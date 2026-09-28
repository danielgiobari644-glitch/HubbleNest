/* =============================================================
   LinkRoom — App Shell Controller
   Orchestrates: routing, sidebar, profile chip, room open,
   realtime notifications, theme toggle, mobile sidebar.
   ============================================================= */

window.App = (function () {
  'use strict';

  let state = {
    profile: null,
    currentRoom: null,
    currentRoomMembership: null,
    currentView: 'dashboard',
    roomSubscriptions: []
  };

  // ---------- Boot ----------
  async function init() {
    const savedTheme = Utils.ls.get('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    document.getElementById('year') && (document.getElementById('year').textContent = new Date().getFullYear());

    // Show loading screen
    const loading = document.getElementById('loadingScreen');
    const shell = document.getElementById('appShell');

    try {
      const { data: { session } } = await LR.getSession();
      if (!session) {
        window.location.replace('index.html');
        return;
      }

      // Load profile
      state.profile = await LR.getCurrentProfile();

      if (!state.profile || !state.profile.full_name || !state.profile.username) {
        // Onboarding gate
        loading.hidden = true;
        await Profile.initOnboardingGate();
        // Wait until they finish onboarding; we won't proceed further
        return;
      }

      // Ensure crypto identity exists
      const hasCrypto = await LinkRoomCrypto.hasIdentity();
      if (!hasCrypto) {
        const pubB64 = await LinkRoomCrypto.ensureIdentity();
        await LR.upsertProfile({ public_key: pubB64, is_online: true, last_seen: new Date().toISOString() });
      } else {
        // Mark online
        const pubB64 = await LinkRoomCrypto.getPublicB64();
        await LR.client.from('profiles').update({
          is_online: true, last_seen: new Date().toISOString(),
          public_key: pubB64 || state.profile.public_key
        }).eq('id', state.profile.id);
      }

      // Show app
      loading.hidden = true;
      shell.hidden = false;

      // Wire UI
      wireUI();
      updateProfileChip();

      // Initial route
      await Notifications.refreshUnread();
      Notifications.subscribe();
      heartbeat();
      window.addEventListener('beforeunload', () => {
        try { LR.client.from('profiles').update({ is_online: false, last_seen: new Date().toISOString() }).eq('id', state.profile.id); } catch {}
      });

      // Initial view = dashboard
      await Dashboard.render();

      // Handle URL: ?join=TOKEN or ?dm=USER_ID
      const params = new URLSearchParams(window.location.search);
      if (params.get('join')) { await Rooms.handleJoinToken(); }
      if (params.get('dm'))   { navigateTo('messages'); }
    } catch (e) {
      console.error('Boot error:', e);
      loading.hidden = true;
      UI.err('Could not start LinkRoom. ' + (e.message||''));
    }
  }

  function heartbeat() {
    // Update last_seen every 60s while active
    setInterval(() => {
      if (!state.profile) return;
      try { LR.client.from('profiles').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', state.profile.id); } catch {}
    }, 60000);
    // On page hidden → set offline
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.profile) {
        try { LR.client.from('profiles').update({ is_online: false, last_seen: new Date().toISOString() }).eq('id', state.profile.id); } catch {}
      } else if (state.profile) {
        try { LR.client.from('profiles').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', state.profile.id); } catch {}
      }
    });
  }

  // ---------- Wire up UI ----------
  function wireUI() {
    // Sidebar nav
    document.querySelectorAll('.sidebar .nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(item.dataset.view);
      });
    });

    // Bottom nav
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
      item.addEventListener('click', () => navigateTo(item.dataset.view));
    });

    // Create/Join buttons
    const cb = document.getElementById('createRoomBtn'); if (cb) cb.addEventListener('click', () => Rooms.openCreateModal());
    const jb = document.getElementById('joinRoomBtn');   if (jb) jb.addEventListener('click', () => Rooms.openJoinModal());
    const sb = document.getElementById('searchTopBtn'); if (sb) sb.addEventListener('click', () => navigateTo('search'));
    const nb = document.getElementById('notifTopBtn');   if (nb) nb.addEventListener('click', () => navigateTo('notifications'));

    // Sidebar profile
    const pc = document.getElementById('profileChip'); if (pc) pc.addEventListener('click', () => navigateTo('profile'));
    const ph = document.getElementById('dashboardHome'); if (ph) ph.addEventListener('click', (e) => { e.preventDefault(); navigateTo('dashboard'); });

    // Theme toggle
    const tt = document.getElementById('themeToggleApp'); if (tt) tt.addEventListener('click', toggleTheme);

    // Mobile sidebar
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    const close = document.getElementById('sidebarClose');
    if (toggle && sidebar) toggle.addEventListener('click', () => {
      sidebar.classList.add('open');
      if (backdrop) backdrop.style.display = 'block';
    });
    if (close && sidebar) close.addEventListener('click', () => {
      sidebar.classList.remove('open');
      if (backdrop) backdrop.style.display = 'none';
    });
    if (backdrop) backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.style.display = 'none';
    });
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    Utils.ls.set('theme', cur);
  }

  function updateProfileChip() {
    if (!state.profile) return;
    const av = document.getElementById('profileAvatar');
    if (av) {
      if (state.profile.avatar_url) { av.src = state.profile.avatar_url; av.style.display = ''; }
      else { av.style.display = 'none'; }
    }
    const name = document.getElementById('profileChipName'); if (name) name.textContent = state.profile.full_name;
    const handle = document.getElementById('profileChipHandle'); if (handle) handle.textContent = '@' + state.profile.username;
  }

  function refreshProfileChip() {
    LR.getCurrentProfile().then(p => { state.profile = p; updateProfileChip(); });
  }

  // ---------- Navigation ----------
  function navigateTo(view, opts) {
    state.currentView = view;

    // Update active states
    document.querySelectorAll('.sidebar .nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
    document.querySelectorAll('.bottom-nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));

    // Show target view
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + view);
    if (target) target.classList.add('active');

    // Topbar title
    const titleMap = { dashboard: 'Dashboard', messages: 'Messages', notifications: 'Notifications', search: 'Search', profile: 'Profile', room: 'Room' };
    const t = document.getElementById('topbarTitle');
    if (t) t.textContent = titleMap[view] || titleMap.dashboard;

    // Mobile: close sidebar
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.style.display = 'none';

    // Render view
    if (view === 'dashboard') Dashboard.render();
    else if (view === 'notifications') Notifications.renderView(target);
    else if (view === 'search') Search.renderView(target, opts && opts.query);
    else if (view === 'profile') Profile.renderMyProfile(target);
    else if (view === 'messages') PrivateChat.render(target);
  }

  // ---------- Open a room ----------
  async function openRoom(roomId) {
    navigateTo('room');
    const target = document.getElementById('view-room');
    Utils.clear(target);

    try {
      const room = await LR.getRoom(roomId);
      if (!room) { UI.err('This room is no longer available.'); navigateTo('dashboard'); return; }
      state.currentRoom = room;

      // Get my role
      const { data: { user } } = await LR.getUser();
      const { data: mem } = await LR.client.from('room_memberships').select('role, last_read_at').eq('room_id', roomId).eq('user_id', user.id).maybeSingle();
      const role = mem?.role || 'member';
      state.currentRoomMembership = { role };

      renderRoomShell(target, room, role);

      // Check expired
      if (room.expired || (room.room_type === 'temporary' && room.expires_at && new Date(room.expires_at) < new Date())) {
        target.appendChild(Utils.el('div', { class: 'empty-state', style: { marginTop: '20px' } },
          Utils.el('div', { class: 'empty-state-icon', text: '⏰' }),
          Utils.el('h3', { text: 'This room has expired' }),
          Utils.el('p', { text: 'Members can still view content. Admins can extend the room to reactivate it.' })
        ));
        if (role === 'admin') {
          target.appendChild(Utils.el('button', { class: 'btn btn-primary', text: 'Extend room', style: { margin: '0 auto', display: 'flex' }, onclick: () => Rooms.openExtendModal(room, () => openRoom(roomId)) }));
        }
      }
    } catch (e) {
      UI.err('Could not open room. ' + (e.message||''));
      navigateTo('dashboard');
    }
  }

  function renderRoomShell(target, room, role) {
    const layout = Utils.el('div', { class: 'room-layout' });

    // Left: room info + tabs
    const side = Utils.el('aside', { class: 'room-side' });
    const sideHead = Utils.el('div', { class: 'room-side-head' });
    sideHead.appendChild(Utils.el('button', { class: 'room-back-btn', onclick: () => navigateTo('dashboard') },
      svgIcon('<path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>', 16),
      'Back to dashboard'
    ));
    sideHead.appendChild(Utils.el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '12px', marginTop: '8px' } },
      Utils.el('div', { style: { width: '52px', height: '52px', borderRadius: '14px', overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, var(--accent-2), var(--accent))' } },
        room.image_url ? Utils.el('img', { src: room.image_url, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : null
      ),
      Utils.el('div', null,
        Utils.el('h3', { text: room.name }),
        room.description ? Utils.el('div', { class: 'room-desc', text: room.description }) : null,
        Utils.el('div', { class: 'row gap-sm', style: { marginTop: '6px' } },
          Utils.el('span', { class: 'chip' + (room.room_type === 'temporary' ? '' : ' active'), text: room.room_type === 'temporary' ? '⏰ Temporary' : '∞ Permanent' }),
          role === 'admin' ? Utils.el('span', { class: 'chip active', text: '👑 You\'re admin' }) : null
        ),
        (room.room_type === 'temporary' && room.expires_at && !room.expired)
          ? Utils.el('div', { class: 'text-muted text-sm', style: { marginTop: '6px' }, text: Utils.fmtRemaining(room.expires_at) })
          : null
      )
    ));
    side.appendChild(sideHead);

    // Tabs
    const tabs = Utils.el('div', { class: 'room-tabs' });
    for (const t of [
      { id: 'chat', label: 'Chat' },
      { id: 'files', label: 'Files' },
      { id: 'links', label: 'Links' },
      { id: 'announcements', label: 'Announcements' },
      { id: 'members', label: 'Members' }
    ]) {
      const tab = Utils.el('button', { class: 'room-tab', dataset: { tab: t.id }, text: t.label });
      tab.addEventListener('click', () => switchTab(t.id, room, role));
      tabs.appendChild(tab);
    }
    // Admin tab: settings
    if (role === 'admin') {
      const t = Utils.el('button', { class: 'room-tab', dataset: { tab: 'settings' }, text: '⚙ Settings' });
      t.addEventListener('click', () => switchTab('settings', room, role));
      tabs.appendChild(t);
    }
    side.appendChild(tabs);

    // Panels
    const chatPanel    = Utils.el('div', { class: 'room-tab-panel active', id: 'panel-chat' });
    const filesPanel   = Utils.el('div', { class: 'room-tab-panel', id: 'panel-files' });
    const linksPanel   = Utils.el('div', { class: 'room-tab-panel', id: 'panel-links' });
    const annPanel     = Utils.el('div', { class: 'room-tab-panel', id: 'panel-announcements' });
    const membersPanel = Utils.el('div', { class: 'room-tab-panel', id: 'panel-members' });
    const settingsPanel= Utils.el('div', { class: 'room-tab-panel', id: 'panel-settings', style: { padding: '20px', overflowY: 'auto' } });
    side.appendChild(chatPanel);
    side.appendChild(filesPanel);
    side.appendChild(linksPanel);
    side.appendChild(annPanel);
    side.appendChild(membersPanel);
    side.appendChild(settingsPanel);

    // Right: contextual info / room menu
    // (For chat tab, chat panel fills the room-main area; for others, use right side)
    const main = Utils.el('section', { class: 'room-main', id: 'roomMain' });
    main.appendChild(Utils.el('div', { class: 'empty-state' },
      Utils.el('div', { class: 'empty-state-icon', text: '←' }),
      Utils.el('h3', { text: 'Pick a tab' }),
      Utils.el('p', { text: 'Choose what you want to see in this room.' })
    ));

    layout.appendChild(side);
    layout.appendChild(main);
    target.appendChild(layout);

    // Auto-open Chat tab
    switchTab('chat', room, role);
  }

  let activeTab = null;
  async function switchTab(tabId, room, role) {
    if (activeTab === tabId) return;
    activeTab = tabId;
    document.querySelectorAll('.room-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.room-tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('panel-' + tabId);
    if (panel) panel.classList.add('active');

    // Set main content based on tab
    const main = document.getElementById('roomMain');
    Utils.clear(main);

    // Move panel content into main on desktop, or expand on mobile (handled by CSS)
    // We'll show the panel content inside main
    if (tabId === 'chat') {
      // For chat, use main as the chat container
      await Chat.mount(main, room.id);
      Chat.currentRoomRole = role;
    } else if (tabId === 'files') {
      await Files.mount(main, room.id);
    } else if (tabId === 'links') {
      await Links.mount(main, room.id);
    } else if (tabId === 'announcements') {
      await Announcements.mount(main, room.id, role === 'admin');
    } else if (tabId === 'members') {
      Members.setRoom(room);
      await Members.mount(main, room.id, role === 'admin');
    } else if (tabId === 'settings') {
      renderSettings(main, room, role);
    }
  }

  function renderSettings(container, room, role) {
    Utils.clear(container);
    container.appendChild(Utils.el('div', { class: 'dash-head', style: { marginBottom: '16px' } },
      Utils.el('div', null,
        Utils.el('h2', { text: 'Room Settings' }),
        Utils.el('p', { class: 'text-muted', text: 'Manage this room.' })
      )
    ));

    const sections = Utils.el('div', { class: 'col gap-md' });

    // Quick actions
    const quickRow = Utils.el('div', { class: 'row wrap gap-sm' });
    quickRow.appendChild(Utils.el('button', { class: 'btn btn-secondary btn-sm', onclick: () => Rooms.showRoomQr(room) }, 'Share room / QR'));
    if (room.room_type === 'temporary') {
      quickRow.appendChild(Utils.el('button', { class: 'btn btn-secondary btn-sm', onclick: () => Rooms.openExtendModal(room, () => openRoom(room.id)) }, 'Extend expiration'));
    }
    quickRow.appendChild(Utils.el('button', { class: 'btn btn-danger btn-sm', onclick: () => Rooms.confirmDelete(room, () => navigateTo('dashboard')) }, 'Delete room'));
    sections.appendChild(quickRow);

    // Edit form
    sections.appendChild(Utils.el('h3', { style: { marginTop: '12px' }, text: 'Edit details' }));
    const form = Utils.el('form', { class: 'profile-edit-form' });

    // Image
    let imageFile = null;
    const imgWrap = Utils.el('div', { class: 'avatar-uploader' });
    const circle = Utils.el('label', { class: 'avatar-uploader-circle', for: 'roomImg', style: { width: '80px', height: '80px', borderRadius: '16px' } });
    if (room.image_url) circle.appendChild(Utils.el('img', { src: room.image_url, alt: '', style: { width: '80px', height: '80px', objectFit: 'cover', borderRadius: '16px' } }));
    else circle.appendChild(Utils.el('div', { class: 'avatar', style: { width: '80px', height: '80px', borderRadius: '16px' }, text: '🖼' }));
    circle.appendChild(Utils.el('span', { class: 'avatar-uploader-edit' }));
    const imgInput = Utils.el('input', { type: 'file', accept: 'image/*', id: 'roomImg', hidden: true });
    imgInput.addEventListener('change', () => {
      const f = imgInput.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { UI.err('Image must be under 5 MB.'); return; }
      imageFile = f;
    });
    imgWrap.appendChild(circle); imgWrap.appendChild(imgInput);
    form.appendChild(imgWrap);

    const nameField = makeField('Room name', 'text', room.name);
    form.appendChild(nameField.wrap);
    const descField = makeField('Description', 'text', room.description || '');
    form.appendChild(descField.wrap);
    const mottoField = makeField('Motto', 'text', room.motto || '');
    form.appendChild(mottoField.wrap);
    const catField = makeField('Category', 'text', room.category || '');
    form.appendChild(catField.wrap);

    const saveBtn = Utils.el('button', { class: 'btn btn-primary', text: 'Save changes', onclick: async (e) => {
      e.preventDefault();
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        let imageUrl = room.image_url;
        if (imageFile) { UI.spinner('Uploading image…'); imageUrl = await StorageRouter.uploadImage(imageFile); UI.hideSpinner(); }
        await LR.updateRoom(room.id, {
          name: nameField.input.value.trim() || room.name,
          description: descField.input.value.trim() || null,
          motto: mottoField.input.value.trim() || null,
          category: catField.input.value.trim() || null,
          image_url: imageUrl
        });
        UI.ok('Room updated.');
        openRoom(room.id);
      } catch (err) { UI.err('Could not save. ' + (err.message||'')); saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
    }});
    form.appendChild(saveBtn);
    sections.appendChild(form);

    container.appendChild(sections);
  }

  function makeField(label, type, value) {
    const wrap = Utils.el('div', { class: 'field' });
    wrap.appendChild(Utils.el('label', { text: label }));
    const input = Utils.el('input', { type, value: value || '' });
    wrap.appendChild(input);
    return { wrap, input };
  }

  function svgIcon(inner, size) {
    const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
    s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.innerHTML = inner;
    return s;
  }

  // ---------- Open profile (member) ----------
  function openProfile(userId) {
    navigateTo('profile');
    const target = document.getElementById('view-profile');
    Profile.renderMemberProfile(target, userId);
  }

  // ---------- Open DM ----------
  function openDM(userId) {
    navigateTo('messages');
    setTimeout(() => PrivateChat.openConversationWith(userId), 200);
  }

  // ---------- Sign out ----------
  async function signOut() {
    const ok = await UI.confirm({
      title: 'Sign out?',
      message: 'You\'ll need to sign in again to access your rooms.',
      confirmLabel: 'Sign out',
      size: 'modal-sm'
    });
    if (!ok) return;
    UI.spinner('Signing out…');
    try {
      // Mark offline
      if (state.profile) {
        try { await LR.client.from('profiles').update({ is_online: false, last_seen: new Date().toISOString() }).eq('id', state.profile.id); } catch {}
      }
      await LR.signOut();
      window.location.replace('index.html');
    } catch (e) {
      UI.hideSpinner();
      UI.err('Could not sign out. ' + (e.message||''));
    }
  }

  return {
    init,
    navigateTo,
    openRoom,
    openProfile,
    openDM,
    signOut,
    refreshProfileChip,
    get profile() { return state.profile; },
    get currentRoom() { return state.currentRoom; }
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
