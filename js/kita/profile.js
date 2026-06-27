/* ============================================================
   FILE: kita/profile.js — Profile form, preview, font settings
   ============================================================ */
(function() {
  const K = window.KitaAI;

  /* ---------- Profile Data ---------- */
  K.loadProfilData = () => {
    const data = {};
    [
      "kita-nama", "kita-tentang", "kita-avatar", "kita-avatar-emoji",
      "kita-nama-ai", "kita-ai-tentang", "kita-avatar-ai", "kita-avatar-emoji-ai",
      "kita-sapaan", "kita-font", "kita-sound"
    ].forEach((key) => {
      data[key] = K.safeGetItem(key, "");
    });
    return data;
  };

  K.saveProfilData = (data) => {
    Object.keys(data).forEach((key) => {
      if (data[key] !== undefined) K.safeSetItem(key, data[key]);
    });
  };

  K.populateProfilForm = () => {
    const data = K.loadProfilData();
    const form = document.getElementById("form-profil");
    if (!form) return;

    Object.keys(data).forEach((key) => {
      const el = form.querySelector('[name="' + key + '"]');
      if (el) el.value = data[key] || "";
    });

    // Preview
    K.updateProfilePreview();
  };

  K.updateProfilePreview = () => {
    const data = K.loadProfilData();
    const preview = document.querySelector(".profile-preview-area");
    if (!preview) return;

    preview.innerHTML =
      '<div class="profile-card-preview">' +
        '<div class="preview-header">' +
          '<div class="preview-avatar">' +
            (data["kita-avatar"] ? '<img src="' + K.escapeHTML(data["kita-avatar"]) + '" alt="">' : '<span class="preview-emoji">' + (data["kita-avatar-emoji"] || "🧑") + '</span>') +
          '</div>' +
          '<div class="preview-info">' +
            '<strong>' + K.escapeHTML(data["kita-nama"] || "Kamu") + '</strong>' +
            '<span>' + K.escapeHTML(data["kita-tentang"] || "Tentang kamu…") + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="preview-ai">' +
          '<div class="preview-avatar">' +
            (data["kita-avatar-ai"] ? '<img src="' + K.escapeHTML(data["kita-avatar-ai"]) + '" alt="">' : '<span class="preview-emoji">' + (data["kita-avatar-emoji-ai"] || "🤖") + '</span>') +
          '</div>' +
          '<div class="preview-info">' +
            '<strong>' + K.escapeHTML(data["kita-nama-ai"] || "Teman AI") + '</strong>' +
            '<span>' + K.escapeHTML(data["kita-ai-tentang"] || "Tentang AI…") + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="preview-sapa"><em>Sapaan:</em> ' + K.escapeHTML(data["kita-sapaan"] || "Halo") + '</div>' +
      '</div>';
  };

  /* ---------- Bind Events ---------- */
  K.bindProfilEvents = () => {
    const form = document.getElementById("form-profil");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = {};
      fd.forEach((val, key) => { data[key] = val; });
      K.saveProfilData(data);
      const soundOn = data["kita-sound"] === "on" || data["kita-sound"] === "true";
      K.safeSetItem("kita-sound", soundOn ? "on" : "off");
      K.setSoundEnabled(soundOn);

      // Apply font
      const font = data["kita-font"];
      if (font) {
        const body = document.body;
        if (font === "modern") {
          body.style.fontFamily = "'Plus Jakarta Sans', sans-serif";
        } else if (font === "classic") {
          body.style.fontFamily = "'Merriweather', serif";
        } else if (font === "mono") {
          body.style.fontFamily = "'JetBrains Mono', monospace";
        } else {
          body.style.fontFamily = "";
        }
      }

      K.updateProfilePreview();
      K.showToast("Profil tersimpan", "✅", "success");
    });

    // Live preview on input
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      el.addEventListener("input", K.updateProfilePreview);
      el.addEventListener("change", K.updateProfilePreview);
    });

    // Avatar upload
    const avatarUploads = form.querySelectorAll(".avatar-upload-input");
    avatarUploads.forEach((input) => {
      input.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const maxSize = 2 * 1024 * 1024;
        if (file.size > maxSize) {
          K.showToast("File terlalu besar (maks 2MB)", "⚠️", "error");
          input.value = "";
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result;
          if (dataUrl) {
            const name = input.dataset?.target || "";
            K.safeSetItem(name, dataUrl);
            K.showToast("Avatar diupload", "✅", "success");
            K.updateProfilePreview();
          }
        };
        reader.readAsDataURL(file);
      });
    });
  };

  K.initProfil = () => {
    K.populateProfilForm();
    K.bindProfilEvents();
  };
})();
