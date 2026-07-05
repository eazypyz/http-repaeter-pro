import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from 'codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { oneDark } from 'https://cdn.jsdelivr.net/npm/@codemirror/theme-one-dark@6.1.2/dist/index.js';

const httpHeaders = [
    'Accept', 'Accept-Charset', 'Accept-Encoding', 'Accept-Language', 'Accept-Ranges',
    'Access-Control-Allow-Origin', 'Age', 'Allow', 'Authorization', 'Cache-Control',
    'Connection', 'Content-Disposition', 'Content-Encoding', 'Content-Language',
    'Content-Length', 'Content-Location', 'Content-Range', 'Content-Type', 'Cookie',
    'Date', 'ETag', 'Expect', 'Expires', 'From', 'Host', 'If-Match', 'If-Modified-Since',
    'If-None-Match', 'If-Range', 'If-Unmodified-Since', 'Last-Modified', 'Link',
    'Location', 'Max-Forwards', 'Origin', 'Pragma', 'Proxy-Authenticate', 'Proxy-Authorization',
    'Range', 'Referer', 'Retry-After', 'Server', 'Set-Cookie', 'Strict-Transport-Security',
    'TE', 'Trailer', 'Transfer-Encoding', 'Upgrade', 'User-Agent', 'Vary', 'Via',
    'Warning', 'WWW-Authenticate', 'X-Forwarded-For', 'X-Forwarded-Proto', 'X-Frame-Options',
    'X-Request-ID', 'X-Real-IP'
];

const httpHeaderCompletion = (context) => {
    const word = context.matchBefore(/[\w-]*/);
    if (!word || word.from === word.to && !context.explicit) return null;

    return {
        from: word.from,
        options: httpHeaders.map(h => ({ label: h, type: 'keyword' }))
    };
};

class Editor {
    constructor() {
        this.editors = new Map();
    }

    create(element, options = {}) {
        const { language = 'text', readOnly = false, value = '' } = options;

        const extensions = [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            history(),
            highlightSelectionMatches(),
            autocompletion({ override: [httpHeaderCompletion] }),
            oneDark,
            EditorView.theme({
                '&': { height: '100%' },
                '.cm-scroller': { overflow: 'auto' },
                '.cm-content': { padding: '8px 0' }
            }),
            keymap.of([
                ...historyKeymap,
                ...searchKeymap,
                ...completionKeymap
            ]),
            EditorView.updateListener.of((update) => {
                if (update.docChanged && options.onChange) {
                    options.onChange(update.state.doc.toString());
                }
            })
        ];

        if (readOnly) {
            extensions.push(EditorView.editable.of(false));
        }

        switch(language) {
            case 'json':
                extensions.push(json());
                break;
            case 'xml':
                extensions.push(xml());
                break;
            case 'html':
                extensions.push(html());
                break;
            case 'javascript':
                extensions.push(javascript());
                break;
        }

        const view = new EditorView({
            doc: value,
            extensions,
            parent: element
        });

        return view;
    }

    destroy(view) {
        if (view) view.destroy();
    }
}

export { Editor };
