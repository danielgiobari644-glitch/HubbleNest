-- =============================================================
-- LinkRoom Migration 007 — Room expiration & maintenance
-- =============================================================

-- Helper: check & mark expired temporary rooms
create or replace function public.check_room_expiration(p_room_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r record;
  updated_count int := 0;
begin
  select * into r from public.rooms where id = p_room_id;
  if not found then return false; end if;
  if r.room_type = 'temporary' and r.expires_at is not null and r.expires_at <= now() and r.expired = false then
    update public.rooms set expired = true, is_active = false where id = p_room_id;
    -- Notify admins
    insert into public.notifications (user_id, type, title, body, room_id, metadata)
    select rm.user_id, 'room_expired',
           'Room expired',
           r.name || ' has expired',
           r.id,
           jsonb_build_object('room_id', r.id)
    from public.room_memberships rm
    where rm.room_id = p_room_id and rm.role = 'admin';
    return true;
  end if;
  return false;
end;
$$;

-- Auto-expire all expired temporary rooms (run via pg_cron or manually)
create or replace function public.expire_temporary_rooms()
returns int language plpgsql security definer set search_path = public as $$
declare
  expired_count int := 0;
  rec record;
begin
  for rec in
    select id, name, expires_at from public.rooms
    where room_type = 'temporary'
      and expires_at is not null
      and expires_at <= now()
      and expired = false
  loop
    update public.rooms set expired = true, is_active = false where id = rec.id;
    insert into public.notifications (user_id, type, title, body, room_id, metadata)
    select rm.user_id, 'room_expired',
           'Room expired',
           rec.name || ' has expired',
           rec.id,
           jsonb_build_object('room_id', rec.id)
    from public.room_memberships rm
    where rm.room_id = rec.id and rm.role = 'admin';

    expired_count := expired_count + 1;
  end loop;

  -- Warning: 24 hours before expiration
  for rec in
    select id, name, expires_at from public.rooms
    where room_type = 'temporary'
      and expires_at is not null
      and expires_at <= now() + interval '24 hours'
      and expires_at > now()
      and expired = false
      and not exists (
        select 1 from public.notifications
        where room_id = rec.id
          and type = 'room_expiring'
          and created_at > now() - interval '12 hours'
      )
  loop
    insert into public.notifications (user_id, type, title, body, room_id, metadata)
    select rm.user_id, 'room_expiring',
           'Room expiring soon',
           rec.name || ' expires ' || to_char(rec.expires_at, 'Mon DD, HH24:MI'),
           rec.id,
           jsonb_build_object('room_id', rec.id, 'expires_at', rec.expires_at)
    from public.room_memberships rm
    where rm.room_id = rec.id and rm.role = 'admin';
  end loop;

  return expired_count;
end;
$$;

-- Clean up old notifications (older than 90 days) — call manually or via pg_cron
create or replace function public.cleanup_old_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  delete from public.notifications
  where created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
