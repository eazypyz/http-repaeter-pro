
class Curl {
    parse(cmd) {
        const result = { method: 'GET', url: '', headers: {}, body: null };
        let text = cmd.trim();
        if (!text.toLowerCase().startsWith('curl')) throw new Error('Invalid cURL command');
        text = text.substring(4).trim();

        const args = this.tokenize(text);
        let i = 0;
        while (i < args.length) {
            const arg = args[i];
            if (arg === '-X' || arg === '--request') {
                result.method = (args[++i] || 'GET').toUpperCase();
            } else if (arg === '-H' || arg === '--header') {
                const header = args[++i];
                if (header) {
                    const idx = header.indexOf(':');
                    if (idx > 0) {
                        result.headers[header.substring(0, idx).trim()] = header.substring(idx + 1).trim();
                    }
                }
            } else if (arg === '-d' || arg === '--data' || arg === '--data-raw') {
                result.body = args[++i];
                if (result.method === 'GET') result.method = 'POST';
            } else if (arg === '-u' || arg === '--user') {
                const creds = args[++i];
                if (creds) result.headers['Authorization'] = 'Basic ' + btoa(creds);
            } else if (arg === '-b' || arg === '--cookie') {
                result.headers['Cookie'] = args[++i];
            } else if (!arg.startsWith('-') && !result.url) {
                result.url = arg.replace(/^['"]|['"]$/g, '');
            }
            i++;
        }
        if (!result.url) throw new Error('No URL found');
        return result;
    }

    tokenize(cmd) {
        const tokens = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';
        for (let i = 0; i < cmd.length; i++) {
            const char = cmd[i];
            if (char === ' ' && !inQuotes) {
                if (current.trim()) tokens.push(current.trim());
                current = '';
            } else if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true; quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false; quoteChar = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) tokens.push(current.trim());
        return tokens;
    }

    generate(method, url, headers, body) {
        let curl = 'curl -X ' + method;
        Object.entries(headers).forEach(([key, value]) => {
            curl += ' \\\n  -H "' + key + ': ' + value + '"';
        });
        if (body) curl += ' \\\n  -d \'' + body.replace(/'/g, "'\\''") + '\'';
        curl += ' \\\n  "' + url + '"';
        return curl;
    }
}

export { Curl };
