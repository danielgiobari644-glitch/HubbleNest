-- =============================================================
-- LinkRoom Storage Bucket Policies
-- Run AFTER migrations 001-007.
-- Creates a private bucket `linkroom-files` with RLS.
-- =============================================================

-- Create bucket (only if not exists)
insert into storage.buckets (id, name, public)
values ('linkroom-files', 'linkroom-files', false)
on conflict (id) do nothing;

-- Public read of profiles bucket if you wish; here we keep files private.
-- Select: a room member can list files of a room they belong to.
drop policy if exists "Allow room members to read files" on storage.objects;
create policy "Allow room members to read files"
  on storage.objects for select
  using (
    bucket_id = 'linkroom-files'
    and exists (
      select 1
      from public.files f
      where f.stored_path = name
      and public.is_room_member(f.room_id)
    )
  );

-- Upload: a room member can write to a path that lives under rooms/<room_id>/
drop policy if exists "Allow room members to upload files" on storage.objects;
create policy "Allow room members to upload files"
  on storage.objects for insert
  with check (
    bucket_id = 'linkroom-files'
    and exists (
      select 1 from public.room_memberships rm
      where rm.user_id = auth.uid()
        and rm.room_id::text = (storage.foldername(name))[2]
    )
  );

-- Delete: uploader or admin
drop policy if exists "Allow uploader/admin to delete files" on storage.objects;
create policy "Allow uploader/admin to delete files"
  on storage.objects for delete
  using (
    bucket_id = 'linkroom-files'
    and exists (
      select 1
      from public.files f
      where f.stored_path = name
        and (
          f.uploader_id = auth.uid()
          or public.is_room_admin(f.room_id)
        )
    )
  );
