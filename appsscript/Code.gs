/**
 * ============================================================
 *  SAKLAR — Backend Google Apps Script
 * ------------------------------------------------------------
 *  Database : Google Sheets (4 tab: USERS, CONFIG, CHAT_LOG, WEBHOOK_LOG)
 *  Peran    : menerima pesan Telegram/WhatsApp → balas via agen AI
 *
 *  SETUP SINGKAT:
 *  1. Jalankan fungsi `setupDatabase()` sekali dari editor.
 *     → Spreadsheet dibuat otomatis, salin ID-nya ke DB_ID di bawah.
 *  2. Deploy → New deployment → Web app
 *     - Execute as : Me
 *     - Access     : Anyone
 *  3. Salin URL /exec ke app-config.js (frontend).
 *  4. Input token AI / Telegram / WhatsApp dari dashboard Saklar.
 * ============================================================
 */

// ====== OPSIONAL: ID Spreadsheet. Kalau kosong, database dibuat OTOMATIS
// pada pemakaian pertama dan ID-nya disimpan di Script Properties.
const DB_ID = "";
const DB_PROP_KEY = "SAKLAR_DB_ID";

// Batas riwayat chat yang dikirim ke AI sebagai konteks
const HISTORY_LIMIT = 12;
// Model default bila user tidak mengisi
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";
const DEFAULT_SYSTEM_PROMPT =
  "Kamu adalah agen customer service yang ramah, singkat, dan membantu. " +
  "Jawab dalam bahasa yang dipakai pengirim (utamanya Bahasa Indonesia).";

/* ============================================================
 *  ROUTING UTAMA
 * ============================================================ */

function doPost(e) {
  // Webhook masuk (Telegram/WhatsApp memakai POST)
  if (e && e.parameter && e.parameter.channel) {
    return webhookPost(e);
  }
  return handleApi_(e);
}

function doGet(e) {
  // Verifikasi webhook WhatsApp (challenge)
  if (e && e.parameter && e.parameter.channel === "whatsapp") {
    return webhookGet(e);
  }
  // Halaman status sederhana (teks biasa)
  const text =
    "⚡ Saklar backend aktif\n\n" +
    "Web App Apps Script berjalan normal.\n" +
    "Salin URL ini (…/exec) ke halaman setup Saklar di frontend.";
  return ContentService.createTextOutput(text);
}

