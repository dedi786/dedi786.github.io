/**
 * PANDUAN SINGKAT — Saklar Backend (Google Apps Script + Google Sheets)
 *
 * 1. Buka script.google.com → New project.
 * 2. Salin isi Code.gs ke editor, dan ganti isi appsscript.json
 *    (aktifkan dulu "Show appsscript.json" di Project Settings).
 * 3. Jalankan fungsi `setupDatabase()` sekali → spreadsheet dibuat otomatis.
 *    Salin ID spreadsheet ke konstanta DB_ID di Code.gs, lalu simpan.
 * 4. Deploy → New deployment → Web app
 *      - Execute as   : Me
 *      - Who has access: Anyone
 * 5. Salin URL Web app (…/exec) ke `API_URL` di app-config.js (frontend).
 * 6. Buka dashboard Saklar → tab Koneksi AI → isi API key model AI
 *    (Gemini / OpenAI / kompatibel), lalu tab Telegram / WhatsApp.
 * 7. Uji chat di dashboard sebelum mengaktifkan webhook kanal.
 */
