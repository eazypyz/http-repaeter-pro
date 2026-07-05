/**
 * history.js — Riwayat request yang pernah dikirim, dan stack tab yang ditutup
 * (agar bisa di-restore, mirip Ctrl+Shift+T di browser).
 * Disimpan di localStorage supaya persist antar sesi.
 */

const HISTORY_KEY = "httprp.history.v1";
const CLOSED_TABS_KEY = "httprp.closedTabs.v1";
const MAX_HISTORY_ITEMS = 500;
const MAX_CLOSED_TABS = 30;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("Gagal menyimpan ke localStorage:", err);
  }
}

class HistoryStore {
  constructor() {
    this.entries = load(HISTORY_KEY, []);
    this.closedTabs = load(CLOSED_TABS_KEY, []);
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  /** Tambahkan entri riwayat baru setelah request dikirim. */
  addEntry({ tabId, tabName, method, url, status, statusText, time, size, requestSnapshot }) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      tabId, tabName, method, url, status, statusText, time, size,
      requestSnapshot,
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_HISTORY_ITEMS) this.entries.length = MAX_HISTORY_ITEMS;
    save(HISTORY_KEY, this.entries);
    this.emit();
    return entry;
  }

  clear() {
    this.entries = [];
    save(HISTORY_KEY, this.entries);
    this.emit();
  }

  search(query) {
    if (!query) return this.entries;
    const q = query.toLowerCase();
    return this.entries.filter(
      (e) =>
        e.url?.toLowerCase().includes(q) ||
        e.method?.toLowerCase().includes(q) ||
        String(e.status).includes(q) ||
        e.tabName?.toLowerCase().includes(q)
    );
  }

  /** Simpan tab yang baru ditutup agar bisa direstore. */
  pushClosedTab(tabSnapshot) {
    this.closedTabs.unshift({ ...tabSnapshot, closedAt: Date.now() });
    if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.length = MAX_CLOSED_TABS;
    save(CLOSED_TABS_KEY, this.closedTabs);
    this.emit();
  }

  /** Ambil & hapus tab teratas dari stack closed-tabs (LIFO, seperti Ctrl+Shift+T). */
  popClosedTab() {
    const tab = this.closedTabs.shift();
    save(CLOSED_TABS_KEY, this.closedTabs);
    this.emit();
    return tab;
  }

  removeClosedTabAt(index) {
    this.closedTabs.splice(index, 1);
    save(CLOSED_TABS_KEY, this.closedTabs);
    this.emit();
  }
}

export const historyStore = new HistoryStore();
