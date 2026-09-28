-- =============================================================
-- LinkRoom Migration 005 — File metadata helpers & RLS extras
-- =============================================================

-- Helper: detect category from MIME type
create or replace function public.file_category(p_mime text, p_name text)
returns text language plpgsql immutable as $$
declare
  lower_mime text := lower(coalesce(p_mime,''));
  lower_name text := lower(coalesce(p_name,''));
begin
  if lower_mime like 'image/%' then return 'images'; end if;
  if lower_mime like 'video/%' then return 'videos'; end if;
  if lower_mime like 'audio/%' then return 'audio'; end if;
  if lower_mime in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/rtf'
  ) then return 'documents'; end if;
  return 'other';
end;
$$;

-- Auto-set category on insert
create or replace function public.set_file_category()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.category := public.file_category(new.mime_type, new.original_name);
  return new;
end;
$$;

drop trigger if exists trg_set_file_category on public.files;
create trigger trg_set_file_category
  before insert on public.files
  for each row execute function public.set_file_category();
