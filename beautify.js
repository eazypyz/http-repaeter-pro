
class Beautify {
    beautify(content, type) {
        if (!content) return content;
        try {
            switch(type) {
                case 'json': return JSON.stringify(JSON.parse(content), null, 2);
                case 'xml':
                case 'html': return this.formatXML(content);
                case 'javascript': return this.formatJS(content);
                case 'http': return this.formatHTTP(content);
                default: return content;
            }
        } catch(e) { return content; }
    }

    formatXML(xml) {
        let formatted = '';
        let indent = '';
        const tab = '  ';
        xml = xml.replace(/>\s*</g, '><');
        xml.split(/(<[^>]+>)/g).filter(Boolean).forEach(node => {
            if (node.match(/^<\/\w/)) indent = indent.substring(tab.length);
            formatted += indent + node + '\n';
            if (node.match(/^<\w[^>]*[^\/]>.*$/)) indent += tab;
        });
        return formatted.trim();
    }

    formatJS(js) {
        return js.replace(/;/g, ';\n').replace(/{/g, ' {\n  ').replace(/}/g, '\n}\n').replace(/,\s*/g, ', ').replace(/\n\s*\n/g, '\n');
    }

    formatHTTP(http) {
        const lines = http.split('\n');
        const formatted = [];
        let inBody = false;
        lines.forEach(line => {
            if (inBody) { formatted.push(line); return; }
            if (line.trim() === '') { inBody = true; formatted.push(''); return; }
            if (formatted.length === 0) {
                formatted.push(line.split(' ').join(' '));
            } else {
                const idx = line.indexOf(':');
                if (idx > 0) {
                    formatted.push(line.substring(0, idx).trim() + ': ' + line.substring(idx + 1).trim());
                } else {
                    formatted.push(line);
                }
            }
        });
        return formatted.join('\n');
    }
}

export { Beautify };
