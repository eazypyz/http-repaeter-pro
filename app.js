
import { Editor } from './editor.js';
import { Tabs } from './tabs.js';
import { History } from './history.js';
import { Curl } from './curl.js';
import { Beautify } from './beautify.js';

// ==================== CONFIG ====================
const CONFIG = {
    WORKER_URL: 'https://YOUR_WORKER_SUBDOMAIN.workers.dev',
    TIMEOUT: 30000,
    MAX_REQUEST_SIZE: 10 * 1024 * 1024,
    MAX_RESPONSE_SIZE: 10 * 1024 * 1024
};

// ==================== APP ====================
class App {
    constructor() {
        this.tabs = new Tabs(this);
        this.history = new History();
        this.curl = new Curl();
        this.beautify = new Beautify();
        this.currentTab = null;
        this.isRequesting = false;
        this.abortController = null;
    }

    async init() {
        try {
            this.setupEventListeners();
            this.setupResizer();
            this.setupKeyboardShortcuts();
            this.setupSubTabs();
            this.tabs.addTab('Request 1');
            this.updateStatus('Ready');
            document.getElementById('loading-screen').style.display = 'none';
        } catch (err) {
            console.error('Init error:', err);
            document.getElementById('loading-error').textContent = 'Failed to initialize: ' + err.message;
            document.getElementById('loading-error').style.display = 'block';
        }
    }

