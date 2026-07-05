/**
 * curl.js — Konversi antara representasi internal Request <-> cURL command <-> Raw HTTP text.
 *
 * Request object shape yang dipakai di seluruh app:
 * {
 *   method: "GET",
 *   url: "https://example.com/path?x=1",
 *   headers: [{ key, value, enabled }],
 *   body: "raw body string",
 * }
 */

// -----------------------------------------------------------------
// TOKENIZER shell sederhana (mendukung single/double quote & escape)
// -----------------------------------------------------------------
function tokenizeShellCommand(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let i = 0;

  // Gabungkan continuation line "\\\n" jadi satu baris.
  const normalized = input.replace(/\\\r?\n/g, " ");

  while (i < normalized.length) {
    const ch = normalized[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === "\\" && '"$`\\'.includes(normalized[i + 1])) {
        current += normalized[i + 1];
        i += 2;
        continue;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }

    if (ch === "\\" && i + 1 < normalized.length) {
      current += normalized[i + 1];
      i += 2;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ""; }
      i++;
      continue;
    }

    current += ch;
    i++;
  }
  if (current) tokens.push(current);
  return tokens;
}

// -----------------------------------------------------------------
// cURL -> Request
// -----------------------------------------------------------------
export function curlToRequest(curlText) {
  const tokens = tokenizeShellCommand(curlText.trim()).filter((t) => t !== "curl");

  const req = { method: null, url: "", headers: [], body: "", queryFromG: null };
  const dataParts = [];
  let isFormMultipart = false;
  let userPass = null;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const next = () => tokens[++i];

    switch (tok) {
      case "-X":
      case "--request":
        req.method = next().toUpperCase();
        break;
      case "-H":
      case "--header": {
        const h = next();
        const idx = h.indexOf(":");
        if (idx > -1) {
          req.headers.push({ key: h.slice(0, idx).trim(), value: h.slice(idx + 1).trim(), enabled: true });
        }
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-ascii":
        dataParts.push(next());
        break;
      case "--data-binary":
        dataParts.push(next());
        break;
      case "--data-urlencode":
        dataParts.push(next());
        break;
      case "-F":
      case "--form":
        isFormMultipart = true;
        dataParts.push(next());
        break;
      case "-u":
      case "--user":
        userPass = next();
        break;
      case "-b":
      case "--cookie":
        req.headers.push({ key: "Cookie", value: next(), enabled: true });
        break;
      case "-A":
      case "--user-agent":
        req.headers.push({ key: "User-Agent", value: next(), enabled: true });
        break;
      case "-I":
      case "--head":
        req.method = req.method || "HEAD";
        break;
      case "-G":
      case "--get":
        req.method = req.method || "GET";
        break;
      case "-k":
      case "--insecure":
      case "-L":
      case "--location":
      case "--compressed":
      case "-s":
      case "--silent":
      case "-v":
      case "--verbose":
        break; // flag tanpa efek pada model request
      case "--url":
        req.url = next();
        break;
      default:
        if (tok.startsWith("-")) {
          // Flag tak dikenal — jika butuh argumen umumnya diikuti value, kita skip aman.
        } else if (!req.url) {
          req.url = tok;
        }
    }
  }

  if (dataParts.length) {
    req.body = dataParts.join("&");
    if (!req.method) req.method = "POST";
    if (!isFormMultipart && !req.headers.some((h) => h.key.toLowerCase() === "content-type")) {
      req.headers.push({ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true });
    }
  }

  if (userPass) {
    const encoded = btoa(userPass);
    req.headers.push({ key: "Authorization", value: `Basic ${encoded}`, enabled: true });
  }

  req.method = req.method || "GET";
  delete req.queryFromG;
  return req;
}

// -----------------------------------------------------------------
// Request -> cURL
// -----------------------------------------------------------------
function shellQuote(str) {
  if (str === "") return "''";
  return "'" + String(str).replace(/'/g, `'\\''`) + "'";
}

export function requestToCurl(req) {
  const parts = ["curl"];
  parts.push("-X", req.method || "GET");
  parts.push(shellQuote(req.url || ""));

  for (const h of req.headers || []) {
    if (h.enabled === false || !h.key) continue;
    parts.push("-H", shellQuote(`${h.key}: ${h.value ?? ""}`));
  }

  if (req.body) {
    parts.push("--data-raw", shellQuote(req.body));
  }

  return parts.join(" \\\n  ");
}

// -----------------------------------------------------------------
// Request -> Raw HTTP text
// -----------------------------------------------------------------
export function requestToRaw(req) {
  let url;
  try { url = new URL(req.url); } catch { url = null; }

  const path = url ? `${url.pathname}${url.search}` || "/" : req.url;
  const lines = [`${req.method || "GET"} ${path} HTTP/1.1`];

  const hasHost = (req.headers || []).some((h) => h.key.toLowerCase() === "host");
  if (!hasHost && url) lines.push(`Host: ${url.host}`);

  for (const h of req.headers || []) {
    if (h.enabled === false || !h.key) continue;
    lines.push(`${h.key}: ${h.value ?? ""}`);
  }

  lines.push("");
  if (req.body) lines.push(req.body);

  return lines.join("\n");
}

// -----------------------------------------------------------------
// Raw HTTP text -> Request
// -----------------------------------------------------------------
export function rawToRequest(rawText, baseUrl = "") {
  const normalized = rawText.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  const requestLine = lines[0] || "";
  const m = requestLine.match(/^([A-Z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?/);
  const method = m ? m[1] : "GET";
  const path = m ? m[2] : "/";

  const headers = [];
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") { i++; break; }
    const idx = line.indexOf(":");
    if (idx > -1) {
      headers.push({ key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim(), enabled: true });
    }
  }

  const body = lines.slice(i).join("\n");

  let url = path;
  const hostHeader = headers.find((h) => h.key.toLowerCase() === "host");
  if (/^https?:\/\//i.test(path)) {
    url = path;
  } else if (hostHeader) {
    const scheme = baseUrl.startsWith("http://") ? "http" : "https";
    url = `${scheme}://${hostHeader.value}${path}`;
  } else if (baseUrl) {
    try {
      url = new URL(path, baseUrl).toString();
    } catch {
      url = baseUrl + path;
    }
  }

  return { method, url, headers, body };
}
