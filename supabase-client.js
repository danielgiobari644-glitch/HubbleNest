/* =============================================================
   LinkRoom — Supabase client + data access helpers
   ============================================================= */

window.LR = (function () {
  'use strict';

  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('Supabase JS not loaded');
  }

  const cfg = window.LINKROOM_CONFIG.supabase;
  if (!cfg.url || !cfg.anonKey || cfg.anonKey === 'YOUR_SUPABASE_ANON_KEY_HERE') {
    console.error('LINKROOM_CONFIG.supabase.anonKey is not set. Edit js/config.js.');
  }

  const client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce'
    },
    realtime: { params: { eventsPerSecond: 10 } }
  });

  // ---------- Auth ----------
  async function signUpWithEmail(email, password, meta) {
    return client.auth.signUp({
      email, password,
      options: { data: meta || {} }
    });
  }

  async function signInWithEmail(email, password) {
    return client.auth.signInWithPassword({ email, password });
  }

  async function signInWithGoogle() {
    const redirectTo = window.location.origin + (window.location.pathname.endsWith('/app.html') ? '/app.html' : '/app.html');
    return client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
  }

  async function signOut() {
    // Clear local crypto identity on logout (privacy)
    try {
      if (navigator.storage && navigator.storage.indexedDB) {
        // IndexedDB will remain but vault key in localStorage will be cleared
      }
    } catch {}
    Utils.ls.del('vault_key');
    return client.auth.signOut();
  }

  async function getSession() { return client.auth.getSession(); }
  async function getUser() { return client.auth.getUser(); }
  function onAuthChange(cb) { return client.auth.onAuthStateChange(cb); }

  // ---------- Profiles ----------
  async function getCurrentProfile() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function upsertProfile(p) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await client
      .from('profiles')
      .upsert({ id: user.id, ...p })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function getProfile(id) {
    const { data, error } = await client.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function searchProfiles(query) {
    const { data, error } = await client
      .from('profiles')
      .select('id, username, full_name, avatar_url, bio')
      .or(`username.ilike.%${query}%,full_name.ilike.%${query}%`)
      .limit(20);
    if (error) throw error;
    return data || [];
  }

  // ---------- Rooms ----------
  async function createRoom(data) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // RPC: generate code & token
    const [{ data: code }, { data: token }] = await Promise.all([
      client.rpc('generate_room_code'),
      client.rpc('generate_join_token')
    ]);

    const payload = {
      name: data.name,
      description: data.description,
      motto: data.motto || null,
      category: data.category || null,
      image_url: data.image_url || null,
      room_type: data.room_type || 'permanent',
      expires_at: data.room_type === 'temporary' ? data.expires_at : null,
      room_code: code,
      join_token: token,
      created_by: user.id,
      settings: data.settings || { max_file_size_mb: 500 }
    };

    const { data: room, error } = await client.from('rooms').insert(payload).select().single();
    if (error) throw error;

    // Auto-membership: creator = admin
    await client.from('room_memberships').insert({
      room_id: room.id,
      user_id: user.id,
      role: 'admin'
    });

    return room;
  }

  async function listMyRooms() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return [];

    const { data: ms, error } = await client
      .from('room_memberships')
      .select('room_id, role, last_read_at, rooms(*)')
      .eq('user_id', user.id);

    if (error) throw error;

    return (ms || []).map(m => {
      const room = m.rooms;
      if (!room) return null;
      return {
        ...room,
        my_role: m.role,
        last_read_at: m.last_read_at
      };
    }).filter(Boolean);
  }

  async function getRoom(roomId) {
    const { data, error } = await client.from('rooms').select('*').eq('id', roomId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getRoomByCode(code) {
    const { data, error } = await client.from('rooms').select('*').eq('room_code', code.toUpperCase()).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getRoomByToken(token) {
    const { data, error } = await client.from('rooms').select('*').eq('join_token', token).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function updateRoom(roomId, patch) {
    const { data, error } = await client.from('rooms').update(patch).eq('id', roomId).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteRoom(roomId) {
    const { error } = await client.from('rooms').delete().eq('id', roomId);
    if (error) throw error;
    return true;
  }

  // ---------- Memberships ----------
  async function getMembers(roomId) {
    const { data, error } = await client
      .from('room_memberships')
      .select('id, user_id, role, joined_at, profiles(id, username, full_name, avatar_url, bio, is_online, last_seen)')
      .eq('room_id', roomId);
    if (error) throw error;
    return (data || []).map(m => ({ ...m, profile: m.profiles })).map(({ profiles, ...rest }) => rest);
  }

  async function leaveRoom(roomId) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await client.from('room_memberships').delete().eq('room_id', roomId).eq('user_id', user.id);
    if (error) throw error;
    return true;
  }

  async function removeMember(roomId, userId) {
    const { error } = await client.from('room_memberships').delete().eq('room_id', roomId).eq('user_id', userId);
    if (error) throw error;
    return true;
  }

  async function updateMembership(roomId, userId, patch) {
    const { data, error } = await client
      .from('room_memberships')
      .update(patch)
      .eq('room_id', roomId).eq('user_id', userId)
      .select().single();
    if (error) throw error;
    return data;
  }

  async function markRead(roomId) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    await client.from('room_memberships')
      .update({ last_read_at: new Date().toISOString() })
      .eq('room_id', roomId).eq('user_id', user.id);
  }

  // ---------- Join requests ----------
  async function requestJoin(roomId) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Check existing
    const { data: existing } = await client.from('join_requests')
      .select('*')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) return existing;

    const { data, error } = await client.from('join_requests').insert({
      room_id: roomId, user_id: user.id, status: 'pending'
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function getJoinRequests(roomId) {
    const { data, error } = await client
      .from('join_requests')
      .select('id, status, created_at, decided_at, user_id, profiles(id, username, full_name, avatar_url, bio, created_at)')
      .eq('room_id', roomId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(r => ({ ...r, profile: r.profiles })).map(({ profiles, ...rest }) => rest);
  }

  async function decideJoinRequest(requestId, status) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: req, error: e1 } = await client.from('join_requests')
      .select('room_id, user_id').eq('id', requestId).single();
    if (e1) throw e1;

    const { error: e2 } = await client.from('join_requests')
      .update({ status, decided_by: user.id, decided_at: new Date().toISOString() })
      .eq('id', requestId);
    if (e2) throw e2;

    if (status === 'approved') {
      // Insert membership
      await client.from('room_memberships').insert({
        room_id: req.room_id, user_id: req.user_id, role: 'member'
      });
    }
    return true;
  }

  // ---------- Messages (room chat) ----------
  async function listMessages(roomId, before) {
    let q = client.from('messages')
      .select('id, body, attachment, reply_to_id, created_at, sender_id, profiles(id, username, full_name, avatar_url)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(40);
    if (before) q = q.lt('created_at', before);

    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(m => ({ ...m, sender: m.profiles })).map(({ profiles, ...rest }) => rest).reverse();
  }

  async function sendMessage(roomId, payload) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await client.from('messages').insert({
      room_id: roomId,
      sender_id: user.id,
      body: payload.body || null,
      attachment: payload.attachment || null,
      reply_to_id: payload.reply_to_id || null
    }).select('id, body, attachment, reply_to_id, created_at, sender_id, profiles(id, username, full_name, avatar_url)').single();

    if (error) throw error;
    return { ...data, sender: data.profiles };
  }

  async function deleteMessage(id) {
    const { error } = await client.from('messages').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  async function updateMessage(id, patch) {
    const { data, error } = await client.from('messages').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  // ---------- Reactions ----------
  async function toggleReaction(messageId, emoji) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data: existing } = await client.from('message_reactions')
      .select('id').eq('message_id', messageId).eq('user_id', user.id).eq('emoji', emoji).maybeSingle();
    if (existing) {
      await client.from('message_reactions').delete().eq('id', existing.id);
    } else {
      await client.from('message_reactions').insert({ message_id: messageId, user_id: user.id, emoji });
    }
  }

  async function listReactions(messageIds) {
    if (!messageIds.length) return [];
    const { data, error } = await client.from('message_reactions')
      .select('id, message_id, user_id, emoji, created_at')
      .in('message_id', messageIds);
    if (error) throw error;
    return data || [];
  }

  // ---------- Announcements ----------
  async function listAnnouncements(roomId) {
    const { data, error } = await client
      .from('announcements')
      .select('*, author_id, profiles(id, username, full_name, avatar_url)')
      .eq('room_id', roomId)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(a => ({ ...a, author: a.profiles })).map(({ profiles, ...rest }) => rest);
  }

  async function createAnnouncement(roomId, payload) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await client.from('announcements').insert({
      room_id: roomId, author_id: user.id,
      title: payload.title, content: payload.content || null, image_url: payload.image_url || null,
      pinned: !!payload.pinned
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function updateAnnouncement(id, patch) {
    const { data, error } = await client.from('announcements').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteAnnouncement(id) {
    const { error } = await client.from('announcements').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  // ---------- Links ----------
  async function listLinks(roomId) {
    const { data, error } = await client
      .from('links')
      .select('id, url, title, description, domain, created_at, user_id, message_id, profiles(id, username, full_name, avatar_url)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(l => ({ ...l, user: l.profiles })).map(({ profiles, ...rest }) => rest);
  }

  async function insertLink(roomId, payload) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await client.from('links').insert({
      room_id: roomId, user_id: user.id,
      url: payload.url, title: payload.title || null,
      description: payload.description || null, domain: payload.domain || null,
      message_id: payload.message_id || null
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteLink(id) {
    const { error } = await client.from('links').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  // ---------- Files ----------
  async function listFiles(roomId, category) {
    let q = client.from('files')
      .select('id, original_name, mime_type, size_bytes, extension, category, storage_provider, storage_path, url, thumbnail_url, public_id, created_at, uploader_id, profiles(id, username, full_name, avatar_url)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false });
    if (category && category !== 'recent') q = q.eq('category', category);
    const { data, error } = await q.limit(200);
    if (error) throw error;
    return (data || []).map(f => ({ ...f, uploader: f.profiles })).map(({ profiles, ...rest }) => rest);
  }

  async function insertFile(roomId, meta) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await client.from('files').insert({
      room_id: roomId, uploader_id: user.id,
      original_name: meta.original_name, stored_path: meta.stored_path,
      mime_type: meta.mime_type, extension: meta.extension || null,
      size_bytes: meta.size_bytes || 0, storage_provider: meta.storage_provider,
      storage_path: meta.storage_path || null, url: meta.url || null,
      thumbnail_url: meta.thumbnail_url || null, public_id: meta.public_id || null
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteFile(id) {
    const { data: file } = await client.from('files').select('storage_provider, storage_path, public_id').eq('id', id).single();
    if (file) {
      if (file.storage_provider === 'supabase' && file.storage_path) {
        try { await client.storage.from(LINKROOM_CONFIG.storage.bucket).remove([file.storage_path]); } catch (e) { console.warn(e); }
      }
      // Cloudinary: deletion requires signed API call (backend). We can leave the resource; metadata is removed.
    }
    const { error } = await client.from('files').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  // ---------- Notifications ----------
  async function listNotifications() {
    const { data, error } = await client.from('notifications')
      .select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  }

  async function markAllNotificationsRead() {
    return client.rpc('mark_all_read');
  }

  async function markNotificationRead(id) {
    return client.from('notifications').update({ read: true }).eq('id', id);
  }

  async function unreadNotificationCount() {
    const { data, error } = await client.rpc('unread_notification_count');
    if (error) throw error;
    return data || 0;
  }

  // ---------- Private messaging (E2E) ----------
  async function listPrivateConversations() {
    const { data, error } = await client.rpc('my_private_conversations');
    if (error) throw error;
    return data || [];
  }

  async function ensurePrivateConversation(otherUserId) {
    const { data, error } = await client.rpc('ensure_private_conversation', { p_other: otherUserId });
    if (error) throw error;
    return data;
  }

  async function listPrivateMessages(conversationId, before) {
    let q = client.from('private_messages')
      .select('id, conversation_id, sender_id, ciphertext, iv, encrypted_meta, meta_iv, reply_to_id, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (before) q = q.lt('created_at', before);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).reverse();
  }

  async function sendPrivateMessage(conversationId, otherUserId, plaintext, meta) {
    const otherPub = await getOtherPublicKey(otherUserId);
    if (!otherPub) throw new Error('Recipient has no public key');
    const shared = await LinkRoomCrypto.getSharedKeyFor(otherPub, otherUserId);
    const enc = await LinkRoomCrypto.encryptMessage(plaintext, shared, meta);
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await client.from('private_messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      encrypted_meta: enc.encrypted_meta,
      meta_iv: enc.meta_iv
    }).select('id, conversation_id, sender_id, ciphertext, iv, encrypted_meta, meta_iv, created_at').single();
    if (error) throw error;
    return data;
  }

  async function deletePrivateMessage(id) {
    const { error } = await client.from('private_messages').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  async function markPrivateRead(convId) {
    return client.rpc('mark_private_read', { p_conv_id: convId });
  }

  async function getOtherPublicKey(userId) {
    const { data, error } = await client.from('profiles').select('public_key').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data ? data.public_key : null;
  }

  // ---------- Storage ----------
  async function uploadToSupabaseStorage(roomId, file, onProgress) {
    const path = `${roomId}/${Utils.uid()}-${file.name}`;
    const up = client.storage.from(LINKROOM_CONFIG.storage.bucket).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      onProgress: (e) => {
        if (e.total && onProgress) onProgress(e.loaded / e.total * 100);
      }
    });
    const { data, error } = await up;
    if (error) throw error;
    const pub = client.storage.from(LINKROOM_CONFIG.storage.bucket).getPublicUrl(data.path);
    return { stored_path: data.path, url: pub.data.publicUrl };
  }

  function createSignedUrl(path) {
    return client.storage.from(LINKROOM_CONFIG.storage.bucket).createSignedUrl(path, 60 * 10);
  }

  // ---------- Realtime helpers ----------
  function subscribe(channelName, opts) {
    return client.channel(channelName, opts);
  }

  function removeChannel(ch) { return client.removeChannel(ch); }

  // ---------- Expose ----------
  return {
    client,
    // auth
    signUpWithEmail, signInWithEmail, signInWithGoogle, signOut,
    getSession, getUser, onAuthChange,
    // profiles
    getCurrentProfile, upsertProfile, getProfile, searchProfiles,
    // rooms
    createRoom, listMyRooms, getRoom, getRoomByCode, getRoomByToken, updateRoom, deleteRoom,
    // memberships
    getMembers, leaveRoom, removeMember, updateMembership, markRead,
    // join requests
    requestJoin, getJoinRequests, decideJoinRequest,
    // messages
    listMessages, sendMessage, deleteMessage, updateMessage,
    // reactions
    toggleReaction, listReactions,
    // announcements
    listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
    // links
    listLinks, insertLink, deleteLink,
    // files
    listFiles, insertFile, deleteFile, uploadToSupabaseStorage, createSignedUrl,
    // notifications
    listNotifications, markAllNotificationsRead, markNotificationRead, unreadNotificationCount,
    // private messaging
    listPrivateConversations, ensurePrivateConversation, listPrivateMessages,
    sendPrivateMessage, deletePrivateMessage, markPrivateRead, getOtherPublicKey,
    // realtime
    subscribe, removeChannel
  };
})();
