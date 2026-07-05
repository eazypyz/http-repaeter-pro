# HTTP Repeater Pro

Aplikasi web HTTP Repeater modern terinspirasi Burp Suite Repeater.
Frontend statis (HTML/CSS/Vanilla JS + CodeMirror 6) di-host di **GitHub Pages**,
seluruh request diteruskan lewat **Cloudflare Worker** sebagai reverse proxy agar
browser tidak pernah fetch langsung ke target (menghindari CORS & menyembunyikan asal request).

```
Browser → GitHub Pages (frontend statis) → Cloudflare Worker (proxy) → Target Website
```

## Struktur Folder

```
http-repeater-pro/
├── frontend/                 # Deploy folder ini ke GitHub Pages
│   ├── index.html
│   ├── style.css
│   ├── app.js                 # entry point, orkestrasi utama
│   ├── editor.js               # wrapper CodeMirror 6
│   ├── tabs.js                 # model & render tab
│   ├── history.js              # riwayat request + closed-tab restore
│   ├── curl.js                  # import/export cURL & Raw HTTP
│   └── beautify.js              # pretty-printer JSON/HTML/XML/JS + hex dump
└── cloudflare-worker/
    ├── worker.js               # reverse proxy + validasi keamanan
    └── wrangler.toml
```

## 1. Deploy Cloudflare Worker

```bash
cd cloudflare-worker
npm install -g wrangler   # jika belum ada
wrangler login
```

Edit `worker.js`, sesuaikan whitelist origin:

```js
const ALLOWED_ORIGINS = [
  "https://USERNAME.github.io", // ganti dengan domain GitHub Pages kamu
];
```

Deploy:

```bash
wrangler deploy
```

Catat URL worker yang muncul, contoh:
`https://http-repeater-pro.<subdomain>.workers.dev`

## 2. Deploy Frontend ke GitHub Pages

1. Push folder `frontend/` ke repo GitHub (bisa di branch `main` atau `gh-pages`).
2. Di **Settings → Pages**, arahkan source ke folder tersebut.
3. Buka situs GitHub Pages kamu, klik **⚙ Settings** di toolbar aplikasi,
   masukkan URL Cloudflare Worker dari langkah 1, simpan.

Tidak ada proses build — semua modul dimuat sebagai ES Module native di browser,
dan CodeMirror 6 dimuat langsung dari CDN (esm.sh) di dalam `editor.js`.

## Keamanan (SSRF & Abuse Protection)

Worker (`worker.js`) menerapkan:

- **Whitelist origin** — hanya origin di `ALLOWED_ORIGINS` yang boleh memanggil worker.
- **Validasi skema URL** — hanya `http:` dan `https:` yang diizinkan.
- **Blokir target privat** — `localhost`, `127.0.0.1`, `::1`, rentang IP privat
  (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local, dsb.), dan
  endpoint metadata cloud (`169.254.169.254`) ditolak untuk mencegah SSRF.
- **Batas ukuran** request (`MAX_REQUEST_SIZE`) dan response (`MAX_RESPONSE_SIZE`).
- **Timeout & retry** terkonfigurasi (`FETCH_TIMEOUT_MS`, `MAX_RETRIES`).
- **Format error JSON konsisten**: `{ error: true, code, message }`.

> Alat ini ditujukan untuk pengujian API/keamanan pada target yang **kamu miliki
> izin untuk mengujinya** (mis. environment milikmu sendiri atau program bug bounty
> yang mengizinkan tooling semacam ini). Jangan gunakan untuk mengakses sistem
> tanpa otorisasi.

## Catatan Implementasi & Batasan yang Diketahui

- **Kompresi (gzip/br/deflate)**: ditangani otomatis oleh `fetch()` di Cloudflare
  Workers runtime (dekompresi transparan) — tidak perlu penanganan manual.
- **Streaming response**: worker membaca body dengan `ReadableStream` reader dan
  membatasi ukuran total sesuai `MAX_RESPONSE_SIZE`, lalu mengirim hasil akhir
  sebagai satu JSON response ke frontend (bukan streaming byte-per-byte ke browser,
  karena payload dibungkus JSON `{status, headers, body, ...}`).
- **Timing granular** (DNS/TLS/Connect time terpisah): Cloudflare Workers `fetch()`
  standar tidak mengekspos angka ini secara terpisah. Worker melaporkan `ttfb` dan
  `total` time yang tersedia; DNS/TLS/Connect ditampilkan sebagai "—" di UI jika
  tidak tersedia.
- **Multipart & Binary**: dikonstruksi di frontend (`app.js`) sebagai body biner
  yang di-base64-encode, lalu didekode kembali oleh worker sebelum diteruskan ke target.
- **Hex view**: dihasilkan dari body response (didekode dari base64 bila biner).
- **Beautify HTML/XML/JS**: implementasi ringan berbasis indentasi tag/kurung,
  cukup untuk keterbacaan viewer — bukan pretty-printer AST penuh.

## Keyboard Shortcuts

| Shortcut | Aksi |
|---|---|
| `Ctrl+Enter` | Send request |
| `Ctrl+T` | Tab baru |
| `Ctrl+L` | Duplicate tab aktif |
| `Ctrl+W` | Close tab aktif |
| `Ctrl+Shift+T` | Restore tab yang baru ditutup |
| `Ctrl+S` | Save session (export JSON) |
| `Ctrl+Shift+C` | Copy request aktif sebagai cURL |

## Format Komunikasi Frontend ↔ Worker

**Request** (`POST /request`):
```json
{
  "url": "https://example.com/api/users?id=1",
  "method": "GET",
  "headers": { "Authorization": "Bearer xxx" },
  "body": "",
  "bodyIsBase64": false
}
```

**Response**:
```json
{
  "status": 200,
  "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "body": "...",
  "bodyIsBase64": false,
  "size": 12345,
  "time": 123,
  "timing": { "ttfb": 80, "total": 123 }
}
```

**Error** (format konsisten):
```json
{ "error": true, "code": "PROXY_ERROR", "message": "Gagal menghubungi target: ..." }
```
