/* ============================================================
   FILE: app.js — Module loader + App orchestrator
   ============================================================ */
(function() {
  const K = window.KitaAI;

  /* ---------- Navigation ---------- */
  K.showSection = (sectionId) => {
    if (!sectionId) sectionId = APP_CONFIG.defaultActive;
    K.currentSectionId = sectionId;

    document.querySelectorAll(".nav-item, .sidebar-item").forEach((el) => {
      el.classList.toggle("active", el.dataset?.section === sectionId);
    });

    document.querySelectorAll(".content-section").forEach((el) => {
      const matchId = el.id?.replace("-section", "");
      const isMatch = matchId === sectionId;
      el.classList.toggle("hidden", !isMatch);
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
    document.querySelectorAll(".nav-item, .sidebar-item").forEach((el) => {
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
        '<li><a href="#' + item.section + '" class="sidebar-item" data-section="' + item.section + '">' +
          '<span class="nav-icon">' + item.icon + '</span>' +
          '<span class="nav-label">' + item.label + '</span>' +
        '</a></li>'
      ).join("");
    }

    // Bottom nav (mobile)
    const bottomNav = document.getElementById("bottom-nav");
    if (bottomNav) {
      // Only show chat sections in bottom nav (not profil/ai)
      const bottomItems = items.filter((i) => ["teman-ai", "curhat", "catatan", "ide"].includes(i.section));
      bottomNav.innerHTML = bottomItems.map((item) =>
        '<button class="nav-item" data-section="' + item.section + '">' +
          '<span class="nav-icon">' + item.icon + '</span>' +
          '<span class="nav-label">' + item.label + '</span>' +
        '</button>'
      ).join("");
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
          const navItem = document.querySelector('.nav-item[data-section="teman-ai"], .sidebar-item[data-section="teman-ai"]');
          if (navItem) navItem.click();
        }
      });
    });
  }

  /* ---------- Welcome Section ---------- */
  function showWelcome() {
    const sectionId = K.safeGetItem("kita-active-section", APP_CONFIG.defaultActive);
    K.loadChatHistory(sectionId);
    K.renderChatFromHistory(sectionId);
    K.showSection(sectionId);
    const target = document.querySelector('[data-section="' + sectionId + '"]');
    if (target) target.classList.add("active");
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
        await K.loadFromSupabase(session.user.id);
      }

      // Generate nav first so bindings work
      generateNavItems();

      // Init modules
      K.bindThemeToggle();
      K.initSidebar();
      K.initStorageMonitor();
      K.initChat();
      K.initMediaRecorder();
      K.initMediaPicker();
      K.initProfil();
      K.initAI();
      bindNavigationEvents();
      bindLogoutButtons();
      bindCancelButtons();
      initOfflineBanner();

      K.setSoundEnabled(K.safeGetItem("kita-sound", "on") === "on");

      showWelcome();
      hideSkeleton();

      // Export button
      document.getElementById("btn-export")?.addEventListener("click", K.exportChatJSON);

      // Reset button
      document.getElementById("btn-hapus-semua")?.addEventListener("click", K.resetAllData);

      // Shortcuts modal close
      document.getElementById("shortcuts-close")?.addEventListener("click", () => {
        const modal = document.getElementById("shortcuts-modal");
        modal?.classList.remove("open");
        document.body.style.overflow = "";
      });
      document.getElementById("shortcuts-modal")?.addEventListener("click", (e) => {
        if (e.target.id === "shortcuts-modal") {
          e.target.classList.remove("open");
          document.body.style.overflow = "";
        }
      });

    } catch (e) {
      if (e?.message?.includes("Auth") || e?.message?.includes("auth")) {
        window.location.replace("login.html");
      }
    }
  };

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
