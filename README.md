# HTTP Repeater Pro

A modern HTTP Repeater inspired by Burp Suite, built with vanilla JavaScript and powered by Cloudflare Workers.

## Quick Deploy Guide

### Step 1: Deploy Cloudflare Worker

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create
2. Choose "Create Worker"
3. Replace the default code with the contents of `worker.js`
4. **IMPORTANT**: Update `ALLOWED_ORIGINS` in `worker.js`:
   ```javascript
   ALLOWED_ORIGINS: [
     "https://YOUR_USERNAME.github.io",
     "https://YOUR_USERNAME.github.io/http-repeater-pro",
   ]
   ```
5. Click "Deploy" and copy your Worker URL (e.g., `https://repeater.YOUR_SUBDOMAIN.workers.dev`)

### Step 2: Update Frontend

In `app.js`, find this line:
```javascript
const CONFIG = {
    WORKER_URL: 'https://YOUR_WORKER_SUBDOMAIN.workers.dev',
```
Replace with your actual Worker URL.

### Step 3: Deploy to GitHub Pages

1. Create a new GitHub repository
2. Upload all frontend files (`index.html`, `style.css`, `app.js`, `editor.js`, `tabs.js`, `history.js`, `curl.js`, `beautify.js`)
3. Go to Settings → Pages → Source: Deploy from a branch → main
4. Wait a few minutes, then visit `https://YOUR_USERNAME.github.io/REPO_NAME`

### Step 4: Test

1. Open your GitHub Pages URL
2. The loading screen should disappear and show the UI
3. Enter a test URL like `https://httpbin.org/get`
4. Click **Send** or press **Ctrl+Enter**

## Why Buttons Might Not Work

| Problem | Solution |
|---------|----------|
| Opening `file://` directly | Must use HTTP server (GitHub Pages, `npx serve`, Python `http.server`) |
| CodeMirror fails to load | Check browser console for import errors; esm.sh CDN should work |
| CORS errors | Worker `ALLOWED_ORIGINS` must match your GitHub Pages URL exactly |
| Worker URL wrong | Update `WORKER_URL` in `app.js` |

## Local Testing

```bash
# Serve locally (requires Node.js)
npx serve .

# Or with Python
python3 -m http.server 8080

# Then open http://localhost:8080
```

## Features

- **9 HTTP Methods**: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD, CONNECT, TRACE
- **CodeMirror 6 Editor**: Syntax highlighting, auto-complete, search/replace
- **CORS Proxy**: All requests via Cloudflare Worker
- **Security**: Whitelist origins, block localhost/private IPs, size limits
- **Utilities**: UUID, Base64, URL encode/decode, SHA-256, JWT decode
- **Keyboard Shortcuts**: Ctrl+Enter (Send), Ctrl+L (Duplicate), Ctrl+W (Close), Ctrl+S (Save)
- **Import/Export**: cURL, Raw HTTP, Session JSON

## Architecture

```
Browser (GitHub Pages)
    ↓
Cloudflare Worker (CORS Proxy + Security)
    ↓
Target Website
```
