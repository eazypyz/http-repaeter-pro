/**
 * HTTP Repeater Pro — Cloudflare Worker
 * ---------------------------------------------------------
 * Bertindak sebagai reverse proxy antara frontend (GitHub Pages)
 * dan target website, agar browser tidak pernah melakukan fetch
 * langsung ke target (menghindari CORS & menyembunyikan asal request).
 *
 * Deploy:
 *   wrangler deploy
 *
 * Endpoint:
 *   POST /request   -> proxy satu HTTP request ke target
 *   GET  /health     -> health check sederhana
 */

// =========================================================
// KONFIGURASI — sesuaikan sebelum deploy
// =========================================================

/** Origin frontend yang diizinkan mengakses worker ini. */
const ALLOWED_ORIGINS = [
  "https://eazypyz.github.io",
  "http://localhost:5173",     // dev lokal (boleh dihapus di production)
  "http://127.0.0.1:5173",
];

const WORKER_URL = "https://empty-disk-47c9.airdrop445.workers.dev/";

/** Batas ukuran request body yang dikirim ke worker (bytes). */
const MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10 MB

/** Batas ukuran response body yang dibaca dari target (bytes). */
const MAX_RESPONSE_SIZE = 20 * 1024 * 1024; // 20 MB

/** Timeout fetch ke target (ms). */
const FETCH_TIMEOUT_MS = 30_000;

/** Jumlah percobaan ulang jika fetch ke target gagal karena error jaringan. */
const MAX_RETRIES = 2;

/** Redirect maksimum yang diikuti otomatis oleh fetch (0 = jangan follow). */
const MAX_REDIRECTS = 5;

// =========================================================
// UTIL — respons & error
// =========================================================

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function errorResponse(message, status, origin, code = "ERROR") {
  return jsonResponse(
    { error: true, code, message },
    status,
    origin
  );
}

// =========================================================
// VALIDASI TARGET URL — anti SSRF
// =========================================================

/** Rentang IPv4 privat / loopback / link-local yang diblokir. */
function isPrivateIPv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 127) return true;                       // loopback
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 169 && b === 254) return true;           // link-local
  if (a === 0) return true;                          // 0.0.0.0/8
  return false;
}

function isBlockedHostname(hostname) {
  const h = hostname.toLowerCase().replace(/\[|\]/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h === "::1") return true;
  if (h === "0.0.0.0") return true;
  if (isPrivateIPv4(h)) return true;
  // IPv6 unique-local (fc00::/7) & link-local (fe80::/10) — cek prefix kasar
  if (/^fc[0-9a-f]{2}:/i.test(h) || /^fd[0-9a-f]{2}:/i.test(h)) return true;
  if (/^fe80:/i.test(h)) return true;
  // Cloud metadata endpoint (AWS/GCP/Azure) — target populer untuk SSRF
  if (h === "169.254.169.254" || h === "metadata.google.internal") return true;
  return false;
}

/**
 * Validasi & normalisasi URL target.
 * Melempar Error dengan pesan yang aman untuk ditampilkan ke user jika tidak valid.
 */
function validateTargetUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL tidak valid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Hanya protokol http dan https yang diizinkan.");
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error(
      "Target ke localhost, loopback, atau alamat IP privat tidak diizinkan."
    );
  }

  return url;
}

// =========================================================
// FETCH KE TARGET — dengan timeout, retry, limit ukuran
// =========================================================