function handleApi_(e) {
  try {
    const body = parseBody_(e);
    const action = body.action || "";
    let data;

    switch (action) {
      case "register":
        data = apiRegister_(body);
        break;
      case "login":
        data = apiLogin_(body);
        break;
      case "getConfig":
        data = apiGetConfig_(body);
        break;
      case "saveConfig":
        data = apiSaveConfig_(body);
        break;
      case "testChat":
        data = apiTestChat_(body);
        break;
      default:
        throw new Error("Aksi tidak dikenal: " + action);
    }
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ============================================================
 *  AUTH
 * ============================================================ */

function apiRegister_(body) {
  const email = clean_(body.email).toLowerCase();
  const name = clean_(body.name) || email.split("@")[0];
  const password = String(body.password || "");

  if (!email || email.indexOf("@") < 1) throw new Error("Email tidak valid.");
  if (password.length < 6) throw new Error("Password minimal 6 karakter.");

  const sh = getSheet_(SHEETS.USERS);
  if (findRow_(sh, "email", email)) throw new Error("Email sudah terdaftar, silakan masuk.");

  const userId = "u_" + randomId_();
  const token = randomId_() + randomId_();
  const now = new Date().toISOString();

  sh.appendRow([userId, name, email, hash_(password), token, now, now]);

  return { user_id: userId, name: name, email: email, session_token: token };
}

function apiLogin_(body) {
  const email = clean_(body.email).toLowerCase();
  const password = String(body.password || "");

  const row = findRow_(getSheet_(SHEETS.USERS), "email", email);
  if (!row) throw new Error("Email atau password salah.");
  if (hash_(password) !== row.values[3]) throw new Error("Email atau password salah.");

  // Regenerasi token sesi tiap login
  const token = randomId_() + randomId_();
  const sh = getSheet_(SHEETS.USERS);
  sh.getRange(row.index, 5).setValue(token);
  sh.getRange(row.index, 7).setValue(new Date().toISOString());

  return {
    user_id: row.values[0],
    name: row.values[1],
    email: row.values[2],
    session_token: token,
  };
}

function requireUser_(body) {
  const userId = clean_(body.user_id);
  const token = clean_(body.session_token);
  if (!userId || !token) throw new Error("Sesi berakhir, silakan masuk lagi.");

  const row = findRow_(getSheet_(SHEETS.USERS), "user_id", userId);
  if (!row || row.values[4] !== token) throw new Error("Sesi tidak valid, silakan masuk lagi.");
  return { id: userId, name: row.values[1], email: row.values[2] };
}

/* ============================================================
 *  KONFIGURASI USER (AI + kanal)
 * ============================================================ */

function apiGetConfig_(body) {
  const user = requireUser_(body);
  const cfg = getUserConfig_(user.id);
  const status = {};

  if (cfg.telegram_bot_token) {
    status.telegram = getTelegramWebhookInfo_(cfg.telegram_bot_token, user.id);
  }
  return {
    user: { id: user.id, name: user.name, email: user.email },
    config: maskConfig_(cfg),
    webhook_status: status,
  };
}

function apiSaveConfig_(body) {
  const user = requireUser_(body);
  const cfg = {
    ai_provider: clean_(body.ai_provider) || "openai",
    ai_model: clean_(body.ai_model),
    ai_api_key: clean_(body.ai_api_key),
    ai_base_url: clean_(body.ai_base_url),
    ai_system_prompt: clean_(body.ai_system_prompt),
    telegram_bot_token: clean_(body.telegram_bot_token),
    telegram_enabled: !!body.telegram_enabled,
    wa_phone_number_id: clean_(body.wa_phone_number_id),
    wa_token: clean_(body.wa_token),
    wa_verify_token: clean_(body.wa_verify_token),
    wa_enabled: !!body.wa_enabled,
  };
  saveUserConfig_(user.id, cfg);

  const status = {};

  // Set / hapus webhook Telegram
  if (cfg.telegram_bot_token) {
    if (cfg.telegram_enabled) {
      const url = getWebAppUrl_() + "?channel=telegram&uid=" + user.id;
      status.telegram = callTelegram_(cfg.telegram_bot_token, "setWebhook", { url: url });
    } else {
      status.telegram = callTelegram_(cfg.telegram_bot_token, "deleteWebhook", {});
    }
    const info = getTelegramWebhookInfo_(cfg.telegram_bot_token, user.id);
    status.telegram = {
      ok: status.telegram.ok,
      error: status.telegram.error,
      info: info,
    };
  }

  // Subscribe WhatsApp app ke nomor ini ( Cloud API )
  if (cfg.wa_phone_number_id && cfg.wa_token) {
    if (cfg.wa_enabled) {
      status.whatsapp = waSubscribe_(cfg.wa_phone_number_id, cfg.wa_token);
    } else {
      status.whatsapp = waUnsubscribe_(cfg.wa_phone_number_id, cfg.wa_token);
    }
  }

  return { saved: true, webhook_status: status };
}

function maskConfig_(cfg) {
  const mask = function (v) {
    return v ? "•".repeat(Math.min(v.length, 24)) : "";
  };
  return {
    ai_provider: cfg.ai_provider,
    ai_model: cfg.ai_model,
    ai_api_key_masked: mask(cfg.ai_api_key),
    ai_base_url: cfg.ai_base_url,
    ai_system_prompt: cfg.ai_system_prompt,
    telegram_bot_token_masked: mask(cfg.telegram_bot_token),
    telegram_enabled: cfg.telegram_enabled,
    wa_phone_number_id: cfg.wa_phone_number_id,
    wa_token_masked: mask(cfg.wa_token),
    wa_verify_token: cfg.wa_verify_token,
    wa_enabled: cfg.wa_enabled,
    has_ai_key: !!cfg.ai_api_key,
    has_telegram_token: !!cfg.telegram_bot_token,
    has_wa_token: !!cfg.wa_token,
  };
}

function getUserConfig_(userId) {
  const row = findRow_(getSheet_(SHEETS.CONFIG), "user_id", userId);
  const d = function (i, fb) {
    return row && row.values[i] ? row.values[i] : fb;
  };
  return {
    ai_provider: d(1, "openai"),
    ai_model: d(2, ""),
    ai_api_key: d(3, ""),
    ai_base_url: d(4, ""),
    ai_system_prompt: d(5, DEFAULT_SYSTEM_PROMPT),
    telegram_bot_token: d(6, ""),
    telegram_enabled: d(7, false) === true || d(7, false) === "TRUE",
    wa_phone_number_id: d(8, ""),
    wa_token: d(9, ""),
    wa_verify_token: d(10, ""),
    wa_enabled: d(11, false) === true || d(11, false) === "TRUE",
  };
}

function saveUserConfig_(userId, cfg) {
  const sh = getSheet_(SHEETS.CONFIG);
  const row = findRow_(sh, "user_id", userId);
  const values = [
    userId, cfg.ai_provider, cfg.ai_model, cfg.ai_api_key, cfg.ai_base_url,
    cfg.ai_system_prompt, cfg.telegram_bot_token, cfg.telegram_enabled,
    cfg.wa_phone_number_id, cfg.wa_token, cfg.wa_verify_token, cfg.wa_enabled,
    new Date().toISOString(),
  ];
  if (row) {
    sh.getRange(row.index, 1, 1, values.length).setValues([values]);
  } else {
    sh.appendRow(values);
  }
}

/* ============================================================
 *  UJI CHAT (dari dashboard)
 * ============================================================ */

function apiTestChat_(body) {
  const user = requireUser_(body);
  const text = clean_(body.message);
  if (!text) throw new Error("Pesan uji kosong.");
  const cfg = getUserConfig_(user.id);
  if (!cfg.ai_api_key) throw new Error("Isi dulu API key model AI di tab Koneksi AI.");

  const chatKey = user.id + "|test";
  const reply = processMessage_(cfg, user.id, chatKey, "test", text);
  return { reply: reply };}

/* ============================================================
 *  WEBHOOK: TELEGRAM & WHATSAPP
 * ============================================================ */

function webhookGet(e) {
  // Verifikasi token WhatsApp
  const p = e.parameter || {};
  if (p["hub.mode"] === "subscribe" && p["hub.verify_token"]) {
    const uid = p.uid || "";
    const cfg = uid ? getUserConfig_(uid) : null;
    if (cfg && p["hub.verify_token"] === cfg.wa_verify_token) {
      return ContentService.createTextOutput(p["hub.challenge"] || "");
    }
  }
  return ContentService.createTextOutput("Saklar webhook aktif.");
}

function webhookPost(e) {
  const p = e.parameter || {};
  const uid = p.uid || "";
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    body = {};
  }
  try {
    logWebhook_(p.channel, JSON.stringify(body).slice(0, 900));
  } catch (err) { /* logging tidak boleh memutus alur */ }

  const user = uid ? { id: uid } : null;
  if (!user) return ContentService.createTextOutput("ok");

  try {
    if (p.channel === "telegram") {
      handleTelegram_(user.id, body);
    } else if (p.channel === "whatsapp") {
      handleWhatsApp_(user.id, body);
    }
  } catch (err) {
    try { logWebhook_("error:" + (p.channel || "?"), String(err)); } catch (e2) {}
  }
  return ContentService.createTextOutput("ok");
}

function handleTelegram_(userId, body) {
  const msg = body.message || body.edited_message;
  if (!msg || !msg.text) return; // sticker, gambar, dll.
  const chatId = msg.chat && msg.chat.id;
  if (!chatId) return;

  const cfg = getUserConfig_(userId);
  if (!cfg.telegram_enabled || !cfg.telegram_bot_token || !cfg.ai_api_key) return;

  const chatKey = userId + "|tg|" + chatId;
  const reply = processMessage_(cfg, userId, chatKey, "telegram", msg.text);
  if (reply) {
    sendTelegramMessage_(cfg.telegram_bot_token, chatId, reply);
  }
}

function handleWhatsApp_(userId, body) {
  const entry = (body.entry && body.entry[0]) || null;
  const change = entry && entry.changes && entry.changes[0];
  const value = change && change.value;
  if (!value || !value.messages || !value.messages.length) return; // status/delivery receipt

  const msg = value.messages[0];
  const from = msg.from;
  const text =
    (msg.text && msg.text.body) ||
    (msg.button && msg.button.text) ||
    (msg.interactive && msg.interactive.button_reply && msg.interactive.button_reply.title) ||
    (msg.interactive && msg.interactive.list_reply && msg.interactive.list_reply.title) ||
    "";
  if (!from || !text) return;

  const cfg = getUserConfig_(userId);
  if (!cfg.wa_enabled || !cfg.wa_token || !cfg.ai_api_key) return;

  const chatKey = userId + "|wa|" + normalizePhone_(from);
  const reply = processMessage_(cfg, userId, chatKey, "whatsapp", text);
  if (reply) {
    sendWhatsAppMessage_(cfg.wa_phone_number_id, cfg.wa_token, from, reply);
  }
}

/* ============================================================
 *  MESIN AI
 * ============================================================ */

function processMessage_(cfg, userId, chatKey, channel, userText) {
  const history = getHistory_(chatKey);
  appendLog_(chatKey, channel, "in", userText);

  let reply = "";
  try {
    reply = callAI_(cfg, history, userText);
  } catch (err) {
    logWebhook_("ai-error", channel + " | " + String(err));
    reply = "Maaf, sedang ada gangguan di agen AI. Coba lagi sebentar ya. 🙏";
  }
  appendLog_(chatKey, channel, "out", reply);
  return reply;
}

function getHistory_(chatKey) {
  const sh = getSheet_(SHEETS.CHAT_LOG);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - 300); // baca maksimal 300 baris terakhir
  const rows = sh.getRange(start, 1, last - start + 1, 4).getValues();
  const out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < HISTORY_LIMIT; i--) {
    if (rows[i][0] === chatKey) {
      out.unshift({
        dir: rows[i][2] === "in" ? "user" : "assistant",
        text: String(rows[i][3]),
      });
    }
  }
  return out;
}

