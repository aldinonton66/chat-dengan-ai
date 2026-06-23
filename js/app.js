// ============================================================
//  FILE: app.js
//  DESKRIPSI: Logika utama aplikasi "Kita & AI"
//  - Navigasi antar section (sidebar + bottom nav mobile)
//  - Toggle tema dark/light
//  - Generate menu dari APP_CONFIG
//  - Profil: load/save localStorage + sync Supabase
//  - AI Settings: system prompt, realtime preview
//  - API Key: CRUD, tes koneksi, sistem loop fallback
//  - Chat: teks, voice note, media, history localStorage + sync Supabase
//  - Storage: monitor + sync ke Supabase user_data table
// ============================================================

(function () {
  "use strict";

  /* ----------------------------------------------------------
     ELEMEN DOM UTAMA
     ---------------------------------------------------------- */
  var sidebarNavList    = document.getElementById("nav-list");
  var bottomNavEl       = document.getElementById("bottom-nav");
  var themeToggleBtn    = document.getElementById("btn-theme-toggle");
  var bodyEl            = document.body;

  /* ----------------------------------------------------------
     STATE APP
     ---------------------------------------------------------- */
  var currentSectionId = APP_CONFIG.defaultActive;

  // State chat
  var chatHistory = [];           // Array {role, sender, text, time, type, mediaUrl, duration}
  var mediaRecorder = null;      // Instance MediaRecorder
  var audioChunks = [];          // Chunk rekaman suara
  var isRecording = false;       // Status sedang merekam
  var _recordStartTime = 0;     // Waktu mulai rekam (timestamp)
  var hiddenFileInput = null;    // Input file tersembunyi

  /* ----------------------------------------------------------
      SUPABASE STORAGE — sync localStorage ke Supabase
      ---------------------------------------------------------- */
  var _supabase = null;              // Instance Supabase client
  var _syncDebounceTimer = null;     // Timer debounce sync
  var _dataLoadedFromSupabase = false;
  var _lastSyncTime = null;          // Timestamp sync terakhir

  /** Dapatkan Supabase client (lazy init) */
  function getSupabase() {
    if (_supabase) return _supabase;
    if (typeof window.supabase !== 'undefined' && APP_CONFIG.supabaseUrl) {
      _supabase = window.supabase.createClient(
        APP_CONFIG.supabaseUrl,
        APP_CONFIG.supabaseAnonKey
      );
    }
    return _supabase;
  }

  /** Load semua data user dari Supabase ke localStorage */
  async function loadFromSupabase() {
    var sb = getSupabase();
    if (!sb) return false;

    try {
      var result = await sb.auth.getSession();
      var session = result.data && result.data.session;
      if (!session) return false;

      var resp = await sb
        .from('user_data')
        .select('data')
        .eq('user_id', session.user.id)
        .single();

      if (resp.error || !resp.data || !resp.data.data) return false;

      var serverData = resp.data.data;
      // Populate localStorage from Supabase
      Object.keys(serverData).forEach(function (key) {
        if (serverData[key]) {
          try { localStorage.setItem(key, serverData[key]); } catch (e) {}
        }
      });

      _dataLoadedFromSupabase = true;
      _lastSyncTime = Date.now();
      return true;
    } catch (e) {
      console.warn('[KitaAI] Gagal load dari Supabase:', e.message || e);
      showToast("Gagal memuat data dari cloud — pakai data lokal", "⚠️");
      return false;
    }
  }

  /** Sync seluruh localStorage ke Supabase.
   *  @param {boolean} silent — true = jangan tampilkan toast (untuk auto-sync) */
  async function syncAllToSupabase(silent) {
    var sb = getSupabase();
    if (!sb) {
      if (!silent) showToast("Supabase tidak terhubung", "⚠️");
      return;
    }

    try {
      var result = await sb.auth.getSession();
      var session = result.data && result.data.session;
      if (!session) {
        if (!silent) showToast("Session tidak ditemukan", "⚠️");
        return;
      }

      var allData = {};
      [
        'kita-chat-history','kita-profil','kita-ai',
        'kita-api-keys','kita-font','kita-theme',
        'kita-sidebar','kita-limited'
      ].forEach(function (key) {
        var val = localStorage.getItem(key);
        if (val !== null && val !== undefined) allData[key] = val;
      });

      // Safety: Supabase REST API limit ~1 MB per request.
      var totalSize = new Blob([JSON.stringify(allData)]).size;
      var MAX_SYNC_SIZE = 900 * 1024;
      if (totalSize > MAX_SYNC_SIZE && allData['kita-chat-history']) {
        console.warn('[KitaAI] Data terlalu besar (' + Math.round(totalSize/1024) + ' KB), trimming chat history...');
        try {
          var historyArr = JSON.parse(allData['kita-chat-history']);
          while (new Blob([JSON.stringify(allData)]).size > MAX_SYNC_SIZE && historyArr.length > 50) {
            historyArr = historyArr.slice(-Math.floor(historyArr.length * 0.8));
            allData['kita-chat-history'] = JSON.stringify(historyArr);
          }
          localStorage.setItem('kita-chat-history', allData['kita-chat-history']);
          chatHistory = historyArr;
          if (!silent) showToast("Data di-trim agar muat di Supabase", "ℹ️");
        } catch (e) {}
      }

      var upsertResult = await sb.from('user_data').upsert({
        user_id: session.user.id,
        data: allData,
        updated_at: new Date().toISOString()
      });

      if (upsertResult.error) {
        throw new Error(upsertResult.error.message || "Upsert gagal");
      }

      _lastSyncTime = Date.now();
      try { refreshStorageMonitor(); } catch (e) {}
      if (!silent) showToast("Data tersimpan ke Supabase ☁️", "✅");
    } catch (e) {
      console.warn('[KitaAI] Gagal sync ke Supabase:', e.message || e);
      if (!silent) showToast("Gagal sync ke Supabase: " + (e.message || "network error"), "⚠️");
    }
  }

  /** Jadwalkan sync (debounce 1.5 detik — silent, tanpa toast) */
  function scheduleSyncToSupabase() {
    clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = setTimeout(function () { syncAllToSupabase(true); }, 1500);
  }

  /** Hapus semua data user dari Supabase */
  async function deleteFromSupabase() {
    var sb = getSupabase();
    if (!sb) return;
    try {
      var result = await sb.auth.getSession();
      var session = result.data && result.data.session;
      if (!session) return;
      var delResult = await sb.from('user_data').delete().eq('user_id', session.user.id);
      if (delResult.error) throw new Error(delResult.error.message);
    } catch (e) {
      console.warn('[KitaAI] Gagal hapus data dari Supabase:', e.message || e);
      showToast("Gagal hapus data dari cloud", "⚠️");
    }
  }

  /* ----------------------------------------------------------
      Panggil Edge Function dengan built-in fallback
      ---------------------------------------------------------- */
  function callAI(messages, model, maxTokens, skipProviders) {
    var url = APP_CONFIG.supabaseUrl + "/functions/v1/groq-chat";
    var body = { messages: messages, max_tokens: maxTokens || 500 };
    if (skipProviders && skipProviders.length > 0) {
      body.skip_providers = skipProviders;
    }
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + APP_CONFIG.supabaseAnonKey,
        "apikey": APP_CONFIG.supabaseAnonKey,
      },
      body: JSON.stringify(body),
    });
  }

  /* ==========================================================
     NAVIGASI
     ========================================================== */

  function generateNavigation() {
    if (!sidebarNavList || !bottomNavEl) return;
    
    var sidebarHtml = "";

    APP_CONFIG.navMenu.forEach(function (menu) {
      sidebarHtml +=
        '<li class="nav-item">' +
          '<button class="nav-link" data-section="' + menu.id + '">' +
            '<span class="nav-icon">' + menu.icon + '</span>' +
            '<span class="nav-label">' + menu.label + '</span>' +
          '</button>' +
        '</li>';
    });

    sidebarNavList.innerHTML = sidebarHtml;

    var bottomHtml = '<ul id="bottom-nav-list">';
    APP_CONFIG.navMenu.forEach(function (menu) {
      bottomHtml +=
        '<li class="bottom-nav-item">' +
          '<button class="bottom-nav-link" data-section="' + menu.id + '">' +
            '<span class="nav-icon">' + menu.icon + '</span>' +
            '<span class="nav-label">' + menu.label + '</span>' +
          '</button>' +
        '</li>';
    });
    bottomHtml += "</ul>";
    bottomNavEl.innerHTML = bottomHtml;
  }

  function showSection(sectionId) {
    var allSections = document.querySelectorAll(".content-section");
    allSections.forEach(function (sec) { sec.classList.remove("active"); });

    var target = document.getElementById(sectionId);
    if (target) { target.classList.add("active"); }

    currentSectionId = sectionId;

    var sidebarLinks = document.querySelectorAll("#nav-list .nav-link");
    sidebarLinks.forEach(function (link) {
      if (link.getAttribute("data-section") === sectionId) {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });

    var bottomLinks = document.querySelectorAll("#bottom-nav .bottom-nav-link");
    bottomLinks.forEach(function (link) {
      if (link.getAttribute("data-section") === sectionId) {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });

    // Saat buka chat, scroll ke bawah
    if (sectionId === "section-chat") {
      setTimeout(function () {
        scrollToBottom();
        updateScrollButton();
      }, 150);
    }

    // Saat buka profil, refresh form & monitor storage
    if (sectionId === "section-profil") {
      try {
        populateProfilForm();
        bindProfilEvents();
        refreshStorageMonitor();
      } catch (e) { console.error("[KitaAI] Gagal init profil on show:", e); }
    }

    // Saat buka AI, refresh form dari localStorage
    if (sectionId === "section-ai") {
      try {
        populateAIForm();
        refreshStorageMonitor();
      } catch (e) { console.error("[KitaAI] Gagal init AI on show:", e); }
    }

    // Saat buka status, render cards
    if (sectionId === "section-status") {
      try { renderStatusCards(); } catch (e) { console.error("[KitaAI] Gagal render status:", e); }
    }
  }

  function bindNavigationEvents() {
    if (sidebarNavList) {
      sidebarNavList.addEventListener("click", function (e) {
        var button = e.target.closest(".nav-link");
        if (!button) return;
        var sectionId = button.getAttribute("data-section");
        if (sectionId) showSection(sectionId);
      });
    }

    if (bottomNavEl) {
      bottomNavEl.addEventListener("click", function (e) {
        var button = e.target.closest(".bottom-nav-link");
        if (!button) return;
        var sectionId = button.getAttribute("data-section");
        if (sectionId) showSection(sectionId);
      });
    }
  }

  /* ==========================================================
     SIDEBAR — Toggle collapse/expand + Drag resize
     ========================================================== */

  /** Dapatkan elemen sidebar (lazy, karena DOM mungkin belum siap) */
  function getSidebarEl() {
    return document.getElementById("sidebar");
  }

  /* ----------------------------------------------------------
     Muat state sidebar dari localStorage
     ---------------------------------------------------------- */
  function loadSidebarState() {
    var saved = localStorage.getItem("kita-sidebar");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* fallback */ }
    }
    return { collapsed: false, width: 200 };
  }

  /* ----------------------------------------------------------
     Simpan state sidebar ke localStorage
     ---------------------------------------------------------- */
  function saveSidebarState(state) {
    safeSetItem("kita-sidebar", JSON.stringify(state));
  }

  /* ----------------------------------------------------------
     Terapkan state sidebar (collapsed + width)
     ---------------------------------------------------------- */
  function applySidebarState() {
    var sidebarEl = getSidebarEl();
    if (!sidebarEl) return;
    var state = loadSidebarState();

    // Terapkan collapsed
    if (state.collapsed) {
      sidebarEl.classList.add("collapsed");
    } else {
      sidebarEl.classList.remove("collapsed");
    }

    // Terapkan lebar
    if (state.width) {
      sidebarEl.style.width = state.width + "px";
    }

    // Update ikon toggle
    updateToggleIcon();
  }

  /* ----------------------------------------------------------
     Update ikon tombol toggle (◀ / ▶)
     ---------------------------------------------------------- */
  function updateToggleIcon() {
    var icon = document.querySelector(".sidebar-toggle-icon");
    var sidebarEl = getSidebarEl();
    if (!icon || !sidebarEl) return;
    if (sidebarEl.classList.contains("collapsed")) {
      icon.textContent = "▶";
    } else {
      icon.textContent = "◀";
    }
  }

  /* ----------------------------------------------------------
     Toggle collapse / expand sidebar
     ---------------------------------------------------------- */
  function toggleSidebar() {
    var sidebarEl = getSidebarEl();
    if (!sidebarEl) return;

    var isCollapsed = sidebarEl.classList.toggle("collapsed");
    updateToggleIcon();

    // Simpan state
    var state = loadSidebarState();
    state.collapsed = isCollapsed;
    saveSidebarState(state);

    // Trigger resize event agar konten menyesuaikan
    setTimeout(function () {
      window.dispatchEvent(new Event("resize"));
    }, 350);
  }

  /* ----------------------------------------------------------
     Binding event toggle sidebar
     ---------------------------------------------------------- */
  function bindSidebarToggle() {
    var toggleBtn = document.getElementById("sidebar-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", toggleSidebar);
    }
  }

  /* ----------------------------------------------------------
     Drag resize sidebar (hanya di tepi kanan)
     ---------------------------------------------------------- */
  function bindSidebarResize() {
    var handle = document.getElementById("sidebar-resize-handle");
    if (!handle || !getSidebarEl()) return;

    var startX = 0;
    var startWidth = 0;
    var isResizing = false;

    handle.addEventListener("mousedown", function (e) {
      e.preventDefault();
      isResizing = true;
      startX = e.clientX;
      var el = getSidebarEl();
      if (!el) return;
      startWidth = el.offsetWidth;
      handle.classList.add("active");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", function (e) {
      if (!isResizing) return;

      var diff = e.clientX - startX;
      var newWidth = startWidth + diff;

      // Batasi min / max
      if (newWidth < 60) newWidth = 60;
      if (newWidth > 280) newWidth = 280;

      var el = getSidebarEl();
      if (el) el.style.width = newWidth + "px";
    });

    document.addEventListener("mouseup", function () {
      if (!isResizing) return;
      isResizing = false;
      handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      // Simpan lebar
      var state = loadSidebarState();
      var el = getSidebarEl();
      if (el) state.width = el.offsetWidth;
      saveSidebarState(state);
    });
  }

  /* ----------------------------------------------------------
     Inisialisasi sidebar
     ---------------------------------------------------------- */
  function initSidebar() {
    applySidebarState();
    bindSidebarToggle();
    bindSidebarResize();
  }

  /* ==========================================================
     TEMA DARK / LIGHT
     ========================================================== */

  function bindThemeToggle() {
    if (!themeToggleBtn) return;

    var savedTheme = localStorage.getItem("kita-theme");
    var isDark = (savedTheme === null)
      ? (APP_CONFIG.defaultTheme === "dark")
      : (savedTheme === "dark");

    if (isDark) {
      bodyEl.classList.add("dark");
      themeToggleBtn.innerHTML = "☀️";
    } else {
      bodyEl.classList.remove("dark");
      themeToggleBtn.innerHTML = "🌙";
    }

    themeToggleBtn.addEventListener("click", function () {
      var isDark = bodyEl.classList.toggle("dark");
      safeSetItem("kita-theme", isDark ? "dark" : "light");
      themeToggleBtn.innerHTML = isDark ? "☀️" : "🌙";
    });
  }

  /* ==========================================================
     TOAST NOTIFIKASI
     ========================================================== */

  function showToast(teks, ikon) {
    var toastEl   = document.getElementById("toast");
    var toastIcon = document.getElementById("toast-icon");
    var toastText = document.getElementById("toast-text");
    if (!toastEl || !toastText) return;

    toastIcon.textContent = ikon || "✅";
    toastText.textContent = teks;
    toastEl.classList.add("show");

    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2500);
  }

  /* ==========================================================
     UTILITAS
     ========================================================== */

  /** Escape karakter HTML untuk cegah XSS */
  function escapeHTML(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /** Safe localStorage setItem — tangkap QuotaExceededError */
  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
      scheduleSyncToSupabase();
      return true;
    } catch (e) {
      console.warn("[KitaAI] Gagal simpan ke localStorage:", key, e.message || e);
      showToast("Penyimpanan lokal penuh! Hapus history chat lama.", "⚠️");
      return false;
    }
  }

  /** Deteksi warna terang (return true) — untuk teks kontras */
  function isLightColor(hex) {
    var r, g, b;
    if (hex.length === 7) {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    } else {
      r = parseInt(hex.slice(1, 2) + hex.slice(1, 2), 16);
      g = parseInt(hex.slice(2, 3) + hex.slice(2, 3), 16);
      b = parseInt(hex.slice(3, 4) + hex.slice(3, 4), 16);
    }
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6;
  }

  /** Format jam:menit dari Date */
  function formatTime(date) {
    return String(date.getHours()).padStart(2, "0") + ":" +
           String(date.getMinutes()).padStart(2, "0");
  }

  /** Generate ID unik pendek */
  function generateUID() {
    return "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
  }

  /* ==========================================================
     BAGIAN PROFIL — Load / Save localStorage
     ========================================================== */

  function loadProfilData() {
    var saved = localStorage.getItem("kita-profil");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* fallback */ }
    }
    return {
      person1: { nama: "Kamu",  warna: "#3b82f6" },
      person2: { nama: "Sari",  warna: "#ec4899" }
    };
  }

  function saveProfilData(data) {
    safeSetItem("kita-profil", JSON.stringify(data));
    try { refreshStorageMonitor(); } catch (e) { /* ignore */ }
  }

  function populateProfilForm() {
    var data = loadProfilData();
    var p1Nama  = document.getElementById("profil-p1-nama");
    var p1Warna = document.getElementById("profil-p1-warna");
    var p1Hex   = document.getElementById("profil-p1-hex");
    var p2Nama  = document.getElementById("profil-p2-nama");
    var p2Warna = document.getElementById("profil-p2-warna");
    var p2Hex   = document.getElementById("profil-p2-hex");

    if (p1Nama)  p1Nama.value  = data.person1.nama;
    if (p1Warna) p1Warna.value = data.person1.warna;
    if (p1Hex)   p1Hex.textContent = data.person1.warna;
    if (p2Nama)  p2Nama.value  = data.person2.nama;
    if (p2Warna) p2Warna.value = data.person2.warna;
    if (p2Hex)   p2Hex.textContent = data.person2.warna;

    updateProfilPreview("p1");
    updateProfilPreview("p2");
    updateSpeakerDropdown();
    updateExistingBubbles();
  }

  function updateProfilPreview(target) {
    var prefix = (target === "p1")
      ? { namaId: "profil-p1-nama", warnaId: "profil-p1-warna",
          previewId: "preview-p1", namaPreviewId: "preview-p1-nama",
          bodyPreviewId: "preview-p1-body" }
      : { namaId: "profil-p2-nama", warnaId: "profil-p2-warna",
          previewId: "preview-p2", namaPreviewId: "preview-p2-nama",
          bodyPreviewId: "preview-p2-body" };

    var namaInput  = document.getElementById(prefix.namaId);
    var warnaInput = document.getElementById(prefix.warnaId);
    var namaPrev   = document.getElementById(prefix.namaPreviewId);
    var bodyPrev   = document.getElementById(prefix.bodyPreviewId);

    if (!namaInput || !warnaInput) return;
    var nama  = namaInput.value.trim() || "Nama";
    var warna = warnaInput.value;

    if (namaPrev) namaPrev.textContent = nama;
    if (bodyPrev) {
      bodyPrev.style.background = warna;
      bodyPrev.style.color = isLightColor(warna) ? "#1a1a1a" : "#ffffff";
    }
    var hexEl = document.getElementById("profil-" + target + "-hex");
    if (hexEl) hexEl.textContent = warna;
  }

  /** Update nama di dropdown speaker chat */
  function updateSpeakerDropdown() {
    var spk = document.getElementById("select-speaker");
    if (!spk) return;
    var data = loadProfilData();
    if (spk.options[0]) spk.options[0].text = "✨ " + data.person1.nama;
    if (spk.options[1]) spk.options[1].text = "🌸 " + data.person2.nama;
  }

  /** Update nama & warna bubble yang sudah ada di area chat */
  function updateExistingBubbles() {
    var data = loadProfilData();
    var aiData = loadAIData();

    document.querySelectorAll(".bubble-person1 .bubble-name").forEach(function (el) {
      el.textContent = "✨ " + data.person1.nama;
    });
    document.querySelectorAll(".bubble-person1 .bubble-body").forEach(function (el) {
      el.style.background = data.person1.warna;
      // Warna teks diatur terpisah oleh applyFontToAllBubbles()
    });
    document.querySelectorAll(".bubble-person2 .bubble-name").forEach(function (el) {
      el.textContent = "🌸 " + data.person2.nama;
    });
    document.querySelectorAll(".bubble-person2 .bubble-body").forEach(function (el) {
      el.style.background = data.person2.warna;
      // Warna teks diatur terpisah oleh applyFontToAllBubbles()
    });

    // Update nama AI di bubble yang sudah ada
    document.querySelectorAll(".bubble-ai .bubble-name").forEach(function (el) {
      el.textContent = "🤖 " + aiData.nama;
    });
  }

  var _profilBound = false;

  function bindProfilEvents() {
    // Hindari double-binding
    if (_profilBound) return;
    _profilBound = true;

    var p1Nama  = document.getElementById("profil-p1-nama");
    var p1Warna = document.getElementById("profil-p1-warna");
    var p2Nama  = document.getElementById("profil-p2-nama");
    var p2Warna = document.getElementById("profil-p2-warna");

    if (p1Nama)  p1Nama.addEventListener("input",  function () { updateProfilPreview("p1"); });
    if (p1Warna) p1Warna.addEventListener("input", function () { updateProfilPreview("p1"); });
    if (p2Nama)  p2Nama.addEventListener("input",  function () { updateProfilPreview("p2"); });
    if (p2Warna) p2Warna.addEventListener("input", function () { updateProfilPreview("p2"); });

    var btnSimpan = document.getElementById("btn-simpan-profil");
    if (btnSimpan) {
      btnSimpan.addEventListener("click", function () {
        var data = {
          person1: {
            nama:  (document.getElementById("profil-p1-nama").value || "").trim() || "Kamu",
            warna: document.getElementById("profil-p1-warna").value
          },
          person2: {
            nama:  (document.getElementById("profil-p2-nama").value || "").trim() || "Sari",
            warna: document.getElementById("profil-p2-warna").value
          }
        };
        saveProfilData(data);

        // Simpan juga data font
        var fontData = {
          ukuran:  parseInt(document.getElementById("font-ukuran").value, 10) || 15,
          warnaP1: document.getElementById("font-warna-p1").value,
          warnaP2: document.getElementById("font-warna-p2").value,
          warnaAI: document.getElementById("font-warna-ai").value,
          fontFamily: (document.getElementById("font-family") || {}).value || "Inter",
          lineHeight: parseFloat((document.getElementById("font-lineheight") || {}).value) || 1.6,
          fontWeight: (document.getElementById("font-bold") || {}).checked ? "700" : "400"
        };
        saveFontData(fontData);

        updateSpeakerDropdown();
        updateExistingBubbles();
        applyFontToAllBubbles();
        refreshStorageMonitor();
        showToast("Profil & font disimpan!", "✅");
      });
    }
  }

  function initProfil() {
    populateProfilForm();
    bindProfilEvents();
  }

  /* ==========================================================
     BAGIAN FONT — Pengaturan ukuran & warna teks chat
     ========================================================== */

  /** Muat data font dari localStorage, fallback ke default */
  function loadFontData() {
    var saved = localStorage.getItem("kita-font");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* fallback */ }
    }
    return {
      ukuran: 15,
      warnaP1: "#ffffff",
      warnaP2: "#ffffff",
      warnaAI: "#e0e0e0",
      fontFamily: "Inter",
      lineHeight: 1.6,
      fontWeight: "400"
    };
  }

  /** Simpan data font ke localStorage */
  function saveFontData(data) {
    safeSetItem("kita-font", JSON.stringify(data));
    try { refreshStorageMonitor(); } catch (e) { /* ignore */ }
  }

  /** Isi form font dengan data tersimpan */
  function populateFontForm() {
    var data = loadFontData();

    var elUkuran     = document.getElementById("font-ukuran");
    var elLabel      = document.getElementById("font-ukuran-label");
    var elPreview    = document.getElementById("font-preview-text");

    var elWarnaP1    = document.getElementById("font-warna-p1");
    var elHexP1      = document.getElementById("font-warna-p1-hex");
    var elSwatchP1   = document.getElementById("font-warna-p1-preview");

    var elWarnaP2    = document.getElementById("font-warna-p2");
    var elHexP2      = document.getElementById("font-warna-p2-hex");
    var elSwatchP2   = document.getElementById("font-warna-p2-preview");

    var elWarnaAI    = document.getElementById("font-warna-ai");
    var elHexAI      = document.getElementById("font-warna-ai-hex");
    var elSwatchAI   = document.getElementById("font-warna-ai-preview");

    var elFontFamily = document.getElementById("font-family");
    var elLineHeight = document.getElementById("font-lineheight");
    var elLineLabel  = document.getElementById("font-lineheight-label");
    var elBold       = document.getElementById("font-bold");

    if (elUkuran)  elUkuran.value = data.ukuran;
    if (elLabel)   elLabel.textContent = data.ukuran + "px";
    if (elPreview) elPreview.style.fontSize = data.ukuran + "px";

    if (elWarnaP1) elWarnaP1.value = data.warnaP1;
    if (elHexP1)   elHexP1.textContent = data.warnaP1;
    if (elSwatchP1) {
      elSwatchP1.style.background = data.warnaP1;
      elSwatchP1.style.color = isLightColor(data.warnaP1) ? "#1a1a1a" : "#ffffff";
    }

    if (elWarnaP2) elWarnaP2.value = data.warnaP2;
    if (elHexP2)   elHexP2.textContent = data.warnaP2;
    if (elSwatchP2) {
      elSwatchP2.style.background = data.warnaP2;
      elSwatchP2.style.color = isLightColor(data.warnaP2) ? "#1a1a1a" : "#ffffff";
    }

    if (elWarnaAI) elWarnaAI.value = data.warnaAI;
    if (elHexAI)   elHexAI.textContent = data.warnaAI;
    if (elSwatchAI) {
      elSwatchAI.style.background = data.warnaAI;
      elSwatchAI.style.color = isLightColor(data.warnaAI) ? "#1a1a1a" : "#ffffff";
    }

    if (elFontFamily) elFontFamily.value = data.fontFamily || "Inter";
    if (elLineHeight) elLineHeight.value = data.lineHeight || 1.6;
    if (elLineLabel)  elLineLabel.textContent = (data.lineHeight || 1.6).toFixed(1);
    if (elBold)       elBold.checked = (data.fontWeight === "700");
    if (elPreview) {
      if (data.fontFamily) elPreview.style.fontFamily = getFontStack(data.fontFamily);
      elPreview.style.lineHeight = (data.lineHeight || 1.6);
      elPreview.style.fontWeight = (data.fontWeight === "700") ? "700" : "400";
    }
    // Tandai preset dot yang sesuai
    markActivePreset("font-warna-p1", data.warnaP1);
    markActivePreset("font-warna-p2", data.warnaP2);
    markActivePreset("font-warna-ai", data.warnaAI);
  }

  /** Update preview ukuran font */
  function updateFontUkuranPreview() {
    var elUkuran  = document.getElementById("font-ukuran");
    var elLabel   = document.getElementById("font-ukuran-label");
    var elPreview = document.getElementById("font-preview-text");

    if (!elUkuran) return;
    var val = elUkuran.value;

    if (elLabel)   elLabel.textContent = val + "px";
    if (elPreview) elPreview.style.fontSize = val + "px";
  }

  /** Update preview swatch warna teks */
  function updateFontWarnaPreview(target) {
    var warnaId, hexId, swatchId;
    if (target === "p1") {
      warnaId = "font-warna-p1"; hexId = "font-warna-p1-hex"; swatchId = "font-warna-p1-preview";
    } else if (target === "p2") {
      warnaId = "font-warna-p2"; hexId = "font-warna-p2-hex"; swatchId = "font-warna-p2-preview";
    } else {
      warnaId = "font-warna-ai"; hexId = "font-warna-ai-hex"; swatchId = "font-warna-ai-preview";
    }

    var elWarna  = document.getElementById(warnaId);
    var elHex    = document.getElementById(hexId);
    var elSwatch = document.getElementById(swatchId);

    if (!elWarna) return;
    var warna = elWarna.value;

    if (elHex) elHex.textContent = warna;
    if (elSwatch) {
      elSwatch.style.background = warna;
      elSwatch.style.color = isLightColor(warna) ? "#1a1a1a" : "#ffffff";
    }
  }

  /** Konversi nama font ke CSS font-family stack */
  function getFontStack(family) {
    var map = {
      "Inter":       "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
      "system-ui":   "system-ui, 'Segoe UI', -apple-system, sans-serif",
      "serif":       "Georgia, 'Times New Roman', serif",
      "monospace":   "'SF Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace"
    };
    return map[family] || map["Inter"];
  }

  /** Tandai preset color dot yang cocok dengan warna saat ini */
  function markActivePreset(targetId, currentColor) {
    var container = document.querySelector('.color-presets[data-target="' + targetId + '"]');
    if (!container) return;
    var dots = container.querySelectorAll(".preset-dot");
    dots.forEach(function (dot) {
      var dotColor = dot.getAttribute("data-color");
      if (dotColor && dotColor.toLowerCase() === (currentColor || "").toLowerCase()) {
        dot.classList.add("active");
      } else {
        dot.classList.remove("active");
      }
    });
  }

  /** Terapkan font ke semua bubble yang sudah ada di chat.
   *  @param {Object} [overrides] — nilai dari form (live preview), menggantikan localStorage */
  function applyFontToAllBubbles(overrides) {
    var data = loadFontData();
    // Override dengan nilai form saat ini (untuk live preview sebelum save)
    if (overrides) {
      if (overrides.ukuran !== undefined)     data.ukuran = overrides.ukuran;
      if (overrides.warnaP1 !== undefined)    data.warnaP1 = overrides.warnaP1;
      if (overrides.warnaP2 !== undefined)    data.warnaP2 = overrides.warnaP2;
      if (overrides.warnaAI !== undefined)    data.warnaAI = overrides.warnaAI;
      if (overrides.fontFamily !== undefined) data.fontFamily = overrides.fontFamily;
      if (overrides.lineHeight !== undefined) data.lineHeight = overrides.lineHeight;
      if (overrides.fontWeight !== undefined) data.fontWeight = overrides.fontWeight;
    }
    var fontStack = getFontStack(data.fontFamily || "Inter");
    var lineH = data.lineHeight || 1.6;
    var weight = (data.fontWeight === "700") ? "700" : "400";

    // Ukuran font — update semua .bubble-body p
    document.querySelectorAll(".bubble-body p").forEach(function (el) {
      el.style.fontSize = data.ukuran + "px";
      el.style.fontFamily = fontStack;
      el.style.lineHeight = lineH;
      el.style.fontWeight = weight;
    });

    // Warna teks Person 1
    document.querySelectorAll(".bubble-person1 .bubble-body").forEach(function (el) {
      el.style.color = data.warnaP1;
    });

    // Warna teks Person 2
    document.querySelectorAll(".bubble-person2 .bubble-body").forEach(function (el) {
      el.style.color = data.warnaP2;
    });

    // Warna teks AI
    document.querySelectorAll(".bubble-ai .bubble-body").forEach(function (el) {
      el.style.color = data.warnaAI;
    });
  }

  /** Binding event form font */
  function bindFontEvents() {
    // Helper: baca semua nilai form saat ini
    function getFormOverrides() {
      return {
        ukuran:     parseInt((document.getElementById("font-ukuran") || {}).value, 10) || 15,
        warnaP1:    (document.getElementById("font-warna-p1") || {}).value,
        warnaP2:    (document.getElementById("font-warna-p2") || {}).value,
        warnaAI:    (document.getElementById("font-warna-ai") || {}).value,
        fontFamily: (document.getElementById("font-family") || {}).value,
        lineHeight: parseFloat((document.getElementById("font-lineheight") || {}).value) || 1.6,
        fontWeight: (document.getElementById("font-bold") || {}).checked ? "700" : "400"
      };
    }

    // -- Slider ukuran --
    var elUkuran = document.getElementById("font-ukuran");
    if (elUkuran) {
      elUkuran.addEventListener("input", function () {
        updateFontUkuranPreview();
        applyFontToAllBubbles(getFormOverrides());
      });
    }

    // -- Color picker Person 1 --
    var elWarnaP1 = document.getElementById("font-warna-p1");
    if (elWarnaP1) {
      elWarnaP1.addEventListener("input", function () {
        updateFontWarnaPreview("p1");
        applyFontToAllBubbles(getFormOverrides());
      });
    }

    // -- Color picker Person 2 --
    var elWarnaP2 = document.getElementById("font-warna-p2");
    if (elWarnaP2) {
      elWarnaP2.addEventListener("input", function () {
        updateFontWarnaPreview("p2");
        applyFontToAllBubbles(getFormOverrides());
      });
    }

    // -- Color picker AI --
    var elWarnaAI = document.getElementById("font-warna-ai");
    if (elWarnaAI) {
      elWarnaAI.addEventListener("input", function () {
        updateFontWarnaPreview("ai");
        applyFontToAllBubbles(getFormOverrides());
      });
    }

    // -- Font family dropdown --
    var elFontFamily = document.getElementById("font-family");
    if (elFontFamily) {
      elFontFamily.addEventListener("change", function () {
        var preview = document.getElementById("font-preview-text");
        if (preview) preview.style.fontFamily = getFontStack(elFontFamily.value);
        applyFontToAllBubbles(getFormOverrides());
      });
    }

    // -- Line height slider --
    var elLineHeight = document.getElementById("font-lineheight");
    if (elLineHeight) {
      elLineHeight.addEventListener("input", function () {
        var label = document.getElementById("font-lineheight-label");
        var preview = document.getElementById("font-preview-text");
        var val = parseFloat(elLineHeight.value);
        if (label) label.textContent = val.toFixed(1);
        if (preview) preview.style.lineHeight = val;
        applyFontToAllBubbles(getFormOverrides());
      });
    }

    // -- Bold toggle --
    var elBold = document.getElementById("font-bold");
    if (elBold) {
      elBold.addEventListener("change", function () {
        var preview = document.getElementById("font-preview-text");
        if (preview) preview.style.fontWeight = elBold.checked ? "700" : "400";
        applyFontToAllBubbles(getFormOverrides());
      });
    }

    // -- Preset color dots (delegated click) --
    document.querySelectorAll(".color-presets").forEach(function (container) {
      container.addEventListener("click", function (e) {
        var dot = e.target.closest(".preset-dot");
        if (!dot) return;
        var targetId = container.getAttribute("data-target");
        var color = dot.getAttribute("data-color");
        if (!targetId || !color) return;

        var input = document.getElementById(targetId);
        if (!input) return;
        input.value = color;

        // Trigger input event
        input.dispatchEvent(new Event("input", { bubbles: true }));

        // Update preview
        if (targetId === "font-warna-p1") updateFontWarnaPreview("p1");
        else if (targetId === "font-warna-p2") updateFontWarnaPreview("p2");
        else updateFontWarnaPreview("ai");

        markActivePreset(targetId, color);
        applyFontToAllBubbles(getFormOverrides());
      });
    });

    // -- Reset defaults --
    var btnReset = document.getElementById("btn-reset-font");
    if (btnReset) {
      btnReset.addEventListener("click", function () {
        var defaults = {
          ukuran: 15, warnaP1: "#ffffff", warnaP2: "#ffffff",
          warnaAI: "#e0e0e0", fontFamily: "Inter", lineHeight: 1.6, fontWeight: "400"
        };
        // Update all form elements
        var elUkuran = document.getElementById("font-ukuran");
        var elWarnaP1 = document.getElementById("font-warna-p1");
        var elWarnaP2 = document.getElementById("font-warna-p2");
        var elWarnaAI = document.getElementById("font-warna-ai");
        var elFontFamily = document.getElementById("font-family");
        var elLineHeight = document.getElementById("font-lineheight");
        var elBold = document.getElementById("font-bold");

        if (elUkuran) elUkuran.value = defaults.ukuran;
        if (elWarnaP1) elWarnaP1.value = defaults.warnaP1;
        if (elWarnaP2) elWarnaP2.value = defaults.warnaP2;
        if (elWarnaAI) elWarnaAI.value = defaults.warnaAI;
        if (elFontFamily) elFontFamily.value = defaults.fontFamily;
        if (elLineHeight) elLineHeight.value = defaults.lineHeight;
        if (elBold) elBold.checked = false;

        // Update all previews
        updateFontUkuranPreview();
        updateFontWarnaPreview("p1");
        updateFontWarnaPreview("p2");
        updateFontWarnaPreview("ai");
        var preview = document.getElementById("font-preview-text");
        if (preview) {
          preview.style.fontFamily = getFontStack("Inter");
          preview.style.lineHeight = "1.6";
          preview.style.fontWeight = "400";
        }
        markActivePreset("font-warna-p1", defaults.warnaP1);
        markActivePreset("font-warna-p2", defaults.warnaP2);
        markActivePreset("font-warna-ai", defaults.warnaAI);
        applyFontToAllBubbles(defaults);
        showToast("Font direset ke default", "🔄");
      });
    }
  }

  /** Inisialisasi modul font */
  function initFont() {
    populateFontForm();
    bindFontEvents();
    // Terapkan ke bubble existing
    setTimeout(function () {
      applyFontToAllBubbles();
    }, 300);
  }

  /* ==========================================================
     BAGIAN MONITOR STORAGE — Pantau pemakaian localStorage
     ========================================================== */

  /** Konstanta batas storage (5 MB = 5 * 1024 * 1024 bytes) */
  var STORAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

  /** Daftar key localStorage yang dipantau + label */
  var STORAGE_KEYS = [
    { key: "kita-chat-history", label: "History Chat",   icon: "💬", id: "storage-chat" },
    { key: "kita-profil",       label: "Profil",         icon: "👤", id: "storage-profil" },
    { key: "kita-ai",           label: "Pengaturan AI",  icon: "🤖", id: "storage-ai" },
    { key: "kita-api-keys",     label: "API Keys",       icon: "🔑", id: "storage-api" },
    { key: "kita-font",         label: "Font",           icon: "🎨", id: "storage-font" }
  ];

  /** Hitung ukuran string dalam bytes (UTF-8) */
  function getByteSize(str) {
    if (!str) return 0;
    // Gunakan Blob untuk hitung ukuran UTF-8 akurat
    return new Blob([str]).size;
  }

  /** Hitung pemakaian storage: return {total, details} */
  function hitungStorageUsage() {
    var total = 0;
    var details = [];

    STORAGE_KEYS.forEach(function (item) {
      var val = localStorage.getItem(item.key) || "";
      var size = getByteSize(val);
      total += size;
      details.push({
        key: item.key,
        label: item.label,
        icon: item.icon,
        id: item.id,
        size: size
      });
    });

    // Tambah key lain yang tidak terdaftar (tema, api-index)
    var otherKeys = ["kita-theme"];
    otherKeys.forEach(function (k) {
      var val = localStorage.getItem(k) || "";
      total += getByteSize(val);
    });

    return { total: total, details: details };
  }

  /** Format bytes ke KB/MB yang mudah dibaca */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  /** Update tampilan monitor storage */
  function refreshStorageMonitor() {
    var data = hitungStorageUsage();
    var totalBytes = data.total;
    var percent = Math.min(100, Math.round((totalBytes / STORAGE_MAX_BYTES) * 100));
    var usedText = formatBytes(totalBytes);

    // Update teks utama
    var elUsed    = document.getElementById("storage-used-text");
    var elPercent = document.getElementById("storage-percent-text");
    if (elUsed)    elUsed.textContent = usedText;
    if (elPercent) elPercent.textContent = "(" + percent + "%)";

    // Update progress bar
    var elBar = document.getElementById("storage-progress-bar");
    if (elBar) {
      elBar.style.width = percent + "%";
      // Bersihkan class warna lama
      elBar.classList.remove("low", "medium", "high");
      if (percent <= 60) {
        elBar.classList.add("low");
      } else if (percent <= 80) {
        elBar.classList.add("medium");
      } else {
        elBar.classList.add("high");
      }
    }

    // Update rincian per data
    data.details.forEach(function (d) {
      var el = document.getElementById(d.id);
      if (el) el.textContent = formatBytes(d.size);
    });

    // Tampilkan / sembunyikan warning
    var elWarning = document.getElementById("storage-warning");
    if (elWarning) {
      elWarning.style.display = (percent > 80) ? "block" : "none";
    }

    // --- Status Sync Supabase ---
    var elSync = document.getElementById("storage-sync-status");
    if (!elSync) {
      // Buat elemen status sync kalau belum ada
      var detailList = document.querySelector(".storage-detail-list");
      if (detailList) {
        elSync = document.createElement("div");
        elSync.id = "storage-sync-status";
        elSync.style.cssText = "margin-top:12px;padding:10px 14px;background:var(--bg-surface);border-radius:var(--radius-sm);border:1px solid var(--border-subtle);display:flex;align-items:center;gap:8px;font-size:0.82rem;";
        detailList.insertAdjacentElement("afterend", elSync);
      }
    }

    if (elSync) {
      var sb = getSupabase();
      if (!sb) {
        elSync.innerHTML = '<span style="color:var(--text-muted)">⚠️ Supabase tidak terhubung</span>';
      } else if (_lastSyncTime) {
        var ago = Math.round((Date.now() - _lastSyncTime) / 1000);
        var agoText = ago < 60 ? ago + " detik lalu" : Math.round(ago / 60) + " menit lalu";
        elSync.innerHTML = '<span style="color:#22c55e">☁️</span> <span style="color:var(--text-secondary)">Tersinkron ke Supabase</span> <span style="color:var(--text-muted);font-size:0.72rem;margin-left:auto">' + agoText + '</span>';
      } else {
        elSync.innerHTML = '<span style="color:var(--text-muted)">🔄 Menyinkronkan...</span>';
      }
    }
  }

  /** Binding event tombol storage */
  function bindStorageEvents() {
    // -- Refresh --
    var btnRefresh = document.getElementById("btn-refresh-storage");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", function () {
        refreshStorageMonitor();
        showToast("Storage diperbarui!", "🔄");
      });
    }

    // -- Hapus History Chat --
    var btnHapusHist = document.getElementById("btn-hapus-history");
    if (btnHapusHist) {
      btnHapusHist.addEventListener("click", function () {
        if (!confirm("Hapus semua history chat? Data profil, AI, API, dan font tetap aman.")) return;

        localStorage.removeItem("kita-chat-history");
        chatHistory = [];
        syncAllToSupabase(false);

        // Hapus bubble dari area chat
        var area = document.getElementById("chat-bubble-area");
        if (area) {
          // Simpan typing indicator & placeholder
          var typingInd = document.getElementById("typing-indicator");
          var placeholder = document.getElementById("chat-empty-placeholder");
          area.innerHTML = "";
          if (typingInd) area.appendChild(typingInd);
          if (placeholder) area.appendChild(placeholder);
          updateEmptyPlaceholder();
        }

        refreshStorageMonitor();
        showToast("History chat dihapus!", "🗑️");
      });
    }

    // -- Hapus Semua Data --
    var btnHapusSemua = document.getElementById("btn-hapus-semua");
    if (btnHapusSemua) {
      btnHapusSemua.addEventListener("click", function () {
        if (!confirm("⚠️ HAPUS SEMUA DATA?\n\nIni akan menghapus: profil, AI, API keys, font, history chat, dan tema.\n\nAplikasi akan di-reset total. Lanjutkan?")) return;

        // Hapus semua key localStorage milik aplikasi
        var keysToRemove = [
          "kita-chat-history", "kita-profil", "kita-ai",
          "kita-api-keys", "kita-font", "kita-theme"
        ];
        keysToRemove.forEach(function (k) {
          localStorage.removeItem(k);
        });

        // Hapus juga dari Supabase
        deleteFromSupabase();

        showToast("Semua data dihapus. Silakan reload halaman.", "⚠️");

        // Reload setelah jeda
        setTimeout(function () {
          location.reload();
        }, 2000);
      });
    }
  }

  /** Inisialisasi monitor storage */
  function initStorageMonitor() {
    refreshStorageMonitor();
    bindStorageEvents();
  }

  /* ==========================================================
     BAGIAN AI — Pengaturan AI + System Prompt
     ========================================================== */

  function loadAIData() {
    var saved = localStorage.getItem("kita-ai");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* fallback */ }
    }
    return {
      nama: "Kita AI",
      kepribadian: "hangat",
      customKepribadian: "",
      peraturan: "",
      aktif: true,
      bolehSaran: true
    };
  }

  function saveAIData(data) {
    safeSetItem("kita-ai", JSON.stringify(data));
    try { refreshStorageMonitor(); } catch (e) { /* ignore */ }
  }

  /** Generate system prompt string dari pengaturan AI + profil */
  function generateSystemPrompt() {
    var ai   = loadAIData();
    var prof = loadProfilData();

    var keprMap = {
      hangat: "Hangat & Ramah — selalu menyapa dengan hangat, empati tinggi, dan bersahabat.",
      bijak:  "Bijak & Netral — memberikan jawaban objektif, seimbang, dan penuh pertimbangan.",
      seru:   "Seru & Santai — gaya bicara santai, humoris, gunakan bahasa gaul sesekali."
    };

    var keprDesc = (ai.kepribadian === "custom" && ai.customKepribadian)
      ? "Custom: " + ai.customKepribadian
      : (keprMap[ai.kepribadian] || "");

    var lines = [];
    lines.push("Kamu adalah " + ai.nama + ".");
    lines.push("Kamu sedang berada dalam percakapan antara " + prof.person1.nama + " (Person 1) dan " + prof.person2.nama + " (Person 2).");
    lines.push("Kepribadianmu: " + keprDesc);

    if (!ai.aktif) {
      lines.push("PENTING: Kamu sedang NONAKTIF. Jangan membalas pesan apapun.");
    }
    if (!ai.bolehSaran) {
      lines.push("PENTING: JANGAN memberikan saran, ide, atau rekomendasi dalam bentuk apapun.");
    }
    if (ai.peraturan) {
      lines.push("Peraturan khusus: " + ai.peraturan);
    }

    lines.push("Gunakan Bahasa Indonesia yang santai dan natural.");
    lines.push("Jawab dengan singkat, padat, dan relevan dengan percakapan.");
    lines.push("Nama Person 1: " + prof.person1.nama);
    lines.push("Nama Person 2: " + prof.person2.nama);

    return lines.join("\n");
  }

  function populateAIForm() {
    var data = loadAIData();
    var elNama      = document.getElementById("ai-nama");
    var elKepr      = document.getElementById("ai-kepribadian");
    var elCustom    = document.getElementById("ai-kepribadian-custom");
    var elPeraturan = document.getElementById("ai-peraturan");
    var elAktif     = document.getElementById("ai-aktif");
    var elSaran     = document.getElementById("ai-boleh-saran");

    if (elNama)      elNama.value      = data.nama;
    if (elKepr)      elKepr.value      = data.kepribadian;
    if (elCustom)    elCustom.value    = data.customKepribadian || "";
    if (elPeraturan) elPeraturan.value = data.peraturan || "";
    if (elAktif)     elAktif.checked   = data.aktif;
    if (elSaran)     elSaran.checked   = data.bolehSaran;

    var groupCustom = document.getElementById("group-ai-custom");
    if (groupCustom) {
      groupCustom.style.display = (data.kepribadian === "custom") ? "block" : "none";
    }

    updatePeraturanCount();
    updateAIPreview();
  }

  function updatePeraturanCount() {
    var elPeraturan = document.getElementById("ai-peraturan");
    var elCount     = document.getElementById("ai-peraturan-count");
    if (!elPeraturan || !elCount) return;
    elCount.textContent = elPeraturan.value.length + " / " + (elPeraturan.maxLength || 1000) + " karakter";
  }

  function updateAIPreview() {
    var elPreview = document.getElementById("ai-preview-prompt");
    if (!elPreview) return;

    var nama    = (document.getElementById("ai-nama").value || "").trim() || "AI";
    var keprVal = document.getElementById("ai-kepribadian").value;
    var custTxt = (document.getElementById("ai-kepribadian-custom").value || "").trim();
    var peratur = (document.getElementById("ai-peraturan").value || "").trim();
    var aktif   = document.getElementById("ai-aktif").checked;
    var saran   = document.getElementById("ai-boleh-saran").checked;

    var keprMap = {
      hangat: "Hangat & Ramah — selalu menyapa dengan hangat, empati tinggi, dan bersahabat.",
      bijak:  "Bijak & Netral — memberikan jawaban objektif, seimbang, dan penuh pertimbangan.",
      seru:   "Seru & Santai — gaya bicara santai, humoris, gunakan bahasa gaul sesekali."
    };

    var keprDesc = (keprVal === "custom" && custTxt)
      ? "Custom: " + custTxt
      : (keprMap[keprVal] || "");

    var lines = [];
    lines.push("=== SYSTEM PROMPT ===");
    lines.push("Kamu adalah " + nama + ".");
    lines.push("Kepribadian: " + keprDesc);

    if (!aktif) lines.push("STATUS: AI sedang NONAKTIF.");
    if (!saran) {
      lines.push("ATURAN: JANGAN memberikan saran atau rekomendasi.");
    } else {
      lines.push("ATURAN: BOLEH memberikan saran dan rekomendasi.");
    }
    if (peratur) {
      lines.push("");
      lines.push("Peraturan khusus:");
      lines.push(peratur);
    }
    elPreview.textContent = lines.join("\n");
  }

  function bindAIEvents() {
    var elKepr = document.getElementById("ai-kepribadian");
    var grpCust = document.getElementById("group-ai-custom");
    if (elKepr && grpCust) {
      elKepr.addEventListener("change", function () {
        grpCust.style.display = (elKepr.value === "custom") ? "block" : "none";
        updateAIPreview();
      });
    }

    var elNama = document.getElementById("ai-nama");
    if (elNama) elNama.addEventListener("input", updateAIPreview);

    var elCustom = document.getElementById("ai-kepribadian-custom");
    if (elCustom) elCustom.addEventListener("input", updateAIPreview);

    var elPeraturan = document.getElementById("ai-peraturan");
    if (elPeraturan) {
      elPeraturan.addEventListener("input", function () {
        updatePeraturanCount();
        updateAIPreview();
      });
    }

    var elAktif = document.getElementById("ai-aktif");
    if (elAktif) elAktif.addEventListener("change", updateAIPreview);

    var elSaran = document.getElementById("ai-boleh-saran");
    if (elSaran) elSaran.addEventListener("change", updateAIPreview);

    var btnSimpan = document.getElementById("btn-simpan-ai");
    if (btnSimpan) {
      btnSimpan.addEventListener("click", function () {
        var data = {
          nama: (document.getElementById("ai-nama").value || "").trim() || "Kita AI",
          kepribadian: document.getElementById("ai-kepribadian").value,
          customKepribadian: (document.getElementById("ai-kepribadian-custom").value || "").trim(),
          peraturan: (document.getElementById("ai-peraturan").value || "").trim(),
          aktif: document.getElementById("ai-aktif").checked,
          bolehSaran: document.getElementById("ai-boleh-saran").checked
        };
        saveAIData(data);
        updateExistingBubbles();
        refreshStorageMonitor();
        showToast("Pengaturan AI disimpan!", "✅");
      });
    }
  }

  function initAI() {
    populateAIForm();
    bindAIEvents();
  }

  /* ==========================================================
      KIRIM PESAN KE AI — via Edge Function dengan fallback
      ========================================================== */
  function kirimPesanKeAI(userMessage, callback) {
    var systemPrompt = generateSystemPrompt();
    var prof = loadProfilData();

    var messages = [];
    messages.push({ role: "system", content: systemPrompt });

    var recentHistory = chatHistory.slice(-20);
    recentHistory.forEach(function (msg) {
      if (msg.type === "text" && msg.role) {
        if (msg.role === "assistant") {
          // Pesan AI — tetap sebagai assistant tanpa prefiks nama
          messages.push({ role: "assistant", content: msg.text });
        } else {
          var senderName = (msg.sender === "person1") ? prof.person1.nama : prof.person2.nama;
          messages.push({ role: msg.role, content: "[" + senderName + "]: " + msg.text });
        }
      }
    });

    var senderName = (userMessage.sender === "person1") ? prof.person1.nama : prof.person2.nama;
    messages.push({ role: "user", content: "[" + senderName + "]: " + userMessage.text });

    // 1 request -> Edge Function handle fallback otomatis
    var skipProviders = loadLimitedProviders();
    callAI(messages, null, 500, skipProviders)
      .then(function (response) {
        if (!response.ok) {
          return response.json().then(function (err) {
            if (err.limited_providers) saveLimitedProviders(err.limited_providers);
            callback("\u26A0\uFE0F AI gagal merespon: " + (err.error || "HTTP " + response.status), null);
          });
        }
        return response.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.limited_providers) saveLimitedProviders(data.limited_providers);
        var replyText = (data.choices && data.choices[0]) ? data.choices[0].message.content : null;
        if (replyText) {
          callback(null, replyText);
        } else {
          callback("\u26A0\uFE0F AI memberikan response kosong.", null);
        }
      })
      .catch(function () {
        callback("\u26A0\uFE0F Gagal terhubung ke server AI.", null);
      });
  }

  /* ==========================================================
     BAGIAN CHAT — Teks, Voice Note, Media, History
     ========================================================== */

  function getChatElements() {
    return {
      bubbleArea:   document.getElementById("chat-bubble-area"),
      typingInd:    document.getElementById("typing-indicator"),
      scrollBtn:    document.getElementById("btn-scroll-bottom"),
      inputText:    document.getElementById("chat-input"),
      btnSend:      document.getElementById("btn-send"),
      selectSpk:    document.getElementById("select-speaker"),
      btnMic:       document.getElementById("btn-mic"),
      btnGallery:   document.getElementById("btn-gallery"),
      lightbox:     document.getElementById("lightbox-overlay"),
      lightboxImg:  document.getElementById("lightbox-img"),
      lightboxClose: document.getElementById("lightbox-close")
    };
  }

  /* ---------- Scroll ---------- */

  function scrollToBottom() {
    var area = getChatElements().bubbleArea;
    if (area) area.scrollTop = area.scrollHeight;
  }

  function isNearBottom() {
    var area = getChatElements().bubbleArea;
    if (!area) return true;
    return (area.scrollHeight - area.scrollTop - area.clientHeight) < 80;
  }

  function updateScrollButton() {
    var btn = getChatElements().scrollBtn;
    if (!btn) return;
    if (isNearBottom()) {
      btn.classList.remove("visible");
    } else {
      btn.classList.add("visible");
    }
  }

  /* ---------- Typing Indicator ---------- */

  function showTyping() {
    var ind = getChatElements().typingInd;
    if (ind) { ind.style.display = "flex"; scrollToBottom(); }
  }

  function hideTyping() {
    var ind = getChatElements().typingInd;
    if (ind) ind.style.display = "none";
  }

  /* ---------- Textarea Auto-Expand ---------- */

  function autoExpandTextarea() {
    var ta = getChatElements().inputText;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  /* ---------- Bubble Builder ---------- */

  /** Buat HTML bubble untuk ditambahkan ke area chat */
  function buildBubbleHTML(msg) {
    var prof = loadProfilData();
    var font = loadFontData();
    var aiData = loadAIData();
    var html = "";
    var personaClass = "";
    var bubbleStyle = "";
    var senderName = "";

    // AI bubble — dibangun terpisah
    if (msg.role === "assistant") {
      personaClass = "bubble-left bubble-ai";
      senderName = "\uD83E\uDD16 " + aiData.nama;
      var aiFontStack = getFontStack(font.fontFamily || "Inter");
      var aiLineH = font.lineHeight || 1.6;
      var aiWeight = (font.fontWeight === "700") ? "700" : "400";
      html += '<div class="chat-bubble ' + personaClass + '" data-msg-id="' + (msg.id || "") + '">';
      html += '<div class="bubble-header">';
      html += '<span class="bubble-avatar">\uD83E\uDD16</span>';
      html += '<span class="bubble-name">' + escapeHTML(senderName) + '</span>';
      html += '<span class="bubble-time">' + msg.time + '</span>';
      html += '</div>';
      html += '<div class="bubble-body" style="color:' + font.warnaAI + ';font-size:' + font.ukuran + 'px;font-family:' + aiFontStack + ';line-height:' + aiLineH + ';font-weight:' + aiWeight + ';"><p>' + escapeHTML(msg.text) + '</p></div>';
      html += '</div>';
      return html;
    }

    // Person bubble
    var isRight = (msg.sender === "person1");
    personaClass = isRight ? "bubble-right bubble-person1" : "bubble-left bubble-person2";
    senderName = isRight ? ("\u2728 " + prof.person1.nama) : ("\uD83C\uDF38 " + prof.person2.nama);
    var senderColor = isRight ? prof.person1.warna : prof.person2.warna;
    var textColor = isRight ? font.warnaP1 : font.warnaP2;
    var personFontStack = getFontStack(font.fontFamily || "Inter");
    var personLineH = font.lineHeight || 1.6;
    var personWeight = (font.fontWeight === "700") ? "700" : "400";
    bubbleStyle = 'style="background:' + senderColor + ';color:' + textColor + ';font-size:' + font.ukuran + 'px;font-family:' + personFontStack + ';line-height:' + personLineH + ';font-weight:' + personWeight + ';"';

    if (msg.type === "voice") personaClass += " bubble-voice";
    if (msg.type === "image") personaClass += " bubble-image";
    if (msg.type === "video") personaClass += " bubble-video";

    html += '<div class="chat-bubble ' + personaClass + '" data-msg-id="' + (msg.id || "") + '">';
    html += '<div class="bubble-header">';

    if (isRight) {
      html += '<span class="bubble-time">' + msg.time + '</span>';
      html += '<span class="bubble-name">' + escapeHTML(senderName) + '</span>';
    } else {
      html += '<span class="bubble-name">' + escapeHTML(senderName) + '</span>';
      html += '<span class="bubble-time">' + msg.time + '</span>';
    }
    html += '</div>';

    // Body sesuai tipe
    if (msg.type === "text") {
      html += '<div class="bubble-body" ' + bubbleStyle + '><p>' + escapeHTML(msg.text) + '</p></div>';

    } else if (msg.type === "voice") {
      html += '<div class="bubble-body bubble-voice-body" ' + bubbleStyle + '>';
      html += '<button class="voice-play-btn" data-audio="' + escapeHTML(msg.mediaUrl || "") + '" title="Putar pesan suara">\u25B6</button>';
      html += '<div class="voice-wave">';
      for (var w = 0; w < 7; w++) { html += '<span class="wave-bar"></span>'; }
      html += '</div>';
      html += '<span class="voice-duration">' + (msg.duration || "0:00") + '</span>';
      html += '</div>';

    } else if (msg.type === "image") {
      html += '<div class="bubble-body" ' + bubbleStyle + '>';
      html += '<div class="image-thumb" data-full="' + escapeHTML(msg.mediaUrl || "") + '">';
      html += '<img src="' + escapeHTML(msg.mediaUrl || "") + '" alt="Foto dikirim" loading="lazy">';
      html += '</div>';
      if (msg.text) html += '<p class="image-caption">' + escapeHTML(msg.text) + '</p>';
      html += '</div>';

    } else if (msg.type === "video") {
      html += '<div class="bubble-body" ' + bubbleStyle + '>';
      html += '<div class="video-thumb">';
      html += '<img src="' + escapeHTML(msg.mediaUrl || "") + '" alt="Thumbnail video" loading="lazy">';
      html += '<div class="video-play-overlay"><span class="video-play-icon">\u25B6</span></div>';
      html += '<span class="video-duration-badge">' + (msg.duration || "0:00") + '</span>';
      html += '</div>';
      if (msg.text) html += '<p class="image-caption">' + escapeHTML(msg.text) + '</p>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  /** Tambah bubble ke area chat + simpan ke history */
  function addBubbleToChat(msg) {
    if (!msg.id) msg.id = generateUID();
    if (!msg.time) msg.time = formatTime(new Date());

    var els = getChatElements();
    var html = buildBubbleHTML(msg);

    if (els.typingInd) {
      els.typingInd.insertAdjacentHTML("beforebegin", html);
    } else if (els.bubbleArea) {
      els.bubbleArea.insertAdjacentHTML("beforeend", html);
    }

    // Simpan ke history (kecuali assistant sementara)
    if (msg.role !== "assistant" || msg.persist) {
      chatHistory.push(msg);
      saveChatHistory();
    }

    // Update placeholder kosong
    updateEmptyPlaceholder();

    scrollToBottom();
  }

  /* ---------- Empty Placeholder ---------- */

  /** Tampilkan / sembunyikan placeholder chat kosong */
  function updateEmptyPlaceholder() {
    var placeholder = document.getElementById("chat-empty-placeholder");
    var area = getChatElements().bubbleArea;
    if (!placeholder || !area) return;

    // Hitung bubble (selain typing indicator & placeholder)
    var bubbles = area.querySelectorAll(".chat-bubble:not(#typing-indicator)");
    if (bubbles.length === 0) {
      placeholder.style.display = "flex";
    } else {
      placeholder.style.display = "none";
    }
  }

  /* ---------- Chat History (localStorage) ---------- */

  function loadChatHistory() {
    var saved = localStorage.getItem("kita-chat-history");
    if (saved) {
      try {
        chatHistory = JSON.parse(saved);
        return;
      } catch (e) { /* fallback */ }
    }
    chatHistory = [];
  }

  function saveChatHistory() {
    // Batasi maks 2000 pesan (cukup untuk ribuan jam percakapan)
    if (chatHistory.length > 2000) {
      chatHistory = chatHistory.slice(-2000);
    }
    safeSetItem("kita-chat-history", JSON.stringify(chatHistory));
    // Update monitor storage (ringan)
    try { refreshStorageMonitor(); } catch (e) { /* ignore */ }
  }

  /** Render ulang chat dari history (dipanggil saat init) */
  function renderChatFromHistory() {
    var area = getChatElements().bubbleArea;
    if (!area) return;

    // Hapus semua bubble & placeholder (simpan typing indicator)
    var typingInd = getChatElements().typingInd;
    var placeholder = document.getElementById("chat-empty-placeholder");
    area.innerHTML = "";

    // Kembalikan typing indicator
    if (typingInd) area.appendChild(typingInd);

    // Kembalikan placeholder (akan diatur visibilitasnya)
    if (placeholder) area.appendChild(placeholder);

    if (chatHistory.length === 0) {
      updateEmptyPlaceholder();
      return;
    }

    chatHistory.forEach(function (msg) {
      var html = buildBubbleHTML(msg);
      if (typingInd) {
        typingInd.insertAdjacentHTML("beforebegin", html);
      } else {
        area.insertAdjacentHTML("beforeend", html);
      }
    });

    updateEmptyPlaceholder();
  }

  /* ---------- Kirim Pesan Teks ---------- */

  function sendMessage() {
    var els = getChatElements();
    var ta = els.inputText;
    var spk = els.selectSpk;
    if (!ta || !spk) return;

    var text = ta.value.trim();
    if (!text) {
      ta.classList.add("input-error");
      setTimeout(function () { ta.classList.remove("input-error"); }, 500);
      return;
    }

    var speaker = spk.value;

    var msg = {
      id: generateUID(),
      role: "user",
      sender: speaker,
      text: text,
      time: formatTime(new Date()),
      type: "text"
    };

    addBubbleToChat(msg);

    ta.value = "";
    ta.style.height = "auto";
    ta.focus();

    var aiData = loadAIData();
    if (aiData.aktif) {
      showTyping();
      
      // Disable send button & show thinking state
      if (els.btnSend) {
        els.btnSend.disabled = true;
        els.btnSend.style.opacity = "0.5";
        els.btnSend.style.pointerEvents = "none";
      }

      kirimPesanKeAI(msg, function (err, replyText) {
        hideTyping();

        if (els.btnSend) {
          els.btnSend.disabled = false;
          els.btnSend.style.opacity = "";
          els.btnSend.style.pointerEvents = "";
        }

        if (err) {
          var errorMsg = {
            id: generateUID(),
            role: "assistant",
            sender: "ai",
            text: err,
            time: formatTime(new Date()),
            type: "text",
            persist: true
          };
          addBubbleToChat(errorMsg);
          showToast("Gagal menghubungi AI", "\u26A0\uFE0F");
        } else {
          var replyMsg = {
            id: generateUID(),
            role: "assistant",
            sender: "ai",
            text: replyText,
            time: formatTime(new Date()),
            type: "text",
            persist: true
          };
          addBubbleToChat(replyMsg);
        }
      });
    } else {
      showToast("AI nonaktif. Aktifkan di Pengaturan AI.", "ℹ️");
    }
  }

  /* ---------- Voice Note (MediaRecorder API) ---------- */

  function initMediaRecorder() {
    var btnMic = getChatElements().btnMic;
    if (!btnMic) return;

    btnMic.addEventListener("click", function () {
      if (isRecording) {
        stopRecording();
        return;
      }

      // Cek dukungan browser
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("Browser tidak mendukung rekaman suara.", "⚠️");
        return;
      }

      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function (stream) {
          audioChunks = [];
          var mimeType = "";
          // Pilih MIME type yang didukung browser
          if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
            mimeType = "audio/webm;codecs=opus";
          } else if (MediaRecorder.isTypeSupported("audio/webm")) {
            mimeType = "audio/webm";
          } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
            mimeType = "audio/mp4";
          }
          mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType: mimeType } : {});

          mediaRecorder.ondataavailable = function (e) {
            if (e.data.size > 0) audioChunks.push(e.data);
          };

          mediaRecorder.onstop = function () {
            var audioBlob = new Blob(audioChunks, { type: mimeType || "audio/webm" });
            var audioUrl = URL.createObjectURL(audioBlob);

            // Hitung durasi aktual dari waktu rekam
            var endTime = Date.now();
            var durMs = endTime - _recordStartTime;
            var durationSec = Math.round(durMs / 1000);
            var durMin = Math.floor(durationSec / 60);
            var durSec = durationSec % 60;
            var durationStr = durMin + ":" + String(durSec).padStart(2, "0");

            // Tambah bubble voice
            var speaker = getChatElements().selectSpk.value;
            var msg = {
              id: generateUID(),
              role: "user",
              sender: speaker,
              text: "🎤 Pesan suara",
              time: formatTime(new Date()),
              type: "voice",
              mediaUrl: audioUrl,
              duration: durationStr
            };
            addBubbleToChat(msg);

            // Stop semua track
            stream.getTracks().forEach(function (t) { t.stop(); });
            isRecording = false;
            btnMic.textContent = "🎤";
            btnMic.classList.remove("recording");
            showToast("Pesan suara dikirim!", "🎤");
          };

          mediaRecorder.start();
          _recordStartTime = Date.now();
          isRecording = true;
          btnMic.textContent = "⏹️";
          btnMic.classList.add("recording");
          showToast("Merekam... klik lagi untuk berhenti.", "🔴");
        })
        .catch(function () {
          showToast("Izin mikrofon ditolak.", "⚠️");
        });
    });
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }

  /* ---------- Media Picker (Foto / Video) ---------- */

  function initMediaPicker() {
    var btnGallery = getChatElements().btnGallery;
    if (!btnGallery) return;

    // Buat hidden file input
    hiddenFileInput = document.createElement("input");
    hiddenFileInput.type = "file";
    hiddenFileInput.accept = "image/*,video/*";
    hiddenFileInput.style.display = "none";
    document.body.appendChild(hiddenFileInput);

    btnGallery.addEventListener("click", function () {
      hiddenFileInput.click();
    });

    hiddenFileInput.addEventListener("change", function () {
      var file = hiddenFileInput.files[0];
      if (!file) return;

      var fileUrl = URL.createObjectURL(file);
      var isVideo = file.type.startsWith("video/");
      var speaker = getChatElements().selectSpk.value;

      if (isVideo) {
        // Buat video element sementara untuk dapat durasi
        var videoEl = document.createElement("video");
        videoEl.preload = "metadata";
        videoEl.src = fileUrl;
        videoEl.onloadedmetadata = function () {
          var dur = Math.round(videoEl.duration || 0);
          var durMin = Math.floor(dur / 60);
          var durSec = dur % 60;
          var durationStr = durMin + ":" + String(durSec).padStart(2, "0");

          var msg = {
            id: generateUID(),
            role: "user",
            sender: speaker,
            text: "🎬 " + (file.name || "Video"),
            time: formatTime(new Date()),
            type: "video",
            mediaUrl: fileUrl,
            duration: durationStr
          };
          addBubbleToChat(msg);
          showToast("Video dikirim!", "🎬");
        };
      } else {
        // Gambar
        var msg = {
          id: generateUID(),
          role: "user",
          sender: speaker,
          text: "📸 " + (file.name || "Foto"),
          time: formatTime(new Date()),
          type: "image",
          mediaUrl: fileUrl
        };
        addBubbleToChat(msg);
        showToast("Gambar dikirim!", "📸");
      }

      // Reset file input
      hiddenFileInput.value = "";
    });
  }

  /* ---------- Lightbox ---------- */

  function openLightbox(imgSrc) {
    var els = getChatElements();
    if (!els.lightbox || !els.lightboxImg) return;
    els.lightboxImg.src = imgSrc;
    els.lightbox.style.display = "flex";
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    var els = getChatElements();
    if (!els.lightbox) return;
    els.lightbox.style.display = "none";
    if (els.lightboxImg) els.lightboxImg.src = "";
    document.body.style.overflow = "";
  }

  /* ---------- Play Voice Note ---------- */

  var currentAudio = null; // Audio yang sedang diputar

  function playVoiceNote(audioUrl, btnEl) {
    // Stop audio sebelumnya
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    // Hapus class .playing dari semua voice bubble
    document.querySelectorAll(".bubble-voice").forEach(function (b) {
      b.classList.remove("playing");
    });

    // Reset semua tombol play
    document.querySelectorAll(".voice-play-btn").forEach(function (b) {
      b.textContent = "▶";
    });

    if (!audioUrl) return;

    // Tandai bubble sebagai playing
    var voiceBubble = btnEl.closest(".bubble-voice");
    if (voiceBubble) voiceBubble.classList.add("playing");

    var audio = new Audio(audioUrl);
    currentAudio = audio;

    audio.onplay = function () { btnEl.textContent = "⏸"; };
    audio.onpause = function () {
      btnEl.textContent = "▶";
      if (voiceBubble) voiceBubble.classList.remove("playing");
    };
    audio.onended = function () {
      btnEl.textContent = "▶";
      currentAudio = null;
      if (voiceBubble) voiceBubble.classList.remove("playing");
    };
    audio.onerror = function () {
      btnEl.textContent = "▶";
      currentAudio = null;
      if (voiceBubble) voiceBubble.classList.remove("playing");
    };

    audio.play().catch(function () {
      btnEl.textContent = "▶";
      if (voiceBubble) voiceBubble.classList.remove("playing");
    });
  }

  /* ---------- Binding Event Chat ---------- */

  function bindChatEvents() {
    var els = getChatElements();

    // Scroll → tombol scroll bawah
    if (els.bubbleArea) {
      els.bubbleArea.addEventListener("scroll", updateScrollButton);
    }

    // Tombol scroll bawah
    if (els.scrollBtn) {
      els.scrollBtn.addEventListener("click", scrollToBottom);
    }

    // Textarea: auto-expand + Enter kirim
    if (els.inputText) {
      els.inputText.addEventListener("input", autoExpandTextarea);
      els.inputText.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }

    // Tombol kirim + ripple effect
    if (els.btnSend) {
      els.btnSend.addEventListener("click", function (e) {
        // Ripple effect
        var ripple = document.createElement("span");
        ripple.className = "ripple-span";
        var rect = els.btnSend.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height);
        ripple.style.width = size + "px";
        ripple.style.height = size + "px";
        ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
        ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
        els.btnSend.appendChild(ripple);
        setTimeout(function () { ripple.remove(); }, 500);

        sendMessage();
      });
    }

    // Klik area chat (delegasi: lightbox, voice play)
    if (els.bubbleArea) {
      els.bubbleArea.addEventListener("click", function (e) {
        // Lightbox gambar
        var thumb = e.target.closest(".image-thumb");
        if (thumb) {
          var fullSrc = thumb.getAttribute("data-full");
          var img = thumb.querySelector("img");
          var src = fullSrc || (img ? img.src : "");
          if (src) openLightbox(src);
          return;
        }

        // Lightbox video (dari thumbnail)
        var videoThumb = e.target.closest(".video-thumb");
        if (videoThumb) {
          var vImg = videoThumb.querySelector("img");
          if (vImg) openLightbox(vImg.src);
          return;
        }

        // Play voice note
        var playBtn = e.target.closest(".voice-play-btn");
        if (playBtn) {
          var audioUrl = playBtn.getAttribute("data-audio");
          playVoiceNote(audioUrl, playBtn);
          return;
        }
      });
    }

    // Lightbox close
    if (els.lightbox) {
      els.lightbox.addEventListener("click", function (e) {
        if (e.target === els.lightbox || e.target === els.lightboxClose) {
          closeLightbox();
        }
      });
    }
    if (els.lightboxClose) {
      els.lightboxClose.addEventListener("click", closeLightbox);
    }

    // Escape → close lightbox
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && els.lightbox && els.lightbox.style.display === "flex") {
        closeLightbox();
      }
    });

    // Mic & Gallery (init terpisah)
    initMediaRecorder();
    initMediaPicker();
  }

  /* ---------- Init Chat ---------- */

  function initChat() {
    // Muat history
    loadChatHistory();

    // Render history atau hapus dummy & tampilkan placeholder
    if (chatHistory.length > 0) {
      renderChatFromHistory();
    } else {
      // History kosong -> hapus dummy bubble HTML, tampilkan placeholder
      var area = getChatElements().bubbleArea;
      if (area) {
        var typingInd = getChatElements().typingInd;
        var placeholder = document.getElementById("chat-empty-placeholder");
        var allBubbles = area.querySelectorAll(".chat-bubble:not(#typing-indicator)");
        allBubbles.forEach(function (b) { b.remove(); });
        if (placeholder) placeholder.style.display = "flex";
      }
    }

    bindChatEvents();

    // Update speaker dropdown sesuai profil
    updateSpeakerDropdown();
    updateExistingBubbles();

    setTimeout(function () {
      scrollToBottom();
      updateScrollButton();
    }, 200);
  }

  /* ==========================================================
     INISIALISASI APLIKASI
     ========================================================== */

  /** Logout — signOut dari Supabase & redirect ke login */
  async function doLogout() {
    // Final sync ke Supabase sebelum logout
    try { await syncAllToSupabase(false); } catch (e) {}

    if (typeof window.supabase !== "undefined" && APP_CONFIG.supabaseUrl) {
      var sb = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);
      await sb.auth.signOut();
    }
    location.replace("login.html");
  }

  /* ==========================================================
     STATUS API — Limit tracking tiap provider
     ========================================================== */

  /** Muat daftar provider yang sedang limit dari localStorage */
  function loadLimitedProviders() {
    // Auto-clean: hapus provider yang reset_at-nya sudah lewat
    var raw = localStorage.getItem("kita-limited");
    if (!raw) return [];
    try {
      var map = JSON.parse(raw);
      var now = Date.now();
      var active = [];
      var cleaned = false;
      Object.keys(map).forEach(function (prov) {
        if (map[prov] > now) {
          active.push(prov);
        } else {
          cleaned = true;
        }
      });
      if (cleaned) localStorage.setItem("kita-limited", JSON.stringify(map));
      return active;
    } catch (e) { return []; }
  }

  /** Simpan provider yang kena limit + reset_at timestamp */
  function saveLimitedProviders(providers) {
    var map = {};
    try { map = JSON.parse(localStorage.getItem("kita-limited") || "{}"); } catch (e) {}
    Object.keys(providers).forEach(function (prov) {
      map[prov] = providers[prov];
    });
    localStorage.setItem("kita-limited", JSON.stringify(map));
  }

  /** Render status cards di section-status */
  function renderStatusCards() {
    var container = document.getElementById("status-list");
    if (!container) return;

    var providers = [
      { name: "groq",       label: "Groq",       model: "llama-3.3-70b", emoji: "⚡" },
      { name: "xai",        label: "xAI",        model: "grok-2-latest", emoji: "🚀" },
      { name: "openrouter", label: "OpenRouter",  model: "gpt-4o-mini",  emoji: "🔗" },
      { name: "cerebras",   label: "Cerebras",    model: "gpt-oss-120b", emoji: "🧠" },
      { name: "gemini",     label: "Gemini",      model: "gemini-2.0-flash", emoji: "🌐" }
    ];

    var limitedMap = {};
    try { limitedMap = JSON.parse(localStorage.getItem("kita-limited") || "{}"); } catch (e) {}
    var now = Date.now();

    var html = "";
    providers.forEach(function (p) {
      var resetAt = limitedMap[p.name];
      var isLimited = resetAt && resetAt > now;
      var statusClass = "ok";
      var indicatorClass = "green";
      var statusText = "Aktif";
      var detailText = "Model: " + p.model;
      var timerText = "";

      if (isLimited) {
        statusClass = "limited";
        indicatorClass = "yellow";
        var remainingMs = resetAt - now;
        var remainingMin = Math.ceil(remainingMs / 60000);
        statusText = "Limit — reset ~" + remainingMin + " menit";
        detailText = "Reset: " + new Date(resetAt).toLocaleTimeString("id-ID");
        timerText = formatCountdown(resetAt);
      } else if (resetAt && resetAt <= now) {
        // Sudah lewat reset → anggap aktif lagi
        indicatorClass = "green";
        statusText = "Aktif (baru reset)";
      }

      html +=
        '<div class="status-card ' + statusClass + '">' +
          '<span class="status-indicator ' + indicatorClass + '"></span>' +
          '<div class="status-info">' +
            '<div class="status-provider-name">' + p.emoji + ' ' + p.label + '</div>' +
            '<div class="status-provider-status">' + statusText + '</div>' +
            '<div class="status-provider-detail">' + detailText + '</div>' +
          '</div>' +
          (timerText ? '<span class="status-reset-timer">' + timerText + '</span>' : '') +
        '</div>';
    });

    container.innerHTML = html;

    // Auto-refresh timer tiap beberapa detik kalau ada yg limit
    if (Object.keys(limitedMap).length > 0) {
      clearTimeout(window._statusTimer);
      window._statusTimer = setTimeout(renderStatusCards, 30000);
    }
  }

  function formatCountdown(resetAt) {
    var diff = resetAt - Date.now();
    if (diff <= 0) return "Sekarang";
    var min = Math.floor(diff / 60000);
    var sec = Math.floor((diff % 60000) / 1000);
    return min + "m " + sec + "s";
  }

  /** Binding tombol logout */
  function bindLogoutButtons() {
    var btnSidebar = document.getElementById("btn-logout-sidebar");
    if (btnSidebar) {
      btnSidebar.addEventListener("click", function (e) {
        e.preventDefault();
        if (confirm("Yakin mau logout?")) doLogout();
      });
    }

    // Refresh status button
    var btnRefresh = document.getElementById("btn-refresh-status");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", function () {
        renderStatusCards();
        showToast("Status API diperbarui!", "🔄");
      });
    }
  }

  async function initApp() {
    // Step 0: Load data dari Supabase (sebelum render UI)
    try { await loadFromSupabase(); } catch (e) { console.warn("[KitaAI] Gagal load dari Supabase:", e); }

    var steps = [
      { name: "generateNavigation", fn: generateNavigation },
      { name: "bindNavigationEvents", fn: bindNavigationEvents },
      { name: "initSidebar", fn: initSidebar },
      { name: "showSection", fn: function() { showSection(APP_CONFIG.defaultActive); } },
      { name: "bindThemeToggle", fn: bindThemeToggle },
      { name: "initChat", fn: initChat },
      { name: "initProfil", fn: initProfil },
      { name: "initAI", fn: initAI },
      { name: "initFont", fn: initFont },
      { name: "initStorageMonitor", fn: initStorageMonitor }
    ];

    steps.forEach(function(step) {
      try {
        step.fn();
      } catch (e) {
        console.error("[KitaAI] Gagal init " + step.name + ":", e);
      }
    });

    // Binding logout
    try { bindLogoutButtons(); } catch (e) { console.error("[KitaAI] Gagal bind logout:", e); }
  }

  // Jalankan saat DOM siap
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }

})();
