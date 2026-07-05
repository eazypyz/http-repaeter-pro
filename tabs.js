/**
 * tabs.js — Model & rendering untuk Request Tabs bar.
 * Setiap tab menyimpan state request+response independen, mirip
 * Burp Suite Repeater (setiap tab = satu "repeater slot").
 */

import { historyStore } from "./history.js";

let tabCounter = 0;

export function createDefaultTab(overrides = {}) {
  tabCounter++;
  return {
    id: crypto.randomUUID(),
    name: overrides.name || `Request ${tabCounter}`,
    method: "GET",
    url: "https://example.com/api/users?id=1",
    headers: [
      { key: "Host", value: "example.com", enabled: true },
      { key: "User-Agent", value: "HTTPRepeaterPro/1.0", enabled: true },
      { key: "Accept", value: "*/*", enabled: true },
    ],
    query: [{ key: "id", value: "1", enabled: true }],
    bodyType: "json",
    body: "",
    formFields: [],
    binaryFileName: null,
    binaryFileData: null, // base64
    auth: { type: "none" },
    cookies: [],
    response: null, // { status, statusText, headers, body, time, size, timing }
    ...overrides,
  };
}

export class TabManager {
  /**
   * @param {HTMLElement} listEl elemen container daftar tab
   * @param {object} callbacks { onActivate(tab), onCloseAll, onChange }
   */
  constructor(listEl, callbacks = {}) {
    this.listEl = listEl;
    this.tabs = [];
    this.activeId = null;
    this.callbacks = callbacks;
  }

  get activeTab() {
    return this.tabs.find((t) => t.id === this.activeId) || null;
  }

  addTab(tab = createDefaultTab(), activate = true) {
    this.tabs.push(tab);
    if (activate) this.activeId = tab.id;
    this.render();
    this.callbacks.onChange?.();
    if (activate) this.callbacks.onActivate?.(tab);
    return tab;
  }

  duplicateTab(id) {
    const source = this.tabs.find((t) => t.id === id);
    if (!source) return null;
    const copy = createDefaultTab({
      ...structuredClone(source),
      id: undefined,
      name: `${source.name} (copy)`,
    });
    copy.id = crypto.randomUUID();
    const idx = this.tabs.findIndex((t) => t.id === id);
    this.tabs.splice(idx + 1, 0, copy);
    this.activeId = copy.id;
    this.render();
    this.callbacks.onChange?.();
    this.callbacks.onActivate?.(copy);
    return copy;
  }

  closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [removed] = this.tabs.splice(idx, 1);

    historyStore.pushClosedTab(removed);

    if (this.tabs.length === 0) {
      this.addTab();
      return;
    }

    if (this.activeId === id) {
      const newIdx = Math.max(0, idx - 1);
      this.activeId = this.tabs[newIdx].id;
      this.callbacks.onActivate?.(this.tabs[newIdx]);
    }
    this.render();
    this.callbacks.onChange?.();
  }

  restoreTab(tabSnapshot) {
    const restored = { ...tabSnapshot, id: crypto.randomUUID() };
    this.addTab(restored, true);
    return restored;
  }

  renameTab(id, newName) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab && newName.trim()) tab.name = newName.trim();
    this.render();
    this.callbacks.onChange?.();
  }

  setActive(id) {
    if (!this.tabs.some((t) => t.id === id)) return;
    this.activeId = id;
    this.render();
    this.callbacks.onActivate?.(this.activeTab);
  }

  updateActiveTab(patch) {
    const tab = this.activeTab;
    if (!tab) return;
    Object.assign(tab, patch);
    this.callbacks.onChange?.();
  }

  serialize() {
    return { tabs: structuredClone(this.tabs), activeId: this.activeId };
  }

  loadSerialized(data) {
    if (!data?.tabs?.length) return;
    this.tabs = data.tabs;
    this.activeId = data.activeId || this.tabs[0].id;
    this.render();
    this.callbacks.onActivate?.(this.activeTab);
    this.callbacks.onChange?.();
  }

  render() {
    this.listEl.innerHTML = "";
    for (const tab of this.tabs) {
      const el = document.createElement("div");
      el.className = "tab-item" + (tab.id === this.activeId ? " active" : "");
      el.dataset.tabId = tab.id;
      el.title = tab.url;

      const methodSpan = document.createElement("span");
      methodSpan.className = `tab-method m-${tab.method}`;
      methodSpan.textContent = tab.method;

      const nameSpan = document.createElement("span");
      nameSpan.className = "tab-name";
      nameSpan.textContent = tab.name;
      nameSpan.ondblclick = (e) => {
        e.stopPropagation();
        this.startRename(nameSpan, tab);
      };

      const closeBtn = document.createElement("span");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "✕";
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      };

      el.append(methodSpan, nameSpan, closeBtn);
      el.onclick = () => this.setActive(tab.id);
      el.oncontextmenu = (e) => {
        e.preventDefault();
        this.duplicateTab(tab.id);
      };

      this.listEl.appendChild(el);
    }
  }

  startRename(nameSpan, tab) {
    nameSpan.contentEditable = "true";
    nameSpan.focus();
    document.execCommand("selectAll", false, null);

    const commit = () => {
      nameSpan.contentEditable = "false";
      this.renameTab(tab.id, nameSpan.textContent);
    };
    nameSpan.onblur = commit;
    nameSpan.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); nameSpan.blur(); }
      if (e.key === "Escape") { nameSpan.textContent = tab.name; nameSpan.blur(); }
    };
  }
}
