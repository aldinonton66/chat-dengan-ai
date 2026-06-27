/* ============================================================
   FILE: kita/sidebar.js — Sidebar navigation, collapse, resize
   ============================================================ */
(function() {
  const K = window.KitaAI;

  K.getSidebarEl = () => document.getElementById("sidebar");

  function loadState() {
    try {
      const saved = localStorage.getItem("kita-sidebar");
      return saved ? JSON.parse(saved) : { collapsed: false, width: 200 };
    } catch { return { collapsed: false, width: 200 }; }
  }

  function saveState(state) {
    K.safeSetItem("kita-sidebar", JSON.stringify(state));
  }

  function updateToggleIcon() {
    const icon = document.querySelector(".sidebar-toggle-icon");
    const sidebar = K.getSidebarEl();
    if (icon && sidebar) icon.textContent = sidebar.classList.contains("collapsed") ? "▶" : "◀";
  }

  function syncWrapperMargin() { /* handled by CSS Grid */ }

  K.applySidebarState = () => {
    const el = K.getSidebarEl();
    if (!el) return;
    const state = loadState();
    el.classList.toggle("collapsed", !!state.collapsed);
    if (state.width) el.style.width = state.width + "px";
    updateToggleIcon();
    syncWrapperMargin();
  };

  function toggleSidebar() {
    const el = K.getSidebarEl();
    if (!el) return;
    const isCollapsed = el.classList.toggle("collapsed");
    updateToggleIcon();
    const state = loadState();
    state.collapsed = isCollapsed;
    saveState(state);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 350);
  }

  function bindToggle() {
    document.getElementById("sidebar-toggle")?.addEventListener("click", toggleSidebar);
  }

  function bindResize() {
    const handle = document.getElementById("sidebar-resize-handle");
    const sidebar = K.getSidebarEl();
    if (!handle || !sidebar) return;

    let startX = 0, startWidth = 0, isResizing = false;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      handle.classList.add("active");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const newW = Math.max(60, Math.min(320, startWidth + (e.clientX - startX)));
      sidebar.style.width = newW + "px";
    });

    document.addEventListener("mouseup", () => {
      if (!isResizing) return;
      isResizing = false;
      handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const state = loadState();
      state.width = sidebar.offsetWidth;
      saveState(state);
    });
  }

  K.initSidebar = () => {
    K.applySidebarState();
    bindToggle();
    bindResize();
  };
})();
