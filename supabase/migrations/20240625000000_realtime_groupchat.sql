-- ============================================================
-- Migration: realtime_groupchat — shared room messaging
-- ============================================================

-- 1. ROOMS
CREATE TABLE IF NOT EXISTS public.rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 8),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. ROOM MEMBERS (who is in which room, with which role)
CREATE TABLE IF NOT EXISTS public.room_members (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id       UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  partner_role  TEXT NOT NULL CHECK (partner_role IN ('partner1', 'partner2')),
  display_name  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_members_room ON public.room_members(room_id);

-- 3. MESSAGES (shared real-time chat)
CREATE TABLE IF NOT EXISTS public.messages (
  id          BIGSERIAL PRIMARY KEY,
  room_id     UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES auth.users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('partner1', 'partner2', 'assistant')),
  content     TEXT NOT NULL,
  msg_type    TEXT NOT NULL DEFAULT 'text' CHECK (msg_type IN ('text','image','video','voice')),
  duration    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON public.messages(room_id, created_at);

-- 4. ENABLE RLS
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 5. RLS POLICIES

-- Rooms: member bisa lihat room mereka
CREATE POLICY "view own rooms"
  ON public.rooms FOR SELECT
  USING (
    id IN (SELECT room_id FROM public.room_members WHERE user_id = auth.uid())
  );

-- Room members: lihat & insert
CREATE POLICY "view own membership"
  ON public.room_members FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "join room"
  ON public.room_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Messages: member room bisa baca & insert
CREATE POLICY "read room messages"
  ON public.messages FOR SELECT
  USING (
    room_id IN (SELECT room_id FROM public.room_members WHERE user_id = auth.uid())
  );

CREATE POLICY "send message"
  ON public.messages FOR INSERT
  WITH CHECK (
    room_id IN (SELECT room_id FROM public.room_members WHERE user_id = auth.uid())
    AND sender_id = auth.uid()
  );

-- 6. ENABLE REALTIME (WebSocket broadcast)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
