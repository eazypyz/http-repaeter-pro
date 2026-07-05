/**
 * app.js — Entry point & orkestrasi utama HTTP Repeater Pro.
 * Menghubungkan: tabs.js, editor.js, curl.js, beautify.js, history.js
 * dengan DOM di index.html.
 */

import { createEditor } from "./editor.js";
import { TabManager, createDefaultTab } from "./tabs.js";
import { historyStore } from "./history.js";
import { curlToRequest, requestToCurl, requestToRaw, rawToRequest } from "./curl.js";
import { beautifyByKind, detectContentKind, toHexDump, formatBytes } from "./beautify.js";

// =========================================================
// SETTINGS (persist ke localStorage)
// =========================================================
const SETTINGS_KEY = "httprp.settings.v1";
const defaultSettings = { workerUrl: "", timeout: 30000, wordWrap: true };
let settings = { ...defaultSettings, ...loadJSON(SETTINGS_KEY, {}) };

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// =========================================================
// DOM SHORTCUTS
// =========================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// =========================================================
// EDITORS
// =========================================================
const rawEditor = createEditor($("#raw-editor"), {
  httpSyntax: true,
  wordWrap: settings.wordWrap,
  onChange: (text) => onRawEditorChanged(text),
});

const bodyEditor = createEditor($("#body-editor"), {
  mode: "json",
  wordWrap: settings.wordWrap,
  onChange: (text) => onBodyEditorChanged(text),
});

const responsePrettyViewer = createEditor($("#response-pretty"), { readOnly: true, wordWrap: true });
const responseRawViewer = createEditor($("#response-raw"), { readOnly: true, wordWrap: true, mode: "text" });

let suppressRawChange = false;
let suppressBodyChange = false;

// =========================================================
// TAB MANAGER
// =========================================================
const tabManager = new TabManager($("#tabs-list"), {
  onActivate: (tab) => renderTabIntoUI(tab),
  onChange: () => updateStatusBar(),
});
tabManager.addTab(createDefaultTab({ name: "Request 1" }));

$("#btn-new-tab").addEventListener("click", () => tabManager.addTab());

// =========================================================
// SUBTABS (Raw / Headers / Query / Body / Auth / Cookies, Pretty/Raw/Headers/Hex/Timing)
// =========================================================
$$(".subtabs").forEach((nav) => {
  nav.addEventListener("click", (e) => {
    const btn = e.target.closest(".subtab");
    if (!btn) return;
    const group = nav.dataset.group;
    const view = btn.dataset.view;

    nav.querySelectorAll(".subtab").forEach((b) => b.classList.toggle("active", b === btn));
    const container = nav.nextElementSibling; // .subview-container
    container.querySelectorAll(".subview").forEach((sv) => {
      sv.classList.toggle("active", sv.dataset.view === view);
    });

    if (group === "request" && view === "raw") {
      refreshRawEditorFromTab(tabManager.activeTab);
    }
  });
});

// =========================================================
// RENDER TAB -> UI
// =========================================================
function renderTabIntoUI(tab) {
  if (!tab) return;

  $("#method-select").value = tab.method;
  $("#url-input").value = tab.url;

  renderHeadersTable(tab);
  renderQueryTable(tab);
  renderCookiesTable(tab);
  renderAuthForm(tab);
  renderBodySection(tab);
  refreshRawEditorFromTab(tab);
  renderResponse(tab);
}

function refreshRawEditorFromTab(tab) {
  suppressRawChange = true;
  rawEditor.setValue(requestToRaw(tab));
  suppressRawChange = false;
}

function onRawEditorChanged(text) {
  if (suppressRawChange) return;
  const tab = tabManager.activeTab;
  if (!tab) return;
  const parsed = rawToRequest(text, tab.url);
  tab.method = parsed.method;
  tab.url = parsed.url;
  tab.headers = parsed.headers;
  tab.body = parsed.body;

  $("#method-select").value = HTTP_METHODS.includes(tab.method) ? tab.method : "GET";
  $("#url-input").value = tab.url;
  renderHeadersTable(tab);
  renderQueryTable(tab);
  syncTabMethodBadge(tab);
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "CONNECT", "TRACE"];

function syncTabMethodBadge(tab) {
  const el = document.querySelector(`.tab-item[data-tab-id="${tab.id}"] .tab-method`);
  if (el) {
    el.textContent = tab.method;
    el.className = `tab-method m-${tab.method}`;
  }
}

