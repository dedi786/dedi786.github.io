/* ============================================================
   SAKLAR — Konfigurasi global
   ------------------------------------------------------------
   URL backend bisa diisi dengan dua cara:
   1. Lewat halaman setup.html (direkomendasikan, ramah HP):
      tempel URL Web App /exec di sana → tersimpan otomatis.
   2. Manual: isi API_URL di bawah.
   ============================================================ */

window.SAKLAR_CONFIG = {
  // Default dipakai bila tidak ada konfigurasi server/perangkat.
  // Boleh diganti manual di sini bila URL deployment berubah.
  API_URL: "https://script.google.com/macros/s/AKfycbz3wKTQG8naFkJn6qKQ_sjdBf2_fLnIEmvA9WEJrKbAXxQNLzP4jriTfzjqi-E4afbG/exec",

  APP_NAME: "Saklar",
  SESSION_KEY: "saklar_session",
  API_URL_STORAGE: "saklar_api_url",
};

// Ambil URL backend: server preview → localStorage → default, lalu boot aplikasi
(function () {
  var loaded = false;
  var callbacks = [];

  function runCallbacks() {
    callbacks.forEach(function (cb) {
      try { cb(); } catch (e) { /* abaikan */ }
    });
    callbacks = [];
  }

  function finalize(url) {
    if (url) window.SAKLAR_CONFIG.API_URL = url;
    loaded = true;
    runCallbacks();
  }

  if (typeof fetch === "function") {
    // Jalur sandbox (ada server kecil) — 404 di GitHub Pages, wajar.
    fetch("/api/load-config")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.api_url) return finalize(d.api_url);
        // Jalur GitHub Pages: pakai pilihan tersimpan di perangkat ini.
        try {
          finalize(localStorage.getItem(window.SAKLAR_CONFIG.API_URL_STORAGE));
        } catch (e) {
          finalize(null);
        }
      })
      .catch(function () {
        try {
          finalize(localStorage.getItem(window.SAKLAR_CONFIG.API_URL_STORAGE));
        } catch (e) {
          finalize(null);
        }
      });
  } else {
    try {
      finalize(localStorage.getItem(window.SAKLAR_CONFIG.API_URL_STORAGE));
    } catch (e) {
      finalize(null);
    }
  }

  /** Jalankan cb setelah konfigurasi (termasuk URL server) siap. */
  window.saklarReady = function (cb) {
    if (loaded) cb();
    else callbacks.push(cb);
  };
})();

// Helper fetch ke Apps Script (JSON body, tanpa preflight CORS)
window.saklarApi = async function (action, payload = {}) {
  const cfg = window.SAKLAR_CONFIG;
  if (!cfg.API_URL) {
    throw new Error(
      "Backend belum tersambung. Buka setup.html dan tempel URL Web App (/exec) kamu."
    );
  }
  const res = await fetch(cfg.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error("Respons server tidak valid.");
  if (!json.ok) throw new Error(json.error || "Terjadi kesalahan di server.");
  return json.data;
};

// Session helpers (localStorage)
window.saklarSession = {
  get() {
    try {
      const raw = localStorage.getItem(window.SAKLAR_CONFIG.SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(data) {
    localStorage.setItem(
      window.SAKLAR_CONFIG.SESSION_KEY,
      JSON.stringify(data)
    );
  },
  clear() {
    localStorage.removeItem(window.SAKLAR_CONFIG.SESSION_KEY);
  },
};

// Guard: halaman terproteksi — redirect ke auth jika belum login
window.requireAuth = function () {
  const session = window.saklarSession.get();
  if (!session || !session.user_id) {
    window.location.replace("auth.html");
    return null;
  }
  return session;
};
