class Curl {
    parse(curlCommand) {
        const result = {
            method: 'GET',
            url: '',
            headers: {},
            body: null
        };

        // Remove 'curl' prefix and trim
        let cmd = curlCommand.trim();
        if (!cmd.toLowerCase().startsWith('curl')) {
            throw new Error('Invalid cURL command');
        }
        cmd = cmd.substring(4).trim();

        // Parse arguments
        const args = this.tokenize(cmd);
        let i = 0;

        while (i < args.length) {
            const arg = args[i];

            if (arg === '-X' || arg === '--request') {
                result.method = args[++i]?.toUpperCase() || 'GET';
            } else if (arg === '-H' || arg === '--header') {
                const header = args[++i];
                if (header) {
                    const colonIndex = header.indexOf(':');
                    if (colonIndex > 0) {
                        const key = header.substring(0, colonIndex).trim();
                        const value = header.substring(colonIndex + 1).trim();
                        result.headers[key] = value;
                    }
                }
            } else if (arg === '-d' || arg === '--data' || arg === '--data-raw') {
                result.body = args[++i];
                if (result.method === 'GET') result.method = 'POST';
            } else if (arg === '-u' || arg === '--user') {
                const creds = args[++i];
                if (creds) {
                    result.headers['Authorization'] = 'Basic ' + btoa(creds);
                }
            } else if (arg === '-b' || arg === '--cookie') {
                result.headers['Cookie'] = args[++i];
            } else if (arg === '-L' || arg === '--location') {
                // Follow redirects - handled by worker
            } else if (!arg.startsWith('-') && !result.url) {
                result.url = arg.replace(/^['"]|['"]$/g, '');
            }

            i++;
        }

        if (!result.url) {
            throw new Error('No URL found in cURL command');
        }

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
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
            } else {
                current += char;
            }
        }

        if (current.trim()) tokens.push(current.trim());
        return tokens;
    }

    generate(method, url, headers, body) {
        let curl = `curl -X ${method}`;

        Object.entries(headers).forEach(([key, value]) => {
            curl += ` \\\n  -H "${key}: ${value}"`;
        });

        if (body) {
            curl += ` \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
        }

        curl += ` \\\n  "${url}"`;

        return curl;
    }
}

export { Curl };
