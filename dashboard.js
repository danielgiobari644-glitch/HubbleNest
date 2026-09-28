/* =============================================================
   LinkRoom — Dashboard
   ============================================================= */

window.Dashboard = (function () {
  'use strict';

  let currentFilter = 'all';

  async function render() {
    const container = document.getElementById('view-dashboard');
    if (!container) return;
    Utils.clear(container);

    const wrap = Utils.el('div', { class: 'view-dashboard-inner', style: { flex: '1', overflow: 'auto' } });

    const head = Utils.el('div', { class: 'dash-head' });
    head.appendChild(Utils.el('div', null,
      Utils.el('h2', { text: 'Your Rooms' }),
      Utils.el('p', { id: 'dashSubtitle', text: 'Pick up where you left off.' })
    ));
    head.appendChild(Utils.el('div', { class: 'row gap-sm' },
      Utils.el('button', { class: 'btn btn-primary btn-sm', id: 'dashCreate', onclick: () => Rooms.openCreateModal() },
        plusIcon(), 'Create Room'
      ),
      Utils.el('button', { class: 'btn btn-secondary btn-sm', id: 'dashJoin', onclick: () => Rooms.openJoinModal() },
        joinIcon(), 'Join Room'
      )
    ));
    wrap.appendChild(head);

    const stats = Utils.el('div', { class: 'dash-stats' });
    for (let i = 0; i < 3; i++) stats.appendChild(Utils.el('div', { class: 'skeleton', style: { height: '78px', borderRadius: '14px' } }));
    wrap.appendChild(stats);

    // Filter chips
    const filters = Utils.el('div', { class: 'filter-chips', style: { marginBottom: '12px' } });
    for (const [k, label] of Object.entries({ all: 'All', admin: 'As Admin', member: 'As Member', permanent: 'Permanent', temporary: 'Temporary' })) {
      const c = Utils.el('button', { class: 'chip' + (currentFilter === k ? ' active' : ''), dataset: { filter: k }, text: label });
      c.addEventListener('click', () => { currentFilter = k; render(); });
      filters.appendChild(c);
    }
    wrap.appendChild(filters);

    // Grid
    const gridWrap = Utils.el('div', { class: 'room-grid', id: 'dashGrid' });
    for (let i = 0; i < 6; i++) gridWrap.appendChild(Utils.el('div', { class: 'skeleton-card' }));
    wrap.appendChild(gridWrap);

    container.appendChild(wrap);

    // Load data
    try {
      const rooms = await LR.listMyRooms();
      renderStats(stats, rooms);
      renderRooms(gridWrap, rooms);
      const subtitle = document.getElementById('dashSubtitle');
      if (subtitle) {
        if (!rooms.length) subtitle.textContent = 'Create or join a room to get started.';
        else subtitle.textContent = `${rooms.length} room${rooms.length === 1 ? '' : 's'} · pick up where you left off.`;
      }
    } catch (e) {
      Utils.clear(gridWrap);
      gridWrap.appendChild(UI.emptyState('Could not load your rooms. ' + (e.message||''), { title: 'Something went wrong', icon: '⚠' }));
    }
  }

  function renderStats(stats, rooms) {
    Utils.clear(stats);
    const adminRooms = rooms.filter(r => r.my_role === 'admin').length;
    const totalMembers = rooms.length; // Placeholder: accurate count would need additional fetch
    const expiring = rooms.filter(r => r.room_type === 'temporary' && r.expires_at && !r.expired && new Date(r.expires_at) > new Date() && new Date(r.expires_at) - new Date() < 86400000 * 3).length;

    stats.appendChild(statCard('🏠', rooms.length, 'Total rooms'));
    stats.appendChild(statCard('👑', adminRooms, 'As admin'));
    stats.appendChild(statCard('⏰', expiring, 'Expiring soon'));
  }

  function statCard(icon, value, label) {
    const card = Utils.el('div', { class: 'stat-card' });
    card.appendChild(Utils.el('div', { class: 'stat-icon', text: icon }));
    card.appendChild(Utils.el('div', { class: 'stat-meta' },
      Utils.el('div', { class: 'stat-value', text: String(value) }),
      Utils.el('div', { class: 'stat-label', text: label })
    ));
    return card;
  }

  function renderRooms(gridWrap, rooms) {
    Utils.clear(gridWrap);

    let filtered = rooms;
    if (currentFilter !== 'all') {
      if (currentFilter === 'admin')     filtered = filtered.filter(r => r.my_role === 'admin');
      if (currentFilter === 'member')   filtered = filtered.filter(r => r.my_role !== 'admin');
      if (currentFilter === 'permanent')filtered = filtered.filter(r => r.room_type === 'permanent');
      if (currentFilter === 'temporary')filtered = filtered.filter(r => r.room_type === 'temporary');
    }

    if (!filtered.length) {
      gridWrap.appendChild(UI.emptyState(
        'Your rooms will appear here. Create or join one to get started.',
        { title: 'No rooms yet', icon: '🏠', actionLabel: 'Create your first room', action: () => Rooms.openCreateModal() }
      ));
      return;
    }

    // Sort: by last activity (currently by created_at desc — could refine)
    filtered.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

    for (const room of filtered) gridWrap.appendChild(renderCard(room));
  }

  function renderCard(room) {
    const card = Utils.el('div', { class: 'room-card reveal', dataset: { id: room.id } });

    const banner = Utils.el('div', { class: 'room-card-banner' });
    if (room.image_url) {
      banner.appendChild(Utils.el('img', { src: room.image_url, alt: '' }));
    }
    // Status badge
    let badgeText = '', badgeClass = '';
    if (room.expired) { badgeText = 'Expired'; badgeClass = 'expired'; }
    else if (room.room_type === 'temporary' && room.expires_at) {
      badgeText = Utils.fmtRemaining(room.expires_at);
      badgeClass = 'temporary';
    }
    if (badgeText) banner.appendChild(Utils.el('div', { class: 'room-card-badge ' + badgeClass, text: badgeText }));
    card.appendChild(banner);

    const body = Utils.el('div', { class: 'room-card-body' });
    body.appendChild(Utils.el('div', { class: 'room-card-name', text: room.name }));
    if (room.description) body.appendChild(Utils.el('div', { class: 'room-card-desc', text: room.description }));

    const meta = Utils.el('div', { class: 'room-card-meta' });
    meta.appendChild(Utils.el('div', { class: 'room-card-meta-item' },
      Utils.el('span', { class: 'room-card-role-' + (room.my_role === 'admin' ? 'admin' : 'member'), text: room.my_role === 'admin' ? '👑 Admin' : 'Member' })
    ));
    meta.appendChild(Utils.el('div', { class: 'room-card-meta-item', text: '· ' + Utils.relativeTime(room.created_at) }));
    body.appendChild(meta);

    card.appendChild(body);

    card.addEventListener('click', () => App.openRoom(room.id));
    return card;
  }

  function plusIcon() {
    const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
    s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('width','16'); s.setAttribute('height','16');
    s.innerHTML = '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
    return s;
  }
  function joinIcon() {
    const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
    s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('width','16'); s.setAttribute('height','16');
    s.innerHTML = '<path d="M4 12h16M14 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    return s;
  }

  return { render };
})();
