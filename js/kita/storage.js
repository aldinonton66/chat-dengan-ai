/* ============================================================
   FILE: kita/storage.js — Supabase real-time messages + local cache
   ============================================================ */
(function() {
  const K = window.KitaAI;

  /* ---------- Helpers ---------- */
  function getSupabase() {
    if (typeof window.supabase === "undefined") return null;
    try {
      return window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);
    } catch { return null; }
  }

  function storageKey(section) { return "kita-chat-" + section; }

  /* ---------- Room & Member ---------- */
  let _currentRoomId = null;
  let _currentRole = "partner1";
  let _subscription = null;

  K.getRoomId = () => _currentRoomId;
  K.getPartnerRole = () => _currentRole;

  K.getOrCreateRoom = async () => {
    const user = window._kitaUser;
    if (!user) return null;
    const sb = getSupabase();
    if (!sb) return null;

    try {
      // Check if already a member
      const { data: member } = await sb.from("room_members").select("room_id, partner_role").eq("user_id", user.id).maybeSingle();
      if (member) {
        _currentRoomId = member.room_id;
        _currentRole = member.partner_role;
        K.safeSetItem("kita-room-id", member.room_id);
        K.safeSetItem("kita-partner-role", member.partner_role);
        return member.room_id;
      }

      // Try joining with stored room code
      const savedCode = K.safeGetItem("kita-room-code", "");
      if (savedCode) {
        const { data: room } = await sb.from("rooms").select("id").eq("code", savedCode).maybeSingle();
        if (room) {
          await sb.from("room_members").insert({
            user_id: user.id,
            room_id: room.id,
            partner_role: "partner2",
            display_name: K.safeGetItem("kita-nama", "Kamu") || "Kamu"
          });
          _currentRoomId = room.id;
          _currentRole = "partner2";
          K.safeSetItem("kita-room-id", room.id);
          K.safeSetItem("kita-partner-role", "partner2");
          return room.id;
        }
      }

      // Create new room
      const { data: newRoom } = await sb.from("rooms").insert({}).select("id, code").single();
      if (newRoom) {
        await sb.from("room_members").insert({
          user_id: user.id,
          room_id: newRoom.id,
          partner_role: "partner1",
          display_name: K.safeGetItem("kita-nama", "Kamu") || "Kamu"
        });
        _currentRoomId = newRoom.id;
        _currentRole = "partner1";
        K.safeSetItem("kita-room-id", newRoom.id);
        K.safeSetItem("kita-partner-role", "partner1");
        K.safeSetItem("kita-room-code", newRoom.code);
        return newRoom;
      }

      return null;
    } catch (e) {
      return null;
    }
  };

  K.joinRoomByCode = async (code) => {
    const user = window._kitaUser;
    if (!user || !code) return false;
    const sb = getSupabase();
    if (!sb) return false;

    try {
      // Remove existing membership
      await sb.from("room_members").delete().eq("user_id", user.id);
      // Find room
      const { data: room } = await sb.from("rooms").select("id").eq("code", code.trim()).maybeSingle();
      if (!room) return false;
      await sb.from("room_members").insert({
        user_id: user.id,
        room_id: room.id,
        partner_role: "partner2",
        display_name: K.safeGetItem("kita-nama", "Kamu") || "Kamu"
      });
      _currentRoomId = room.id;
      _currentRole = "partner2";
      K.safeSetItem("kita-room-id", room.id);
      K.safeSetItem("kita-partner-role", "partner2");
      K.safeSetItem("kita-room-code", code.trim());
      return true;
    } catch { return false; }
  };

  /* ---------- Messages ---------- */
  K._sendToSupabase = async (content, msgType, duration) => {
    const user = window._kitaUser;
    if (!user || !_currentRoomId) return false;
    const sb = getSupabase();
    if (!sb) return false;

    try {
      await sb.from("messages").insert({
        room_id: _currentRoomId,
        sender_id: user.id,
        sender_role: _currentRole,
        content: content.trim(),
        msg_type: msgType || "text",
        duration: duration || null
      });
      // Also save to local cache immediately
      const localMsg = {
        role: _currentRole === "partner1" ? "user" : "partner",
        sender_role: _currentRole,
        content: content.trim(),
        type: msgType || "text",
        duration: duration || null,
        timestamp: Date.now()
      };
      K.chatHistory.push(localMsg);
      K.saveChatHistory();
      return true;
    } catch { return false; }
  };

  K.loadHistoryFromSupabase = async () => {
    if (!_currentRoomId) return;
    const sb = getSupabase();
    if (!sb) return;

    try {
      const { data: rows } = await sb.from("messages")
        .select("*")
        .eq("room_id", _currentRoomId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (rows && rows.length > 0) {
        K.chatHistory = rows.map((r) => ({
          role: r.sender_role === _currentRole ? "user" : (r.sender_role === "assistant" ? "assistant" : "partner"),
          sender_role: r.sender_role,
          content: r.content,
          type: r.msg_type || "text",
          duration: r.duration || null,
          timestamp: new Date(r.created_at).getTime()
        }));
        K.saveChatHistory();
      }
    } catch (e) { /* silent */ }
  };

  /* ---------- Real-time Subscription ---------- */
  K.initRealtime = () => {
    if (_subscription) return;
    const sb = getSupabase();
    if (!sb || !_currentRoomId) return;

    _subscription = sb.channel("room-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: "room_id=eq." + _currentRoomId
        },
        (payload) => {
          const msg = payload.new;
          // Skip own messages (already in local cache)
          if (msg.sender_id === window._kitaUser?.id) return;

          const newMsg = {
            role: msg.sender_role === _currentRole ? "user" : (msg.sender_role === "assistant" ? "assistant" : "partner"),
            sender_role: msg.sender_role,
            content: msg.content,
            type: msg.msg_type || "text",
            duration: msg.duration || null,
            timestamp: new Date(msg.created_at).getTime()
          };
          K.chatHistory.push(newMsg);
          K.saveChatHistory();
          const renderFn = K.renderChatFromHistory;
          if (typeof renderFn === "function") {
            renderFn(K.currentSectionId);
          }
          K.playSound(newMsg.role === "assistant" ? "receive" : "send");
          K.scrollToBottom();
        }
      )
      .subscribe();
  };

  K.disconnectRealtime = () => {
    if (_subscription) {
      const sb = getSupabase();
      if (sb) sb.removeChannel(_subscription);
      _subscription = null;
    }
  };

  /* ---------- Legacy local-only fallback ---------- */
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

  /* ---------- Cross-tab sync (same browser) ---------- */
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