function callAI_(cfg, history, userText) {
  const systemPrompt = cfg.ai_system_prompt || DEFAULT_SYSTEM_PROMPT;
  const messages = [{ role: "system", content: systemPrompt }]
    .concat(history)
    .concat([{ role: "user", content: userText }]);

  if (cfg.ai_provider === "gemini") {
    return callGemini_(cfg, systemPrompt, history, userText);
  }
  return callOpenAI_(cfg, messages);
}

function callOpenAI_(cfg, messages) {
  const base = (cfg.ai_base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = cfg.ai_model || DEFAULT_OPENAI_MODEL;
  const res = fetchJson_(base + "/chat/completions", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + cfg.ai_api_key },
    payload: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: 800,
      temperature: 0.6,
    }),
  });
  if (res.error) {
    throw new Error("AI: " + ((res.error.message) || JSON.stringify(res.error)));
  }
  const choice = res.choices && res.choices[0];
  const text = choice && choice.message && choice.message.content;
  if (!text) throw new Error("AI: respons kosong.");
  return text.trim();
}

function callGemini_(cfg, systemPrompt, history, userText) {
  const model = cfg.ai_model || DEFAULT_GEMINI_MODEL;
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" + encodeURIComponent(cfg.ai_api_key);

  const contents = history.map(function (h) {
    return {
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.text }],
    };
  });
  contents.push({ role: "user", parts: [{ text: userText }] });

  const res = fetchJson_(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: contents,
      generationConfig: { temperature: 0.6, maxOutputTokens: 800 },
    }),
  });
  if (res.error) {
    throw new Error("Gemini: " + ((res.error.message) || JSON.stringify(res.error)));
  }
  const cand = res.candidates && res.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  const text = (parts || []).map(function (p) { return p.text || ""; }).join("");
  if (!text) throw new Error("Gemini: respons kosong.");
  return text.trim();
}

