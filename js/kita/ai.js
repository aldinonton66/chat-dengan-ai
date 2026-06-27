/* ============================================================
   FILE: kita/ai.js — AI settings, prompt builder
   ============================================================ */
(function() {
  const K = window.KitaAI;

  K.loadAIData = () => {
    const data = {};
    ["kita-nama", "kita-tentang", "kita-sapaan", "kita-nama-ai", "kita-ai-tentang",
     "kita-ai-gaya", "kita-ai-kepribadian", "kita-ai-pengetahuan", "kita-ai-batasan",
     "kita-ai-instruksi", "kita-ai-model"
    ].forEach((key) => {
      data[key] = K.safeGetItem(key, "");
    });
    return data;
  };

  K.saveAIData = (data) => {
    Object.keys(data).forEach((key) => {
      if (data[key] !== undefined) K.safeSetItem(key, data[key]);
    });
  };

  K.generateSystemPrompt = () => {
    const d = K.loadAIData();
    const p = [];
    const userName = d["kita-nama"] || "User";
    const aiName = d["kita-nama-ai"] || "Teman AI";

    p.push("Kamu adalah " + aiName + ", teman bicara yang hangat dan setia.");
    if (d["kita-sapaan"]) p.push("Kamu menyapa dengan '" + d["kita-sapaan"] + "'");
    p.push("Kamu berbicara dengan " + userName + ".");

    if (d["kita-ai-tentang"]) p.push("Tentang dirimu: " + d["kita-ai-tentang"]);
    if (d["kita-ai-gaya"]) p.push("Gaya bicara: " + d["kita-ai-gaya"]);
    if (d["kita-ai-kepribadian"]) p.push("Kepribadian: " + d["kita-ai-kepribadian"]);
    if (d["kita-ai-pengetahuan"]) p.push("Pengetahuan: " + d["kita-ai-pengetahuan"]);
    if (d["kita-ai-batasan"]) p.push("Batasan: " + d["kita-ai-batasan"]);
    if (d["kita-ai-instruksi"]) p.push("Instruksi khusus: " + d["kita-ai-instruksi"]);
    p.push("Gunakan bahasa Indonesia yang natural dan hangat.");
    p.push("Jangan gunakan markdown atau format khusus. Jawab langsung dengan teks biasa.");

    return p.join("\n");
  };

  K.populateAIForm = () => {
    const data = K.loadAIData();
    const form = document.getElementById("form-ai");
    if (!form) return;
    Object.keys(data).forEach((key) => {
      const el = form.querySelector('[name="' + key + '"]');
      if (el) el.value = data[key] || "";
    });
    K.updatePromptPreview();
  };

  K.updatePromptPreview = () => {
    const preview = document.getElementById("prompt-preview");
    if (!preview) return;
    preview.textContent = K.generateSystemPrompt();
  };

  K.bindAIEvents = () => {
    const form = document.getElementById("form-ai");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = {};
      fd.forEach((val, key) => { data[key] = val; });
      K.saveAIData(data);
      K.updatePromptPreview();
      K.showToast("Pengaturan AI disimpan", "✅", "success");
    });

    // Live preview
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      el.addEventListener("input", K.updatePromptPreview);
      el.addEventListener("change", K.updatePromptPreview);
    });
  };

  K.initAI = () => {
    K.populateAIForm();
    K.bindAIEvents();
  };
})();
