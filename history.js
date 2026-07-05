
class History {
    constructor() {
        this.items = [];
        try {
            this.items = JSON.parse(localStorage.getItem('http_repeater_history') || '[]');
        } catch(e) {}
        this.maxItems = 100;
    }
    add(entry) {
        this.items.unshift(entry);
        if (this.items.length > this.maxItems) this.items = this.items.slice(0, this.maxItems);
        this.save();
    }
    getAll() { return this.items; }
    getRecent(limit = 10) { return this.items.slice(0, limit); }
    clear() { this.items = []; this.save(); }
    save() {
        try { localStorage.setItem('http_repeater_history', JSON.stringify(this.items)); }
        catch(e) { console.warn('Failed to save history:', e); }
    }
    load(items) { this.items = items; this.save(); }
    search(query) {
        const lower = query.toLowerCase();
        return this.items.filter(item => item.url.toLowerCase().includes(lower) || item.method.toLowerCase().includes(lower));
    }
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

export { History };
