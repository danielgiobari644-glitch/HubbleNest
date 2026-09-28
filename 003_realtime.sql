-- =============================================================
-- LinkRoom Migration 003 — Realtime publication
-- Publishes chat, private messages, memberships, notifications,
-- join requests, announcements, files, reactions.
-- =============================================================

-- Drop existing publication to start clean
drop publication if exists supabase_realtime;
create publication supabase_realtime;

-- Room chat
alter table public.messages replica identity full;
alter publication supabase_realtime add table public.messages;

-- Message reactions
alter table public.message_reactions replica identity full;
alter publication supabase_realtime add table public.message_reactions;

-- Memberships
alter table public.room_memberships replica identity full;
alter publication supabase_realtime add table public.room_memberships;

-- Join requests
alter table public.join_requests replica identity full;
alter publication supabase_realtime add table public.join_requests;

-- Notifications
alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.notifications;

-- Announcements
alter table public.announcements replica identity full;
alter publication supabase_realtime add table public.announcements;

-- Links
alter table public.links replica identity full;
alter publication supabase_realtime add table public.links;

-- Files
alter table public.files replica identity full;
alter publication supabase_realtime add table public.files;

-- Private messages (ciphertext only — never plaintext)
alter table public.private_messages replica identity full;
alter publication supabase_realtime add table public.private_messages;

-- Private conversations
alter table public.private_conversations replica identity full;
alter publication supabase_realtime add table public.private_conversations;

-- Private reactions
alter table public.private_message_reactions replica identity full;
alter publication supabase_realtime add table public.private_message_reactions;

-- Private read state
alter table public.private_read_state replica identity full;
alter publication supabase_realtime add table public.private_read_state;

-- Rooms (so members see updates live)
alter table public.rooms replica identity full;
alter publication supabase_realtime add table public.rooms;

-- Profiles (for online/last-seen and public_key updates)
alter table public.profiles replica identity full;
alter publication supabase_realtime add table public.profiles;
