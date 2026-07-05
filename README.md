# HTTP Repeater Pro

A modern HTTP Repeater inspired by Burp Suite, built with vanilla JavaScript and powered by Cloudflare Workers.

![Dark Theme](https://img.shields.io/badge/theme-dark-blue)
![Vanilla JS](https://img.shields.io/badge/framework-vanilla%20JS-yellow)
![Cloudflare Workers](https://img.shields.io/badge/backend-Cloudflare%20Workers-orange)

## Features

### Request Editor
- Raw HTTP editor with CodeMirror 6
- Syntax highlighting (JSON, XML, HTML, JavaScript)
- Line numbers, search, replace, undo/redo
- Word wrap toggle
- Auto-complete HTTP headers
- Table-based header/query/cookie editor
- Multiple body types: Raw, JSON, XML, Text, Form, Multipart, Binary
- Authentication: Bearer, Basic, API Key, JWT, Cookie

### Response Viewer
- Status code with color coding
- Response time & size
- Pretty JSON/XML/HTML view
- Raw view
- Hex dump view
- Response headers & cookies
- Copy & save response

### Tabs
- Unlimited tabs
- Duplicate tab (Ctrl+L)
- Close tab (Ctrl+W)
- Session history

### Import/Export
- Import cURL command
- Export to cURL
- Save session to JSON
- Load session from JSON

### Utilities
- UUID generator
- Base64 encode/decode
- URL encode/decode
- SHA-256 hash
- JWT decode
- Timestamp tools

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl+Enter | Send Request |
| Ctrl+L | Duplicate Tab |
| Ctrl+W | Close Tab |
| Ctrl+S | Save Session |
| Ctrl+Shift+C | Copy cURL |

## Architecture

```
Browser (GitHub Pages)
    ↓
Cloudflare Worker (CORS Proxy)
    ↓
Target Website
```

All HTTP requests go through the Cloudflare Worker to bypass CORS restrictions.

## File Structure

```
http-repeater-pro/
├── index.html      # Main HTML
├── style.css       # Dark theme styles
├── app.js          # Main application logic
├── editor.js       # CodeMirror 6 integration
├── tabs.js         # Tab management
├── history.js      # Request history
├── curl.js         # cURL parser/generator
├── beautify.js     # Code beautification
└── worker.js       # Cloudflare Worker backend
```

## Deployment

### 1. Deploy Cloudflare Worker

1. Go to [Cloudflare Workers Dashboard](https://dash.cloudflare.com/)
2. Create a new Worker
3. Paste the contents of `worker.js`
4. Update `ALLOWED_ORIGINS` with your GitHub Pages URL:
   ```javascript
   ALLOWED_ORIGINS: [
     "https://YOUR_USERNAME.github.io",
   ]
   ```
5. Deploy and note your Worker URL (e.g., `https://your-worker.workers.dev`)

### 2. Update Frontend

In `app.js`, update the Worker URL:
```javascript
const CONFIG = {
    WORKER_URL: 'https://your-worker.workers.dev',
    // ...
};
```

### 3. Deploy to GitHub Pages

1. Create a new repository on GitHub
2. Push all files (except `worker.js`) to the repository
3. Go to Settings → Pages
4. Select source: Deploy from a branch → main
5. Your app will be live at `https://YOUR_USERNAME.github.io/REPO_NAME`

### 4. Update Worker CORS

Go back to your Cloudflare Worker and update `ALLOWED_ORIGINS`:
```javascript
ALLOWED_ORIGINS: [
    "https://YOUR_USERNAME.github.io",
    "https://YOUR_USERNAME.github.io/REPO_NAME",
]
```

## Security Features

- Whitelist-based CORS origin validation
- Blocks localhost & private IP addresses
- Request/response size limits (10MB)
- Request timeout with retry logic
- Input validation on URL format

## API Endpoint

### POST /request

Request body:
```json
{
  "url": "https://api.example.com/data",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer token"
  },
  "body": "{\"key\":\"value\"}",
  "timeout": 30000
}
```

Response:
```json
{
  "status": 200,
  "statusText": "OK",
  "headers": { ... },
  "body": "...",
  "time": 234,
  "size": 1234,
  "url": "https://api.example.com/data",
  "redirected": false
}
```

### GET /health

Health check endpoint for monitoring.

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

MIT License