    setupEventListeners() {
        // Send / Cancel
        document.getElementById('btn-send').addEventListener('click', () => this.sendRequest());
        document.getElementById('btn-cancel').addEventListener('click', () => this.cancelRequest());

        // Toolbar
        document.getElementById('btn-undo').addEventListener('click', () => this.undo());
        document.getElementById('btn-redo').addEventListener('click', () => this.redo());
        document.getElementById('btn-beautify').addEventListener('click', () => this.beautifyRequest());
        document.getElementById('btn-wrap').addEventListener('click', () => this.toggleWordWrap());
        document.getElementById('btn-clear-request').addEventListener('click', () => this.clearRequest());

        // Import / Export / Session
        document.getElementById('btn-import-curl').addEventListener('click', () => this.importCurl());
        document.getElementById('btn-export-curl').addEventListener('click', () => this.exportCurl());
        document.getElementById('btn-save-session').addEventListener('click', () => this.saveSession());
        document.getElementById('btn-load-session').addEventListener('click', () => this.loadSession());
        document.getElementById('session-file-input').addEventListener('change', (e) => this.handleSessionFile(e));

        // Request controls
        document.getElementById('method-select').addEventListener('change', () => this.syncRawFromUI());
        document.getElementById('url-input').addEventListener('input', () => this.syncRawFromUI());
        document.getElementById('btn-encode-url').addEventListener('click', () => this.encodeUrl());

        // Body & Auth
        document.getElementById('body-type').addEventListener('change', (e) => this.onBodyTypeChange(e.target.value));
        document.getElementById('auth-type').addEventListener('change', (e) => this.onAuthTypeChange(e.target.value));

        // Response actions
        document.getElementById('btn-copy-response').addEventListener('click', () => this.copyResponse());
        document.getElementById('btn-save-response').addEventListener('click', () => this.saveResponse());

        // Utilities
        document.getElementById('btn-utilities').addEventListener('click', () => this.showUtilities());

        // Modal
        document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('modal-overlay')) this.closeModal();
        });

        // New tab
        document.getElementById('btn-new-tab').addEventListener('click', () => {
            this.tabs.addTab('Request ' + (this.tabs.getTabCount() + 1));
        });
    }

    setupSubTabs() {
        // Request sub-tabs
        document.getElementById('request-sub-tabs').addEventListener('click', (e) => {
            if (e.target.classList.contains('sub-tab')) {
                this.switchSubTab(e.target, 'request-content');
            }
        });
        // Response sub-tabs
        document.getElementById('response-sub-tabs').addEventListener('click', (e) => {
            if (e.target.classList.contains('sub-tab')) {
                this.switchSubTab(e.target, 'response-content');
            }
        });
    }

    switchSubTab(tab, contentId) {
        const parent = tab.parentElement;
        const container = document.getElementById(contentId);
        const targetId = 'tab-' + tab.dataset.tab;

        parent.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        container.querySelectorAll('.sub-tab-content').forEach(c => c.classList.remove('active'));
        const target = document.getElementById(targetId);
        if (target) {
            target.classList.add('active');
            if (this.currentTab) this.currentTab.refreshEditors();
        }
    }

    setupResizer() {
        const resizer = document.getElementById('resizer');
        const leftPanel = document.getElementById('panel-request');
        const container = document.querySelector('.main-content');
        let isResizing = false;
        let startX = 0;
        let startLeftWidth = 0;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startLeftWidth = leftPanel.offsetWidth;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            const containerWidth = container.offsetWidth;
            const newLeftWidth = startLeftWidth + dx;
            const leftPercent = (newLeftWidth / containerWidth) * 100;
            if (leftPercent > 20 && leftPercent < 80) {
                leftPanel.style.flex = '0 0 ' + leftPercent + '%';
                document.getElementById('panel-response').style.flex = '0 0 ' + (100 - leftPercent) + '%';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                if (this.currentTab) this.currentTab.refreshEditors();
            }
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'Enter') { e.preventDefault(); this.sendRequest(); }
                else if (e.key === 'l') { e.preventDefault(); this.tabs.duplicateTab(this.currentTab?.id); }
                else if (e.key === 'w') { e.preventDefault(); this.tabs.closeTab(this.currentTab?.id); }
                else if (e.key === 's') { e.preventDefault(); this.saveSession(); }
                else if (e.key === 'C' && e.shiftKey) { e.preventDefault(); this.exportCurl(); }
                else if (e.key === 't') { e.preventDefault(); this.tabs.addTab('Request ' + (this.tabs.getTabCount() + 1)); }
            }
        });
    }

    // ==================== REQUEST ====================
    async sendRequest() {
        if (this.isRequesting) return;
        const url = document.getElementById('url-input').value.trim();
        if (!url) { this.showToast('Please enter a URL', 'error'); return; }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            this.showToast('URL must start with http:// or https://', 'error'); return;
        }

        this.isRequesting = true;
        this.abortController = new AbortController();
        document.getElementById('btn-send').disabled = true;
        document.getElementById('btn-cancel').disabled = false;
        this.updateStatus('Sending request...');

        const startTime = performance.now();
        try {
            const method = document.getElementById('method-select').value;
            const headers = this.getHeadersFromTable();
            const body = this.getBodyContent();
            const requestSize = new Blob([body || '']).size;
            if (requestSize > CONFIG.MAX_REQUEST_SIZE) {
                throw new Error('Request body too large (' + this.formatSize(requestSize) + '). Max: ' + this.formatSize(CONFIG.MAX_REQUEST_SIZE));
            }

            const payload = { url, method, headers, body, timeout: CONFIG.TIMEOUT };
            const response = await fetch(CONFIG.WORKER_URL + '/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: this.abortController.signal
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Request failed');

            const totalTime = Math.round(performance.now() - startTime);
            this.displayResponse(data, totalTime);
            this.history.add({ method, url, status: data.status, time: totalTime, size: data.size || 0, timestamp: new Date().toISOString() });
            this.updateStatus('Request completed in ' + totalTime + 'ms');
            this.showToast('Response: ' + data.status + ' ' + data.statusText, 'success');
        } catch (error) {
            if (error.name === 'AbortError') {
                this.updateStatus('Request cancelled');
                this.showToast('Request cancelled', 'info');
            } else {
                this.displayError(error);
                this.updateStatus('Error: ' + error.message);
                this.showToast(error.message, 'error');
            }
        } finally {
            this.isRequesting = false;
            this.abortController = null;
            document.getElementById('btn-send').disabled = false;
            document.getElementById('btn-cancel').disabled = true;
        }
    }

    cancelRequest() {
        if (this.abortController) this.abortController.abort();
    }

    displayResponse(data, time) {
        const badge = document.getElementById('status-badge');
        badge.textContent = data.status + ' ' + data.statusText;
        badge.className = 'status-badge';
        if (data.status >= 200 && data.status < 300) badge.classList.add('success');
        else if (data.status >= 300 && data.status < 400) badge.classList.add('warning');
        else if (data.status >= 400) badge.classList.add('error');

        document.getElementById('response-time').textContent = time + 'ms';
        document.getElementById('response-size').textContent = this.formatSize(data.size || 0);

        const ct = this.getContentType(data.headers);
        const body = data.body || '';
        if (this.currentTab) {
            this.currentTab.setResponseBody(body, ct);
            this.currentTab.setResponseRaw(body);
            this.currentTab.setResponseHex(body);
            this.currentTab.setResponseHeaders(data.headers || {});
            this.currentTab.setResponseCookies(data.headers || {});
        }
    }

    displayError(error) {
        const badge = document.getElementById('status-badge');
        badge.textContent = 'Error';
        badge.className = 'status-badge error';
        document.getElementById('response-time').textContent = '-';
        document.getElementById('response-size').textContent = '-';
        const errBody = JSON.stringify({ error: error.message }, null, 2);
        if (this.currentTab) {
            this.currentTab.setResponseBody(errBody, 'application/json');
            this.currentTab.setResponseRaw(errBody);
            this.currentTab.setResponseHex(errBody);
            this.currentTab.setResponseHeaders({});
            this.currentTab.setResponseCookies({});
        }
    }

    getContentType(headers) {
        if (!headers) return 'text/plain';
        const ct = headers['content-type'] || headers['Content-Type'] || '';
        return ct.split(';')[0].trim();
    }

    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    getHeadersFromTable() {
        const headers = {};
        document.querySelectorAll('#headers-editor .table-row').forEach(row => {
            const cb = row.querySelector('.row-toggle');
            if (cb && cb.checked) {
                const inputs = row.querySelectorAll('input[type="text"]');
                if (inputs[0] && inputs[0].value.trim()) {
                    headers[inputs[0].value.trim()] = inputs[1] ? inputs[1].value : '';
                }
            }
        });
        return headers;
    }

    getBodyContent() {
        const type = document.getElementById('body-type').value;
        if (type === 'none' || type === 'binary') return null;
        return this.currentTab?.bodyEditor?.state?.doc?.toString() || null;
    }

    syncRawFromUI() {
        const method = document.getElementById('method-select').value;
        const url = document.getElementById('url-input').value;
        const headers = this.getHeadersFromTable();
        let raw = method + ' / HTTP/1.1\n';
        try {
            const u = new URL(url);
            raw = method + ' ' + u.pathname + u.search + ' HTTP/1.1\n';
            raw += 'Host: ' + u.host + '\n';
        } catch(e) {}
        Object.entries(headers).forEach(([k, v]) => { raw += k + ': ' + v + '\n'; });
        raw += '\n';
        const body = this.getBodyContent();
        if (body) raw += body;
        if (this.currentTab?.requestEditor) {
            this.currentTab.requestEditor.dispatch({ changes: { from: 0, to: this.currentTab.requestEditor.state.doc.length, insert: raw } });
        }
    }

    onBodyTypeChange(type) {
        const editorContainer = document.getElementById('editor-body');
        const binaryUpload = document.getElementById('binary-upload');
        if (type === 'binary') {
            editorContainer.style.display = 'none';
            binaryUpload.style.display = 'block';
        } else {
            editorContainer.style.display = 'block';
            binaryUpload.style.display = 'none';
            if (this.currentTab) this.currentTab.setupBodyEditor(type);
        }
        this.syncRawFromUI();
    }

    onAuthTypeChange(type) {
        const config = document.getElementById('auth-config');
        config.innerHTML = '';
        switch(type) {
            case 'bearer':
                config.innerHTML = '<div class="auth-field"><label>Token</label><input type="text" id="auth-bearer-token" placeholder="Bearer token..."></div>';
                break;
            case 'basic':
                config.innerHTML = '<div class="auth-field"><label>Username</label><input type="text" id="auth-basic-username" placeholder="Username"></div><div class="auth-field"><label>Password</label><input type="password" id="auth-basic-password" placeholder="Password"></div>';
                break;
            case 'apikey':
                config.innerHTML = '<div class="auth-field"><label>Key Name</label><input type="text" id="auth-apikey-name" placeholder="X-API-Key"></div><div class="auth-field"><label>Key Value</label><input type="text" id="auth-apikey-value" placeholder="API key value"></div><div class="auth-field"><label>Add to</label><select id="auth-apikey-in"><option value="header">Header</option><option value="query">Query</option></select></div>';
                break;
            case 'jwt':
                config.innerHTML = '<div class="auth-field"><label>JWT Token</label><textarea id="auth-jwt-token" rows="4" placeholder="eyJhbGciOiJIUzI1NiIs..."></textarea></div><div class="auth-field"><button class="btn btn-secondary" id="btn-decode-jwt">Decode JWT</button></div>';
                setTimeout(() => {
                    document.getElementById('btn-decode-jwt')?.addEventListener('click', () => this.decodeJWT());
                }, 0);
                break;
            case 'cookie':
                config.innerHTML = '<div class="auth-field"><label>Cookie String</label><input type="text" id="auth-cookie-string" placeholder="session=abc123; user=john"></div>';
                break;
        }
        config.querySelectorAll('input, textarea').forEach(el => {
            el.addEventListener('input', () => this.updateAuthHeaders(type));
        });
    }

    updateAuthHeaders(type) {
        switch(type) {
            case 'bearer': {
                const token = document.getElementById('auth-bearer-token')?.value;
                if (token) this.setHeader('Authorization', 'Bearer ' + token);
                break;
            }
            case 'basic': {
                const u = document.getElementById('auth-basic-username')?.value;
                const p = document.getElementById('auth-basic-password')?.value;
                if (u) this.setHeader('Authorization', 'Basic ' + btoa(u + ':' + (p || '')));
                break;
            }
            case 'apikey': {
                const name = document.getElementById('auth-apikey-name')?.value;
                const value = document.getElementById('auth-apikey-value')?.value;
                const where = document.getElementById('auth-apikey-in')?.value;
                if (name && value && where === 'header') this.setHeader(name, value);
                break;
            }
            case 'jwt': {
                const jwt = document.getElementById('auth-jwt-token')?.value;
                if (jwt) this.setHeader('Authorization', 'Bearer ' + jwt);
                break;
            }
            case 'cookie': {
                const cookie = document.getElementById('auth-cookie-string')?.value;
                if (cookie) this.setHeader('Cookie', cookie);
                break;
            }
        }
    }

    setHeader(key, value) {
        const editor = document.getElementById('headers-editor');
        const rows = editor.querySelectorAll('.table-row');
        for (const row of rows) {
            const inputs = row.querySelectorAll('input[type="text"]');
            if (inputs[0]?.value.trim().toLowerCase() === key.toLowerCase()) {
                inputs[1].value = value;
                return;
            }
        }
        if (this.currentTab) this.currentTab.addTableRow('headers-editor', key, value);
    }

    decodeJWT() {
        const token = document.getElementById('auth-jwt-token')?.value;
        if (!token) return;
        try {
            const parts = token.split('.');
            if (parts.length !== 3) throw new Error('Invalid JWT format');
            const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            this.showModal('JWT Decode', '<div style="margin-bottom:12px"><h4 style="color:var(--accent-primary);margin-bottom:8px">Header</h4><pre style="background:var(--bg-primary);padding:10px;border-radius:4px;overflow:auto">' + JSON.stringify(header, null, 2) + '</pre></div><div><h4 style="color:var(--accent-success);margin-bottom:8px">Payload</h4><pre style="background:var(--bg-primary);padding:10px;border-radius:4px;overflow:auto">' + JSON.stringify(payload, null, 2) + '</pre></div>');
        } catch (e) {
            this.showToast('Invalid JWT token', 'error');
        }
    }

    encodeUrl() {
        const input = document.getElementById('url-input');
        try {
            const url = new URL(input.value);
            url.searchParams.forEach((value, key) => { url.searchParams.set(key, encodeURIComponent(value)); });
            input.value = url.toString();
        } catch (e) { this.showToast('Invalid URL', 'error'); }
    }

    undo() {
        if (this.currentTab?.requestEditor) {
            this.currentTab.requestEditor.dispatch({ undo: true });
        }
    }

    redo() {
        if (this.currentTab?.requestEditor) {
            this.currentTab.requestEditor.dispatch({ redo: true });
        }
    }

    beautifyRequest() {
        const activeTab = document.querySelector('#request-sub-tabs .sub-tab.active');
        if (!activeTab) return;
        const tabName = activeTab.dataset.tab;
        if (tabName === 'raw' && this.currentTab?.requestEditor) {
            const content = this.currentTab.requestEditor.state.doc.toString();
            const beautified = this.beautify.beautify(content, 'http');
            this.currentTab.requestEditor.dispatch({ changes: { from: 0, to: this.currentTab.requestEditor.state.doc.length, insert: beautified } });
        } else if (tabName === 'body' && this.currentTab?.bodyEditor) {
            const content = this.currentTab.bodyEditor.state.doc.toString();
            const type = document.getElementById('body-type').value;
            const lang = type === 'json' ? 'json' : type === 'xml' ? 'xml' : type === 'html' ? 'html' : 'text';
            const beautified = this.beautify.beautify(content, lang);
            this.currentTab.bodyEditor.dispatch({ changes: { from: 0, to: this.currentTab.bodyEditor.state.doc.length, insert: beautified } });
        }
    }

    toggleWordWrap() {
        if (this.currentTab) this.currentTab.toggleWordWrap();
    }

    clearRequest() {
        if (this.currentTab) this.currentTab.clear();
        document.getElementById('url-input').value = '';
        document.getElementById('method-select').value = 'GET';
        document.getElementById('body-type').value = 'none';
        this.onBodyTypeChange('none');
        this.updateStatus('Request cleared');
    }

    // ==================== IMPORT/EXPORT ====================
    importCurl() {
        this.showModal('Import cURL', '<div class="auth-field"><label>Paste cURL command</label><textarea id="import-curl-input" rows="8" placeholder="curl -X GET https://api.example.com..."></textarea></div>', [
            { text: 'Cancel', class: 'btn-secondary', action: () => this.closeModal() },
            { text: 'Import', class: 'btn-primary', action: () => {
                const input = document.getElementById('import-curl-input').value;
                if (!input.trim()) return;
                try {
                    const parsed = this.curl.parse(input);
                    this.applyParsedRequest(parsed);
                    this.closeModal();
                    this.showToast('cURL imported successfully', 'success');
                } catch (e) { this.showToast('Failed to parse cURL: ' + e.message, 'error'); }
            }}
        ]);
    }

    exportCurl() {
        if (!this.currentTab) return;
        const method = document.getElementById('method-select').value;
        const url = document.getElementById('url-input').value;
        const headers = this.getHeadersFromTable();
        const body = this.getBodyContent();
        const curl = this.curl.generate(method, url, headers, body);
        navigator.clipboard.writeText(curl).then(() => this.showToast('cURL copied to clipboard', 'success')).catch(() => {
            this.showModal('Export cURL', '<div class="auth-field"><label>cURL Command</label><textarea rows="8" readonly style="width:100%">' + this.escapeHtml(curl) + '</textarea></div>');
        });
    }

    applyParsedRequest(parsed) {
        document.getElementById('method-select').value = parsed.method || 'GET';
        document.getElementById('url-input').value = parsed.url || '';
        const headersEditor = document.getElementById('headers-editor');
        headersEditor.querySelectorAll('.table-row').forEach(r => r.remove());
        if (parsed.headers) {
            Object.entries(parsed.headers).forEach(([k, v]) => {
                if (this.currentTab) this.currentTab.addTableRow('headers-editor', k, v);
            });
        }
        if (parsed.body) {
            document.getElementById('body-type').value = 'raw';
            this.onBodyTypeChange('raw');
            if (this.currentTab?.bodyEditor) {
                this.currentTab.bodyEditor.dispatch({ changes: { from: 0, to: this.currentTab.bodyEditor.state.doc.length, insert: parsed.body } });
            }
        }
        this.syncRawFromUI();
    }

    saveSession() {
        const session = { tabs: this.tabs.getAllTabsData(), history: this.history.getAll(), timestamp: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'http-repeater-session-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Session saved', 'success');
    }

    loadSession() { document.getElementById('session-file-input').click(); }

    handleSessionFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const session = JSON.parse(event.target.result);
                if (session.tabs) this.tabs.loadTabs(session.tabs);
                if (session.history) this.history.load(session.history);
                this.showToast('Session loaded', 'success');
            } catch (err) { this.showToast('Invalid session file', 'error'); }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    copyResponse() {
        if (!this.currentTab) return;
        const content = this.currentTab.getResponseBody();
        if (!content) { this.showToast('No response to copy', 'error'); return; }
        navigator.clipboard.writeText(content).then(() => this.showToast('Response copied', 'success'));
    }

    saveResponse() {
        if (!this.currentTab) return;
        const content = this.currentTab.getResponseBody();
        if (!content) { this.showToast('No response to save', 'error'); return; }
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'response-' + Date.now() + '.txt';
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Response saved', 'success');
    }

    // ==================== UTILITIES ====================
    showUtilities() {
        this.showModal('Utilities & Settings', '<div class="utilities-grid"><div class="utility-card"><h4>Worker URL</h4><input type="text" id="setting-worker-url" value="' + CONFIG.WORKER_URL + '" style="width:100%;padding:8px"></div><div class="utility-card"><h4>Timeout (ms)</h4><input type="number" id="setting-timeout" value="' + CONFIG.TIMEOUT + '" style="width:100%;padding:8px"></div><div class="utility-card"><h4>Generate UUID</h4><div style="display:flex;gap:8px"><input type="text" id="generated-uuid" readonly style="flex:1;padding:8px"><button class="btn btn-secondary" id="btn-gen-uuid">Generate</button></div></div><div class="utility-card"><h4>Base64</h4><textarea id="b64-input" rows="3" placeholder="Text..." style="width:100%"></textarea><div class="utility-actions"><button class="btn btn-secondary" id="btn-b64-encode">Encode</button><button class="btn btn-secondary" id="btn-b64-decode">Decode</button></div><textarea id="b64-output" rows="2" readonly style="width:100%;margin-top:8px" placeholder="Result..."></textarea></div><div class="utility-card"><h4>URL Encode/Decode</h4><textarea id="url-encode-input" rows="3" placeholder="Text..." style="width:100%"></textarea><div class="utility-actions"><button class="btn btn-secondary" id="btn-url-encode">Encode</button><button class="btn btn-secondary" id="btn-url-decode">Decode</button></div><textarea id="url-encode-output" rows="2" readonly style="width:100%;margin-top:8px" placeholder="Result..."></textarea></div><div class="utility-card"><h4>Hash (SHA-256)</h4><textarea id="hash-input" rows="3" placeholder="Text to hash..." style="width:100%"></textarea><button class="btn btn-secondary" id="btn-hash" style="margin-top:8px">Hash</button><input type="text" id="hash-output" readonly style="width:100%;margin-top:8px;padding:8px" placeholder="Result..."></div><div class="utility-card"><h4>Timestamp</h4><div style="display:flex;gap:8px;flex-direction:column"><div>Current: <span id="current-timestamp">' + Date.now() + '</span></div><div>ISO: <span id="current-iso">' + new Date().toISOString() + '</span></div><button class="btn btn-secondary" id="btn-refresh-timestamp">Refresh</button></div></div></div>', [
            { text: 'Close', class: 'btn-secondary', action: () => this.closeModal() },
            { text: 'Save Settings', class: 'btn-primary', action: () => {
                const wu = document.getElementById('setting-worker-url')?.value;
                const to = parseInt(document.getElementById('setting-timeout')?.value);
                if (wu) CONFIG.WORKER_URL = wu;
                if (to) CONFIG.TIMEOUT = to;
                this.closeModal();
                this.showToast('Settings saved', 'success');
            }}
        ]);

        setTimeout(() => {
            document.getElementById('btn-gen-uuid')?.addEventListener('click', () => {
                document.getElementById('generated-uuid').value = crypto.randomUUID();
            });
            document.getElementById('btn-b64-encode')?.addEventListener('click', () => {
                try { document.getElementById('b64-output').value = btoa(document.getElementById('b64-input').value); }
                catch(e) { document.getElementById('b64-output').value = 'Error: ' + e.message; }
            });
            document.getElementById('btn-b64-decode')?.addEventListener('click', () => {
                try { document.getElementById('b64-output').value = atob(document.getElementById('b64-input').value); }
                catch(e) { document.getElementById('b64-output').value = 'Error: ' + e.message; }
            });
            document.getElementById('btn-url-encode')?.addEventListener('click', () => {
                document.getElementById('url-encode-output').value = encodeURIComponent(document.getElementById('url-encode-input').value);
            });
            document.getElementById('btn-url-decode')?.addEventListener('click', () => {
                try { document.getElementById('url-encode-output').value = decodeURIComponent(document.getElementById('url-encode-input').value); }
                catch(e) { document.getElementById('url-encode-output').value = 'Error: ' + e.message; }
            });
            document.getElementById('btn-hash')?.addEventListener('click', async () => {
                const input = document.getElementById('hash-input').value;
                const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
                document.getElementById('hash-output').value = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
            });
            document.getElementById('btn-refresh-timestamp')?.addEventListener('click', () => {
                document.getElementById('current-timestamp').textContent = Date.now();
                document.getElementById('current-iso').textContent = new Date().toISOString();
            });
        }, 100);
    }

    // ==================== UI HELPERS ====================
    showModal(title, content, buttons = []) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;
        const footer = document.getElementById('modal-footer');
        footer.innerHTML = '';
        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = 'btn ' + btn.class;
            button.textContent = btn.text;
            button.addEventListener('click', btn.action);
            footer.appendChild(button);
        });
        document.getElementById('modal-overlay').classList.add('active');
    }

    closeModal() { document.getElementById('modal-overlay').classList.remove('active'); }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { toast.classList.add('hiding'); setTimeout(() => toast.remove(), 300); }, 3000);
    }

    updateStatus(text) { document.getElementById('status-text').textContent = text; }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setCurrentTab(tab) { this.currentTab = tab; }
}

// ==================== INIT ====================
const app = new App();
app.init();
export { app };