async function fetchWithTimeout(input, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Baca body response dengan pembatasan ukuran, kembalikan ArrayBuffer. */
async function readBodyWithLimit(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);

  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel();
      throw new Error(`Response melebihi batas ukuran (${maxBytes} bytes).`);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

/** Deteksi apakah content-type kemungkinan besar berupa teks (untuk keputusan encoding). */
function isProbablyText(contentType) {
  if (!contentType) return true;
  return /text|json|xml|javascript|html|csv|urlencoded|svg/i.test(contentType);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function proxyRequest(payload) {
  const { url: rawUrl, method = "GET", headers = {}, body, bodyIsBase64 } = payload;

  const url = validateTargetUrl(rawUrl);

  // Bersihkan header yang tidak boleh di-forward / bisa memicu error di Workers runtime
  const forwardHeaders = new Headers();
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (["host", "content-length", "connection"].includes(lower)) continue;
    try {
      forwardHeaders.set(key, String(value));
    } catch {
      /* header tidak valid, skip */
    }
  }

  const methodUpper = String(method).toUpperCase();
  const bodyAllowed = !["GET", "HEAD"].includes(methodUpper);

  let fetchBody;
  if (bodyAllowed && body != null && body !== "") {
    fetchBody = bodyIsBase64
      ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
      : body;
  }

  const init = {
    method: methodUpper,
    headers: forwardHeaders,
    body: fetchBody,
    redirect: MAX_REDIRECTS > 0 ? "follow" : "manual",
  };

  const startedAt = Date.now();
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url.toString(), init, FETCH_TIMEOUT_MS);
      const ttfb = Date.now() - startedAt;

      const contentType = response.headers.get("content-type") || "";
      const bodyBuffer = await readBodyWithLimit(response, MAX_RESPONSE_SIZE);
      const totalTime = Date.now() - startedAt;

      const responseHeaders = {};
      for (const [k, v] of response.headers.entries()) responseHeaders[k] = v;

      const asText = isProbablyText(contentType);
      const bodyOut = asText
        ? new TextDecoder("utf-8", { fatal: false }).decode(bodyBuffer)
        : arrayBufferToBase64(bodyBuffer);

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: bodyOut,
        bodyIsBase64: !asText,
        size: bodyBuffer.byteLength,
        time: totalTime,
        timing: {
          // Cloudflare Workers tidak mengekspos DNS/TLS/connect time secara granular
          // dari fetch() standar; kita laporkan apa yang tersedia dan estimasi TTFB.
          ttfb,
          total: totalTime,
        },
        redirected: response.redirected,
        finalUrl: response.url,
      };
    } catch (err) {
      lastError = err;
      if (err.name === "AbortError") {
        throw new Error(`Request timeout setelah ${FETCH_TIMEOUT_MS}ms.`);
      }
      if (attempt === MAX_RETRIES) break;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }

  throw new Error(
    `Gagal menghubungi target: ${lastError?.message || "unknown error"}`
  );
}

// =========================================================
// HANDLER UTAMA
// =========================================================

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Validasi origin untuk semua request non-OPTIONS
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return errorResponse(
        "Origin tidak diizinkan mengakses worker ini.",
        403,
        origin,
        "FORBIDDEN_ORIGIN"
      );
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ ok: true, service: "http-repeater-pro-worker" }, 200, origin);
    }

    if (url.pathname === "/request" && request.method === "POST") {
      try {
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength && contentLength > MAX_REQUEST_SIZE) {
          return errorResponse(
            `Request body melebihi batas ${MAX_REQUEST_SIZE} bytes.`,
            413,
            origin,
            "REQUEST_TOO_LARGE"
          );
        }

        const rawBody = await request.text();
        if (rawBody.length > MAX_REQUEST_SIZE) {
          return errorResponse(
            `Request body melebihi batas ${MAX_REQUEST_SIZE} bytes.`,
            413,
            origin,
            "REQUEST_TOO_LARGE"
          );
        }

        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return errorResponse("Body request bukan JSON yang valid.", 400, origin, "INVALID_JSON");
        }

        if (!payload || typeof payload.url !== "string" || !payload.url) {
          return errorResponse("Field 'url' wajib diisi.", 400, origin, "MISSING_URL");
        }

        const result = await proxyRequest(payload);
        return jsonResponse(result, 200, origin);
      } catch (err) {
        return errorResponse(err.message || "Terjadi kesalahan pada worker.", 502, origin, "PROXY_ERROR");
      }
    }

    return errorResponse("Not found.", 404, origin, "NOT_FOUND");
  },
};
