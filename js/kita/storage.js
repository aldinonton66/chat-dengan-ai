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

  K.syncAllToSupabase = async () => {
    const user = window._kitaUser;
    if (!user) return;
    const sb = getSupabase();
    if (!sb) return;
    try {
      const sections = ["teman-ai", "curhat", "catatan", "ide"];
      for (const s of sections) {
        const key = storageKey(s);
        const data = K.safeGetItem(key, "[]");
        await sb.from("chat_sync").upsert(
          { user_id: user.id, section: s, data: data, updated_at: new Date().toISOString() },
          { onConflict: "user_id,section" }
        ).maybeSingle();
      }
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
      const { data } = await sb.from("chat_sync").select("*").eq("user_id", userId);
      if (data && data.length > 0) {
        data.forEach((row) => {
          if (row.data) {
            K.safeSetItem(storageKey(row.section), row.data);
          }
        });
      }
    } catch (e) { /* silent */ }
  };

  K.deleteFromSupabase = async (userId) => {
    const sb = getSupabase(userId);
    if (!sb) return;
    try {
      await sb.from("chat_sync").delete().eq("user_id", userId);
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
  };

})();
