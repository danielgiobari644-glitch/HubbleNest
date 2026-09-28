-- =============================================================
-- LinkRoom Migration 006 — Private messaging helpers
-- Architecture overview (doc only):
--  - Each user generates an ECDH P-256 keypair in browser.
--  - Public key is stored in profiles.public_key (base64 SPKI).
--  - Private key NEVER leaves the browser (stored in IndexedDB).
--  - To send a private message:
--    1. Load recipient's public_key.
--    2. ECDH derive shared secret (browser-side).
--    3. AES-GCM-256 encrypt plaintext + attachments.
--    4. Store ONLY ciphertext + IV in private_messages.
--  - Supabase cannot read private message contents.
--  - Decryption happens only on the recipient's authorized browser.
-- =============================================================

-- Helper: get-or-create private conversation between current user and another user
create or replace function public.ensure_private_conversation(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  conv_id uuid;
begin
  if p_other = auth.uid() then
    raise exception 'Cannot create private conversation with yourself';
  end if;

  -- Ensure other user has public key (so we can encrypt)
  if not exists (select 1 from public.profiles where id = p_other and public_key is not null) then
    raise exception 'Recipient has no public key yet';
  end if;

  select id into conv_id from public.private_conversations
  where (user_a = auth.uid() and user_b = p_other)
     or (user_b = auth.uid() and user_a = p_other)
  limit 1;

  if conv_id is null then
    -- Order user ids deterministically (smaller first) for unique constraint
    if auth.uid() < p_other then
      insert into public.private_conversations (user_a, user_b)
      values (auth.uid(), p_other)
      on conflict (user_a, user_b) do nothing
      returning id into conv_id;
    else
      insert into public.private_conversations (user_a, user_b)
      values (p_other, auth.uid())
      on conflict (user_a, user_b) do nothing
      returning id into conv_id;
    end if;

    if conv_id is null then
      select id into conv_id from public.private_conversations
      where (user_a = auth.uid() and user_b = p_other)
         or (user_b = auth.uid() and user_a = p_other)
      limit 1;
    end if;
  end if;

  return conv_id;
end;
$$;

-- Helper: list my private conversations with last message preview
create or replace function public.my_private_conversations()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  other_username text,
  other_full_name text,
  other_avatar_url text,
  last_message_at timestamptz,
  unread_count bigint
) language sql stable security definer set search_path = public as $$
  with others as (
    select id as conv_id,
           case when user_a = auth.uid() then user_b else user_a end as other_user_id
    from public.private_conversations
    where user_a = auth.uid() or user_b = auth.uid()
  )
  select
    o.conv_id,
    o.other_user_id,
    p.username,
    p.full_name,
    p.avatar_url,
    (select max(created_at) from public.private_messages where conversation_id = o.conv_id),
    (
      select count(*)
      from public.private_messages pm
      left join public.private_read_state prs
        on prs.conversation_id = o.conv_id and prs.user_id = auth.uid()
      where pm.conversation_id = o.conv_id
        and pm.sender_id <> auth.uid()
        and (prs.last_read_at is null or pm.created_at > prs.last_read_at)
    )
  from others o
  join public.profiles p on p.id = o.other_user_id;
$$;

-- Helper: mark private conversation as read
create or replace function public.mark_private_read(p_conv_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.private_conversations
    where id = p_conv_id and (user_a = auth.uid() or user_b = auth.uid())
  ) then
    raise exception 'Not a participant';
  end if;

  insert into public.private_read_state (conversation_id, user_id, last_read_at)
  values (p_conv_id, auth.uid(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = now();
end;
$$;
