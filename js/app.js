// ============================================================
//  FILE: app.js
//  DESKRIPSI: Logika utama aplikasi "Kita & AI"
//  - Navigasi antar section (sidebar + bottom nav mobile)
//  - Toggle tema dark/light
//  - Generate menu dari APP_CONFIG
//  - Profil: load/save localStorage, update speaker & bubble
//  - AI Settings: system prompt, realtime preview
//  - API Key: CRUD, tes koneksi, sistem loop fallback
//  - Chat: teks, voice note, media, history localStorage
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
  var currentAPIIndex = 0;       // Index API yang sedang dipakai
  var mediaRecorder = null;      // Instance MediaRecorder
  var audioChunks = [];          // Chunk rekaman suara
  var isRecording = false;       // Status sedang merekam
  var _recordStartTime = 0;     // Waktu mulai rekam (timestamp)
  var hiddenFileInput = null;    // Input file tersembunyi

  /* ----------------------------------------------------------
     Supabase client (dari CDN, sudah ada sebelum konten)
     ---------------------------------------------------------- */
  var supabaseClient = null;
  if (typeof window.supabase !== "undefined" && APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseUrl !== "YOUR_SUPABASE_URL") {
    supabaseClient = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);
  }

  /* ----------------------------------------------------------
      Helper: panggil Edge Function (multi-provider)
      ---------------------------------------------------------- */
  function callEdgeFunction(provider, messages, model, maxTokens) {
    var url = APP_CONFIG.supabaseUrl + "/functions/v1/groq-chat";
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + APP_CONFIG.supabaseAnonKey,
        "apikey": APP_CONFIG.supabaseAnonKey,
      },
      body: JSON.stringify({
        provider: provider,
        messages: messages,
        model: model || getDefaultModelForProvider(provider),
        max_tokens: maxTokens || 500,
      }),
    });
  }

  function getDefaultModelForProvider(provider) {
    var models = {
      groq: "llama-3.3-70b-versatile",
      xai: "grok-2-1212",
      openrouter: "google/gemini-2.0-flash-001",
      cerebras: "llama3.1-8b",
      gemini: "gemini-2.0-flash"
    };
    return models[provider] || "gpt-3.5-turbo";
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
      return true;
    } catch (e) {
      // QuotaExceededError atau localStorage disable
      console.warn("[KitaAI] Gagal simpan ke localStorage:", key, e.message || e);
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

    document.querySelectorAll(".bubble-person1 .bubble-name").forEach(function (el) {
      el.textContent = "✨ " + data.person1.nama;
    });
    document.querySelectorAll(".bubble-person1 .bubble-body").forEach(function (el) {
      el.style.background = data.person1.warna;
      el.style.color = isLightColor(data.person1.warna) ? "#1a1a1a" : "#ffffff";
    });
    document.querySelectorAll(".bubble-person2 .bubble-name").forEach(function (el) {
      el.textContent = "🌸 " + data.person2.nama;
    });
    document.querySelectorAll(".bubble-person2 .bubble-body").forEach(function (el) {
      el.style.background = data.person2.warna;
      el.style.color = isLightColor(data.person2.warna) ? "#1a1a1a" : "#ffffff";
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
          warnaAI: document.getElementById("font-warna-ai").value
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
      warnaAI: "#e0e0e0"
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

  /** Terapkan font ke semua bubble yang sudah ada di chat */
  function applyFontToAllBubbles() {
    var data = loadFontData();

    // Ukuran font — update semua .bubble-body p
    document.querySelectorAll(".bubble-body p").forEach(function (el) {
      el.style.fontSize = data.ukuran + "px";
    });

    // Warna teks Person 1
    document.querySelectorAll(".bubble-person1 .bubble-body").forEach(function (el) {
      // Hanya ubah color jika bukan inline style dari profil (cek apakah inline background ada)
      if (el.style.background) {
        el.style.color = data.warnaP1;
      }
    });

    // Warna teks Person 2
    document.querySelectorAll(".bubble-person2 .bubble-body").forEach(function (el) {
      if (el.style.background) {
        el.style.color = data.warnaP2;
      }
    });

    // Warna teks AI
    document.querySelectorAll(".bubble-ai .bubble-body").forEach(function (el) {
      el.style.color = data.warnaAI;
    });
  }

  /** Binding event form font */
  function bindFontEvents() {
    // -- Slider ukuran --
    var elUkuran = document.getElementById("font-ukuran");
    if (elUkuran) {
      elUkuran.addEventListener("input", function () {
        updateFontUkuranPreview();
        applyFontToAllBubbles();
      });
    }

    // -- Color picker Person 1 --
    var elWarnaP1 = document.getElementById("font-warna-p1");
    if (elWarnaP1) {
      elWarnaP1.addEventListener("input", function () {
        updateFontWarnaPreview("p1");
        applyFontToAllBubbles();
      });
    }

    // -- Color picker Person 2 --
    var elWarnaP2 = document.getElementById("font-warna-p2");
    if (elWarnaP2) {
      elWarnaP2.addEventListener("input", function () {
        updateFontWarnaPreview("p2");
        applyFontToAllBubbles();
      });
    }

    // -- Color picker AI --
    var elWarnaAI = document.getElementById("font-warna-ai");
    if (elWarnaAI) {
      elWarnaAI.addEventListener("input", function () {
        updateFontWarnaPreview("ai");
        applyFontToAllBubbles();
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
  var STORAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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
    var otherKeys = ["kita-theme", "kita-api-index"];
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
          "kita-api-keys", "kita-font", "kita-theme", "kita-api-index"
        ];
        keysToRemove.forEach(function (k) {
          localStorage.removeItem(k);
        });

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
     BAGIAN API — CRUD + Tes Koneksi + API Loop
     ========================================================== */

  function getDefaultAPIData() {
    return [];
  }

  /** Provider yang API key-nya dikelola server (Edge Function), bukan localStorage */
  function isEdgeProvider(provider) {
    return ["groq", "xai", "openrouter", "cerebras", "gemini"].indexOf(provider) !== -1;
  }

  function loadAPIData() {
    var saved = localStorage.getItem("kita-api-keys");
    var data = [];
    if (saved) {
      try {
        data = JSON.parse(saved);
        if (!Array.isArray(data)) data = [];
      } catch (e) { /* fallback */ }
    }

    // Inject provider Edge Function otomatis (gak perlu user tambah manual)
    var edgeProviders = ["groq", "xai", "openrouter", "cerebras", "gemini"];
    var disabledEdges = loadDisabledEdges();

    // Hapus duplikat Edge Function yang sudah ada di data user
    var edgeIds = {};
    edgeProviders.forEach(function (prov) {
      edgeIds["edge_" + prov] = prov;
    });
    data = data.filter(function (item) {
      return !edgeIds[item.id];
    });

    // Tambah entry Edge Function di urutan pertama (prioritas)
    edgeProviders.forEach(function (prov) {
      data.unshift({
        id: "edge_" + prov,
        provider: prov,
        label: getProviderLabel(prov) + " (Server)",
        key: "",
        endpoint: "",
        aktif: !disabledEdges[prov],
        status: disabledEdges[prov] ? "nonaktif" : "aktif",
        isEdge: true
      });
    });

    return data;
  }

  function loadDisabledEdges() {
    try {
      return JSON.parse(localStorage.getItem("kita-disabled-edges") || "{}");
    } catch (e) { return {}; }
  }

  function saveDisabledEdges(data) {
    var disabled = {};
    data.forEach(function (item) {
      if (item.isEdge && !item.aktif) disabled[item.provider] = true;
    });
    localStorage.setItem("kita-disabled-edges", JSON.stringify(disabled));
  }

  function getProviderLabel(provider) {
    var labels = {
      groq: "Groq", xai: "xAI", openrouter: "OpenRouter",
      cerebras: "Cerebras", gemini: "Gemini",
      openai: "OpenAI", claude: "Claude"
    };
    return labels[provider] || provider;
  }

  function saveAPIData(data) {
    // Pisah: simpan disabled edge & user API keys
    saveDisabledEdges(data);
    var userData = data.filter(function (item) { return !item.isEdge; });
    safeSetItem("kita-api-keys", JSON.stringify(userData));
    try { refreshStorageMonitor(); } catch (e) { /* ignore */ }
  }

  /** Dapatkan hanya API yang aktif, urut sesuai prioritas */
  function getActiveAPIs() {
    return loadAPIData().filter(function (item) {
      return item.aktif && item.status !== "error";
    });
  }

  /** Update status satu API via ID */
  function updateAPIStatus(id, statusBaru) {
    var data = loadAPIData();
    for (var i = 0; i < data.length; i++) {
      if (data[i].id === id) {
        data[i].status = statusBaru;
        break;
      }
    }
    saveAPIData(data);
    renderAPIList();
  }

  /* ----------------------------------------------------------
     API LOOP: Kirim pesan ke AI secara berurutan (fallback)
     - Mulai dari currentAPIIndex
     - Jika gagal/error → index++ → coba API berikutnya
     - Jika semua gagal → tampilkan error
     - Jika berhasil → simpan index, return response
     ---------------------------------------------------------- */
  function kirimPesanKeAI(userMessage, callback) {
    var activeAPIs = getActiveAPIs();

    // Jika tidak ada API aktif, return error
    if (activeAPIs.length === 0) {
      callback("\u26A0\uFE0F Tidak ada API key aktif. Tambah API key di Pengaturan API lalu aktifkan.", null);
      return;
    }

    // Pastikan index tidak melebihi jumlah API
    if (currentAPIIndex >= activeAPIs.length) {
      currentAPIIndex = 0;
    }

    // Bangun request body
    var systemPrompt = generateSystemPrompt();
    var prof = loadProfilData();

    // Format history untuk API (role user/assistant)
    var messages = [];
    messages.push({ role: "system", content: systemPrompt });

    // Tambahkan chat history (maks 20 pesan terakhir)
    var recentHistory = chatHistory.slice(-20);
    recentHistory.forEach(function (msg) {
      if (msg.type === "text" && msg.role) {
        var senderName = (msg.sender === "person1") ? prof.person1.nama : prof.person2.nama;
        messages.push({
          role: msg.role,
          content: "[" + senderName + "]: " + msg.text
        });
      }
    });

    // Tambahkan pesan user terbaru
    var senderName = (userMessage.sender === "person1") ? prof.person1.nama : prof.person2.nama;
    messages.push({
      role: "user",
      content: "[" + senderName + "]: " + userMessage.text
    });

    // Fungsi rekursif untuk mencoba API
    function tryAPI(index) {
      if (index >= activeAPIs.length) {
        // Semua API gagal
        callback("\u26A0\uFE0F Semua API gagal. Coba cek:\n1. API key valid?\n2. Ada kuota?\n3. Jika CORS error, butuh backend proxy untuk Claude/Gemini.", null);
        return;
      }

      var api = activeAPIs[index];

      // === Provider via Edge Function (API key aman di server) ===
      if (isEdgeProvider(api.provider) && supabaseClient) {
        var edgeModel = getDefaultModelForProvider(api.provider);
        callEdgeFunction(api.provider, messages, edgeModel, 500)
          .then(function (response) {
            if (!response.ok) {
              updateAPIStatus(api.id, "error");
              tryAPI(index + 1);
              return null;
            }
            return response.json();
          })
          .then(function (data) {
            if (!data) return;
            var replyText = extractReplyFromResponse(api.provider, data);
            if (replyText) {
              currentAPIIndex = index;
              updateAPIStatus(api.id, "aktif");
              callback(null, replyText);
            } else {
              updateAPIStatus(api.id, "error");
              tryAPI(index + 1);
            }
          })
          .catch(function () {
            updateAPIStatus(api.id, "error");
            tryAPI(index + 1);
          });
        return;
      }

      // === Provider lain: panggil langsung (pakai API key dari localStorage) ===
      var endpoint = getEndpointForProvider(api.provider, api.endpoint);
      var headers = getHeadersForProvider(api.provider, api.key);
      var body = buildRequestBody(api.provider, messages);

      // Gemini: tambahkan API key sebagai query parameter
      if (api.provider === "gemini") {
        endpoint = endpoint + "?key=" + encodeURIComponent(api.key);
      }

      // Kirim fetch request
      fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body)
      })
      .then(function (response) {
        if (!response.ok) {
          // Tandai sebagai error/limit lalu coba berikutnya
          if (response.status === 429 || response.status === 403) {
            updateAPIStatus(api.id, "limit");
          } else {
            updateAPIStatus(api.id, "error");
          }
          tryAPI(index + 1);
          return null;
        }
        return response.json();
      })
      .then(function (data) {
        if (!data) return; // Sudah di-handle di atas

        // Ekstrak teks balasan sesuai provider
        var replyText = extractReplyFromResponse(api.provider, data);
        if (replyText) {
          // Sukses: simpan index & update status
          currentAPIIndex = index;
          updateAPIStatus(api.id, "aktif");
          callback(null, replyText);
        } else {
          updateAPIStatus(api.id, "error");
          tryAPI(index + 1);
        }
      })
      .catch(function (err) {
        // Network / CORS error -> coba berikutnya
        updateAPIStatus(api.id, "error");
        tryAPI(index + 1);
      });
    }

    // Mulai dari currentAPIIndex
    tryAPI(currentAPIIndex);
  }

  /** Dapatkan endpoint URL sesuai provider */
  function getEndpointForProvider(provider, customEndpoint) {
    var endpoints = {
      claude:     "https://api.anthropic.com/v1/messages",
      openai:     "https://api.openai.com/v1/chat/completions",
      gemini:     "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      groq:       "https://api.groq.com/openai/v1/chat/completions",
      xai:        "https://api.x.ai/v1/chat/completions",
      openrouter: "https://openrouter.ai/api/v1/chat/completions",
      cerebras:   "https://api.cerebras.ai/v1/chat/completions"
    };
    return (provider === "custom" && customEndpoint) ? customEndpoint : (endpoints[provider] || "");
  }

  /** Dapatkan headers sesuai provider */
  function getHeadersForProvider(provider, apiKey) {
    var base = { "Content-Type": "application/json" };

    switch (provider) {
      case "claude":
        base["x-api-key"] = apiKey;
        base["anthropic-version"] = "2023-06-01";
        break;
      case "openai":
      case "groq":
      case "xai":
      case "cerebras":
        base["Authorization"] = "Bearer " + apiKey;
        break;
      case "openrouter":
        base["Authorization"] = "Bearer " + apiKey;
        base["HTTP-Referer"] = "https://aldinonton66.github.io";
        base["X-Title"] = "Kita & AI";
        break;
      case "gemini":
        // Gemini pakai query param key, bukan header
        break;
      default:
        base["Authorization"] = "Bearer " + apiKey;
        break;
    }
    return base;
  }

  /** Bangun request body sesuai provider */
  function buildRequestBody(provider, messages) {
    switch (provider) {
      case "claude":
        var systemMsg = "";
        var claudeMsgs = [];
        messages.forEach(function (m) {
          if (m.role === "system") {
            systemMsg = m.content;
          } else {
            claudeMsgs.push({ role: m.role, content: m.content });
          }
        });
        return {
          model: "claude-3-haiku-20240307",
          max_tokens: 500,
          system: systemMsg,
          messages: claudeMsgs
        };

      case "openai":
        return {
          model: "gpt-3.5-turbo",
          max_tokens: 500,
          messages: messages
        };

      case "groq":
        return {
          model: "llama-3.3-70b-versatile",
          max_tokens: 500,
          messages: messages
        };

      case "xai":
        return {
          model: "grok-2-1212",
          max_tokens: 500,
          messages: messages
        };

      case "openrouter":
        return {
          model: "google/gemini-2.0-flash-001",
          max_tokens: 500,
          messages: messages
        };

      case "cerebras":
        return {
          model: "llama3.1-8b",
          max_tokens: 500,
          messages: messages
        };

      case "gemini":
        var geminiContents = [];
        messages.forEach(function (m) {
          var role = (m.role === "system" || m.role === "user") ? "user" : "model";
          geminiContents.push({
            role: role,
            parts: [{ text: m.content }]
          });
        });
        return {
          contents: geminiContents
        };

      default:
        return {
          model: "gpt-3.5-turbo",
          max_tokens: 500,
          messages: messages
        };
    }
  }

  /** Ekstrak teks balasan dari response JSON */
  function extractReplyFromResponse(provider, data) {
    try {
      switch (provider) {
        case "claude":
          return data.content && data.content[0] ? data.content[0].text : null;
        case "openai":
        case "groq":
        case "xai":
        case "cerebras":
          return data.choices && data.choices[0] ? data.choices[0].message.content : null;
        case "openrouter":
          return data.choices && data.choices[0] ? data.choices[0].message.content : null;
        case "gemini":
          return data.candidates && data.candidates[0]
            ? data.candidates[0].content.parts[0].text : null;
        default:
          if (data.choices && data.choices[0]) return data.choices[0].message.content;
          if (data.content && data.content[0]) return data.content[0].text;
          return null;
      }
    } catch (e) {
      return null;
    }
  }

  /* ----------------------------------------------------------
     Tes koneksi: kirim request "ping" sederhana ke API
     ---------------------------------------------------------- */
  function testAPIConnection(apiId, callback) {
    var data = loadAPIData();
    var api = null;
    for (var i = 0; i < data.length; i++) {
      if (data[i].id === apiId) { api = data[i]; break; }
    }
    if (!api) { callback(false, "API tidak ditemukan"); return; }

    // === Provider via Edge Function ===
    if (isEdgeProvider(api.provider) && supabaseClient) {
      callEdgeFunction(api.provider, [
        { role: "system", content: "Reply with 'pong' only." },
        { role: "user", content: "ping" }
      ], getDefaultModelForProvider(api.provider), 50)
        .then(function (response) {
          if (!response.ok) {
            updateAPIStatus(apiId, "error");
            return response.text().then(function (txt) {
              callback(false, "Error " + response.status + ": " + txt.substring(0, 80));
            });
          }
          return response.json();
        })
        .then(function (respData) {
          if (!respData) return;
          var reply = extractReplyFromResponse(api.provider, respData);
          if (reply) {
            updateAPIStatus(apiId, "aktif");
            callback(true, "Koneksi berhasil! Balasan: \"" + reply.substring(0, 50) + "\"");
          } else {
            updateAPIStatus(apiId, "error");
            callback(false, "Response tidak valid");
          }
        })
        .catch(function (err) {
          updateAPIStatus(apiId, "error");
          callback(false, "Network error: " + err.message);
        });
      return;
    }

    // === Provider lain: tes langsung ===
    var endpoint = getEndpointForProvider(api.provider, api.endpoint);
    var headers = getHeadersForProvider(api.provider, api.key);

    // Kirim pesan "ping" minimal
    var body = buildRequestBody(api.provider, [
      { role: "system", content: "Reply with 'pong' only." },
      { role: "user", content: "ping" }
    ]);

    // Untuk Gemini, tambahkan key di URL
    var finalEndpoint = endpoint;
    if (api.provider === "gemini") {
      finalEndpoint = endpoint + "?key=" + encodeURIComponent(api.key);
    }

    fetch(finalEndpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    })
    .then(function (response) {
      if (!response.ok) {
        // Coba baca body error
        return response.text().then(function (errText) {
          var shortErr = errText.substring(0, 80);
          if (response.status === 429 || response.status === 403) {
            updateAPIStatus(apiId, "limit");
            callback(false, "Limit / forbidden (HTTP " + response.status + ") " + shortErr);
          } else {
            updateAPIStatus(apiId, "error");
            callback(false, "Error HTTP " + response.status + " — " + shortErr);
          }
        });
      }
      return response.json();
    })
    .then(function (respData) {
      if (!respData) return;
      var reply = extractReplyFromResponse(api.provider, respData);
      if (reply) {
        updateAPIStatus(apiId, "aktif");
        callback(true, "Koneksi berhasil! Balasan: \"" + reply.substring(0, 50) + "\"");
      } else {
        updateAPIStatus(apiId, "error");
        callback(false, "Response tidak valid");
      }
    })
    .catch(function (err) {
      updateAPIStatus(apiId, "error");
      callback(false, "Network error: " + err.message);
    });
  }

  /* ----------------------------------------------------------
     Render & binding event list API (Step 5 logic, enhanced)
     ---------------------------------------------------------- */

  function renderAPIList() {
    var container  = document.getElementById("api-list-container");
    var elKosong   = document.getElementById("api-kosong");
    if (!container) return;

    var data = loadAPIData();
    if (elKosong) {
      elKosong.style.display = (data.length === 0) ? "block" : "none";
    }
    if (data.length === 0) { container.innerHTML = ""; return; }

    var providerMap = {
      claude:     { lbl: "Claude",     cls: "api-badge-claude" },
      openai:     { lbl: "OpenAI",     cls: "api-badge-openai" },
      gemini:     { lbl: "Gemini",     cls: "api-badge-gemini" },
      groq:       { lbl: "Groq",       cls: "api-badge-groq" },
      xai:        { lbl: "xAI",        cls: "api-badge-xai" },
      openrouter: { lbl: "OpenRouter", cls: "api-badge-openrouter" },
      cerebras:   { lbl: "Cerebras",   cls: "api-badge-cerebras" },
      custom:     { lbl: "Custom",     cls: "api-badge-custom" }
    };
    var statusMap = {
      aktif:    { lbl: "Aktif",    cls: "api-status-aktif" },
      limit:    { lbl: "Limit",    cls: "api-status-limit" },
      error:    { lbl: "Error",    cls: "api-status-error" },
      nonaktif: { lbl: "Nonaktif", cls: "api-status-nonaktif" }
    };

    var html = "";
    data.forEach(function (item, index) {
      var prov = providerMap[item.provider] || providerMap.custom;
      var stat = statusMap[item.status] || statusMap.nonaktif;
      var maskedKey = item.isEdge ? "🔐 Dikelola server" : (item.key ? (item.key.substring(0, 8) + "••••••••") : "(kosong)");
      var isFirst = (index === 0);
      var isLast  = (index === data.length - 1);

      html +=
        '<div class="api-item' + (item.isEdge ? ' api-item-edge' : '') + '" data-api-id="' + item.id + '">' +
          '<span class="api-priority-num">' + (index + 1) + '</span>' +
          '<div class="api-priority-btns">' +
            '<button class="api-arrow-btn api-arrow-up" title="Naikkan prioritas" ' + (isFirst ? 'disabled' : '') + '>▲</button>' +
            '<button class="api-arrow-btn api-arrow-down" title="Turunkan prioritas" ' + (isLast ? 'disabled' : '') + '>▼</button>' +
          '</div>' +
          '<div class="api-item-info">' +
            '<div class="api-item-label">' + escapeHTML(item.label) + '</div>' +
            '<span class="api-badge ' + prov.cls + '">' + prov.lbl + '</span>' +
            (item.isEdge ? '<span class="api-badge-edge">Server</span>' : '') +
            '<span class="api-status ' + stat.cls + '">' + stat.lbl + '</span>' +
            '<span style="font-size:0.7rem;color:var(--text-muted);margin-left:8px;">' + maskedKey + '</span>' +
          '</div>' +
          '<div class="api-item-right">' +
            '<label class="api-toggle-mini" title="Aktif / Nonaktif">' +
              '<input type="checkbox" class="api-cb-aktif" ' + (item.aktif ? 'checked' : '') + '>' +
              '<span class="toggle-slider"></span>' +
            '</label>' +
            '<button class="api-btn-mini api-btn-test" title="Tes koneksi">Tes</button>' +
            (item.isEdge ? '' : '<button class="api-btn-mini api-btn-hapus" title="Hapus API key">Hapus</button>') +
          '</div>' +
        '</div>';
    });

    container.innerHTML = html;
    bindAPIItemEvents();
  }

  function bindAPIItemEvents() {
    var container = document.getElementById("api-list-container");
    if (!container) return;

    // Toggle aktif
    container.querySelectorAll(".api-cb-aktif").forEach(function (cb) {
      var newCb = cb.cloneNode(true);
      cb.parentNode.replaceChild(newCb, cb);
      newCb.addEventListener("change", function () {
        var itemEl = newCb.closest(".api-item");
        if (!itemEl) return;
        var id = itemEl.getAttribute("data-api-id");
        var data = loadAPIData();
        for (var i = 0; i < data.length; i++) {
          if (data[i].id === id) {
            data[i].aktif = newCb.checked;
            data[i].status = newCb.checked ? "aktif" : "nonaktif";
            break;
          }
        }
        saveAPIData(data);
        // Reset index loop jika daftar berubah
        currentAPIIndex = 0;
        renderAPIList();
      });
    });

    // Tes koneksi
    container.querySelectorAll(".api-btn-test").forEach(function (btn) {
      var newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", function () {
        if (newBtn.classList.contains("loading")) return;
        var itemEl = newBtn.closest(".api-item");
        if (!itemEl) return;
        var id = itemEl.getAttribute("data-api-id");

        newBtn.classList.add("loading");
        newBtn.textContent = "";

        testAPIConnection(id, function (sukses, pesan) {
          newBtn.classList.remove("loading");
          newBtn.textContent = "Tes";
          renderAPIList();
          showToast(pesan, sukses ? "✅" : "❌");
        });
      });
    });

    // Hapus
    container.querySelectorAll(".api-btn-hapus").forEach(function (btn) {
      var newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", function () {
        var itemEl = newBtn.closest(".api-item");
        if (!itemEl) return;
        var id = itemEl.getAttribute("data-api-id");
        if (!confirm("Hapus API key ini?")) return;
        var data = loadAPIData();
        data = data.filter(function (item) { return item.id !== id; });
        saveAPIData(data);
        currentAPIIndex = 0;
        renderAPIList();
        showToast("API key dihapus.", "🗑️");
      });
    });

    // Panah atas
    container.querySelectorAll(".api-arrow-up").forEach(function (btn) {
      var newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", function () {
        var itemEl = newBtn.closest(".api-item");
        if (!itemEl) return;
        var id = itemEl.getAttribute("data-api-id");
        var data = loadAPIData();
        for (var i = 1; i < data.length; i++) {
          if (data[i].id === id) {
            var temp = data[i - 1]; data[i - 1] = data[i]; data[i] = temp;
            break;
          }
        }
        saveAPIData(data);
        currentAPIIndex = 0;
        renderAPIList();
      });
    });

    // Panah bawah
    container.querySelectorAll(".api-arrow-down").forEach(function (btn) {
      var newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", function () {
        var itemEl = newBtn.closest(".api-item");
        if (!itemEl) return;
        var id = itemEl.getAttribute("data-api-id");
        var data = loadAPIData();
        for (var i = 0; i < data.length - 1; i++) {
          if (data[i].id === id) {
            var temp = data[i + 1]; data[i + 1] = data[i]; data[i] = temp;
            break;
          }
        }
        saveAPIData(data);
        currentAPIIndex = 0;
        renderAPIList();
      });
    });
  }

  function bindAPIFormEvents() {
    var toggleForm = document.getElementById("toggle-form-api");
    var bodyForm   = document.getElementById("body-form-api");
    var arrowEl    = document.getElementById("arrow-form-api");
    if (toggleForm && bodyForm) {
      toggleForm.addEventListener("click", function () {
        var isHidden = (bodyForm.style.display === "none");
        bodyForm.style.display = isHidden ? "block" : "none";
        if (arrowEl) arrowEl.classList.toggle("collapsed", !isHidden);
      });
    }

    var provSelect = document.getElementById("api-provider");
    var grpEndpoint = document.getElementById("group-api-endpoint");
    if (provSelect && grpEndpoint) {
      provSelect.addEventListener("change", function () {
        grpEndpoint.style.display = (provSelect.value === "custom") ? "block" : "none";
      });
    }

    var btnToggle = document.getElementById("btn-toggle-key");
    var keyInput  = document.getElementById("api-key");
    if (btnToggle && keyInput) {
      btnToggle.addEventListener("click", function () {
        var isPassword = (keyInput.type === "password");
        keyInput.type = isPassword ? "text" : "password";
        btnToggle.textContent = isPassword ? "🙈" : "👁️";
      });
    }

    var btnTambah = document.getElementById("btn-tambah-api");
    if (btnTambah) {
      btnTambah.addEventListener("click", function () {
        var provider = document.getElementById("api-provider").value;
        var label    = (document.getElementById("api-label").value || "").trim();
        var key      = (document.getElementById("api-key").value || "").trim();
        var endpoint = (document.getElementById("api-endpoint").value || "").trim();

        if (!label) { showToast("Nama label harus diisi!", "⚠️"); return; }
        if (!key)   { showToast("API key harus diisi!", "⚠️"); return; }
        if (provider === "custom" && !endpoint) { showToast("Endpoint URL harus diisi!", "⚠️"); return; }

        var newItem = {
          id: "api_" + Date.now(),
          provider: provider, label: label, key: key,
          endpoint: (provider === "custom") ? endpoint : "",
          aktif: true, status: "aktif"
        };

        var data = loadAPIData();
        data.push(newItem);
        saveAPIData(data);

        document.getElementById("api-label").value = "";
        document.getElementById("api-key").value = "";
        document.getElementById("api-key").type = "password";
        document.getElementById("api-endpoint").value = "";
        document.getElementById("api-provider").value = "claude";
        if (grpEndpoint) grpEndpoint.style.display = "none";
        if (btnToggle) btnToggle.textContent = "👁️";

        renderAPIList();
        showToast("API key ditambahkan!", "✅");
      });
    }
  }

  function initAPI() {
    renderAPIList();
    bindAPIFormEvents();
    var bodyForm = document.getElementById("body-form-api");
    if (bodyForm) bodyForm.style.display = "block";
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
      html += '<div class="chat-bubble ' + personaClass + '" data-msg-id="' + (msg.id || "") + '">';
      html += '<div class="bubble-header">';
      html += '<span class="bubble-avatar">\uD83E\uDD16</span>';
      html += '<span class="bubble-name">' + escapeHTML(senderName) + '</span>';
      html += '<span class="bubble-time">' + msg.time + '</span>';
      html += '</div>';
      html += '<div class="bubble-body" style="color:' + font.warnaAI + ';font-size:' + font.ukuran + 'px;"><p>' + escapeHTML(msg.text) + '</p></div>';
      html += '</div>';
      return html;
    }

    // Person bubble
    var isRight = (msg.sender === "person1");
    personaClass = isRight ? "bubble-right bubble-person1" : "bubble-left bubble-person2";
    senderName = isRight ? ("\u2728 " + prof.person1.nama) : ("\uD83C\uDF38 " + prof.person2.nama);
    var senderColor = isRight ? prof.person1.warna : prof.person2.warna;
    var textColor = isRight ? font.warnaP1 : font.warnaP2;
    bubbleStyle = 'style="background:' + senderColor + ';color:' + textColor + ';font-size:' + font.ukuran + 'px;"';

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
    // Batasi maks 500 pesan
    if (chatHistory.length > 500) {
      chatHistory = chatHistory.slice(-500);
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
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    location.replace("login.html");
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
  }

  function initApp() {
    var steps = [
      { name: "generateNavigation", fn: generateNavigation },
      { name: "bindNavigationEvents", fn: bindNavigationEvents },
      { name: "initSidebar", fn: initSidebar },
      { name: "showSection", fn: function() { showSection(APP_CONFIG.defaultActive); } },
      { name: "bindThemeToggle", fn: bindThemeToggle },
      { name: "initChat", fn: initChat },
      { name: "initProfil", fn: initProfil },
      { name: "initAI", fn: initAI },
      { name: "initAPI", fn: initAPI },
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

    // Muat index API loop dari localStorage
    var savedIdx = localStorage.getItem("kita-api-index");
    if (savedIdx !== null) {
      currentAPIIndex = parseInt(savedIdx, 10) || 0;
    }
  }

  // Simpan index API loop saat page unload
  window.addEventListener("beforeunload", function () {
    safeSetItem("kita-api-index", String(currentAPIIndex));
  });

  // Jalankan saat DOM siap
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }

})();
