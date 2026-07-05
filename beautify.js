/**
 * beautify.js — Pretty-printer sederhana untuk JSON, HTML, XML, dan JavaScript,
 * plus util deteksi tipe konten & hex dump.
 * Tidak memakai library eksternal berat — cukup untuk kebutuhan viewer.
 */

export function beautifyJSON(text) {
  const parsed = JSON.parse(text);
  return JSON.stringify(parsed, null, 2);
}

export function minifyJSON(text) {
  return JSON.stringify(JSON.parse(text));
}

/** Pretty-print markup (HTML/XML) dengan indentasi berbasis tag. */
export function beautifyMarkup(text, indentSize = 2) {
  const src = text.replace(/>\s*</g, "><").trim();
  const tokens = src.split(/(<[^>]+>)/g).filter((t) => t.length);

  let indent = 0;
  const pad = (n) => " ".repeat(n * indentSize);
  const lines = [];
  const voidTags = new Set(["br", "hr", "img", "input", "meta", "link", "source", "area", "base", "col", "embed", "track", "wbr"]);

  for (const token of tokens) {
    if (!token.trim()) continue;

    if (token.startsWith("</")) {
      indent = Math.max(0, indent - 1);
      lines.push(pad(indent) + token);
      continue;
    }

    if (token.startsWith("<")) {
      const isComment = token.startsWith("<!--");
      const isDecl = token.startsWith("<!") || token.startsWith("<?");
      const selfClosing = /\/>\s*$/.test(token);
      const tagNameMatch = token.match(/^<([a-zA-Z0-9:-]+)/);
      const tagName = tagNameMatch ? tagNameMatch[1].toLowerCase() : "";

      lines.push(pad(indent) + token);

      if (!isComment && !isDecl && !selfClosing && !voidTags.has(tagName)) {
        indent++;
      }
      continue;
    }

    // text node
    lines.push(pad(indent) + token.trim());
  }

  return lines.join("\n");
}

export function beautifyXML(text) {
  return beautifyMarkup(text);
}
export function beautifyHTML(text) {
  return beautifyMarkup(text);
}

/** Beautify JS minimal: normalisasi indentasi berbasis kurung kurawal/kurung siku. */
export function beautifyJS(text) {
  let indent = 0;
  const indentSize = 2;
  const out = [];
  let current = "";
  let inString = null;

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) out.push(" ".repeat(indent * indentSize) + trimmed);
    current = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    current += ch;

    if (inString) {
      if (ch === inString && text[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }

    if (ch === "{" || ch === "[") {
      flush();
      indent++;
    } else if (ch === "}" || ch === "]") {
      current = current.slice(0, -1);
      flush();
      indent = Math.max(0, indent - 1);
      current = ch;
    } else if (ch === ";" || (ch === "," && text[i + 1] === "\n")) {
      flush();
    } else if (ch === "\n") {
      flush();
    }
  }
  flush();
  return out.join("\n");
}

/** Deteksi tipe konten dari content-type header atau isi teks. */
export function detectContentKind(contentType = "", body = "") {
  const ct = contentType.toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("javascript")) return "javascript";
  if (ct.includes("text")) return "text";

  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<?xml")) return "xml";
  if (trimmed.startsWith("<")) return "html";
  return "text";
}

/** Beautify generik berdasarkan kind. Melempar error bila gagal parse (biarkan caller fallback ke raw). */
export function beautifyByKind(text, kind) {
  switch (kind) {
    case "json": return beautifyJSON(text);
    case "html": return beautifyHTML(text);
    case "xml": return beautifyXML(text);
    case "javascript": return beautifyJS(text);
    default: return text;
  }
}

/** Hex dump ala `xxd`: offset | hex bytes | ascii. */
export function toHexDump(input) {
  let bytes;
  if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }

  const lines = [];
  const width = 16;
  for (let offset = 0; offset < bytes.length; offset += width) {
    const chunk = bytes.subarray(offset, offset + width);
    const hexParts = [];
    let ascii = "";
    for (let i = 0; i < width; i++) {
      if (i < chunk.length) {
        const b = chunk[i];
        hexParts.push(b.toString(16).padStart(2, "0"));
        ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
      } else {
        hexParts.push("  ");
      }
      if (i === 7) hexParts.push("");
    }
    const offsetStr = offset.toString(16).padStart(8, "0");
    lines.push(`${offsetStr}  ${hexParts.join(" ")}  |${ascii}|`);
  }
  return lines.join("\n") || "(empty)";
}

export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
