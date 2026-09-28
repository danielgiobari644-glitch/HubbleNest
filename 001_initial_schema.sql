-- =============================================================
-- LinkRoom Migration 001 — Initial Schema
-- Tables: profiles, rooms, room_memberships, join_requests,
--         messages, message_reactions, announcements, links, files
-- =============================================================

-- Extension: pgcrypto for gen_random_uuid (already in Supabase, but ensure)
create extension if not exists "pgcrypto";

-- ===========  PROFILES  ===========
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null,
  username        text not null unique,
  bio             text,
  email           text,
  phone           text,
  avatar_url      text,
  public_key      text,           -- ECDH P-256 public key (base64 spki)
  is_online       boolean default false,
  last_seen       timestamptz default now(),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_profiles_username on public.profiles (lower(username));

-- ===========  ROOMS  ===========
create table if not exists public.rooms (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  motto           text,
  category        text,
  image_url       text,
  room_type       text not null default 'permanent' check (room_type in ('permanent','temporary')),
  room_code       text not null unique,
  join_token      text not null unique,
  is_active       boolean default true,
  expires_at      timestamptz,
  expired         boolean default false,
  settings        jsonb default '{}'::jsonb,
  created_by      uuid not null references auth.users(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_rooms_code on public.rooms (room_code);
create index if not exists idx_rooms_token on public.rooms (join_token);
create index if not exists idx_rooms_created_by on public.rooms (created_by);
create index if not exists idx_rooms_active on public.rooms (is_active) where is_active = true;

-- ===========  ROOM MEMBERSHIPS  ===========
create table if not exists public.room_memberships (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'member' check (role in ('admin','member')),
  joined_at       timestamptz default now(),
  last_read_at    timestamptz default now(),
  unique (room_id, user_id)
);

create index if not exists idx_memberships_room on public.room_memberships (room_id);
create index if not exists idx_memberships_user on public.room_memberships (user_id);

-- ===========  JOIN REQUESTS  ===========
create table if not exists public.join_requests (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by      uuid references auth.users(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz default now(),
  unique (room_id, user_id, status) deferrable initially deferred
);

create index if not exists idx_requests_room on public.join_requests (room_id) where status = 'pending';
create index if not exists idx_requests_user on public.join_requests (user_id);

-- ===========  MESSAGES (room chat)  ===========
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade,
  body            text,
  reply_to_id     uuid references public.messages(id) on delete set null,
  attachment      jsonb,                  -- { url, type, name, size, provider, public_id, thumbnail }
  created_at      timestamptz default now()
);

create index if not exists idx_messages_room on public.messages (room_id, created_at desc);
create index if not exists idx_messages_sender on public.messages (sender_id);

-- ===========  MESSAGE REACTIONS  ===========
create table if not exists public.message_reactions (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.messages(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  emoji           text not null,
  created_at      timestamptz default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_reactions_message on public.message_reactions (message_id);

-- ===========  ANNOUNCEMENTS  ===========
create table if not exists public.announcements (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  author_id       uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  content         text,
  image_url       text,
  pinned          boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_announcements_room on public.announcements (room_id, created_at desc);

-- ===========  LINKS  ===========
create table if not exists public.links (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  url             text not null,
  title           text,
  description     text,
  domain          text,
  message_id     uuid references public.messages(id) on delete set null,
  created_at      timestamptz default now()
);

create index if not exists idx_links_room on public.links (room_id, created_at desc);

-- ===========  FILES  ===========
create table if not exists public.files (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  uploader_id     uuid not null references auth.users(id) on delete cascade,
  original_name   text not null,
  stored_path     text not null,
  mime_type       text not null,
  extension       text,
  size_bytes      bigint not null default 0,
  storage_provider text not null check (storage_provider in ('cloudinary','supabase')),
  storage_path    text,
  url             text,
  thumbnail_url   text,
  public_id       text,
  category        text default 'other',
  created_at      timestamptz default now()
);

create index if not exists idx_files_room on public.files (room_id, created_at desc);
create index if not exists idx_files_category on public.files (room_id, category);

-- ===========  NOTIFICATIONS  ===========
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null,                 -- join_request, request_approved, request_declined, room_message, private_message, announcement, file_upload, room_expiring, room_expired, reaction, reply, member_removed
  title           text,
  body            text,
  room_id         uuid references public.rooms(id) on delete cascade,
  actor_id        uuid references auth.users(id) on delete set null,
  metadata        jsonb,
  read            boolean default false,
  created_at      timestamptz default now()
);

create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_unread on public.notifications (user_id) where read = false;

-- ===========  PRIVATE CONVERSATIONS  ===========
create table if not exists public.private_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references auth.users(id) on delete cascade,
  user_b          uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz default now(),
  unique (user_a, user_b),
  check (user_a <> user_b)
);

create index if not exists idx_pconv_a on public.private_conversations (user_a);
create index if not exists idx_pconv_b on public.private_conversations (user_b);

-- ===========  PRIVATE MESSAGES (encrypted ciphertext)  ===========
create table if not exists public.private_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.private_conversations(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade,
  -- Encrypted payload (base64) — server never sees plaintext
  ciphertext      text not null,
  iv              text not null,                 -- base64 IV
  -- Optional encrypted attachment metadata (also encrypted as JSON)
  encrypted_meta  text,
  meta_iv         text,
  reply_to_id     uuid references public.private_messages(id) on delete set null,
  created_at      timestamptz default now()
);

create index if not exists idx_pm_conv on public.private_messages (conversation_id, created_at desc);

-- ===========  PRIVATE MESSAGE REACTIONS  ===========
create table if not exists public.private_message_reactions (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.private_messages(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  emoji           text not null,
  unique (message_id, user_id, emoji)
);

-- ===========  PRIVATE READ RECEIPTS  ===========
create table if not exists public.private_read_state (
  conversation_id uuid not null references public.private_conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  last_read_at    timestamptz default now(),
  primary key (conversation_id, user_id)
);

-- ===========  AUTO-UPDATED updated_at triggers  ===========
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_rooms_touch on public.rooms;
create trigger trg_rooms_touch before update on public.rooms
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_announcements_touch on public.announcements;
create trigger trg_announcements_touch before update on public.announcements
  for each row execute function public.touch_updated_at();

-- ===========  AUTO-PROFILE on signup  ===========
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, username, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)) || '_' || substr(encode(gen_random_bytes(3),'hex'), 1, 5),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========  ROOM CODE GENERATION  ===========
create or replace function public.generate_room_code()
returns text language sql as $$
  select 'LR-' || upper(substr(encode(gen_random_bytes(4),'hex'),1,6));
$$;

create or replace function public.generate_join_token()
returns text language sql as $$
  select encode(gen_random_bytes(16),'hex');
$$;
