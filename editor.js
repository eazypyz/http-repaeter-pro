
// CodeMirror 6 via esm.sh (reliable ES module CDN)
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from 'https://esm.sh/codemirror@6.0.1';
import { json } from 'https://esm.sh/@codemirror/lang-json@6.0.1';
import { xml } from 'https://esm.sh/@codemirror/lang-xml@6.0.2';
import { javascript } from 'https://esm.sh/@codemirror/lang-javascript@6.2.1';
import { html } from 'https://esm.sh/@codemirror/lang-html@6.4.8';
import { searchKeymap, highlightSelectionMatches } from 'https://esm.sh/@codemirror/search@6.5.5';
import { history, historyKeymap } from 'https://esm.sh/@codemirror/commands@6.3.2';
import { autocompletion, completionKeymap } from 'https://esm.sh/@codemirror/autocomplete@6.11.1';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6.1.2';

const httpHeaders = [
    'Accept','Accept-Charset','Accept-Encoding','Accept-Language','Accept-Ranges',
    'Access-Control-Allow-Origin','Age','Allow','Authorization','Cache-Control',
    'Connection','Content-Disposition','Content-Encoding','Content-Language',
    'Content-Length','Content-Location','Content-Range','Content-Type','Cookie',
    'Date','ETag','Expect','Expires','From','Host','If-Match','If-Modified-Since',
    'If-None-Match','If-Range','If-Unmodified-Since','Last-Modified','Link',
    'Location','Max-Forwards','Origin','Pragma','Proxy-Authenticate','Proxy-Authorization',
    'Range','Referer','Retry-After','Server','Set-Cookie','Strict-Transport-Security',
    'TE','Trailer','Transfer-Encoding','Upgrade','User-Agent','Vary','Via',
    'Warning','WWW-Authenticate','X-Forwarded-For','X-Forwarded-Proto','X-Frame-Options',
    'X-Request-ID','X-Real-IP'
];

const httpHeaderCompletion = (context) => {
    const word = context.matchBefore(/[\w-]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return {
        from: word.from,
        options: httpHeaders.map(h => ({ label: h, type: 'keyword' }))
    };
};

class Editor {
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
            case 'json': extensions.push(json()); break;
            case 'xml': extensions.push(xml()); break;
            case 'html': extensions.push(html()); break;
            case 'javascript': extensions.push(javascript()); break;
        }

        return new EditorView({
            doc: value,
            extensions,
            parent: element
        });
    }

    destroy(view) {
        if (view) view.destroy();
    }
}

export { Editor };
