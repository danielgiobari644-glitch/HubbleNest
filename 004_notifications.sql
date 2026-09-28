-- =============================================================
-- LinkRoom Migration 004 — Notification triggers & helpers
-- =============================================================

-- Trigger: notify admins when a join request is created
create or replace function public.notify_join_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  admin record;
  room_rec record;
begin
  select name into room_rec from public.rooms where id = new.room_id;
  for admin in
    select rm.user_id from public.room_memberships rm
    where rm.room_id = new.room_id and rm.role = 'admin'
  loop
    insert into public.notifications (user_id, type, title, body, room_id, actor_id, metadata)
    values (
      admin.user_id,
      'join_request',
      'New join request',
      coalesce((select username from public.profiles where id = new.user_id), 'Someone') || ' wants to join ' || coalesce(room_rec.name, 'a room'),
      new.room_id,
      new.user_id,
      jsonb_build_object('join_request_id', new.id, 'requester_id', new.user_id)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_join_request on public.join_requests;
create trigger trg_notify_join_request
  after insert on public.join_requests
  for each row execute function public.notify_join_request();

-- Trigger: notify requester when status changes
create or replace function public.notify_join_request_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  room_rec record;
begin
  if (new.status <> old.status) then
    select name into room_rec from public.rooms where id = new.room_id;
    insert into public.notifications (user_id, type, title, body, room_id, actor_id, metadata)
    values (
      new.user_id,
      case new.status
        when 'approved' then 'request_approved'
        when 'declined' then 'request_declined'
      end,
      case new.status
        when 'approved' then 'Request approved'
        when 'declined' then 'Request declined'
      end,
      case new.status
        when 'approved' then 'You can now join ' || coalesce(room_rec.name, 'the room')
        when 'declined' then 'Your request to join ' || coalesce(room_rec.name, 'a room') || ' was declined'
      end,
      new.room_id,
      new.decided_by,
      jsonb_build_object('join_request_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_join_decision on public.join_requests;
create trigger trg_notify_join_decision
  after update on public.join_requests
  for each row execute function public.notify_join_request_decision();

-- Trigger: notify room members when new announcement
create or replace function public.notify_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m record;
begin
  for m in
    select rm.user_id from public.room_memberships rm
    where rm.room_id = new.room_id and rm.user_id <> new.author_id
  loop
    insert into public.notifications (user_id, type, title, body, room_id, actor_id, metadata)
    values (
      m.user_id,
      'announcement',
      'New announcement',
      new.title,
      new.room_id,
      new.author_id,
      jsonb_build_object('announcement_id', new.id)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_announcement on public.announcements;
create trigger trg_notify_announcement
  after insert on public.announcements
  for each row execute function public.notify_announcement();

-- Trigger: notify on file upload
create or replace function public.notify_file_upload()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m record;
  uploader text;
begin
  select username into uploader from public.profiles where id = new.uploader_id;
  for m in
    select rm.user_id from public.room_memberships rm
    where rm.room_id = new.room_id and rm.user_id <> new.uploader_id
  loop
    insert into public.notifications (user_id, type, title, body, room_id, actor_id, metadata)
    values (
      m.user_id,
      'file_upload',
      'New file shared',
      coalesce(uploader,'Someone') || ' shared ' || new.original_name,
      new.room_id,
      new.uploader_id,
      jsonb_build_object('file_id', new.id)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_file on public.files;
create trigger trg_notify_file
  after insert on public.files
  for each row execute function public.notify_file_upload();

-- Auto-mute notifications if room notification is sent (helper RPC)
create or replace function public.create_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_room_id uuid default null,
  p_actor_id uuid default null,
  p_metadata jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, room_id, actor_id, metadata)
  values (p_user_id, p_type, p_title, p_body, p_room_id, p_actor_id, coalesce(p_metadata,'{}'::jsonb));
end;
$$;

-- Mark all notifications read for a user (helper RPC)
create or replace function public.mark_all_read()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notifications set read = true where user_id = auth.uid() and read = false;
end;
$$;

-- Get unread count (RPC helper)
create or replace function public.unread_notification_count()
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.notifications where user_id = auth.uid() and read = false;
$$;
