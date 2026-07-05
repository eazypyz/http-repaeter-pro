/**
 * editor.js — Wrapper CodeMirror 6 untuk semua text-editor di aplikasi.
 *
 * Menyediakan:
 *  - Raw HTTP request editor (syntax highlight ringan + header autocomplete)
 *  - Body editor (JSON / XML / HTML / text)
 *  - Response viewer read-only (pretty / raw)
 *
 * CodeMirror 6 dimuat sebagai ES module langsung dari CDN (esm.sh), tanpa bundler,
 * sesuai requirement "vanilla JS tanpa framework, tanpa Node.js build step".
 */

import { EditorView, basicSetup } from "https://esm.sh/codemirror@6.0.1?bundle";
import { EditorState, Compartment } from "https://esm.sh/@codemirror/state@6.4.1?bundle";
import { json } from "https://esm.sh/@codemirror/lang-json@6.0.1?bundle";
import { html } from "https://esm.sh/@codemirror/lang-html@6.4.9?bundle";
import { xml } from "https://esm.sh/@codemirror/lang-xml@6.1.0?bundle";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6.2.2?bundle";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6.1.2?bundle";
import {
  autocompletion,
} from "https://esm.sh/@codemirror/autocomplete@6.16.0?bundle";
import {
  ViewPlugin,
  Decoration,
  keymap,
} from "https://esm.sh/@codemirror/view@6.26.3?bundle";

// -----------------------------------------------------------------
// Header names umum, dipakai untuk "Auto Complete Header"
// -----------------------------------------------------------------
export const COMMON_HEADERS = [
  "Accept", "Accept-Encoding", "Accept-Language", "Authorization",
  "Cache-Control", "Connection", "Content-Length", "Content-Type",
  "Cookie", "Host", "Origin", "Referer", "User-Agent", "X-Requested-With",
  "X-API-Key", "X-Forwarded-For", "X-CSRF-Token", "Accept-Charset",
  "If-None-Match", "If-Modified-Since", "Pragma", "Upgrade-Insecure-Requests",
  "Sec-Fetch-Mode", "Sec-Fetch-Site", "Sec-Fetch-Dest", "TE",
];

const HEADER_VALUE_HINTS = {
  "Content-Type": [
    "application/json", "application/xml", "application/x-www-form-urlencoded",
    "multipart/form-data", "text/plain", "text/html", "application/octet-stream",
  ],
  Accept: ["application/json", "*/*", "text/html", "application/xml"],
  Connection: ["keep-alive", "close"],
  "Cache-Control": ["no-cache", "no-store", "max-age=0"],
};

/** Completion source untuk raw HTTP editor: nama header di awal baris. */
function httpHeaderCompletionSource(context) {
  const line = context.state.doc.lineAt(context.pos);
  const textBeforeCursor = line.text.slice(0, context.pos - line.from);

  // Baris pertama = request line (METHOD /path HTTP/1.1) — tidak di-autocomplete di sini.
  if (line.number === 1) return null;

  // Jika sudah ada ":" di baris ini, coba tawarkan value hint.
  const colonIdx = textBeforeCursor.indexOf(":");
  if (colonIdx === -1) {
    const word = context.matchBefore(/[\w-]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return {
      from: word.from,
      options: COMMON_HEADERS.map((h) => ({ label: h, type: "property", apply: h + ": " })),
      validFor: /[\w-]*/,
    };
  }

  const headerName = textBeforeCursor.slice(0, colonIdx).trim();
  const hints = HEADER_VALUE_HINTS[headerName];
  if (!hints) return null;
  const word = context.matchBefore(/[\w./+-]*/);
  return {
    from: word ? word.from : context.pos,
    options: hints.map((v) => ({ label: v, type: "value" })),
  };
}

// -----------------------------------------------------------------
// Syntax highlight ringan untuk Raw HTTP editor via ViewPlugin + Decoration
// (bukan grammar penuh — cukup untuk membedakan method, URL, header key, dsb.)
// -----------------------------------------------------------------
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "CONNECT", "TRACE"];

const httpHighlightPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.buildDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }
    buildDecorations(view) {
      const widgets = [];
      const doc = view.state.doc;
      const lineCount = doc.lines;

      for (let i = 1; i <= Math.min(lineCount, 4000); i++) {
        const line = doc.line(i);
        const text = line.text;
        if (text.trim() === "") continue;

        if (i === 1) {
          const m = text.match(/^([A-Z]+)(\s+)(\S+)(\s+HTTP\/[\d.]+)?/);
          if (m) {
            const methodEnd = line.from + m[1].length;
            widgets.push(
              Decoration.mark({ class: "tok-method" }).range(line.from, methodEnd)
            );
            const pathStart = line.from + m[1].length + m[2].length;
            const pathEnd = pathStart + m[3].length;
            widgets.push(Decoration.mark({ class: "tok-path" }).range(pathStart, pathEnd));
          }
          continue;
        }

        const colon = text.indexOf(":");
        if (colon > 0 && /^[\w-]+$/.test(text.slice(0, colon))) {
          widgets.push(
            Decoration.mark({ class: "tok-header-key" }).range(line.from, line.from + colon)
          );
        }
      }
      return Decoration.set(widgets, true);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// Inject sedikit CSS untuk token highlight (sekali saja).
(function injectTokenStyles() {
  if (document.getElementById("cm-token-styles")) return;
  const style = document.createElement("style");
  style.id = "cm-token-styles";
  style.textContent = `
    .tok-method { color: #ff8a3d; font-weight: 700; }
    .tok-path { color: #5eead4; }
    .tok-header-key { color: #63b3ed; font-weight: 600; }
  `;
  document.head.appendChild(style);
})();

// -----------------------------------------------------------------
// Compartments agar language & wordwrap bisa direconfigure runtime
// -----------------------------------------------------------------
const languageCompartment = new Compartment();
const wrapCompartment = new Compartment();

function langExtensionFor(mode) {
  switch (mode) {
    case "json": return json();
    case "xml": return xml();
    case "html": return html();
    case "javascript": return javascript();
    default: return [];
  }
}

/**
 * Buat instance editor CodeMirror generik.
 * @param {HTMLElement} parent
 * @param {object} opts { doc, mode, readOnly, onChange, wordWrap, extraExtensions }
 */
export function createEditor(parent, opts = {}) {
  const {
    doc = "",
    mode = null,
    readOnly = false,
    onChange = null,
    wordWrap = true,
    httpSyntax = false,
    extraExtensions = [],
  } = opts;

  const extensions = [
    basicSetup,
    oneDark,
    languageCompartment.of(langExtensionFor(mode)),
    wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
    autocompletion(httpSyntax ? { override: [httpHeaderCompletionSource] } : {}),
    EditorState.readOnly.of(readOnly),
    EditorView.theme({}, { dark: true }),
    ...extraExtensions,
  ];

  if (httpSyntax) extensions.push(httpHighlightPlugin);

  if (onChange) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      })
    );
  }

  const state = EditorState.create({ doc, extensions });
  const view = new EditorView({ state, parent });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (text) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    setMode: (newMode) => {
      view.dispatch({ effects: languageCompartment.reconfigure(langExtensionFor(newMode)) });
    },
    setWordWrap: (enabled) => {
      view.dispatch({ effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

export { EditorView };
