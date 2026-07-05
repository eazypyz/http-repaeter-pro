/**
 * HTTP Repeater Pro - Cloudflare Worker
 * Reverse Proxy with Security & CORS
 */

// ===== CONFIGURATION =====
const CONFIG = {
  // Whitelist of allowed origins (update with your GitHub Pages URL)
  ALLOWED_ORIGINS: [
    "https://YOUR_USERNAME.github.io",
    "http://localhost:3000",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8080",
  ],

  // Request limits
  MAX_REQUEST_SIZE: 10 * 1024 * 1024,    // 10MB
  MAX_RESPONSE_SIZE: 10 * 1024 * 1024,   // 10MB
  DEFAULT_TIMEOUT: 30000,                   // 30 seconds
  MAX_TIMEOUT: 120000,                      // 120 seconds

  // Retry config
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,

  // Security
  BLOCKED_HOSTS: [
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
  ],
  BLOCKED_IP_PATTERNS: [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/,
  ],
};

// ===== CORS HEADERS =====
function getCorsHeaders(origin) {
  const allowedOrigin = CONFIG.ALLOWED_ORIGINS.includes(origin) ? origin : CONFIG.ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": "true",
  };
}

// ===== SECURITY VALIDATION =====
function isBlockedHost(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Check blocked hostnames
    if (CONFIG.BLOCKED_HOSTS.includes(hostname)) {
      return true;
    }

    // Check blocked IP patterns
    for (const pattern of CONFIG.BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return true;
      }
    }

    return false;
  } catch {
    return true;
  }
}

function validateUrl(url) {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "URL is required" };
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { valid: false, error: "URL must start with http:// or https://" };
  }

  if (isBlockedHost(url)) {
    return { valid: false, error: "Access to localhost and private IP addresses is not allowed" };
  }

  return { valid: true };
}

function validateRequestSize(body) {
  if (!body) return { valid: true };

  const size = new Blob([body]).size;
  if (size > CONFIG.MAX_REQUEST_SIZE) {
    return {
      valid: false,
      error: `Request body too large (${formatSize(size)}). Max: ${formatSize(CONFIG.MAX_REQUEST_SIZE)}`,
    };
  }
  return { valid: true };
}

// ===== UTILITY FUNCTIONS =====
function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateResponse(body, maxSize) {
  if (!body) return "";
  const size = new Blob([body]).size;
  if (size <= maxSize) return body;

  // For text responses, truncate with notice
  if (typeof body === "string") {
    return body.substring(0, maxSize) + "\n\n[Response truncated - exceeded max size]";
  }
  return body;
}

// ===== RESPONSE HELPERS =====
function jsonResponse(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function errorResponse(error, status = 400, origin) {
  return jsonResponse({ error, status }, status, origin);
}

// ===== MAIN REQUEST HANDLER =====
async function handleRequest(request, origin) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { url, method = "GET", headers = {}, body: requestBody, timeout = CONFIG.DEFAULT_TIMEOUT } = body;

    // Validate URL
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      return errorResponse(urlValidation.error, 400, origin);
    }

    // Validate request size
    const sizeValidation = validateRequestSize(requestBody);
    if (!sizeValidation.valid) {
      return errorResponse(sizeValidation.error, 413, origin);
    }

    // Validate timeout
    const reqTimeout = Math.min(Math.max(parseInt(timeout) || CONFIG.DEFAULT_TIMEOUT, 1000), CONFIG.MAX_TIMEOUT);

    // Prepare fetch options
    const fetchOptions = {
      method: method.toUpperCase(),
      headers: {},
      redirect: "follow",
    };

    // Set headers (filter out problematic ones)
    const blockedHeaders = ["host", "content-length", "transfer-encoding", "connection", "expect"];
    Object.entries(headers).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (!blockedHeaders.includes(lowerKey)) {
        fetchOptions.headers[key] = String(value);
      }
    });

    // Set body
    if (requestBody && !["GET", "HEAD"].includes(method.toUpperCase())) {
      fetchOptions.body = requestBody;
    }

    // Execute request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), reqTimeout);

    let response;
    let lastError;

    // Retry logic
    for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      try {
        response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });
        break;
      } catch (err) {
        lastError = err;
        if (err.name === "AbortError") {
          clearTimeout(timeoutId);
          return errorResponse("Request timeout", 408, origin);
        }
        if (attempt < CONFIG.MAX_RETRIES) {
          await sleep(CONFIG.RETRY_DELAY * (attempt + 1));
        }
      }
    }

    clearTimeout(timeoutId);

    if (!response) {
      return errorResponse(lastError?.message || "Request failed after retries", 502, origin);
    }

    // Read response body
    let responseBody = "";
    let responseSize = 0;

    try {
      const cloned = response.clone();
      const buffer = await cloned.arrayBuffer();
      responseSize = buffer.byteLength;

      if (responseSize > CONFIG.MAX_RESPONSE_SIZE) {
        responseBody = `[Response too large: ${formatSize(responseSize)}. Max: ${formatSize(CONFIG.MAX_RESPONSE_SIZE)}]`;
      } else {
        // Try to read as text first
        const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
        responseBody = text;
      }
    } catch (e) {
      responseBody = `[Failed to read response body: ${e.message}]`;
    }

    // Extract response headers
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const totalTime = Date.now() - startTime;

    return jsonResponse(
      {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        time: totalTime,
        size: responseSize,
        url: response.url,
        redirected: response.redirected,
      },
      200,
      origin
    );
  } catch (error) {
    return errorResponse(error.message || "Internal server error", 500, origin);
  }
}

// ===== FETCH EVENT HANDLER =====
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(origin),
      });
    }

    // Only allow POST to /request
    if (url.pathname === "/request" && request.method === "POST") {
      return handleRequest(request, origin);
    }

    // Health check endpoint
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse(
        {
          status: "ok",
          service: "HTTP Repeater Pro Worker",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
        },
        200,
        origin
      );
    }

    // Default: not found
    return errorResponse("Not found. Use POST /request", 404, origin);
  },
};
