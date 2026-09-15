# ⚡ Saklar

**Saklar** adalah panel penghubung agen AI customer service ke **Telegram** dan **WhatsApp**.
Kamu cukup menempelkan API model AI dan token bot lewat dashboard — **Google Apps Script** yang memproses penghubungnya, dan **Google Sheets** sebagai database. Tanpa server, tanpa hosting tambahan.

## Cara kerja

```
Pelanggan (Telegram/WhatsApp)
        │  webhook
        ▼
Google Apps Script  ←→  Google Sheets (USERS, CONFIG, CHAT_LOG, WEBHOOK_LOG)
        │  panggil API
        ▼
Model AI pilihanmu (Gemini / OpenAI / kompatibel)
        │
        ▼
Balasan otomatis terkirim ke pelanggan
```

## Struktur proyek

| File | Fungsi |
|---|---|
| `index.html` | Landing page Saklar |
| `auth.html` | Login & daftar (akun disimpan di Sheets) |
| `dashboard.html` | Panel: input API AI, token Telegram/WhatsApp, uji chat, log |
| `app-config.js` | Konfigurasi `API_URL` + helper session (URL juga bisa diisi via `setup.html`) |
| `setup.html` | Panduan setup backend langkah-demi-langkah, ramah HP |
| `server.js` | Server statis kecil hanya untuk preview sandbox |
| `appsscript/Code.gs` | **Backend lengkap** untuk Google Apps Script |
| `appsscript/appsscript.json` | Manifest Apps Script |
| `appsscript/README.md` | Ringkasan langkah setup backend |

## Setup (sekali saja, ±10 menit)

### 1. Buat database & backend

> 💡 Cara paling gampang (termasuk dari HP): buka **`setup.html`** di situs Saklar —
> semua blok kode siap disalin, langkahnya dijelaskan satu per satu.

1. Buka [script.google.com](https://script.google.com) → **New project**.
2. Salin isi `appsscript/Code.gs` ke editor.
3. Aktifkan **Show "appsscript.json"** di Project Settings, lalu ganti isinya dengan `appsscript/appsscript.json`.
4. Jalankan fungsi **`setupDatabase()`** satu kali → spreadsheet *Saklar Database* dibuat otomatis
   (ID-nya disimpan sendiri di Script Properties — tidak perlu menyalin apa pun).

### 2. Deploy sebagai Web App

1. **Deploy → New deployment → Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
2. Salin URL yang berakhiran `/exec`.

### 3. Hubungkan frontend

Buka `app-config.js`, isi:

```js
API_URL: "https://script.google.com/macros/s/XXXX…/exec",
```

### 3b. Alternatif: push backend dengan clasp (opsional)

Daripada copy-paste manual, backend bisa didorong langsung dari repo ini — bahkan **oleh asisten dari sandbox ini** setelah kredensial terpasang:

**Sekali saja (di komputermu sendiri):**

```bash
npm install -g @google/clasp
clasp login                      # buka browser, izinkan akun Google kamu
```

Lalu salin isi file `~/.clasprc.json` dari komputermu dan tempel sebagai nilai
environment variable **`CLASPRC_JSON`** di menu Keys / Environment workspace ini.
(File itu berisi token OAuth clasp-mu — asisten memasangnya otomatis saat push
via `scripts/clasp-setup.sh`, dan tidak pernah menampilkan isinya.)

**Isi `scriptId` di `.clasp.json`:**

- **Buat project baru:** `npx @google/clasp create --title "Saklar Backend" --type standalone`
  (script ID otomatis ditulis ke `.clasp.json`)
- **Pakai project yang sudah ada:** buka [script.google.com](https://script.google.com) →
  pilih project → *Project Settings* → salin **Script ID** → tempel ke `.clasp.json`

**Setelah itu, dari sandbox ini asisten bisa menjalankan:**

```bash
npm run backend:push   # dorong Code.gs + appsscript.json ke Apps Script
npm run backend:pull   # tarik perubahan dari Apps Script ke repo
npm run backend:open   # tampilkan URL editor Apps Script
```

> Catatan: `clasp login` (izin akun Google lewat browser) hanya bisa kamu lakukan
> sendiri — sekali saja. Sisanya otomatis.

### 4. Nyalakan lewat dashboard

1. Daftar/masuk di `auth.html`.
2. Tab **Koneksi AI** → pilih penyedia (Gemini/OpenAI/kompatibel), tempel API key, tulis instruksi agen.
3. Tab **Telegram** → tempel token bot dari [@BotFather](https://t.me/BotFather), nyalakan saklar, simpan → webhook terpasang otomatis.
4. Tab **WhatsApp** → isi Phone number ID + token dari [Meta for Developers](https://developers.facebook.com), salin callback URL ke konfigurasi webhook Meta (verify token dicocokkan otomatis), subscribe field `messages`, nyalakan saklar.
5. Tab **Uji Chat** → pastikan agen menjawab dengan benar sebelum melayani pelanggan sungguhan.
6. Tab **Log Chat** → pantau percakapan; data lengkap ada di tab `CHAT_LOG` Google Sheets.

## Catatan keamanan

- Password disimpan sebagai hash SHA-256, bukan teks biasa.
- Token/API key **tidak pernah** dikirim balik ke browser — hanya ditampilkan sebagai `••••`.
- Semua kredensial milikmu tersimpan di Google Sheets-mu sendiri (folder Drive kamu), bukan di server pihak ketiga.

## Hosting frontend di GitHub Pages

Repo ini (`dedi786.github.io`) adalah **GitHub Pages** — begitu perubahan di-push,
Saklar live di `https://dedi786.github.io`.

- Yang dibutuhkan Pages hanya file statis: `index.html`, `auth.html`, `dashboard.html`,
  `setup.html`, `app-config.js` — semuanya ada di root, jadi tidak perlu konfigurasi tambahan.
- `server.js`, `config/`, dan `appsscript/` tetap ikut ter-push tanpa masalah
  (Pages hanya menyajikannya sebagai file statis).
- URL backend di-bake sebagai default di `app-config.js` + bisa ditimpa per-perangkat
  lewat `setup.html` (tersimpan di `localStorage`).

## Keterbatasan yang perlu diketahui

- Kuota harian Apps Script (URL Fetch ±20.000 panggilan/hari untuk akun gratis) — cukup untuk ribuan pesan, tapi bukan untuk volume sangat besar.
- WhatsApp Business butuh app Meta yang disetujui untuk produksi; mode *development* hanya bisa mengirim ke nomor penerima yang didaftarkan.
