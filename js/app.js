/* ============================================================
   FILE: app.js — Module loader + App orchestrator
   ============================================================ */
(function() {
  const K = window.KitaAI;

  /* ---------- Navigation ---------- */
  K.showSection = (sectionId) => {
    if (!sectionId) sectionId = APP_CONFIG.defaultActive;
    K.currentSectionId = sectionId;

    document.querySelectorAll(".nav-link, .bottom-nav-link").forEach((el) => {
      el.classList.toggle("active", el.dataset?.section === sectionId);
    });

    // Show target section via .active class; hide others by removing .active
    document.querySelectorAll(".content-section").forEach((el) => {
      const chatSections = ["teman-ai", "curhat", "catatan", "ide"];
      const isTarget = chatSections.includes(sectionId)
        ? el.id === "section-chat"
        : el.id === "section-" + sectionId;
      el.classList.toggle("active", isTarget);
    });

    const headerTitle = document.getElementById("sidebar-header-title");
    if (headerTitle) {
      const labels = {
        "teman-ai": "Teman AI",
        curhat: "Curhat",
        catatan: "Catatan",
        ide: "Ide Kreatif"
      };
      headerTitle.textContent = labels[sectionId] || "Teman AI";
    }

    if (["teman-ai", "curhat", "catatan", "ide"].includes(sectionId)) {
      K.loadChatHistory(sectionId);
      K.renderChatFromHistory(sectionId);
    }

    const searchBar = document.getElementById("chat-search-bar");
    if (searchBar) searchBar.style.display = "none";

    K.safeSetItem("kita-active-section", sectionId);
  };

  /* ---------- Bind Navigation ---------- */
  function bindNavigationEvents() {
    document.querySelectorAll(".nav-link, .bottom-nav-link").forEach((el) => {
      el.addEventListener("click", () => {
        const section = el.dataset?.section;
        if (section) K.showSection(section);
      });
    });
  }

  /* ---------- Generate Nav Items ---------- */
  function generateNavItems() {
    const items = [
      { section: "teman-ai", icon: "💬", label: "Teman AI" },
      { section: "curhat", icon: "💝", label: "Curhat" },
      { section: "catatan", icon: "📝", label: "Catatan" },
      { section: "ide", icon: "💡", label: "Ide Kreatif" },
      { section: "profil", icon: "👤", label: "Profil" },
      { section: "ai", icon: "🤖", label: "AI" }
    ];

    // Sidebar nav
    const navList = document.getElementById("nav-list");
    if (navList) {
      navList.innerHTML = items.map((item) =>
        '<li><a href="#' + item.section + '" class="nav-link" data-section="' + item.section + '">' +
          '<span class="nav-icon">' + item.icon + '</span>' +
          '<span class="nav-label">' + item.label + '</span>' +
        '</a></li>'
      ).join("");
    }

    // Bottom nav (mobile)
    const bottomNav = document.getElementById("bottom-nav");
    if (bottomNav) {
      const bottomItems = items.filter((i) => ["teman-ai", "curhat", "catatan", "ide"].includes(i.section));
      bottomNav.innerHTML = '<div id="bottom-nav-list" style="display:flex;height:100%;list-style:none;padding:0;margin:0">' +
        bottomItems.map((item) =>
          '<button class="bottom-nav-link" data-section="' + item.section + '">' +
            '<span class="nav-icon">' + item.icon + '</span>' +
            '<span class="nav-label">' + item.label + '</span>' +
          '</button>'
        ).join("") +
      '</div>';
    }
  }

  /* ---------- Logout ---------- */
  K.doLogout = async () => {
    try {
      if (typeof window.supabase !== "undefined") {
        const sb = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);
        await sb.auth.signOut();
      }
    } catch (e) { /* silent */ }
    window._kitaUser = null;
    window.location.replace("login.html");
  };

  function bindLogoutButtons() {
    document.querySelectorAll("#btn-logout-sidebar, #btn-logout, .btn-logout").forEach((btn) => {
      btn.addEventListener("click", K.doLogout);
    });
  }

  /* ---------- Skeleton Loader ---------- */
  function hideSkeleton() {
    const skel = document.getElementById("app-skeleton");
    if (skel) {
      skel.classList.add("hidden");
      setTimeout(() => { skel.style.display = "none"; }, 500);
    }
  }

  /* ---------- Offline Banner ---------- */
  function initOfflineBanner() {
    const banner = document.getElementById("offline-banner");
    if (!banner) return;
    function updateOnlineStatus() {
      banner.classList.toggle("visible", !navigator.onLine);
    }
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    updateOnlineStatus();
  }

  /* ---------- Cancel Buttons ---------- */
  function bindCancelButtons() {
    document.querySelectorAll("#form-profil .btn-cancel, #form-ai .btn-cancel").forEach((btn) => {
      btn.addEventListener("click", () => {
        const section = btn.closest(".content-section");
        if (section) {
          const navItem = document.querySelector('.nav-link[data-section="teman-ai"], .bottom-nav-link[data-section="teman-ai"]');
          if (navItem) navItem.click();
        }
      });
    });
  }

  /* ---------- Welcome Section ---------- */
  function showWelcome() {
    let sectionId = K.safeGetItem("kita-active-section", APP_CONFIG.defaultActive);
    // Migrate old section ID format
    const validSections = ["teman-ai", "curhat", "catatan", "ide", "profil", "ai", "status"];
    if (!validSections.includes(sectionId)) sectionId = APP_CONFIG.defaultActive;
    K.loadChatHistory(sectionId);
    K.renderChatFromHistory(sectionId);
    K.showSection(sectionId);
    const target = document.querySelector('[data-section="' + sectionId + '"]');
    if (target) target.classList.add("active");
  }

  /* ---------- Status ---------- */
  function refreshStatus() {
    const elMode = document.getElementById("status-mode");
    const elUser = document.getElementById("status-nama-user");
    const elAi = document.getElementById("status-nama-ai");
    const elTotal = document.getElementById("status-total-pesan");
    const badge = document.querySelector(".status-badge");

    if (badge) {
      badge.textContent = navigator.onLine ? "Online" : "Offline";
      badge.className = "status-badge " + (navigator.onLine ? "status-badge--online" : "status-badge--offline");
    }

    if (elMode) elMode.textContent = window._kitaUser ? "Real-time (Supabase)" : "Lokal (disimpan di perangkat ini)";
    if (elUser) elUser.textContent = K.safeGetItem("kita-nama", "Kamu");
    if (elAi) elAi.textContent = K.safeGetItem("kita-nama-ai", "Teman AI");

    if (elTotal) {
      let total = 0;
      ["teman-ai", "curhat", "catatan", "ide"].forEach((s) => {
        const arr = K.safeGetItem("kita-chat-" + s, "[]");
        try { total += JSON.parse(arr).length; } catch(e) {}
      });
      elTotal.textContent = total;
    }

    K.showToast("Status diperbarui", "🔄", "success");
  }

  /* ---------- Full Reset ---------- */
  K.resetAllData = () => {
    if (!confirm("Hapus semua data? (tidak bisa dibatalkan)")) return;
    [
      "kita-nama", "kita-tentang", "kita-avatar", "kita-avatar-emoji",
      "kita-nama-ai", "kita-ai-tentang", "kita-avatar-ai", "kita-avatar-emoji-ai",
      "kita-sapaan", "kita-font", "kita-sound", "kita-ai-gaya", "kita-ai-kepribadian",
      "kita-ai-pengetahuan", "kita-ai-batasan", "kita-ai-instruksi", "kita-ai-model"
    ].forEach((key) => K.safeRemoveItem(key));
    ["teman-ai", "curhat", "catatan", "ide"].forEach((s) => K.safeRemoveItem("kita-chat-" + s));
    K.safeRemoveItem("kita-active-section");
    K.safeRemoveItem("kita-sidebar");
    K.safeRemoveItem("kita-theme");
    K.chatHistory = [];
    K.showToast("Semua data dihapus", "🗑️", "success");
    location.reload();
  };

  K.clearCurrentChat = () => {
    if (!K.currentSectionId) return;
    if (!confirm("Hapus history chat di section ini? (tidak bisa dibatalkan)")) return;
    const key = "kita-chat-" + K.currentSectionId;
    K.safeSetItem(key, "[]");
    K.chatHistory = [];
    K.renderChatFromHistory(K.currentSectionId);
    K.showToast("History chat dihapus", "🗑️", "success");
  };

  /* ---------- Init ---------- */
  K.initApp = async () => {
    try {
      // Auth check
      if (typeof window.supabase !== "undefined") {
        const sb = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);
        const { data } = await sb.auth.getSession();
        const session = data?.session;
        if (!session) {
          window.location.replace("login.html");
          return;
        }
        window._kitaUser = session.user;
      }

      // Generate nav first so bindings work
      generateNavItems();

      // Init modules (except chat — needs room first)
      K.bindThemeToggle();
      K.initSidebar();
      K.initStorageMonitor();
      K.initProfil();
      K.initAI();
      bindNavigationEvents();
      bindLogoutButtons();
      bindCancelButtons();
      initOfflineBanner();

      K.setSoundEnabled(K.safeGetItem("kita-sound", "on") === "on");
      bindExtraButtons();

      // Setup room (for real-time messaging)
      if (window._kitaUser) {
        await setupRoom();
      } else {
        setupLocalChat();
      }

      refreshStatus();
    } catch (e) {
      if (e?.message?.includes("Auth") || e?.message?.includes("auth")) {
        window.location.replace("login.html");
      }
    } finally {
      hideSkeleton();
    }
  };

  async function setupRoom() {
    const roomId = await K.getOrCreateRoom();
    if (roomId) {
      // Load history from Supabase
      await K.loadHistoryFromSupabase();

      // Init real-time chat + media after history loaded
      K.initChat();
      K.initMediaRecorder();
      K.initMediaPicker();
      K.initRealtime();

      showWelcome();
      showPairingCode();
    } else {
      setupLocalChat();
    }
  }

  function setupLocalChat() {
    K.initChat();
    K.initMediaRecorder();
    K.initMediaPicker();
    showWelcome();

    // Show export button for local-only
    document.getElementById("btn-export-chat")?.style.removeProperty("display");
    document.getElementById("btn-hapus-semua")?.addEventListener("click", K.resetAllData);
  }

  function showPairingCode() {
    const code = K.safeGetItem("kita-room-code", "");
    const role = K.getPartnerRole();
    if (!code || role === "partner2") return;

    // Show pairing banner in sidebar
    const navList = document.getElementById("nav-list");
    if (navList && !document.getElementById("pairing-banner")) {
      const banner = document.createElement("li");
      banner.id = "pairing-banner";
      banner.style.cssText = "padding:10px 12px;margin:4px 8px;background:var(--accent-subtle, rgba(13,148,136,0.12));border-radius:10px;font-size:0.82rem;text-align:center";
      banner.innerHTML =
        '<div style="font-size:0.7rem;opacity:0.6;margin-bottom:2px">Kode Kolaborasi</div>' +
        '<strong style="font-size:1.1rem;letter-spacing:2px;font-family:monospace">' + code + '</strong>' +
        '<div style="font-size:0.7rem;opacity:0.6;margin-top:2px">Bagikan ke pasangan untuk join</div>';
      navList.insertBefore(banner, navList.firstChild);
    }

    // Show pairing modal on first visit
    if (!K.safeGetItem("kita-pairing-shown", "")) {
      K.safeSetItem("kita-pairing-shown", "1");
      setTimeout(() => {
        K.showToast("Kode room: " + code + " — bagikan ke pasangan!", "🔗", "");
      }, 2000);
    }
  }

  // Export + reset bindings (also needed for real-time mode)
  function bindExtraButtons() {
    document.getElementById("btn-export-chat")?.addEventListener("click", K.exportChatJSON);
    document.getElementById("btn-hapus-semua")?.addEventListener("click", K.resetAllData);
    document.getElementById("btn-refresh-status")?.addEventListener("click", refreshStatus);
    document.getElementById("btn-hapus-history")?.addEventListener("click", K.clearCurrentChat);
  }

  // Boot
  let _retry = 0;
  function boot() {
    _retry++;
    if (typeof APP_CONFIG === "undefined" && _retry < 50) return setTimeout(boot, 50);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => K.initApp());
    } else {
      K.initApp();
    }
  }
  boot();
})();
