/* ============================================================
   FILE: kita/theme.js — Dark/Light theme toggle
   ============================================================ */
(function() {
  const K = window.KitaAI;

  K.bindThemeToggle = () => {
    const btn = document.getElementById("btn-theme-toggle");
    if (!btn) return;

    const saved = K.safeGetItem("kita-theme", null);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = saved !== null ? saved === "dark" : prefersDark;
    document.body.classList.toggle("dark", isDark);
    btn.textContent = isDark ? "☀️" : "🌙";

    btn.addEventListener("click", () => {
      const nowDark = document.body.classList.toggle("dark");
      K.safeSetItem("kita-theme", nowDark ? "dark" : "light");
      btn.textContent = nowDark ? "☀️" : "🌙";
      // Update theme-color meta
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = nowDark ? "#0a0f0f" : "#faf8f5";
    });
  };
})();
