/* ============================================================
   FILE: kita/utils.js — Shared namespace + utility functions
   ============================================================ */
window.KitaAI = window.KitaAI || {};

(function() {
  const K = window.KitaAI;

  /* ---------- State ---------- */
  K.chatHistory = [];
  K.currentSectionId = APP_CONFIG.defaultActive;
  K.isRecording = false;
  K.audioChunks = [];
  K.mediaRecorder = null;
  K.hiddenFileInput = null;
  K._recordStartTime = 0;

  /* ---------- DOM Cache ---------- */
  K.dom = {};

  /** Safely get or set localStorage */
  K.safeGetItem = (key, def) => {
    try { const v = localStorage.getItem(key); return v !== null ? v : def; } catch { return def; }
  };
  K.safeSetItem = (key, val) => {
    try { localStorage.setItem(key, val); return true; } catch { return false; }
  };
  K.safeRemoveItem = (key) => {
    try { localStorage.removeItem(key); return true; } catch { return false; }
  };

  /* ---------- Toast ---------- */
  let _toastTimer = null;

  K.showToast = (text, icon, type) => {
    const toast = document.getElementById("toast");
    const toastIcon = document.getElementById("toast-icon");
    const toastText = document.getElementById("toast-text");
    if (!toast || !toastText) return;
    clearTimeout(_toastTimer);
    toast.className = "toast" + (type === "success" ? " success" : type === "error" ? " error" : "");
    toastIcon.textContent = icon || (type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️");
    toastText.textContent = text;
    toast.style.display = "flex";
    requestAnimationFrame(() => toast.classList.add("show"));
    _toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => { toast.style.display = "none"; }, 300);
    }, 2500);
  };

  /* ---------- Lightbox ---------- */
  K.openLightbox = (src) => {
    const overlay = document.getElementById("lightbox-overlay");
    const img = document.getElementById("lightbox-img");
    const video = document.getElementById("lightbox-video");
    if (!overlay || !img || !video) return;
    img.style.display = "block";
    video.style.display = "none";
    video.pause();
    img.src = src;
    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
  };

  K.openVideoLightbox = (src) => {
    const overlay = document.getElementById("lightbox-overlay");
    const img = document.getElementById("lightbox-img");
    const video = document.getElementById("lightbox-video");
    if (!overlay || !video || !img) return;
    img.style.display = "none";
    video.style.display = "block";
    video.src = src;
    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    video.play().catch(() => {});
  };

  K.closeLightbox = () => {
    const overlay = document.getElementById("lightbox-overlay");
    const img = document.getElementById("lightbox-img");
    const video = document.getElementById("lightbox-video");
    if (!overlay) return;
    overlay.style.display = "none";
    if (img) { img.style.display = ""; img.src = ""; }
    if (video) { video.style.display = "none"; video.pause(); video.src = ""; }
    document.body.style.overflow = "";
  };

  /* ---------- Chat Elements ---------- */
  K.getChatElements = () => {
    const area = document.getElementById("chat-bubble-area");
    return {
      bubbleArea: area,
      inputText: document.getElementById("chat-input"),
      btnSend: document.getElementById("btn-send"),
      scrollBtn: document.getElementById("btn-scroll-bottom"),
      lightbox: document.getElementById("lightbox-overlay"),
      lightboxImg: document.getElementById("lightbox-img"),
      lightboxClose: document.getElementById("lightbox-close"),
      typingInd: document.getElementById("typing-indicator"),
      selectSpeaker: document.getElementById("select-speaker"),
      btnMic: document.getElementById("btn-mic"),
      btnGallery: document.getElementById("btn-gallery"),
      chatInputBar: document.getElementById("chat-input-bar")
    };
  };

  /* ---------- Scroll ---------- */
  K.scrollToBottom = () => {
    const els = K.getChatElements();
    if (els.bubbleArea) {
      requestAnimationFrame(() => { els.bubbleArea.scrollTop = els.bubbleArea.scrollHeight; });
    }
  };

  K.isNearBottom = () => {
    const area = K.getChatElements().bubbleArea;
    if (!area) return true;
    return (area.scrollHeight - area.scrollTop - area.clientHeight) < 80;
  };

  K.updateScrollButton = () => {
    const btn = K.getChatElements().scrollBtn;
    if (!btn) return;
    btn.classList.toggle("visible", !K.isNearBottom());
  };

  /* ---------- Textarea auto-expand ---------- */
  K.autoExpandTextarea = (ta) => {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 130) + "px";
  };

  /* ---------- Date Format ---------- */
  K.formatTime = (date) => {
    const d = date || new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  };

  K.formatDate = (date) => {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  };

  K.timeAgo = (timestamp) => {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "baru saja";
    if (mins < 60) return mins + "m lalu";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "j lalu";
    const days = Math.floor(hours / 24);
    return days + "h lalu";
  };

  /* ---------- Escape HTML ---------- */
  K.escapeHTML = (str) => {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  };

  /* ---------- Sound ---------- */
  let _soundEnabled = true;

  K.isSoundEnabled = () => _soundEnabled;
  K.setSoundEnabled = (v) => { _soundEnabled = !!v; };

  K.playSound = (type) => {
    if (!_soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.08;
      if (type === "send") {
        osc.frequency.value = 620;
        osc.type = "sine";
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === "receive") {
        osc.frequency.value = 520;
        osc.type = "sine";
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.06);
      }
    } catch (e) { /* audio not supported */ }
  };

})();
