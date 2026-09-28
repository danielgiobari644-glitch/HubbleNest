/* =============================================================
   LinkRoom — Room chat (real-time, replies, reactions, attachments)
   ============================================================= */

window.Chat = (function () {
  'use strict';

  let state = {
    roomId: null,
    messages: [],     // [{ id, body, attachment, reply_to_id, created_at, sender_id, sender, reactions: [] }]
    cursor: null,     // for pagination
    loading: false,
    hasMore: true,
    replyTo: null,    // message being replied to
    subscription: null,
    reactionsSub: null
  };

  const EMOJIS = ['👍','❤️','😂','😮','😢','🙏','🔥','👏','🎉','💯','✅','👀'];

  // ---------- Mount chat into a container ----------
  async function mount(container, roomId) {
    state.roomId = roomId;
    state.messages = [];
    state.cursor = null;
    state.hasMore = true;
    state.replyTo = null;
    if (state.subscription) { LR.removeChannel(state.subscription); state.subscription = null; }
    if (state.reactionsSub) { LR.removeChannel(state.reactionsSub); state.reactionsSub = null; }

    Utils.clear(container);
    const host = Utils.el('div', { class: 'chat-host' });

    const messagesWrap = Utils.el('div', { class: 'chat-messages', id: 'chatMessages' });
    // Infinite scroll
    messagesWrap.addEventListener('scroll', () => {
      if (messagesWrap.scrollTop < 60 && state.hasMore && !state.loading) loadOlder();
    });
    host.appendChild(messagesWrap);

    const inputWrap = Utils.el('div', { class: 'chat-input-wrap' });
    const replyPreview = Utils.el('div', { class: 'chat-reply-preview', id: 'replyPreview', style: { display: 'none' } });
    inputWrap.appendChild(replyPreview);

    const row = Utils.el('div', { class: 'chat-input-row', style: { position: 'relative' } });
    const attachBtn = Utils.el('button', { class: 'chat-attach-btn', 'aria-label': 'Attach file' });
    attachBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const fileInput = Utils.el('input', { type: 'file', hidden: true });
    attachBtn.appendChild(fileInput);
    row.appendChild(attachBtn);

    const textarea = Utils.el('textarea', { placeholder: 'Type a message…', rows: '1', style: { maxHeight: '120px' } });
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    row.appendChild(textarea);

    const emojiBtn = Utils.el('button', { class: 'chat-attach-btn', 'aria-label': 'Emoji' });
    emojiBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/><path d="M9 14c1 1 5 1 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    emojiBtn.addEventListener('click', () => toggleEmojiPicker(row));
    row.appendChild(emojiBtn);

    const sendBtn = Utils.el('button', { class: 'chat-send-btn', 'aria-label': 'Send message' });
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12l16-8-6 16-3-7-7-1z" fill="currentColor"/></svg>';
    sendBtn.addEventListener('click', send);
    row.appendChild(sendBtn);

    inputWrap.appendChild(row);
    host.appendChild(inputWrap);

    container.appendChild(host);

    // Attach file handler
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      fileInput.value = '';
      sendAttachment(f);
    });

    // Initial load
    await loadInitial();

    // Realtime subscribe
    state.subscription = LR.subscribe('room-chat-' + roomId);
    state.subscription.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}`
    }, (payload) => {
      onNewMessage(payload.new);
    }).on('postgres_changes', {
      event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}`
    }, (payload) => {
      state.messages = state.messages.filter(m => m.id !== payload.old.id);
      renderMessages();
    }).on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}`
    }, (payload) => {
      const idx = state.messages.findIndex(m => m.id === payload.new.id);
      if (idx >= 0) { state.messages[idx] = { ...state.messages[idx], ...payload.new }; renderMessages(); }
    }).subscribe();

    state.reactionsSub = LR.subscribe('room-reactions-' + roomId);
    state.reactionsSub.on('postgres_changes', {
      event: '*', schema: 'public', table: 'message_reactions'
    }, async () => {
      await refreshReactions();
    }).subscribe();

    // Mark room as read
    try { await LR.markRead(roomId); } catch {}

    // Focus input
    setTimeout(() => textarea.focus(), 100);
  }

  function unmount() {
    if (state.subscription) { LR.removeChannel(state.subscription); state.subscription = null; }
    if (state.reactionsSub) { LR.removeChannel(state.reactionsSub); state.reactionsSub = null; }
  }

  async function loadInitial() {
    state.loading = true;
    showSkeleton();
    try {
      const msgs = await LR.listMessages(state.roomId);
      state.messages = msgs;
      if (msgs.length < 40) state.hasMore = false;
      state.cursor = msgs.length ? msgs[0].created_at : null;
      await refreshReactions();
      renderMessages();
      scrollBottom(true);
    } catch (e) {
      UI.err('Could not load messages. ' + (e.message||''));
    } finally {
      state.loading = false;
    }
  }

  async function loadOlder() {
    if (!state.hasMore || state.loading || !state.cursor) return;
    state.loading = true;
    const wrap = document.getElementById('chatMessages');
    const prevScrollH = wrap?.scrollHeight || 0;
    const prevScrollT = wrap?.scrollTop || 0;

    try {
      const msgs = await LR.listMessages(state.roomId, state.cursor);
      if (msgs.length < 40) state.hasMore = false;
      state.messages = [...msgs, ...state.messages];
      state.cursor = msgs.length ? msgs[0].created_at : null;
      await refreshReactions();
      renderMessages();
      // Restore scroll
      requestAnimationFrame(() => {
        if (wrap) wrap.scrollTop = prevScrollT + (wrap.scrollHeight - prevScrollH);
      });
    } catch (e) {
      UI.err('Could not load older messages.');
    } finally {
      state.loading = false;
    }
  }

  function showSkeleton() {
    const wrap = document.getElementById('chatMessages');
    if (!wrap) return;
    Utils.clear(wrap);
    for (let i = 0; i < 4; i++) {
      const s = Utils.el('div', { class: 'msg' });
      s.appendChild(Utils.el('div', { class: 'avatar avatar-md skeleton' }));
      const body = Utils.el('div', { class: 'msg-body', style: { width: '60%' } });
      body.appendChild(Utils.el('div', { class: 'skeleton', style: { width: '40%', height: '14px', marginBottom: '6px' } }));
      body.appendChild(Utils.el('div', { class: 'skeleton', style: { width: '100%', height: '40px' } }));
      s.appendChild(body);
      wrap.appendChild(s);
    }
  }

  async function refreshReactions() {
    if (!state.messages.length) return;
    try {
      const ids = state.messages.map(m => m.id);
      const r = await LR.listReactions(ids);
      // Group by message
      const grouped = {};
      for (const x of r) {
        if (!grouped[x.message_id]) grouped[x.message_id] = {};
        if (!grouped[x.message_id][x.emoji]) grouped[x.message_id][x.emoji] = { count: 0, mine: false, ids: [] };
        grouped[x.message_id][x.emoji].count++;
        grouped[x.message_id][x.emoji].ids.push(x.user_id);
      }
      // Mark mine
      const { data: { user } } = await LR.getUser();
      for (const x of r) {
        if (user && x.user_id === user.id && grouped[x.message_id] && grouped[x.message_id][x.emoji]) {
          grouped[x.message_id][x.emoji].mine = true;
        }
      }
      // Assign back
      for (const m of state.messages) m.reactions = grouped[m.id] ? Object.entries(grouped[m.id]).map(([emoji, info]) => ({ emoji, count: info.count, mine: info.mine, ids: info.ids })) : [];
      renderMessages(true);
    } catch (e) {
      console.warn('Could not refresh reactions:', e);
    }
  }

  function renderMessages(skipScroll) {
    const wrap = document.getElementById('chatMessages');
    if (!wrap) return;
    const wasAtBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 100;

    Utils.clear(wrap);

    if (!state.messages.length) {
      wrap.appendChild(UI.emptyState('Start the conversation. Send your first message above.', { title: 'No messages yet', icon: '💬' }));
      return;
    }

    // Cache my user id (fetched async; we re-render once it arrives)
    if (!Chat.myUserId) {
      LR.getUser().then(({ data: { user } }) => { if (user) { Chat.myUserId = user.id; renderMessages(); } });
    }

    for (const msg of state.messages) {
      wrap.appendChild(renderMessage(msg));
    }

    if (wasAtBottom && !skipScroll) scrollBottom();
  }

  function renderMessage(msg) {
    const isMine = Chat.myUserId && msg.sender_id === Chat.myUserId;
    const wrap = Utils.el('div', { class: 'msg' + (isMine ? ' mine' : '') });

    // Avatar
    wrap.appendChild(UI.avatarNode(msg.sender || { full_name: '?', username: '?' }, 'md'));

    const body = Utils.el('div', { class: 'msg-body' });
    body.appendChild(Utils.el('div', { class: 'msg-meta' },
      Utils.el('span', { class: 'msg-sender', text: msg.sender?.full_name || msg.sender?.username || 'Unknown' }),
      Utils.el('span', { text: Utils.fmtTime(msg.created_at) })
    ));

    const msgWrap = Utils.el('div', { class: 'msg-wrap' });
    const bubble = Utils.el('div', { class: 'msg-bubble' });

    // Reply preview
    if (msg.reply_to_id) {
      const ref = state.messages.find(m => m.id === msg.reply_to_id);
      if (ref) {
        const reply = Utils.el('div', { class: 'msg-reply' });
        reply.appendChild(Utils.el('span', { text: (ref.sender?.full_name || ref.sender?.username || 'Unknown') + ': ' }));
        reply.appendChild(Utils.el('span', { text: (ref.body || '[attachment]').slice(0, 80) }));
        bubble.appendChild(reply);
      }
    }

    // Attachment
    if (msg.attachment) {
      const a = msg.attachment;
      if (a.type && a.type.startsWith('image/')) {
        const imgWrap = Utils.el('a', { class: 'msg-attachment', href: a.url, target: '_blank', rel: 'noopener' });
        imgWrap.appendChild(Utils.el('img', { src: a.thumbnail_url || a.url, alt: a.name || '' }));
        bubble.appendChild(imgWrap);
      } else {
        const fileWrap = Utils.el('a', { class: 'msg-attachment file', href: a.url, target: '_blank', rel: 'noopener' });
        fileWrap.appendChild(Utils.el('span', { text: '📄' }));
        fileWrap.appendChild(Utils.el('span', { text: a.name || 'file' }));
        fileWrap.appendChild(Utils.el('span', { class: 'text-muted', text: ' · ' + Utils.humanBytes(a.size) }));
        bubble.appendChild(fileWrap);
      }
    }

    // Body
    if (msg.body) {
      const p = Utils.el('div');
      p.innerHTML = Utils.linkify(msg.body);
      bubble.appendChild(p);
    }

    msgWrap.appendChild(bubble);

    // Reactions
    if (msg.reactions && msg.reactions.length) {
      const rWrap = Utils.el('div', { class: 'msg-reactions' });
      for (const r of msg.reactions) {
        const rBtn = Utils.el('button', { class: 'msg-reaction' + (r.mine ? ' mine' : ''), dataset: { emoji: r.emoji, id: msg.id } });
        rBtn.appendChild(Utils.el('span', { text: r.emoji }));
        rBtn.appendChild(Utils.el('span', { class: 'msg-reaction-count', text: String(r.count) }));
        rBtn.addEventListener('click', () => toggleReaction(msg.id, r.emoji));
        rWrap.appendChild(rBtn);
      }
      msgWrap.appendChild(rWrap);
    }

    // Actions
    const actions = Utils.el('div', { class: 'msg-actions' });
    const replyBtn = actionBtn('↩', 'Reply', () => setReplyTo(msg));
    actions.appendChild(replyBtn);
    actions.appendChild(actionBtn('😀', 'React', (e) => {
      e.stopPropagation();
      openReactionPicker(msg.id);
    }));
    if (msg.body) actions.appendChild(actionBtn('⧉', 'Copy text', () => { Utils.copy(msg.body); UI.ok('Copied to clipboard.'); }));
    if (isMine) {
      actions.appendChild(actionBtn('🗑', 'Delete', () => deleteMessage(msg)));
    } else if (Chat.currentRoomRole === 'admin') {
      actions.appendChild(actionBtn('🗑', 'Remove (admin)', () => deleteMessage(msg)));
    }
    msgWrap.appendChild(actions);

    body.appendChild(msgWrap);
    wrap.appendChild(body);
    return wrap;
  }

  function actionBtn(icon, label, onClick) {
    const b = Utils.el('button', { class: 'msg-action-btn', title: label, 'aria-label': label, text: icon });
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return b;
  }

  function setReplyTo(msg) {
    state.replyTo = msg;
    const preview = document.getElementById('replyPreview');
    if (!preview) return;
    preview.style.display = 'flex';
    Utils.clear(preview);
    preview.appendChild(Utils.el('div', { class: 'msg-reply', style: { flex: 1, margin: 0 } },
      Utils.el('span', { text: (msg.sender?.full_name || msg.sender?.username || 'Unknown') + ': ' }),
      Utils.el('span', { text: (msg.body || '[attachment]').slice(0,80) })
    ));
    const cancel = Utils.el('button', { class: 'icon-btn cancel', 'aria-label': 'Cancel reply' });
    cancel.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    cancel.addEventListener('click', () => { state.replyTo = null; preview.style.display = 'none'; });
    preview.appendChild(cancel);
  }

  async function send() {
    const textarea = document.querySelector('.chat-input-row textarea');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    textarea.style.height = 'auto';

    const replyTo = state.replyTo;
    state.replyTo = null;
    const preview = document.getElementById('replyPreview');
    if (preview) preview.style.display = 'none';

    try {
      // Optimistic: add temp message
      const { data: { user } } = await LR.getUser();
      const profile = await LR.getCurrentProfile();
      const tempMsg = {
        id: 'tmp_' + Date.now(),
        body: text,
        attachment: null,
        reply_to_id: replyTo?.id || null,
        created_at: new Date().toISOString(),
        sender_id: user.id,
        sender: profile,
        reactions: []
      };
      state.messages.push(tempMsg);
      renderMessages();
      scrollBottom(true);

      const sent = await LR.sendMessage(state.roomId, { body: text, reply_to_id: replyTo?.id || null });
      // Replace temp message
      const idx = state.messages.findIndex(m => m.id === tempMsg.id);
      if (idx >= 0) state.messages[idx] = { ...sent, reactions: [] };
      renderMessages();
      scrollBottom(true);

      // Detect links → store in links table
      detectLinks(text, sent.id);
    } catch (e) {
      UI.err('Could not send message. ' + (e.message||''));
    }
  }

  async function sendAttachment(file) {
    // Validate
    const maxBytes = (LINKROOM_CONFIG.app?.maxFileSizeMb || 500) * 1024 * 1024;
    if (file.size > maxBytes) return UI.err(`This file is larger than the ${LINKROOM_CONFIG.app.maxFileSizeMb} MB upload limit.`);

    const replyTo = state.replyTo;
    state.replyTo = null;
    const preview = document.getElementById('replyPreview');
    if (preview) preview.style.display = 'none';

    // Show upload progress bar
    const progress = Utils.el('div', { class: 'chat-upload-progress' });
    progress.appendChild(Utils.el('span', { text: 'Uploading ' + file.name + '…' }));
    const bar = Utils.el('div', { class: 'upload-bar' });
    const fill = Utils.el('div', { class: 'upload-bar-fill', style: { width: '0%' } });
    bar.appendChild(fill);
    progress.appendChild(bar);
    const percent = Utils.el('span', { class: 'text-muted', style: { minWidth: '40px', textAlign: 'right' }, text: '0%' });
    progress.appendChild(percent);
    const inputRow = document.querySelector('.chat-input-row');
    if (inputRow) inputRow.parentElement.appendChild(progress);

    try {
      const meta = await StorageRouter.uploadFile(file, state.roomId, {
        onProgress: (p) => {
          fill.style.width = p.toFixed(0) + '%';
          percent.textContent = p.toFixed(0) + '%';
        }
      });
      progress.remove();

      // Save to files table
      await LR.insertFile(state.roomId, meta);

      // Send message with attachment
      const { data: { user } } = await LR.getUser();
      const profile = await LR.getCurrentProfile();
      const tempMsg = {
        id: 'tmp_' + Date.now(),
        body: null,
        attachment: { ...meta, type: meta.mime_type, name: meta.original_name, size: meta.size_bytes },
        reply_to_id: replyTo?.id || null,
        created_at: new Date().toISOString(),
        sender_id: user.id,
        sender: profile,
        reactions: []
      };
      state.messages.push(tempMsg);
      renderMessages();
      scrollBottom(true);

      const sent = await LR.sendMessage(state.roomId, {
        body: null,
        reply_to_id: replyTo?.id || null,
        attachment: {
          url: meta.url,
          type: meta.mime_type,
          name: meta.original_name,
          size: meta.size_bytes,
          thumbnail_url: meta.thumbnail_url,
          provider: meta.storage_provider,
          public_id: meta.public_id,
          stored_path: meta.stored_path
        }
      });
      const idx = state.messages.findIndex(m => m.id === tempMsg.id);
      if (idx >= 0) state.messages[idx] = { ...sent, reactions: [] };
      renderMessages();
      scrollBottom(true);
      UI.ok('File sent.');
    } catch (e) {
      progress.remove();
      UI.err('This file couldn\'t be uploaded. Try again. ' + (e.message||''));
    }
  }

  function detectLinks(text, messageId) {
    const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      const url = match[1];
      const domain = tryDomain(url);
      LR.insertLink(state.roomId, { url, domain, message_id: messageId }).catch(() => {});
    }
  }
  function tryDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; }
  }

  async function onNewMessage(msg) {
    // Skip if already exists
    if (state.messages.find(m => m.id === msg.id)) return;
    // Need to fetch sender info (since payload doesn't include join)
    // Use listMessages with explicit id
    try {
      const { data: { user } } = await LR.getUser();
      const profile = await LR.getProfile(msg.sender_id);
      const fullMsg = { ...msg, sender: profile, reactions: [] };
      state.messages.push(fullMsg);
      renderMessages();
      scrollBottom();
      // Detect links
      if (msg.body) detectLinks(msg.body, msg.id);
      // Refresh room's links list
      if (window.Links && Links.refresh) Links.refresh(state.roomId);
      // Mark as read if we're currently in this room
      if (state.roomId === msg.room_id) await LR.markRead(state.roomId);
    } catch (e) {
      console.warn('Failed to render new message:', e);
    }
  }

  async function deleteMessage(msg) {
    const ok = await UI.confirm({
      title: 'Delete message?',
      message: 'This message will be permanently deleted.',
      danger: true,
      confirmLabel: 'Delete',
      size: 'modal-sm'
    });
    if (!ok) return;
    try {
      await LR.deleteMessage(msg.id);
      state.messages = state.messages.filter(m => m.id !== msg.id);
      renderMessages();
      UI.ok('Message deleted.');
    } catch (e) {
      UI.err('Could not delete message. ' + (e.message||''));
    }
  }

  async function toggleReaction(messageId, emoji) {
    try {
      await LR.toggleReaction(messageId, emoji);
      // refreshReactions will be triggered by realtime subscription
      await refreshReactions();
    } catch (e) {
      UI.err('Could not react. ' + (e.message||''));
    }
  }

  function openReactionPicker(messageId) {
    const pop = Utils.el('div', { class: 'emoji-popover' });
    for (const e of EMOJIS) {
      const b = Utils.el('button', { text: e });
      b.addEventListener('click', () => {
        pop.remove();
        toggleReaction(messageId, e);
      });
      pop.appendChild(b);
    }
    // Position above row
    const row = document.querySelector('.chat-input-row');
    if (!row) return;
    row.style.position = 'relative';
    row.appendChild(pop);
    setTimeout(() => {
      const handler = (e) => {
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', handler); }
      };
      document.addEventListener('mousedown', handler);
    }, 50);
  }

  function toggleEmojiPicker(row) {
    const existing = row.querySelector('.emoji-popover');
    if (existing) { existing.remove(); return; }
    const pop = Utils.el('div', { class: 'emoji-popover', style: { bottom: 'auto', top: '100%' } });
    const emojis = ['😀','😂','😍','😎','🤔','👍','👎','❤️','🔥','🎉','✅','❌','🙏','👏','🤝','👀','😅','😊','😢','😡','😴','🤯','🥳','😇','🤗','😉','😋','😜','🤩','😏'];
    for (const e of emojis) {
      const b = Utils.el('button', { text: e });
      b.addEventListener('click', () => {
        const textarea = row.querySelector('textarea');
        if (textarea) {
          textarea.value += e;
          textarea.focus();
        }
      });
      pop.appendChild(b);
    }
    row.appendChild(pop);
    setTimeout(() => {
      const handler = (e) => {
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', handler); }
      };
      document.addEventListener('mousedown', handler);
    }, 50);
  }

  function scrollBottom(force) {
    const wrap = document.getElementById('chatMessages');
    if (!wrap) return;
    requestAnimationFrame(() => { wrap.scrollTop = wrap.scrollHeight; });
  }

  return {
    mount, unmount, renderMessages,
    set myUserId(v) { this._uid = v; },
    get myUserId() { return this._uid; },
    set currentRoomRole(v) { this._role = v; },
    get currentRoomRole() { return this._role; }
  };
})();
