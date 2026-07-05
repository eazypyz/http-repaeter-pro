
import { Editor } from './editor.js';

class Tab {
    constructor(id, name, app) {
        this.id = id;
        this.name = name;
        this.app = app;
        this.editor = new Editor();
        this.requestEditor = null;
        this.bodyEditor = null;
        this.responseEditor = null;
        this.responseRawEditor = null;
        this.wordWrap = false;
        this.init();
    }

    init() {
        const reqEl = document.getElementById('editor-request');
        reqEl.innerHTML = '';
        this.requestEditor = this.editor.create(reqEl, {
            language: 'text',
            value: 'GET /api/users?id=1 HTTP/1.1\nHost: example.com\nUser-Agent: Mozilla/5.0\n\n'
        });

        this.setupBodyEditor('none');

        const respEl = document.getElementById('editor-response');
        respEl.innerHTML = '';
        this.responseEditor = this.editor.create(respEl, { language: 'json', readOnly: true });

        const respRawEl = document.getElementById('editor-response-raw');
        respRawEl.innerHTML = '';
        this.responseRawEditor = this.editor.create(respRawEl, { readOnly: true });

        this.setupTableEditor('headers-editor');
        this.setupTableEditor('query-editor');
        this.setupTableEditor('cookies-editor');
    }

    setupBodyEditor(type) {
        const bodyEl = document.getElementById('editor-body');
        bodyEl.innerHTML = '';
        let lang = 'text';
        switch(type) {
            case 'json': lang = 'json'; break;
            case 'xml': lang = 'xml'; break;
            case 'html': lang = 'html'; break;
            case 'javascript': lang = 'javascript'; break;
        }
        this.bodyEditor = this.editor.create(bodyEl, { language: lang });
    }

