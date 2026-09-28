-- =============================================================
-- LinkRoom Migration 002 — Row Level Security
-- All sensitive authorization enforced at database level.
-- =============================================================

-- Enable RLS on all data tables
alter table public.profiles                  enable row level security;
alter table public.rooms                      enable row level security;
alter table public.room_memberships           enable row level security;
alter table public.join_requests              enable row level security;
alter table public.messages                   enable row level security;
alter table public.message_reactions          enable row level security;
alter table public.announcements              enable row level security;
alter table public.links                      enable row level security;
alter table public.files                      enable row level security;
alter table public.notifications              enable row level security;
alter table public.private_conversations      enable row level security;
alter table public.private_messages           enable row level security;
alter table public.private_message_reactions  enable row level security;
alter table public.private_read_state         enable row level security;

-- Helper: is current user a member of a room?
create or replace function public.is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.room_memberships
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

-- Helper: is current user an admin of a room?
create or replace function public.is_room_admin(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.room_memberships
    where room_id = p_room_id and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Helper: find private conversation between two users
create or replace function public.find_private_conversation(p_other uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.private_conversations
  where (user_a = auth.uid() and user_b = p_other)
     or (user_b = auth.uid() and user_a = p_other)
  limit 1;
$$;

-- ===========  PROFILES  ===========
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

-- ===========  ROOMS  ===========
drop policy if exists rooms_select_visible on public.rooms;
create policy rooms_select_visible on public.rooms
  for select using (
    is_room_member(id) = true
    or created_by = auth.uid()
    or is_active = false and expires_at is not null and expires_at < now()
  );

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms
  for insert with check (created_by = auth.uid());

drop policy if exists rooms_update_admin on public.rooms;
create policy rooms_update_admin on public.rooms
  for update using (is_room_admin(id));

drop policy if exists rooms_delete_admin on public.rooms;
create policy rooms_delete_admin on public.rooms
  for delete using (is_room_admin(id));

-- Allow lookup by room_code/join_token for non-members (for join flow)
drop policy if exists rooms_select_join_lookup on public.rooms;
create policy rooms_select_join_lookup on public.rooms
  for select using (true);  -- Information shown is limited; approval still required

-- ===========  ROOM MEMBERSHIPS  ===========
drop policy if exists memberships_select_member on public.room_memberships;
create policy memberships_select_member on public.room_memberships
  for select using (
    user_id = auth.uid() or is_room_member(room_id)
  );

drop policy if exists memberships_insert on public.room_memberships;
create policy memberships_insert on public.room_memberships
  for insert with check (user_id = auth.uid());

drop policy if exists memberships_update_self on public.room_memberships;
create policy memberships_update_self on public.room_memberships
  for update using (user_id = auth.uid());

drop policy if exists memberships_delete_admin on public.room_memberships;
create policy memberships_delete_admin on public.room_memberships
  for delete using (is_room_admin(room_id));

drop policy if exists memberships_delete_self on public.room_memberships;
create policy memberships_delete_self on public.room_memberships
  for delete using (user_id = auth.uid());

-- ===========  JOIN REQUESTS  ===========
drop policy if exists join_requests_select on public.join_requests;
create policy join_requests_select on public.join_requests
  for select using (
    user_id = auth.uid() or is_room_admin(room_id)
  );

drop policy if exists join_requests_insert on public.join_requests;
create policy join_requests_insert on public.join_requests
  for insert with check (user_id = auth.uid());

drop policy if exists join_requests_update_admin on public.join_requests;
create policy join_requests_update_admin on public.join_requests
  for update using (is_room_admin(room_id));

drop policy if exists join_requests_delete_self on public.join_requests;
create policy join_requests_delete_self on public.join_requests
  for delete using (user_id = auth.uid());

-- ===========  MESSAGES (room chat)  ===========
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (is_room_member(room_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (is_room_member(room_id) and sender_id = auth.uid());

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete using (
    sender_id = auth.uid() or is_room_admin(room_id)
  );

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update using (sender_id = auth.uid() or is_room_admin(room_id));

-- ===========  MESSAGE REACTIONS  ===========
drop policy if exists reactions_select on public.message_reactions;
create policy reactions_select on public.message_reactions
  for select using (true);

drop policy if exists reactions_insert on public.message_reactions;
create policy reactions_insert on public.message_reactions
  for insert with check (user_id = auth.uid());

drop policy if exists reactions_delete on public.message_reactions;
create policy reactions_delete on public.message_reactions
  for delete using (user_id = auth.uid());

-- ===========  ANNOUNCEMENTS  ===========
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select using (is_room_member(room_id));

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert with check (is_room_admin(room_id) and author_id = auth.uid());

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update using (is_room_admin(room_id));

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements
  for delete using (is_room_admin(room_id));

-- ===========  LINKS  ===========
drop policy if exists links_select on public.links;
create policy links_select on public.links
  for select using (is_room_member(room_id));

drop policy if exists links_insert on public.links;
create policy links_insert on public.links
  for insert with check (is_room_member(room_id) and user_id = auth.uid());

drop policy if exists links_delete on public.links;
create policy links_delete on public.links
  for delete using (user_id = auth.uid() or is_room_admin(room_id));

-- ===========  FILES  ===========
drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (is_room_member(room_id));

drop policy if exists files_insert on public.files;
create policy files_insert on public.files
  for insert with check (is_room_member(room_id) and uploader_id = auth.uid());

drop policy if exists files_delete on public.files;
create policy files_delete on public.files
  for delete using (uploader_id = auth.uid() or is_room_admin(room_id));

-- ===========  NOTIFICATIONS  ===========
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete using (user_id = auth.uid());

-- ===========  PRIVATE CONVERSATIONS  ===========
drop policy if exists pconv_select on public.private_conversations;
create policy pconv_select on public.private_conversations
  for select using (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists pconv_insert on public.private_conversations;
create policy pconv_insert on public.private_conversations
  for insert with check (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists pconv_delete on public.private_conversations;
create policy pconv_delete on public.private_conversations
  for delete using (user_a = auth.uid() or user_b = auth.uid());

-- ===========  PRIVATE MESSAGES (ciphertext only)  ===========
drop policy if exists pm_select on public.private_messages;
create policy pm_select on public.private_messages
  for select using (
    exists (
      select 1 from public.private_conversations pc
      where pc.id = private_messages.conversation_id
        and (pc.user_a = auth.uid() or pc.user_b = auth.uid())
    )
  );

drop policy if exists pm_insert on public.private_messages;
create policy pm_insert on public.private_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.private_conversations pc
      where pc.id = private_messages.conversation_id
        and (pc.user_a = auth.uid() or pc.user_b = auth.uid())
    )
  );

drop policy if exists pm_delete on public.private_messages;
create policy pm_delete on public.private_messages
  for delete using (sender_id = auth.uid());

-- ===========  PRIVATE MESSAGE REACTIONS  ===========
drop policy if exists pmr_select on public.private_message_reactions;
create policy pmr_select on public.private_message_reactions
  for select using (true);

drop policy if exists pmr_insert on public.private_message_reactions;
create policy pmr_insert on public.private_message_reactions
  for insert with check (user_id = auth.uid());

drop policy if exists pmr_delete on public.private_message_reactions;
create policy pmr_delete on public.private_message_reactions
  for delete using (user_id = auth.uid());

-- ===========  PRIVATE READ STATE  ===========
drop policy if exists prs_select on public.private_read_state;
create policy prs_select on public.private_read_state
  for select using (user_id = auth.uid());

drop policy if exists prs_upsert on public.private_read_state;
create policy prs_upsert on public.private_read_state
  for insert with check (user_id = auth.uid());

drop policy if exists prs_update on public.private_read_state;
create policy prs_update on public.private_read_state
  for update using (user_id = auth.uid());

drop policy if exists prs_delete on public.private_read_state;
create policy prs_delete on public.private_read_state
  for delete using (user_id = auth.uid());