// =========================================================
// METHOD & URL BAR
// =========================================================
$("#method-select").addEventListener("change", (e) => {
  const tab = tabManager.activeTab;
  tab.method = e.target.value;
  syncTabMethodBadge(tab);
});

$("#url-input").addEventListener("input", (e) => {
  const tab = tabManager.activeTab;
  tab.url = e.target.value;
  renderQueryTable(tab);
});

// =========================================================
// KEY-VALUE TABLE HELPERS (headers / query / cookies / form fields)
// =========================================================
function renderKVTable(tbody, rows, { onUpdate, onRemove, placeholderKey = "Key", placeholderValue = "Value", extraColumn }) {
  tbody.innerHTML = "";
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (row.enabled === false) tr.classList.add("row-disabled");

    const tdEnable = document.createElement("td");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = row.enabled !== false;
    chk.onchange = () => { row.enabled = chk.checked; tr.classList.toggle("row-disabled", !chk.checked); onUpdate(); };
    tdEnable.appendChild(chk);

    const tdKey = document.createElement("td");
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.value = row.key ?? "";
    keyInput.placeholder = placeholderKey;
    keyInput.oninput = () => { row.key = keyInput.value; onUpdate(); };
    tdKey.appendChild(keyInput);

    const tdValue = document.createElement("td");
    const valInput = document.createElement("input");
    valInput.type = "text";
    valInput.value = row.value ?? "";
    valInput.placeholder = placeholderValue;
    valInput.oninput = () => { row.value = valInput.value; onUpdate(); };
    tdValue.appendChild(valInput);

    tr.append(tdEnable, tdKey, tdValue);

    if (extraColumn) {
      tr.appendChild(extraColumn(row, onUpdate));
    }

    const tdActions = document.createElement("td");
    const dupBtn = document.createElement("button");
    dupBtn.className = "row-action-btn";
    dupBtn.title = "Duplicate";
    dupBtn.textContent = "⧉";
    dupBtn.onclick = () => { rows.splice(index + 1, 0, { ...row }); onUpdate(true); };

    const delBtn = document.createElement("button");
    delBtn.className = "row-action-btn danger";
    delBtn.title = "Delete";
    delBtn.textContent = "🗑";
    delBtn.onclick = () => { rows.splice(index, 1); onRemove ? onRemove() : onUpdate(true); };

    tdActions.append(dupBtn, delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

// ---------- Headers ----------
function renderHeadersTable(tab) {
  renderKVTable($("#headers-tbody"), tab.headers, {
    onUpdate: (rerender) => { if (rerender) renderHeadersTable(tab); },
    placeholderKey: "Header-Name",
    placeholderValue: "value",
  });
}
$("#btn-add-header").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  tab.headers.push({ key: "", value: "", enabled: true });
  renderHeadersTable(tab);
});
$("#btn-auto-headers").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  const existingKeys = new Set(tab.headers.map((h) => h.key.toLowerCase()));
  const autoDefaults = [
    ["User-Agent", "HTTPRepeaterPro/1.0"],
    ["Accept", "*/*"],
    ["Accept-Encoding", "gzip, deflate, br"],
    ["Connection", "keep-alive"],
  ];
  for (const [k, v] of autoDefaults) {
    if (!existingKeys.has(k.toLowerCase())) tab.headers.push({ key: k, value: v, enabled: true });
  }
  renderHeadersTable(tab);
});

// ---------- Query params (sinkron dengan URL) ----------
function parseQueryFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return Array.from(u.searchParams.entries()).map(([key, value]) => ({ key, value, enabled: true }));
  } catch { return []; }
}

function renderQueryTable(tab) {
  tab.query = parseQueryFromUrl(tab.url);
  renderKVTable($("#query-tbody"), tab.query, {
    onUpdate: (rerender) => { rebuildUrlFromQuery(tab); if (rerender) renderQueryTable(tab); },
    onRemove: () => { rebuildUrlFromQuery(tab); renderQueryTable(tab); },
    placeholderKey: "param",
    placeholderValue: "value",
  });
}

function rebuildUrlFromQuery(tab) {
  try {
    const u = new URL(tab.url);
    const params = new URLSearchParams();
    for (const q of tab.query) {
      if (q.enabled === false || !q.key) continue;
      params.append(q.key, q.value ?? "");
    }
    u.search = params.toString();
    tab.url = u.toString();
    $("#url-input").value = tab.url;
    if (isViewActive("request", "raw")) refreshRawEditorFromTab(tab);
  } catch { /* URL belum valid, biarkan apa adanya */ }
}

