-- ============================================================
-- Migration: fix_rls_policies — add missing INSERT/DELETE policies
-- ============================================================

-- 1. Rooms: authenticated user can create a room
CREATE POLICY "create room"
  ON public.rooms FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- 2. Room members: user can leave/delete their own membership
CREATE POLICY "leave room"
  ON public.room_members FOR DELETE
  USING (user_id = auth.uid());

-- 3. Messages: allow database webhook (service_role) to insert AI responses
--    This is handled by service_role key bypassing RLS.
--    For anon key users, the existing "send message" policy already covers humans.