    setupTableEditor(containerId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        const addBtn = document.createElement('button');
        addBtn.className = 'add-row-btn';
        addBtn.textContent = '+ Add Row';
        addBtn.addEventListener('click', () => this.addTableRow(containerId));
        container.appendChild(addBtn);

        if (containerId === 'headers-editor') {
            this.addTableRow(containerId, 'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            this.addTableRow(containerId, 'Accept', 'application/json');
        }
    }

    addTableRow(containerId, key = '', value = '') {
        const container = document.getElementById(containerId);
        const addBtn = container.querySelector('.add-row-btn');

        const row = document.createElement('div');
        row.className = 'table-row';
        row.innerHTML = '<input type="checkbox" class="row-toggle" checked><input type="text" placeholder="Key" value="' + this.escapeAttr(key) + '"><input type="text" placeholder="Value" value="' + this.escapeAttr(value) + '"><div class="row-actions"><button class="row-btn" title="Duplicate">&#10629;</button><button class="row-btn danger" title="Delete">&#10005;</button></div>';

        row.querySelector('.row-btn[title="Duplicate"]').addEventListener('click', () => {
            const inputs = row.querySelectorAll('input[type="text"]');
            this.addTableRow(containerId, inputs[0].value, inputs[1].value);
        });

        row.querySelector('.row-btn[title="Delete"]').addEventListener('click', () => row.remove());

        container.insertBefore(row, addBtn);
    }

    escapeAttr(s) {
        return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    setResponseBody(content, contentType) {
        let lang = 'text';
        if (contentType.includes('json')) lang = 'json';
        else if (contentType.includes('xml')) lang = 'xml';
        else if (contentType.includes('html')) lang = 'html';
        else if (contentType.includes('javascript')) lang = 'javascript';

        const el = document.getElementById('editor-response');
        el.innerHTML = '';
        this.responseEditor = this.editor.create(el, { language: lang, readOnly: true, value: content || '' });
    }

    setResponseRaw(content) {
        const el = document.getElementById('editor-response-raw');
        el.innerHTML = '';
        this.responseRawEditor = this.editor.create(el, { readOnly: true, value: content || '' });
    }

    setResponseHex(content) {
        const el = document.getElementById('editor-response-hex');
        const encoder = new TextEncoder();
        const bytes = encoder.encode(content || '');
        let hexOutput = '';
        for (let i = 0; i < bytes.length; i += 16) {
            const offset = i.toString(16).padStart(8, '0');
            const chunk = bytes.slice(i, i + 16);
            const hexBytes = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
            const ascii = Array.from(chunk).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
            hexOutput += '<span class="hex-offset">' + offset + '</span> <span class="hex-byte">' + hexBytes.padEnd(48, ' ') + '</span> <span class="hex-ascii">' + ascii + '</span>\n';
        }
        el.innerHTML = hexOutput;
    }

    setResponseHeaders(headers) {
        const container = document.getElementById('response-headers-view');
        container.innerHTML = '';
        Object.entries(headers || {}).forEach(([key, value]) => {
            const row = document.createElement('div');
            row.className = 'header-row';
            row.innerHTML = '<span class="header-name">' + this.escapeHtml(key) + '</span><span class="header-value">' + this.escapeHtml(String(value)) + '</span>';
            container.appendChild(row);
        });
    }

    setResponseCookies(headers) {
        const container = document.getElementById('response-cookies-view');
        container.innerHTML = '';
        const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
        if (!setCookie) {
            container.innerHTML = '<div style="color:var(--text-muted);padding:12px">No cookies in response</div>';
            return;
        }
        const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
        cookies.forEach(cookie => {
            const row = document.createElement('div');
            row.className = 'cookie-row';
            row.innerHTML = '<span class="cookie-value">' + this.escapeHtml(cookie) + '</span>';
            container.appendChild(row);
        });
    }

    getResponseBody() {
        return this.responseEditor?.state?.doc?.toString() || '';
    }

    toggleWordWrap() {
        this.wordWrap = !this.wordWrap;
        this.refreshEditors();
    }

    refreshEditors() {
        [this.requestEditor, this.bodyEditor, this.responseEditor, this.responseRawEditor].forEach(ed => {
            if (ed) ed.requestMeasure();
        });
    }

    clear() {
        if (this.requestEditor) {
            this.requestEditor.dispatch({ changes: { from: 0, to: this.requestEditor.state.doc.length, insert: '' } });
        }
        if (this.bodyEditor) {
            this.bodyEditor.dispatch({ changes: { from: 0, to: this.bodyEditor.state.doc.length, insert: '' } });
        }
        this.setupTableEditor('headers-editor');
        this.setupTableEditor('query-editor');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getData() {
        return {
            id: this.id, name: this.name,
            method: document.getElementById('method-select').value,
            url: document.getElementById('url-input').value,
            headers: this.getTableData('headers-editor'),
            query: this.getTableData('query-editor'),
            bodyType: document.getElementById('body-type').value,
            body: this.bodyEditor?.state?.doc?.toString() || '',
            authType: document.getElementById('auth-type').value,
            requestRaw: this.requestEditor?.state?.doc?.toString() || ''
        };
    }

    getTableData(containerId) {
        const data = {};
        document.querySelectorAll('#' + containerId + ' .table-row').forEach(row => {
            const checkbox = row.querySelector('.row-toggle');
            if (checkbox && checkbox.checked) {
                const inputs = row.querySelectorAll('input[type="text"]');
                if (inputs[0]?.value.trim()) {
                    data[inputs[0].value.trim()] = inputs[1]?.value || '';
                }
            }
        });
        return data;
    }

    loadData(data) {
        if (data.method) document.getElementById('method-select').value = data.method;
        if (data.url) document.getElementById('url-input').value = data.url;
        if (data.bodyType) {
            document.getElementById('body-type').value = data.bodyType;
            this.setupBodyEditor(data.bodyType);
        }
        if (data.body && this.bodyEditor) {
            this.bodyEditor.dispatch({ changes: { from: 0, to: this.bodyEditor.state.doc.length, insert: data.body } });
        }
        if (data.requestRaw && this.requestEditor) {
            this.requestEditor.dispatch({ changes: { from: 0, to: this.requestEditor.state.doc.length, insert: data.requestRaw } });
        }
        if (data.headers) this.loadTableData('headers-editor', data.headers);
        if (data.query) this.loadTableData('query-editor', data.query);
    }

    loadTableData(containerId, data) {
        const container = document.getElementById(containerId);
        container.querySelectorAll('.table-row').forEach(r => r.remove());
        Object.entries(data).forEach(([key, value]) => this.addTableRow(containerId, key, value));
    }

    destroy() {
        if (this.requestEditor) this.editor.destroy(this.requestEditor);
        if (this.bodyEditor) this.editor.destroy(this.bodyEditor);
        if (this.responseEditor) this.editor.destroy(this.responseEditor);
        if (this.responseRawEditor) this.editor.destroy(this.responseRawEditor);
    }
}

class Tabs {
    constructor(app) {
        this.app = app;
        this.tabs = new Map();
        this.activeTabId = null;
        this.tabCounter = 0;
        this.closedTabs = [];
    }

    addTab(name) {
        this.tabCounter++;
        const id = 'tab-' + this.tabCounter;
        const tab = new Tab(id, name, this.app);
        this.tabs.set(id, tab);
        this.renderTabs();
        this.switchTab(id);
        return tab;
    }

    duplicateTab(id) {
        const source = this.tabs.get(id);
        if (!source) return;
        const newTab = this.addTab(source.name + ' (Copy)');
        newTab.loadData(source.getData());
    }

    closeTab(id) {
        const tab = this.tabs.get(id);
        if (!tab) return;
        this.closedTabs.push(tab.getData());
        if (this.closedTabs.length > 20) this.closedTabs.shift();
        tab.destroy();
        this.tabs.delete(id);
        if (this.activeTabId === id) {
            const remaining = Array.from(this.tabs.keys());
            if (remaining.length > 0) this.switchTab(remaining[remaining.length - 1]);
            else this.addTab('Request 1');
        }
        this.renderTabs();
    }

    restoreTab() {
        if (this.closedTabs.length === 0) return;
        const data = this.closedTabs.pop();
        const tab = this.addTab('Restored');
        tab.loadData(data);
    }

    switchTab(id) {
        this.activeTabId = id;
        const tab = this.tabs.get(id);
        if (tab) this.app.setCurrentTab(tab);
        this.renderTabs();
    }

    renderTabs() {
        const container = document.getElementById('tabs-container');
        container.innerHTML = '';
        this.tabs.forEach((tab, id) => {
            const el = document.createElement('div');
            el.className = 'tab ' + (id === this.activeTabId ? 'active' : '');
            el.innerHTML = '<span>' + tab.name + '</span><span class="tab-close">&times;</span>';
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('tab-close')) {
                    e.stopPropagation();
                    this.closeTab(id);
                } else {
                    this.switchTab(id);
                }
            });
            container.appendChild(el);
        });
    }

    getTabCount() { return this.tabs.size; }
    getAllTabsData() { return Array.from(this.tabs.values()).map(t => t.getData()); }
    loadTabs(tabsData) {
        this.tabs.forEach(t => t.destroy());
        this.tabs.clear();
        tabsData.forEach((data, i) => {
            const tab = this.addTab(data.name || 'Request ' + (i + 1));
            tab.loadData(data);
        });
    }
}

export { Tabs, Tab };