$("#btn-add-query").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  try {
    const u = new URL(tab.url);
    u.searchParams.append("param", "value");
    tab.url = u.toString();
    $("#url-input").value = tab.url;
    renderQueryTable(tab);
  } catch { /* ignore */ }
});
$("#btn-encode-query").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  tab.query.forEach((q) => { q.value = encodeURIComponent(q.value ?? ""); });
  rebuildUrlFromQuery(tab);
  renderQueryTable(tab);
});
$("#btn-decode-query").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  tab.query.forEach((q) => { try { q.value = decodeURIComponent(q.value ?? ""); } catch {} });
  rebuildUrlFromQuery(tab);
  renderQueryTable(tab);
});

// ---------- Cookies ----------
function renderCookiesTable(tab) {
  renderKVTable($("#cookies-tbody"), tab.cookies, {
    onUpdate: (rerender) => { if (rerender) renderCookiesTable(tab); },
    placeholderKey: "name",
    placeholderValue: "value",
  });
}
$("#btn-add-cookie").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  tab.cookies.push({ key: "", value: "", enabled: true });
  renderCookiesTable(tab);
});
$("#btn-import-cookie").addEventListener("click", () => {
  const raw = prompt("Paste cookie string (name=value; name2=value2):");
  if (!raw) return;
  const tab = tabManager.activeTab;
  raw.split(";").forEach((pair) => {
    const [key, ...rest] = pair.trim().split("=");
    if (key) tab.cookies.push({ key: key.trim(), value: rest.join("=").trim(), enabled: true });
  });
  renderCookiesTable(tab);
});
$("#btn-export-cookie").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  const str = tab.cookies.filter((c) => c.enabled !== false && c.key)
    .map((c) => `${c.key}=${c.value}`).join("; ");
  navigator.clipboard.writeText(str);
  flashStatus("Cookie disalin ke clipboard.");
});

// ---------- Form fields (multipart / urlencoded) ----------
function renderFormTable(tab) {
  renderKVTable($("#form-tbody"), tab.formFields, {
    onUpdate: (rerender) => { if (rerender) renderFormTable(tab); },
    placeholderKey: "field",
    placeholderValue: "value",
    extraColumn: (row) => {
      const td = document.createElement("td");
      const sel = document.createElement("select");
      sel.className = "select-sm";
      sel.innerHTML = `<option value="text">Text</option><option value="file">File</option>`;
      sel.value = row.type || "text";
      sel.onchange = () => { row.type = sel.value; };
      td.appendChild(sel);
      return td;
    },
  });
}
$("#btn-add-formfield").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  tab.formFields.push({ key: "", value: "", type: "text", enabled: true });
  renderFormTable(tab);
});

// ---------- Body ----------
function renderBodySection(tab) {
  $("#body-type-select").value = tab.bodyType;
  $("#body-raw-container").hidden = !["raw", "json", "xml", "text"].includes(tab.bodyType);
  $("#body-form-container").hidden = !["form-urlencoded", "multipart"].includes(tab.bodyType);
  $("#body-binary-container").hidden = tab.bodyType !== "binary";

  if (["raw", "json", "xml", "text"].includes(tab.bodyType)) {
    suppressBodyChange = true;
    bodyEditor.setMode(tab.bodyType === "text" ? null : tab.bodyType);
    bodyEditor.setValue(tab.body || "");
    suppressBodyChange = false;
  }
  if (["form-urlencoded", "multipart"].includes(tab.bodyType)) {
    renderFormTable(tab);
  }
  if (tab.bodyType === "binary") {
    $("#binary-file-info").textContent = tab.binaryFileName
      ? `File terpilih: ${tab.binaryFileName}`
      : "Belum ada file dipilih.";
  }
}

function onBodyEditorChanged(text) {
  if (suppressBodyChange) return;
  const tab = tabManager.activeTab;
  if (tab) tab.body = text;
}

$("#body-type-select").addEventListener("change", (e) => {
  const tab = tabManager.activeTab;
  tab.bodyType = e.target.value;
  renderBodySection(tab);
});

