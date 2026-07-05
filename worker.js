
/**
 * HTTP Repeater Pro - Cloudflare Worker
 * Reverse Proxy with Security & CORS
 */

const CONFIG = {
  ALLOWED_ORIGINS: [
    "https://eazypyz.github.io",
    "http://localhost:3000",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8080",
  ],
  MAX_REQUEST_SIZE: 10 * 1024 * 1024,
  MAX_RESPONSE_SIZE: 10 * 1024 * 1024,
  DEFAULT_TIMEOUT: 30000,
  MAX_TIMEOUT: 120000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  BLOCKED_HOSTS: ["localhost", "127.0.0.1", "::1", "0.0.0.0"],
  BLOCKED_IP_PATTERNS: [
    /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./, /^169\.254\./, /^::1$/, /^fc00:/, /^fe80:/,
  ],
};

function getCorsHeaders(origin) {
  const allowed = CONFIG.ALLOWED_ORIGINS.includes(origin) ? origin : CONFIG.ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": "true",
  };
}

function isBlockedHost(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (CONFIG.BLOCKED_HOSTS.includes(hostname)) return true;
    for (const p of CONFIG.BLOCKED_IP_PATTERNS) { if (p.test(hostname)) return true; }
    return false;
  } catch { return true; }
}

function validateUrl(url) {
  if (!url || typeof url !== "string") return { valid: false, error: "URL is required" };
  if (!url.startsWith("http://") && !url.startsWith("https://")) return { valid: false, error: "URL must start with http:// or https://" };
  if (isBlockedHost(url)) return { valid: false, error: "Access to localhost and private IP addresses is not allowed" };
  return { valid: true };
}

function validateSize(body, max) {
  if (!body) return { valid: true };
  const size = new Blob([body]).size;
  if (size > max) return { valid: false, error: `Body too large (${size} bytes). Max: ${max} bytes` };
  return { valid: true };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) },
  });
}

function errorResponse(error, status, origin) {
  return jsonResponse({ error, status }, status, origin);
}

async function handleRequest(request, origin) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { url, method = "GET", headers = {}, body: reqBody, timeout = CONFIG.DEFAULT_TIMEOUT } = body;

    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) return errorResponse(urlValidation.error, 400, origin);

    const sizeValidation = validateSize(reqBody, CONFIG.MAX_REQUEST_SIZE);
    if (!sizeValidation.valid) return errorResponse(sizeValidation.error, 413, origin);

    const reqTimeout = Math.min(Math.max(parseInt(timeout) || CONFIG.DEFAULT_TIMEOUT, 1000), CONFIG.MAX_TIMEOUT);

    const fetchOptions = {
      method: method.toUpperCase(),
      headers: {},
      redirect: "follow",
    };

    const blockedHeaders = ["host", "content-length", "transfer-encoding", "connection", "expect"];
    Object.entries(headers).forEach(([k, v]) => {
      if (!blockedHeaders.includes(k.toLowerCase())) fetchOptions.headers[k] = String(v);
    });

    if (reqBody && !["GET", "HEAD"].includes(method.toUpperCase())) {
      fetchOptions.body = reqBody;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), reqTimeout);

    let response, lastError;
    for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      try {
        response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        break;
      } catch (err) {
        lastError = err;
        if (err.name === "AbortError") {
          clearTimeout(timeoutId);
          return errorResponse("Request timeout", 408, origin);
        }
        if (attempt < CONFIG.MAX_RETRIES) await sleep(CONFIG.RETRY_DELAY * (attempt + 1));
      }
    }

    clearTimeout(timeoutId);
    if (!response) return errorResponse(lastError?.message || "Request failed after retries", 502, origin);

    let responseBody = "";
    let responseSize = 0;
    try {
      const cloned = response.clone();
      const buffer = await cloned.arrayBuffer();
      responseSize = buffer.byteLength;
      if (responseSize > CONFIG.MAX_RESPONSE_SIZE) {
        responseBody = `[Response too large: ${responseSize} bytes. Max: ${CONFIG.MAX_RESPONSE_SIZE} bytes]`;
      } else {
        responseBody = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
      }
    } catch (e) {
      responseBody = `[Failed to read response body: ${e.message}]`;
    }

    const responseHeaders = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    return jsonResponse({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      time: Date.now() - startTime,
      size: responseSize,
      url: response.url,
      redirected: response.redirected,
    }, 200, origin);

  } catch (error) {
    return errorResponse(error.message || "Internal server error", 500, origin);
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
    }

    if (url.pathname === "/request" && request.method === "POST") {
      return handleRequest(request, origin);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ status: "ok", service: "HTTP Repeater Pro", version: "1.0.0", timestamp: new Date().toISOString() }, 200, origin);
    }

    return errorResponse("Not found. Use POST /request", 404, origin);
  },
};
