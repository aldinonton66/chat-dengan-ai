/* ============================================================
   FILE: kita/storage.js — localStorage + Supabase sync
   ============================================================ */
(function() {
  const K = window.KitaAI;

  function getSupabase(userId) {
    if (typeof window.supabase === "undefined") return null;
    try {
      return window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);
    } catch { return null; }
  }

  function storageKey(section) {
    return "kita-chat-" + section;
  }

  /* ---------- Chat History Persistence ---------- */
  K.loadChatHistory = (sectionId) => {
    if (!sectionId) sectionId = K.currentSectionId;
    const raw = K.safeGetItem(storageKey(sectionId), "[]");
    try {
      K.chatHistory = JSON.parse(raw) || [];
    } catch { K.chatHistory = []; }
    return K.chatHistory;
  };

  K.saveChatHistory = (sectionId) => {
    if (!sectionId) sectionId = K.currentSectionId;
    return K.safeSetItem(storageKey(sectionId), JSON.stringify(K.chatHistory));
  };

  K.clearChat = (sectionId) => {
    if (!sectionId) sectionId = K.currentSectionId;
    K.chatHistory = [];
    K.saveChatHistory(sectionId);
  };

  /* ---------- Supabase sync ---------- */
  let _syncTimer = null;

  function buildSnapshot() {
    const snapshot = { chats: {}, profile: {}, ai: {} };
    ["teman-ai", "curhat", "catatan", "ide"].forEach((s) => {
      snapshot.chats[s] = K.safeGetItem(storageKey(s), "[]");
    });
    [
      "kita-nama","kita-tentang","kita-avatar","kita-avatar-emoji",
      "kita-nama-ai","kita-ai-tentang","kita-avatar-ai","kita-avatar-emoji-ai",
      "kita-sapaan","kita-font"
    ].forEach((k) => {
      snapshot.profile[k] = K.safeGetItem(k, "");
    });
    [
      "kita-ai-gaya","kita-ai-kepribadian","kita-ai-pengetahuan",
      "kita-ai-batasan","kita-ai-instruksi","kita-ai-model"
    ].forEach((k) => {
      snapshot.ai[k] = K.safeGetItem(k, "");
    });
    return snapshot;
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.chats) {
      Object.keys(snapshot.chats).forEach((s) => {
        const v = snapshot.chats[s];
        if (v) K.safeSetItem(storageKey(s), v);
      });
    }
    if (snapshot.profile) {
      Object.keys(snapshot.profile).forEach((k) => {
        const v = snapshot.profile[k];
        if (v) K.safeSetItem(k, v);
      });
    }
    if (snapshot.ai) {
      Object.keys(snapshot.ai).forEach((k) => {
        const v = snapshot.ai[k];
        if (v) K.safeSetItem(k, v);
      });
    }
  }

  K.syncAllToSupabase = async () => {
    const user = window._kitaUser;
    if (!user) return;
    const sb = getSupabase();
    if (!sb) return;
    try {
      const snapshot = buildSnapshot();
      await sb.from("user_data").upsert(
        { user_id: user.id, data: snapshot, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    } catch (e) {
      // silent fail — sync is best-effort
    }
  };

  K.scheduleSyncToSupabase = () => {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => K.syncAllToSupabase(), 3000);
  };

  K.loadFromSupabase = async (userId) => {
    const sb = getSupabase(userId);
    if (!sb) return;
    try {
      const { data } = await sb.from("user_data").select("data").eq("user_id", userId).maybeSingle();
      if (data?.data) {
        applySnapshot(data.data);
      }
    } catch (e) { /* silent */ }
  };

  K.deleteFromSupabase = async (userId) => {
    const sb = getSupabase(userId);
    if (!sb) return;
    try {
      await sb.from("user_data").delete().eq("user_id", userId);
    } catch (e) { /* silent */ }
  };

  /* ---------- Storage change monitor (cross-tab) ---------- */
  K.initStorageMonitor = () => {
    window.addEventListener("storage", (e) => {
      if (e.key && e.key.startsWith("kita-chat-")) {
        const section = e.key.replace("kita-chat-", "");
        if (section === K.currentSectionId) {
          K.loadChatHistory(section);
          const renderFn = K.renderChatFromHistory;
          if (typeof renderFn === "function") renderFn();
        }
      }
    });

    // Re-sync from Supabase when tab regains focus
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && window._kitaUser) {
        K.loadFromSupabase(window._kitaUser.id).then(() => {
          K.loadChatHistory(K.currentSectionId);
          const renderFn = K.renderChatFromHistory;
          if (typeof renderFn === "function") renderFn();
        });
      }
    });
  };

})();