$("#btn-beautify-body").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  try {
    const kind = tab.bodyType === "raw" || tab.bodyType === "text"
      ? detectContentKind("", bodyEditor.getValue())
      : tab.bodyType;
    const pretty = beautifyByKind(bodyEditor.getValue(), kind);
    bodyEditor.setValue(pretty);
    tab.body = pretty;
  } catch (err) {
    flashStatus("Gagal beautify: " + err.message, true);
  }
});

$("#binary-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const tab = tabManager.activeTab;
  tab.binaryFileName = file.name;
  tab.binaryFileData = await fileToBase64(file);
  tab.binaryMimeType = file.type || "application/octet-stream";
  $("#binary-file-info").textContent = `File terpilih: ${file.name} (${formatBytes(file.size)})`;
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Auth ----------
function renderAuthForm(tab) {
  $("#auth-type-select").value = tab.auth.type;
  const container = $("#auth-form");
  container.innerHTML = "";

  const field = (label, key, placeholder = "", type = "text") => {
    const wrap = document.createElement("div");
    const lbl = document.createElement("label");
    lbl.className = "field-label";
    lbl.textContent = label;
    const input = document.createElement("input");
    input.type = type;
    input.className = "text-input";
    input.placeholder = placeholder;
    input.value = tab.auth[key] || "";
    input.oninput = () => { tab.auth[key] = input.value; };
    wrap.append(lbl, input);
    container.appendChild(wrap);
  };

  switch (tab.auth.type) {
    case "bearer":
      field("Token", "token", "eyJhbGciOi...");
      break;
    case "basic":
      field("Username", "username");
      field("Password", "password", "", "password");
      break;
    case "apikey":
      field("Header/Param Name", "key", "X-API-Key");
      field("Value", "value");
      break;
    case "jwt":
      field("JWT Token", "token", "eyJhbGciOi...");
      break;
    case "cookie":
      field("Cookie String", "cookie", "session=abc123");
      break;
    default:
      container.innerHTML = `<p class="hint-text">Tidak ada autentikasi tambahan.</p>`;
  }
}
$("#auth-type-select").addEventListener("change", (e) => {
  const tab = tabManager.activeTab;
  tab.auth = { type: e.target.value };
  renderAuthForm(tab);
});

/** Hitung header tambahan dari konfigurasi Auth (dipakai saat kirim request). */
function computeAuthHeaders(tab) {
  const extra = [];
  const a = tab.auth;
  switch (a.type) {
    case "bearer":
    case "jwt":
      if (a.token) extra.push({ key: "Authorization", value: `Bearer ${a.token}` });
      break;
    case "basic":
      if (a.username || a.password) {
        extra.push({ key: "Authorization", value: `Basic ${btoa(`${a.username || ""}:${a.password || ""}`)}` });
      }
      break;
    case "apikey":
      if (a.key && a.value) extra.push({ key: a.key, value: a.value });
      break;
    case "cookie":
      if (a.cookie) extra.push({ key: "Cookie", value: a.cookie });
      break;
  }
  return extra;
}

// =========================================================
// VIEW HELPERS
// =========================================================
function isViewActive(group, view) {
  const nav = document.querySelector(`.subtabs[data-group="${group}"]`);
  return nav?.querySelector(".subtab.active")?.dataset.view === view;
}

// =========================================================
// SEND REQUEST
// =========================================================
let currentAbortController = null;

async function buildEffectiveRequest(tab) {
  const headersMap = new Map();
  for (const h of tab.headers) {
    if (h.enabled === false || !h.key) continue;
    headersMap.set(h.key, h.value ?? "");
  }
  for (const h of computeAuthHeaders(tab)) headersMap.set(h.key, h.value);

  const enabledCookies = tab.cookies.filter((c) => c.enabled !== false && c.key);
  if (enabledCookies.length) {
    const cookieStr = enabledCookies.map((c) => `${c.key}=${c.value}`).join("; ");
    const existing = headersMap.get("Cookie");
    headersMap.set("Cookie", existing ? `${existing}; ${cookieStr}` : cookieStr);
  }

  let body;
  let bodyIsBase64 = false;

  switch (tab.bodyType) {
    case "json":
    case "xml":
    case "raw":
    case "text":
      body = bodyEditor.getValue();
      if (!headersMap.has("Content-Type")) {
        const ct = { json: "application/json", xml: "application/xml", text: "text/plain", raw: "text/plain" }[tab.bodyType];
        headersMap.set("Content-Type", ct);
      }
      break;

    case "form-urlencoded": {
      const params = new URLSearchParams();
      tab.formFields.forEach((f) => { if (f.enabled !== false && f.key) params.append(f.key, f.value ?? ""); });
      body = params.toString();
      if (!headersMap.has("Content-Type")) headersMap.set("Content-Type", "application/x-www-form-urlencoded");
      break;
    }

    case "multipart": {
      const boundary = "----HTTPRepeaterPro" + Math.random().toString(16).slice(2);
      const encoder = new TextEncoder();
      const chunks = [];
      for (const f of tab.formFields) {
        if (f.enabled === false || !f.key) continue;
        chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value ?? ""}\r\n`));
      }
      chunks.push(encoder.encode(`--${boundary}--\r\n`));
      const totalLen = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.length; }
      body = arrayBufferToBase64(merged.buffer);
      bodyIsBase64 = true;
      headersMap.set("Content-Type", `multipart/form-data; boundary=${boundary}`);
      break;
    }

    case "binary":
      body = tab.binaryFileData || "";
      bodyIsBase64 = true;
      if (!headersMap.has("Content-Type")) headersMap.set("Content-Type", tab.binaryMimeType || "application/octet-stream");
      break;

    default:
      body = undefined;
  }

  const headersObj = {};
  headersMap.forEach((v, k) => { headersObj[k] = v; });

  return { url: tab.url, method: tab.method, headers: headersObj, body, bodyIsBase64 };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function sendActiveRequest() {
  const tab = tabManager.activeTab;
  if (!tab) return;

  if (!settings.workerUrl) {
    flashStatus("Set Worker URL di Settings terlebih dahulu.", true);
    openModal("modal-settings");
    return;
  }

  const payload = await buildEffectiveRequest(tab);

  $("#btn-send").disabled = true;
  $("#btn-cancel").disabled = false;
  setStatusPill("...", "pending");

  currentAbortController = new AbortController();
  const timeoutId = setTimeout(() => currentAbortController.abort(), settings.timeout || 30000);
  const clientStart = performance.now();

  try {
    const res = await fetch(settings.workerUrl.replace(/\/$/, "") + "/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: currentAbortController.signal,
    });
    const clientTime = Math.round(performance.now() - clientStart);
    const data = await res.json();

    if (!res.ok || data.error) {
      tab.response = { error: true, message: data.message || `HTTP ${res.status}`, time: clientTime };
    } else {
      tab.response = { ...data, clientTime };
    }
  } catch (err) {
    const clientTime = Math.round(performance.now() - clientStart);
    tab.response = {
      error: true,
      message: err.name === "AbortError" ? "Request dibatalkan / timeout." : err.message,
      time: clientTime,
    };
  } finally {
    clearTimeout(timeoutId);
    $("#btn-send").disabled = false;
    $("#btn-cancel").disabled = true;
    currentAbortController = null;
  }

  renderResponse(tab);

  historyStore.addEntry({
    tabId: tab.id,
    tabName: tab.name,
    method: tab.method,
    url: tab.url,
    status: tab.response.status ?? "ERR",
    statusText: tab.response.statusText ?? tab.response.message ?? "",
    time: tab.response.time,
    size: tab.response.size,
    requestSnapshot: structuredClone({
      method: tab.method, url: tab.url, headers: tab.headers, body: tab.body, bodyType: tab.bodyType,
    }),
  });
  updateStatusBar();
}

$("#btn-send").addEventListener("click", sendActiveRequest);
$("#btn-cancel").addEventListener("click", () => currentAbortController?.abort());

// =========================================================
// RESPONSE RENDERING
// =========================================================
function setStatusPill(text, cls) {
  const el = $("#response-status");
  el.textContent = text;
  el.className = "status-pill" + (cls ? ` ${cls}` : "");
}

function statusClassFor(status) {
  if (status >= 200 && status < 300) return "s-2xx";
  if (status >= 300 && status < 400) return "s-3xx";
  if (status >= 400 && status < 500) return "s-4xx";
  if (status >= 500) return "s-5xx";
  return "";
}

function renderResponse(tab) {
  const r = tab.response;
  if (!r) {
    setStatusPill("—");
    $("#response-time").textContent = "0 ms";
    $("#response-size").textContent = "0 B";
    responsePrettyViewer.setValue("");
    responseRawViewer.setValue("");
    $("#response-headers-tbody").innerHTML = "";
    $("#response-hex").textContent = "";
    $("#timing-grid").innerHTML = "";
    return;
  }

  if (r.error) {
    setStatusPill("ERR", "s-err");
    $("#response-time").textContent = `${r.time ?? 0} ms`;
    $("#response-size").textContent = "0 B";
    responsePrettyViewer.setValue(r.message || "Terjadi kesalahan.");
    responseRawViewer.setValue(r.message || "");
    $("#response-headers-tbody").innerHTML = "";
    $("#response-hex").textContent = "";
    $("#timing-grid").innerHTML = "";
    return;
  }

  setStatusPill(`${r.status} ${r.statusText || ""}`.trim(), statusClassFor(r.status));
  $("#response-time").textContent = `${r.time} ms`;
  $("#response-size").textContent = formatBytes(r.size || 0);

  const contentType = r.headers?.["content-type"] || r.headers?.["Content-Type"] || "";
  const bodyText = r.bodyIsBase64 ? "(binary content — lihat tab Hex)" : (r.body || "");
  const kind = detectContentKind(contentType, bodyText);

  let pretty = bodyText;
  try { pretty = beautifyByKind(bodyText, kind); } catch { /* fallback ke raw jika gagal parse */ }
  responsePrettyViewer.setMode(kind === "text" ? null : kind);
  responsePrettyViewer.setValue(pretty);
  responseRawViewer.setValue(bodyText);

  const tbody = $("#response-headers-tbody");
  tbody.innerHTML = "";
  for (const [k, v] of Object.entries(r.headers || {})) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td>`;
    tbody.appendChild(tr);
  }

  $("#response-hex").textContent = r.bodyIsBase64
    ? toHexDump(base64ToArrayBuffer(r.body))
    : toHexDump(r.body || "");

  const timingGrid = $("#timing-grid");
  timingGrid.innerHTML = "";
  const timingEntries = [
    ["TTFB", r.timing?.ttfb, "ms"],
    ["Total (server)", r.timing?.total, "ms"],
    ["Total (client)", r.clientTime, "ms"],
    ["Size", formatBytes(r.size || 0), ""],
  ];
  for (const [label, value, unit] of timingEntries) {
    if (value === undefined) continue;
    const card = document.createElement("div");
    card.className = "timing-card";
    card.innerHTML = `<div class="t-label">${label}</div><div class="t-value">${value}${unit}</div>`;
    timingGrid.appendChild(card);
  }
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("#btn-copy-response").addEventListener("click", () => {
  navigator.clipboard.writeText(responsePrettyViewer.getValue());
  flashStatus("Response disalin ke clipboard.");
});
$("#btn-save-response").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  const blob = new Blob([responseRawViewer.getValue()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `response-${tab.name.replace(/\s+/g, "_")}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// =========================================================
// MODALS
// =========================================================
function openModal(id) {
  $("#modal-overlay").hidden = false;
  $$(".modal").forEach((m) => (m.hidden = m.id !== id));
}
function closeModal() {
  $("#modal-overlay").hidden = true;
}
$("#modal-overlay").addEventListener("click", (e) => { if (e.target.id === "modal-overlay") closeModal(); });
$$("[data-close]").forEach((btn) => btn.addEventListener("click", closeModal));

// ---------- Settings ----------
$("#btn-settings").addEventListener("click", () => {
  $("#input-worker-url").value = settings.workerUrl;
  $("#input-timeout").value = settings.timeout;
  $("#input-wordwrap").checked = settings.wordWrap;
  openModal("modal-settings");
});
$("#btn-save-settings").addEventListener("click", () => {
  settings.workerUrl = $("#input-worker-url").value.trim();
  settings.timeout = Number($("#input-timeout").value) || 30000;
  settings.wordWrap = $("#input-wordwrap").checked;
  saveSettings();
  rawEditor.setWordWrap(settings.wordWrap);
  bodyEditor.setWordWrap(settings.wordWrap);
  updateStatusBar();
  closeModal();
});

// ---------- Import cURL ----------
$("#btn-import-curl").addEventListener("click", () => {
  $("#curl-import-textarea").value = "";
  openModal("modal-curl-import");
});
$("#btn-confirm-curl-import").addEventListener("click", () => {
  try {
    const parsed = curlToRequest($("#curl-import-textarea").value);
    const tab = tabManager.addTab(createDefaultTab({
      name: "Imported cURL",
      method: parsed.method,
      url: parsed.url,
      headers: parsed.headers,
      body: parsed.body,
      bodyType: parsed.body ? "raw" : "json",
    }));
    renderTabIntoUI(tab);
    closeModal();
  } catch (err) {
    flashStatus("Gagal parse cURL: " + err.message, true);
  }
});

// ---------- Export cURL ----------
$("#btn-export-curl").addEventListener("click", () => {
  const tab = tabManager.activeTab;
  $("#curl-export-textarea").value = requestToCurl(tab);
  openModal("modal-curl-export");
});
$("#btn-copy-curl-export").addEventListener("click", () => {
  navigator.clipboard.writeText($("#curl-export-textarea").value);
  flashStatus("cURL disalin ke clipboard.");
});

// ---------- Import Raw HTTP ----------
$("#btn-import-raw").addEventListener("click", () => {
  $("#raw-import-textarea").value = "";
  $("#raw-import-baseurl").value = "https://";
  openModal("modal-raw-import");
});
$("#btn-confirm-raw-import").addEventListener("click", () => {
  try {
    const parsed = rawToRequest($("#raw-import-textarea").value, $("#raw-import-baseurl").value);
    const tab = tabManager.addTab(createDefaultTab({
      name: "Imported Raw",
      method: parsed.method,
      url: parsed.url,
      headers: parsed.headers,
      body: parsed.body,
      bodyType: parsed.body ? "raw" : "json",
    }));
    renderTabIntoUI(tab);
    closeModal();
  } catch (err) {
    flashStatus("Gagal parse Raw HTTP: " + err.message, true);
  }
});

// ---------- Save / Load Session ----------
$("#btn-save-session").addEventListener("click", () => {
  const data = tabManager.serialize();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `http-repeater-session-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$("#btn-load-session").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      tabManager.loadSerialized(data);
    } catch (err) {
      flashStatus("Gagal load session: " + err.message, true);
    }
  };
  input.click();
});

// ---------- History ----------
$("#btn-history").addEventListener("click", () => {
  renderHistoryModal();
  openModal("modal-history");
});
function renderHistoryModal() {
  const list = $("#history-list");
  const query = $("#history-search").value;
  list.innerHTML = "";
  for (const entry of historyStore.search(query)) {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <span class="h-method">${entry.method}</span>
      <span class="h-url">${escapeHtml(entry.url)}</span>
      <span class="h-status">${entry.status}</span>
      <span class="h-time">${entry.time ?? "-"}ms</span>`;
    div.onclick = () => {
      const tab = tabManager.addTab(createDefaultTab({
        name: entry.tabName + " (history)",
        ...entry.requestSnapshot,
      }));
      renderTabIntoUI(tab);
      closeModal();
    };
    list.appendChild(div);
  }

  const closedList = $("#closed-tabs-list");
  closedList.innerHTML = "";
  historyStore.closedTabs.forEach((snap, idx) => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `<span class="h-method">${snap.method}</span><span class="h-url">${escapeHtml(snap.url)} — ${escapeHtml(snap.name)}</span>`;
    div.onclick = () => {
      historyStore.removeClosedTabAt(idx);
      const tab = tabManager.restoreTab(snap);
      renderTabIntoUI(tab);
      closeModal();
    };
    closedList.appendChild(div);
  });
}
$("#history-search").addEventListener("input", renderHistoryModal);
$("#btn-clear-history").addEventListener("click", () => { historyStore.clear(); renderHistoryModal(); });

// ---------- Utilities ----------
$("#btn-utilities").addEventListener("click", () => openModal("modal-utilities"));

$("#util-gen-uuid").addEventListener("click", () => {
  $("#util-uuid-out").value = crypto.randomUUID();
});

$("#util-jwt-decode").addEventListener("click", () => {
  const token = $("#util-jwt-in").value.trim();
  try {
    const [headerB64, payloadB64] = token.split(".");
    const decode = (b64) => JSON.parse(decodeURIComponent(escape(atob(b64.replace(/-/g, "+").replace(/_/g, "/")))));
    const out = { header: decode(headerB64), payload: decode(payloadB64) };
    $("#util-jwt-out").textContent = JSON.stringify(out, null, 2);
  } catch (err) {
    $("#util-jwt-out").textContent = "Token JWT tidak valid: " + err.message;
  }
});

$("#util-b64-encode").addEventListener("click", () => {
  try { $("#util-b64-out").textContent = btoa($("#util-b64-in").value); }
  catch (err) { $("#util-b64-out").textContent = "Error: " + err.message; }
});
$("#util-b64-decode").addEventListener("click", () => {
  try { $("#util-b64-out").textContent = atob($("#util-b64-in").value); }
  catch (err) { $("#util-b64-out").textContent = "Error: " + err.message; }
});

$("#util-url-encode").addEventListener("click", () => {
  $("#util-url-out").textContent = encodeURIComponent($("#util-url-in").value);
});
$("#util-url-decode").addEventListener("click", () => {
  try { $("#util-url-out").textContent = decodeURIComponent($("#util-url-in").value); }
  catch (err) { $("#util-url-out").textContent = "Error: " + err.message; }
});

$("#util-hash-run").addEventListener("click", async () => {
  const algo = $("#util-hash-algo").value;
  const data = new TextEncoder().encode($("#util-hash-in").value);
  const digest = await crypto.subtle.digest(algo, data);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  $("#util-hash-out").textContent = hex;
});

$("#util-ts-now").addEventListener("click", () => {
  const now = Date.now();
  $("#util-ts-out").textContent = `Unix: ${Math.floor(now / 1000)}\nMillis: ${now}\nISO: ${new Date(now).toISOString()}`;
});
$("#util-ts-convert").addEventListener("click", () => {
  const input = $("#util-ts-in").value.trim();
  let date;
  if (/^\d+$/.test(input)) {
    const num = Number(input);
    date = new Date(num > 1e12 ? num : num * 1000);
  } else {
    date = new Date(input);
  }
  if (isNaN(date.getTime())) {
    $("#util-ts-out").textContent = "Format tidak valid.";
  } else {
    $("#util-ts-out").textContent = `Unix: ${Math.floor(date.getTime() / 1000)}\nMillis: ${date.getTime()}\nISO: ${date.toISOString()}\nLocal: ${date.toString()}`;
  }
});

// =========================================================
// STATUS BAR & MISC FEEDBACK
// =========================================================
function updateStatusBar() {
  $("#status-worker").textContent = settings.workerUrl
    ? `Worker: ${settings.workerUrl.replace(/^https?:\/\//, "")}`
    : "Worker: belum dikonfigurasi";
  $("#status-tabs").textContent = `${tabManager.tabs.length} tab`;
  $("#status-history").textContent = `${historyStore.entries.length} riwayat`;
}

let flashTimeout = null;
function flashStatus(message, isError = false) {
  const el = $("#status-worker");
  const original = el.textContent;
  el.textContent = message;
  el.style.color = isError ? "var(--red)" : "var(--cyan)";
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => { el.textContent = original; el.style.color = ""; }, 2500);
}

// =========================================================
// RESIZABLE SPLIT PANE
// =========================================================
(function setupResizablePane() {
  const handle = $("#resize-handle");
  const container = $("#split-pane");
  const left = $("#panel-request");
  let dragging = false;

  handle.addEventListener("mousedown", () => {
    dragging = true;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.min(80, Math.max(20, pct));
    left.style.flex = `0 0 ${clamped}%`;
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
  });
})();

// =========================================================
// KEYBOARD SHORTCUTS
// =========================================================
document.addEventListener("keydown", (e) => {
  const ctrlOrCmd = e.ctrlKey || e.metaKey;

  if (ctrlOrCmd && e.key === "Enter") { e.preventDefault(); sendActiveRequest(); }
  else if (ctrlOrCmd && e.key.toLowerCase() === "l") { e.preventDefault(); tabManager.duplicateTab(tabManager.activeId); }
  else if (ctrlOrCmd && e.key.toLowerCase() === "w") { e.preventDefault(); tabManager.closeTab(tabManager.activeId); }
  else if (ctrlOrCmd && e.key.toLowerCase() === "t") { e.preventDefault(); tabManager.addTab(); }
  else if (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    const snap = historyStore.popClosedTab();
    if (snap) { const tab = tabManager.restoreTab(snap); renderTabIntoUI(tab); }
  }
  else if (ctrlOrCmd && e.key.toLowerCase() === "s") {
    e.preventDefault();
    $("#btn-save-session").click();
  }
  else if (ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === "c") {
    e.preventDefault();
    navigator.clipboard.writeText(requestToCurl(tabManager.activeTab));
    flashStatus("cURL disalin ke clipboard.");
  }
});

// =========================================================
// INIT
// =========================================================
renderTabIntoUI(tabManager.activeTab);
updateStatusBar();