/* ============================================================
 *  PENGIRIM PESAN
 * ============================================================ */

function sendTelegramMessage_(token, chatId, text) {
  const res = callTelegram_(token, "sendMessage", {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
  });
  if (!res.ok && /can't parse entities|parse/i.test(res.error || "")) {
    // fallback tanpa format HTML
    callTelegram_(token, "sendMessage", { chat_id: chatId, text: text });
  }
}

function sendWhatsAppMessage_(phoneId, token, to, text) {
  fetchJson_(
    "https://graph.facebook.com/v20.0/" + encodeURIComponent(phoneId) + "/messages",
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(to),
        type: "text",
        text: { body: text },
      }),
    }
  );
}

function callTelegram_(token, method, params) {
  try {
    const res = fetchJson_(
      "https://api.telegram.org/bot" + token + "/" + method,
      {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(params),
      }
    );
    if (res.ok === true) return { ok: true, result: res.result || null };
    return { ok: false, error: (res.description) || "Telegram error" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function getTelegramWebhookInfo_(token, userId) {
  const res = callTelegram_(token, "getWebhookInfo", {});
  if (!res.ok) return { connected: false, error: res.error };
  const info = res.result || {};
  const expected = getWebAppUrl_() + "?channel=telegram&uid=" + userId;
  return {
    connected: !!info.url,
    url_matches: info.url === expected,
    bot_username: null,
    pending_update_count: info.pending_update_count || 0,
    last_error: info.last_error_message || "",
  };
}

function waSubscribe_(phoneId, token) {
  try {
    fetchJson_(
      "https://graph.facebook.com/v20.0/" + encodeURIComponent(phoneId) + "/subscribed_apps",
      {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + token },
        payload: "{}",
      }
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function waUnsubscribe_(phoneId, token) {
  try {
    fetchJson_(
      "https://graph.facebook.com/v20.0/" + encodeURIComponent(phoneId) + "/subscribed_apps",
      { method: "delete", headers: { Authorization: "Bearer " + token } }
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ============================================================
 *  UTILITAS SHEETS & LAIN-LAIN
 * ============================================================ */

const SHEETS = {
  USERS: "USERS",
  CONFIG: "CONFIG",
  CHAT_LOG: "CHAT_LOG",
  WEBHOOK_LOG: "WEBHOOK_LOG",
};

function setupDatabase() {
  const ss = ensureDatabase_();
  Logger.log("Database siap. ID: " + ss.getId());
  Logger.log("URL: " + ss.getUrl());
  return ss.getId();
}

/** Ambil database; buat otomatis + simpan ID bila belum ada. */
function ensureDatabase_() {
  if (DB_ID) return openAndEnsure_(SpreadsheetApp.openById(DB_ID));
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty(DB_PROP_KEY);
  if (stored) {
    try {
      return openAndEnsure_(SpreadsheetApp.openById(stored));
    } catch (err) {
      // Spreadsheet mungkin terhapus — buat yang baru di bawah.
    }
  }
  const ss = openAndEnsure_(SpreadsheetApp.create("Saklar Database"));
  props.setProperty(DB_PROP_KEY, ss.getId());
  return ss;
}

function openAndEnsure_(ss) {
  ensureSheets_(ss);
  return ss;
}

function getDb_() {
  return ensureDatabase_();
}

function ensureSheets_(ss) {
  createIfMissing_(ss, SHEETS.USERS, ["user_id", "name", "email", "password_hash", "session_token", "created_at", "updated_at"]);
  createIfMissing_(ss, SHEETS.CONFIG, ["user_id", "ai_provider", "ai_model", "ai_api_key", "ai_base_url", "ai_system_prompt", "telegram_bot_token", "telegram_enabled", "wa_phone_number_id", "wa_token", "wa_verify_token", "wa_enabled", "updated_at"]);
  createIfMissing_(ss, SHEETS.CHAT_LOG, ["chat_key", "timestamp", "direction", "message"]);
  createIfMissing_(ss, SHEETS.WEBHOOK_LOG, ["timestamp", "tag", "payload"]);
}

function createIfMissing_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getSheet_(name) {
  return getDb_().getSheetByName(name);
}

function findRow_(sh, header, value) {
  const last = sh.getLastRow();
  if (last < 2) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf(header);
  if (col === -1) return null;
  const rows = sh.getRange(2, 1, last - 1, headers.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][col]).toLowerCase() === String(value).toLowerCase()) {
      return { index: i + 2, values: rows[i] };
    }
  }
  return null;
}

function appendLog_(chatKey, channel, dir, message) {
  getSheet_(SHEETS.CHAT_LOG).appendRow([
    chatKey, new Date(), dir, String(message || ""),
  ]);
}

function logWebhook_(tag, payload) {
  getSheet_(SHEETS.WEBHOOK_LOG).appendRow([new Date(), tag, String(payload || "")]);
}

function getWebAppUrl_() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    throw new Error(
      "URL Web App belum tersedia. Deploy dulu (Deploy → New deployment → Web app), lalu coba lagi."
    );
  }
  return url;
}

function fetchJson_(url, options) {
  const opts = options || {};
  opts.muteHttpExceptions = true;
  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  let json = null;
  try {
    json = JSON.parse(res.getContentText());
  } catch (err) {
    json = null;
  }
  if (code >= 400) {
    const msg = json && json.error && json.error.message
      ? json.error.message
      : "HTTP " + code;
    const e = new Error(msg);
    e.payload = json;
    throw e;
  }
  return json || {};
}

function parseBody_(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      return {};
    }
  }
  return (e && e.parameter) || {};
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function hash_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text),
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    })
    .join("");
}

function randomId_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 16);
}

function clean_(v) {
  return String(v == null ? "" : v).trim();
}

function normalizePhone_(s) {
  let d = String(s || "").replace(/[^0-9]/g, "");
  if (d.indexOf("0") === 0) d = "62" + d.slice(1);
  return d;
}
