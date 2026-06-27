/* ============================================================
   FILE: kita/chat.js — Chat UI, send/receive, voice, media, search
   ============================================================ */
(function() {
  const K = window.KitaAI;

  /* ---------- Render ---------- */
  K.renderChatFromHistory = (sectionId) => {
    if (!sectionId) sectionId = K.currentSectionId;
    const els = K.getChatElements();
    if (!els.bubbleArea) return;
    els.bubbleArea.innerHTML = "";
    const history = K.loadChatHistory(sectionId);
    if (!history || history.length === 0) {
      els.bubbleArea.innerHTML =
        '<div class="chat-empty"><span>💬</span><p>Belum ada pesan. Mulai percakapan!</p></div>';
      return;
    }

    let lastDate = "";
    const fragment = document.createDocumentFragment();

    history.forEach((msg, idx) => {
      const msgDate = K.formatDate(new Date(msg.timestamp || Date.now()));
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const separator = document.createElement("div");
        separator.className = "date-separator";
        separator.textContent = msgDate;
        fragment.appendChild(separator);
      }
      fragment.appendChild(K.buildBubbleHTML(msg, idx));
    });

    els.bubbleArea.appendChild(fragment);
    K.scrollToBottom();
  };

  K.buildBubbleHTML = (msg, idx) => {
    const div = document.createElement("div");
    const isUser = msg.role === "user";
    const time = K.formatTime(new Date(msg.timestamp || Date.now()));
    div.className = "bubble " + (isUser ? "user" : "ai") + " bubble-enter";
    div.style.animationDelay = (Math.min(idx || 0, 20) * 15) + "ms";
    div.dataset.idx = idx;

    let avatar = "";
    let name = "";
    let avatarEmoji = "🧑";

    if (isUser) {
      avatar = K.safeGetItem("kita-avatar", "");
      name = K.safeGetItem("kita-nama", "Kamu") || "Kamu";
      avatarEmoji = K.safeGetItem("kita-avatar-emoji", "🧑") || "🧑";
    } else {
      avatar = K.safeGetItem("kita-avatar-ai", "");
      name = K.safeGetItem("kita-nama-ai", "Teman AI") || "Teman AI";
      avatarEmoji = K.safeGetItem("kita-avatar-emoji-ai", "🤖") || "🤖";
    }

    let mediaHTML = "";
    if (msg.type === "image") {
      mediaHTML =
        '<div class="bubble-media"><img src="' + K.escapeHTML(msg.content) + '" loading="lazy" alt="Foto" onclick="KitaAI.openLightbox(\'' + K.escapeHTML(msg.content) + '\')"></div>';
    } else if (msg.type === "video") {
      mediaHTML =
        '<div class="bubble-media video-thumb" onclick="KitaAI.openVideoLightbox(\'' + K.escapeHTML(msg.content) + '\')"><video src="' + K.escapeHTML(msg.content) + '" preload="metadata"></video><span class="video-play-btn">▶</span></div>';
    } else if (msg.type === "voice") {
      mediaHTML =
        '<div class="bubble-voice"><button class="voice-play-btn" data-src="' + K.escapeHTML(msg.content) + '" onclick="KitaAI.playVoiceNote(this)">▶</button><span class="voice-duration">' + (msg.duration || "0:03") + '</span><div class="voice-wave"></div></div>';
    }

    div.innerHTML =
      '<div class="bubble-avatar' + (avatar ? " has-img" : "") + '">' +
        (avatar ? '<img src="' + K.escapeHTML(avatar) + '" alt="' + K.escapeHTML(name) + '">' : '<span class="bubble-avatar-emoji">' + avatarEmoji + '</span>') +
      '</div>' +
      '<div class="bubble-body">' +
        '<div class="bubble-name">' + K.escapeHTML(name) + '</div>' +
        '<div class="bubble-text">' + (mediaHTML || K.escapeHTML(msg.content).replace(/\n/g, "<br>")) + '</div>' +
        '<div class="bubble-time">' + time + '</div>' +
      '</div>';

    return div;
  };

  /* ---------- Send Message ---------- */
  K.sendMessage = (content, type, duration) => {
    const els = K.getChatElements();
    if (!content || !content.trim()) return;

    // Reset typing indicator
    if (els.typingInd) els.typingInd.classList.add("hidden");

    // Add user message
    const userMsg = {
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
      type: type || "text",
      duration: duration || null
    };
    K.chatHistory.push(userMsg);
    K.saveChatHistory();
    K.renderChatFromHistory();

    // Schedule sync
    K.scheduleSyncToSupabase();

    // Sound + scroll
    K.playSound("send");
    K.scrollToBottom();

    // Show typing indicator
    if (els.typingInd) {
      els.typingInd.classList.remove("hidden");
      K.scrollToBottom();
    }

    // Call AI
    K.callAI();
  };

  /* ---------- AI ---------- */
  K.callAI = async () => {
    const els = K.getChatElements();
    try {
      const res = await fetch(APP_CONFIG.supabaseUrl + "/functions/v1/groq-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + APP_CONFIG.supabaseAnonKey
        },
        body: JSON.stringify({ messages: K.chatHistory })
      });

      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      K.chatHistory.push({
        role: "assistant",
        content: data.reply || data.choices?.[0]?.message?.content || "…",
        timestamp: Date.now()
      });
      K.saveChatHistory();
    } catch (e) {
      K.chatHistory.push({
        role: "assistant",
        content: "⚠️ Maaf, terjadi kesalahan. Coba lagi ya.",
        timestamp: Date.now()
      });
      K.saveChatHistory();
    }

    if (els.typingInd) els.typingInd.classList.add("hidden");
    K.renderChatFromHistory();
    K.playSound("receive");
    K.scrollToBottom();
    K.scheduleSyncToSupabase();
  };

  /* ---------- Voice Playback ---------- */
  K.playVoiceNote = (btn) => {
    const src = btn?.dataset?.src;
    if (!src) return;
    const audio = new Audio(src);
    audio.play().catch(() => {});
    btn.textContent = "⏹";
    audio.addEventListener("ended", () => { btn.textContent = "▶"; });
  };

  /* ---------- Media Recorder ---------- */
  K.initMediaRecorder = () => {
    const els = K.getChatElements();
    if (!els.btnMic || !navigator.mediaDevices) return;

    let mediaRecorder = null;
    let audioChunks = [];

    els.btnMic.addEventListener("click", async () => {
      if (K.isRecording) {
        // Stop recording
        K.isRecording = false;
        els.btnMic.classList.remove("recording");
        els.btnMic.textContent = "🎤";
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = "audio/webm;codecs=opus";
        mediaRecorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(mimeType) ? { mimeType } : {});
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (audioChunks.length === 0) return;
          const blob = new Blob(audioChunks, { type: "audio/webm" });
          const url = URL.createObjectURL(blob);
          const durationSec = Math.round((Date.now() - K._recordStartTime) / 1000);
          const dur = "0:" + String(Math.min(durationSec, 99)).padStart(2, "0");
          K.sendMessage(url, "voice", dur);
        };

        mediaRecorder.start();
        K.isRecording = true;
        K._recordStartTime = Date.now();
        els.btnMic.classList.add("recording");
        els.btnMic.textContent = "⏹";
      } catch (e) {
        K.showToast("Mikrofon tidak diizinkan", "🎤", "error");
      }
    });
  };

  /* ---------- Media Picker ---------- */
  K.initMediaPicker = () => {
    const els = K.getChatElements();
    if (!els.btnGallery) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.style.display = "none";
    input.id = "hidden-media-input";
    document.body.appendChild(input);

    els.btnGallery.addEventListener("click", () => input.click());

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith("video/");
      K.sendMessage(url, isVideo ? "video" : "image");
      input.value = "";
    });
  };

  /* ---------- Export Chat ---------- */
  K.exportChatJSON = () => {
    const data = JSON.stringify(K.chatHistory, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const now = new Date();
    a.download = "chat-kita-ai-" + now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") + ".json";
    a.click();
    URL.revokeObjectURL(url);
    K.showToast("Chat berhasil diexport", "📥", "success");
  };

  /* ---------- Search Chat ---------- */
  K.searchChat = (query) => {
    const els = K.getChatElements();
    if (!els.bubbleArea) return;
    const bubbles = els.bubbleArea.querySelectorAll(".bubble");
    if (!query || !query.trim()) {
      bubbles.forEach((b) => b.style.display = "");
      return;
    }
    const q = query.toLowerCase().trim();
    let found = 0;
    bubbles.forEach((b) => {
      const text = b.querySelector(".bubble-text")?.textContent?.toLowerCase() || "";
      const match = text.includes(q);
      b.style.display = match ? "" : "none";
      if (match) {
        found++;
        b.style.order = "-1";
      } else {
        b.style.order = "";
      }
    });
    K.showToast("Ditemukan " + found + " pesan", "🔍", found > 0 ? "success" : "");
  };

  /* ---------- Init Chat ---------- */
  K.initChat = () => {
    const els = K.getChatElements();

    // Send on button click
    els.btnSend?.addEventListener("click", () => {
      const text = els.inputText?.value;
      if (text?.trim()) {
        K.sendMessage(text);
        if (els.inputText) { els.inputText.value = ""; els.inputText.style.height = "auto"; }
      }
    });

    // Send on Enter (Shift+Enter for newline)
    els.inputText?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        els.btnSend?.click();
      }
    });

    // Auto-expand textarea
    els.inputText?.addEventListener("input", () => K.autoExpandTextarea(els.inputText));

    // Scroll to bottom on new content
    els.bubbleArea?.addEventListener("scroll", K.updateScrollButton);

    // Scroll button click
    els.scrollBtn?.addEventListener("click", () => {
      K.scrollToBottom();
      els.scrollBtn?.classList.remove("visible");
    });

    // Close lightbox
    document.getElementById("lightbox-close")?.addEventListener("click", K.closeLightbox);
    document.getElementById("lightbox-overlay")?.addEventListener("click", (e) => {
      if (e.target.id === "lightbox-overlay") K.closeLightbox();
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      // Ctrl+Enter to send
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        els.btnSend?.click();
      }
      // Escape to close lightbox
      if (e.key === "Escape") {
        K.closeLightbox();
        const modal = document.getElementById("shortcuts-modal");
        if (modal?.classList.contains("open")) {
          modal.classList.remove("open");
          document.body.style.overflow = "";
        }
      }
      // Ctrl+F for search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const bar = document.getElementById("chat-search-bar");
        if (bar) {
          const isVisible = bar.style.display !== "none";
          bar.style.display = isVisible ? "none" : "flex";
          if (!isVisible) {
            const inp = bar.querySelector("input");
            inp?.focus();
            inp?.select();
          }
        }
      }
      // / to focus chat input
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        if (active?.tagName !== "INPUT" && active?.tagName !== "TEXTAREA") {
          e.preventDefault();
          els.inputText?.focus();
        }
      }
      // ? to show shortcuts
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        const modal = document.getElementById("shortcuts-modal");
        if (modal && !modal.classList.contains("open")) {
          modal.classList.add("open");
          document.body.style.overflow = "hidden";
        }
      }
    });

    // Search bar
    const searchInput = document.querySelector("#chat-search-bar input");
    const searchClose = document.querySelector("#chat-search-bar .search-close");
    searchInput?.addEventListener("input", () => K.searchChat(searchInput.value));
    searchClose?.addEventListener("click", () => {
      const bar = document.getElementById("chat-search-bar");
      if (bar) bar.style.display = "none";
      if (searchInput) searchInput.value = "";
      K.searchChat("");
    });

    // Render initial
    K.loadChatHistory();
    K.renderChatFromHistory();
  };

})();
