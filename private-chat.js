/* =============================================================
   LinkRoom — Private 1-to-1 Messaging (End-to-End Encrypted)
   -------------------------------------------------------------
   - Server stores ONLY ciphertext + IV.
   - Decryption happens locally with Web Crypto API.
   - Supabase cannot read message plaintext.
   ============================================================= */

window.PrivateChat = (function () {
  'use strict';

  let state = {
    view: 'list',           // 'list' or 'conversation'
    conversationId: null,
    otherUserId: null,
    messages: [],
    cursor: null,
    hasMore: true,
    loading: false,
    subscription: null,
    replyTo: null,
    myUserId: null
  };

  // ---------- Render the messages view (list + conversation shell) ----------
  async function render(container) {
    Utils.clear(container);
    const wrap = Utils.el('div', { class: 'room-layout', style: { height: '100%' } });

    // Conversation list (left)
    const list = Utils.el('aside', { class: 'room-side', id: 'dmList' });
    list.appendChild(Utils.el('div', { class: 'room-side-head' },
      Utils.el('h3', { text: 'Private Messages' }),
      Utils.el('p', { class: 'room-desc', text: 'End-to-end encrypted. Only you and your contact can read these.' })
    ));
    const listBody = Utils.el('div', { class: 'room-tab-panel active', id: 'dmListBody', style: { padding: '8px' } });
    list.appendChild(listBody);
    wrap.appendChild(list);

    // Conversation (right) — placeholder until selected
    const convWrap = Utils.el('section', { class: 'room-main', id: 'dmConvWrap' });
    convWrap.appendChild(emptyConversation());
    wrap.appendChild(convWrap);

    container.appendChild(wrap);

    // Load list
    await refreshList();

    // Subscribe to new conversations / messages
    if (state.subscription) { LR.removeChannel(state.subscription); }
    state.subscription = LR.subscribe('linkroom-private');
    state.subscription
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_conversations' }, () => {
        refreshList();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'private_messages' }, (payload) => {
        // Only handle if it belongs to the currently open conversation
        if (state.conversationId && payload.new.conversation_id === state.conversationId) {
          onNewMessage(payload.new);
        } else {
          // Just refresh the list to update previews
          refreshList();
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'private_messages' }, (payload) => {
        if (state.conversationId) {
          state.messages = state.messages.filter(m => m.id !== payload.old.id);
          renderConversation();
        }
      })
      .subscribe();

    // Check URL for ?dm=USER_ID
    const params = new URLSearchParams(window.location.search);
    const dmUserId = params.get('dm');
    if (dmUserId) {
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => openConversationWith(dmUserId), 300);
    }
  }

  function emptyConversation() {
    const wrap = document.createElement('section');
    wrap.className = 'room-main';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    const empty = UI.emptyState('Select a conversation or message someone from a room\'s Members tab.', { title: 'No conversation selected', icon: '🔒' });
    wrap.appendChild(empty);
    return wrap;
  }

  async function refreshList() {
    const body = document.getElementById('dmListBody');
    if (!body) return;
    Utils.clear(body);
    try {
      const convs = await LR.listPrivateConversations();
      if (!convs.length) {
        body.appendChild(UI.emptyState('No private conversations yet. Start one from a room\'s Members tab.', { title: 'No messages', icon: '💬' }));
        return;
      }
      const { data: { user } } = await LR.getUser();
      state.myUserId = user?.id;
      for (const c of convs) {
        body.appendChild(renderConversationRow(c));
      }
    } catch (e) {
      body.appendChild(UI.emptyState('Could not load conversations.', { title: 'Error', icon: '⚠' }));
    }
  }

  function renderConversationRow(c) {
    const row = Utils.el('div', { class: 'dm-row' + (state.conversationId === c.conversation_id ? ' active' : ''), dataset: { id: c.conversation_id, otherId: c.other_user_id } });
    row.appendChild(UI.avatarNode({ full_name: c.other_full_name, username: c.other_username, avatar_url: c.other_avatar_url }, 'md'));
    row.appendChild(Utils.el('div', { class: 'dm-info' },
      Utils.el('div', { class: 'dm-name', text: c.other_full_name || c.other_username || 'Unknown' }),
      Utils.el('div', { class: 'dm-preview', text: c.last_message_at ? Utils.relativeTime(c.last_message_at) : 'Tap to open' })
    ));
    if (c.unread_count > 0) row.appendChild(Utils.el('span', { class: 'badge', text: String(c.unread_count) }));
    row.addEventListener('click', () => openConversation(c.conversation_id, c.other_user_id));
    return row;
  }

  async function openConversationWith(otherUserId) {
    UI.spinner('Setting up encrypted channel…');
    try {
      // Ensure other user has a public key
      const otherPub = await LR.getOtherPublicKey(otherUserId);
      if (!otherPub) {
        UI.hideSpinner();
        return UI.err('This person hasn\'t set up encrypted messaging yet. Ask them to log in and set up their profile.');
      }
      const convId = await LR.ensurePrivateConversation(otherUserId);
      UI.hideSpinner();
      openConversation(convId, otherUserId);
    } catch (e) {
      UI.hideSpinner();
      UI.err('Could not start conversation. ' + (e.message||''));
    }
  }

  async function openConversation(conversationId, otherUserId) {
    state.conversationId = conversationId;
    state.otherUserId = otherUserId;
    state.messages = [];
    state.cursor = null;
    state.hasMore = true;

    // Highlight row
    document.querySelectorAll('.dm-row').forEach(r => r.classList.toggle('active', r.dataset.id === conversationId));

    const wrap = document.getElementById('dmConvWrap');
    if (!wrap) return;
    Utils.clear(wrap);

    // Header
    const head = Utils.el('header', { class: 'room-main-head', style: { padding: '12px 20px' } });
    const backBtn = Utils.el('button', { class: 'icon-btn', 'aria-label': 'Back', style: { display: window.innerWidth < 880 ? 'inline-flex' : 'none' } });
    backBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    backBtn.addEventListener('click', () => { state.conversationId = null; state.otherUserId = null; render(document.getElementById('view-messages')); });
    head.appendChild(backBtn);

    // Load other user's profile
    let otherProfile = null;
    try { otherProfile = await LR.getProfile(otherUserId); } catch {}
    head.appendChild(UI.avatarNode(otherProfile || {}, 'sm'));
    head.appendChild(Utils.el('div', { class: 'room-main-head-info' },
      Utils.el('h3', { text: otherProfile?.full_name || otherProfile?.username || 'Unknown' }),
      Utils.el('p', { text: otherProfile?.is_online ? 'Online · 🔒 End-to-end encrypted' : '🔒 End-to-end encrypted' })
    ));
    head.appendChild(Utils.el('div', { class: 'room-main-actions' },
      Utils.el('button', { class: 'icon-btn', title: 'View profile', onclick: () => App.openProfile(otherUserId) },
        svgEl('<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', 20)
      )
    ));
    wrap.appendChild(head);

    // Chat host
    const chatHost = Utils.el('div', { class: 'chat-host' });
    const messagesWrap = Utils.el('div', { class: 'chat-messages', id: 'dmMessages' });
    messagesWrap.addEventListener('scroll', () => {
      if (messagesWrap.scrollTop < 60 && state.hasMore && !state.loading) loadOlderPM();
    });
    chatHost.appendChild(messagesWrap);

    // Input
    const inputWrap = Utils.el('div', { class: 'chat-input-wrap' });
    const replyPreview = Utils.el('div', { class: 'chat-reply-preview', id: 'pmReplyPreview', style: { display: 'none' } });
    inputWrap.appendChild(replyPreview);

    const row = Utils.el('div', { class: 'chat-input-row', style: { position: 'relative' } });
    const textarea = Utils.el('textarea', { placeholder: 'Encrypted message…', rows: '1', style: { maxHeight: '120px' } });
    textarea.addEventListener('input', () => { textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'; });
    textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPM(); } });
    row.appendChild(textarea);

    const emojiBtn = Utils.el('button', { class: 'chat-attach-btn', 'aria-label': 'Emoji' });
    emojiBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/><path d="M9 14c1 1 5 1 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    row.appendChild(emojiBtn);

    const sendBtn = Utils.el('button', { class: 'chat-send-btn', 'aria-label': 'Send' });
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12l16-8-6 16-3-7-7-1z" fill="currentColor"/></svg>';
    sendBtn.addEventListener('click', sendPM);
    row.appendChild(sendBtn);

    inputWrap.appendChild(row);
    chatHost.appendChild(inputWrap);
    wrap.appendChild(chatHost);

    // Load messages
    await loadPMInitial();
    setTimeout(() => textarea.focus(), 100);
  }

  async function loadPMInitial() {
    state.loading = true;
    const wrap = document.getElementById('dmMessages');
    if (wrap) {
      Utils.clear(wrap);
      for (let i = 0; i < 3; i++) {
        const s = Utils.el('div', { class: 'msg' });
        s.appendChild(Utils.el('div', { class: 'avatar avatar-md skeleton' }));
        const body = Utils.el('div', { class: 'msg-body', style: { width: '60%' } });
        body.appendChild(Utils.el('div', { class: 'skeleton', style: { width: '40%', height: '14px', marginBottom: '6px' } }));
        body.appendChild(Utils.el('div', { class: 'skeleton', style: { width: '100%', height: '40px' } }));
        s.appendChild(body);
        wrap.appendChild(s);
      }
    }
    try {
      const rows = await LR.listPrivateMessages(state.conversationId);
      // Decrypt each
      const otherPub = await LR.getOtherPublicKey(state.otherUserId);
      const decrypted = [];
      for (const r of rows) {
        const dec = await LinkRoomCrypto.decryptMessage(
          r.ciphertext, r.iv,
          await LinkRoomCrypto.getSharedKeyFor(otherPub, state.otherUserId),
          r.encrypted_meta, r.meta_iv
        );
        decrypted.push({ ...r, body: dec?.plaintext || '[Unable to decrypt]', attachment: dec?.meta?.attachment || null });
      }
      state.messages = decrypted;
      state.cursor = rows.length ? rows[0].created_at : null;
      if (rows.length < 50) state.hasMore = false;
      renderConversation();

      // Mark as read
      await LR.markPrivateRead(state.conversationId);
      // Refresh list to clear unread badge
      refreshList();
    } catch (e) {
      if (wrap) {
        Utils.clear(wrap);
        wrap.appendChild(UI.emptyState('Could not load messages. ' + (e.message||''), { title: 'Error', icon: '⚠' }));
      }
    } finally {
      state.loading = false;
    }
  }

  async function loadOlderPM() {
    if (!state.cursor) return;
    state.loading = true;
    const wrap = document.getElementById('dmMessages');
    const prevH = wrap?.scrollHeight || 0;
    const prevT = wrap?.scrollTop || 0;
    try {
      const rows = await LR.listPrivateMessages(state.conversationId, state.cursor);
      if (rows.length < 50) state.hasMore = false;
      const otherPub = await LR.getOtherPublicKey(state.otherUserId);
      const decrypted = [];
      for (const r of rows) {
        const dec = await LinkRoomCrypto.decryptMessage(
          r.ciphertext, r.iv,
          await LinkRoomCrypto.getSharedKeyFor(otherPub, state.otherUserId),
          r.encrypted_meta, r.meta_iv
        );
        decrypted.push({ ...r, body: dec?.plaintext || '[Unable to decrypt]', attachment: dec?.meta?.attachment || null });
      }
      state.messages = [...decrypted, ...state.messages];
      state.cursor = rows.length ? rows[0].created_at : null;
      renderConversation();
      requestAnimationFrame(() => { if (wrap) wrap.scrollTop = prevT + (wrap.scrollHeight - prevH); });
    } catch (e) {
      UI.err('Could not load older messages.');
    } finally {
      state.loading = false;
    }
  }

  function renderConversation() {
    const wrap = document.getElementById('dmMessages');
    if (!wrap) return;
    Utils.clear(wrap);
    if (!state.messages.length) {
      wrap.appendChild(UI.emptyState('Say hello! Your messages are end-to-end encrypted — only you and your contact can read them.', { title: 'No messages yet', icon: '🔒' }));
      return;
    }
    for (const m of state.messages) wrap.appendChild(renderPM(m));
    scrollBottomPM();
  }

  function renderPM(m) {
    const isMine = state.myUserId && m.sender_id === state.myUserId;
    const wrap = Utils.el('div', { class: 'msg' + (isMine ? ' mine' : '') });
    const senderName = isMine ? 'You' : 'Them';
    // Avatar: only show for other side (since we know who they are)
    if (!isMine) {
      // Avatar from other profile; for simplicity use initials placeholder
      const av = Utils.el('div', { class: 'avatar avatar-md placeholder', text: '🔒' });
      wrap.appendChild(av);
    }
    const body = Utils.el('div', { class: 'msg-body' });
    body.appendChild(Utils.el('div', { class: 'msg-meta' },
      Utils.el('span', { class: 'msg-sender', text: senderName }),
      Utils.el('span', { text: Utils.fmtTime(m.created_at) })
    ));
    const msgWrap = Utils.el('div', { class: 'msg-wrap' });
    const bubble = Utils.el('div', { class: 'msg-bubble' });
    if (m.body) {
      const p = Utils.el('div');
      p.innerHTML = Utils.linkify(m.body);
      bubble.appendChild(p);
    }
    if (m.attachment) {
      if (m.attachment.type && m.attachment.type.startsWith('image/')) {
        const imgWrap = Utils.el('a', { class: 'msg-attachment', href: m.attachment.url, target: '_blank', rel: 'noopener' });
        imgWrap.appendChild(Utils.el('img', { src: m.attachment.thumbnail_url || m.attachment.url, alt: m.attachment.name || '' }));
        bubble.appendChild(imgWrap);
      } else {
        const fileWrap = Utils.el('a', { class: 'msg-attachment file', href: m.attachment.url, target: '_blank', rel: 'noopener' });
        fileWrap.appendChild(Utils.el('span', { text: '📄' }));
        fileWrap.appendChild(Utils.el('span', { text: m.attachment.name || 'file' }));
        bubble.appendChild(fileWrap);
      }
    }
    msgWrap.appendChild(bubble);
    body.appendChild(msgWrap);
    wrap.appendChild(body);
    return wrap;
  }

  async function sendPM() {
    const textarea = document.querySelector('#dmConvWrap .chat-input-row textarea');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    textarea.style.height = 'auto';

    const replyTo = state.replyTo;
    state.replyTo = null;
    const preview = document.getElementById('pmReplyPreview');
    if (preview) preview.style.display = 'none';

    // Optimistic insert
    const tempId = 'tmp_' + Date.now();
    state.messages.push({
      id: tempId,
      sender_id: state.myUserId,
      body: text,
      attachment: null,
      reply_to_id: replyTo?.id || null,
      created_at: new Date().toISOString()
    });
    renderConversation();
    scrollBottomPM();

    try {
      const sent = await LR.sendPrivateMessage(state.conversationId, state.otherUserId, text, null);
      const idx = state.messages.findIndex(m => m.id === tempId);
      if (idx >= 0) state.messages[idx] = { ...sent, body: text, attachment: null };
      renderConversation();
    } catch (e) {
      UI.err('Could not send message. ' + (e.message||''));
      state.messages = state.messages.filter(m => m.id !== tempId);
      renderConversation();
    }
  }

  async function onNewMessage(payload) {
    if (state.messages.find(m => m.id === payload.id)) return;
    try {
      const otherPub = await LR.getOtherPublicKey(state.otherUserId);
      const dec = await LinkRoomCrypto.decryptMessage(
        payload.ciphertext, payload.iv,
        await LinkRoomCrypto.getSharedKeyFor(otherPub, state.otherUserId),
        payload.encrypted_meta, payload.meta_iv
      );
      state.messages.push({ ...payload, body: dec?.plaintext || '[Unable to decrypt]', attachment: dec?.meta?.attachment || null });
      renderConversation();
      scrollBottomPM();
      await LR.markPrivateRead(state.conversationId);
      refreshList();
    } catch (e) {
      console.warn('Could not decrypt new message:', e);
    }
  }

  function scrollBottomPM() {
    const wrap = document.getElementById('dmMessages');
    if (wrap) requestAnimationFrame(() => { wrap.scrollTop = wrap.scrollHeight; });
  }

  function svgEl(inner, size) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size); s.setAttribute('height', size);
    s.innerHTML = inner;
    return s;
  }

  function unmount() {
    if (state.subscription) { LR.removeChannel(state.subscription); state.subscription = null; }
  }

  return { render, openConversationWith, unmount };
})();
