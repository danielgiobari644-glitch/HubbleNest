/* =============================================================
   LinkRoom — Members & Join Requests
   ============================================================= */

window.Members = (function () {
  'use strict';

  let state = { roomId: null, container: null, isAdmin: false, members: [], myUserId: null };

  async function mount(container, roomId, isAdmin) {
    state.roomId = roomId;
    state.container = container;
    state.isAdmin = !!isAdmin;
    state.members = [];
    Utils.clear(container);

    const wrap = Utils.el('div', { class: 'files-host', style: { flex: '1', overflow: 'auto' } });

    const head = Utils.el('div', { class: 'dash-head', style: { marginBottom: '16px' } });
    head.appendChild(Utils.el('div', null,
      Utils.el('h2', { text: 'Members' }),
      Utils.el('p', { class: 'text-muted', text: 'People in this room.' })
    ));
    if (state.isAdmin) {
      head.appendChild(Utils.el('button', { class: 'btn btn-secondary btn-sm', onclick: () => Rooms.showRoomQr(state._room) },
        svgIcon('<path d="M3 9v6h4l5 5V4L7 9H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>', 14),
        'Invite'
      ));
    }
    wrap.appendChild(head);

    // Join requests (admin only)
    const requestsWrap = Utils.el('div', { id: 'requestsWrap' });
    wrap.appendChild(requestsWrap);

    // Members list
    const listWrap = Utils.el('div', { class: 'members-list', id: 'membersList' });
    for (let i = 0; i < 5; i++) listWrap.appendChild(Utils.el('div', { class: 'skeleton', style: { height: '56px' } }));
    wrap.appendChild(listWrap);

    container.appendChild(wrap);

    try {
      const { data: { user } } = await LR.getUser();
      state.myUserId = user?.id;
    } catch {}

    await loadMembers();
    if (state.isAdmin) await loadRequests();
  }

  function setRoom(room) {
    state._room = room;
  }

  async function loadMembers() {
    const list = document.getElementById('membersList');
    if (!list) return;
    Utils.clear(list);
    try {
      const members = await LR.getMembers(state.roomId);
      state.members = members;
      if (!members.length) {
        list.appendChild(UI.emptyState('No members yet.', { title: 'Empty', icon: '👥' }));
        return;
      }
      // Sort admins first, then alpha
      members.sort((a,b) => {
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (b.role === 'admin' && a.role !== 'admin') return 1;
        const an = (a.profile?.full_name || a.profile?.username || '').toLowerCase();
        const bn = (b.profile?.full_name || b.profile?.username || '').toLowerCase();
        return an.localeCompare(bn);
      });
      for (const m of members) list.appendChild(renderMember(m));
    } catch (e) {
      list.appendChild(UI.emptyState('Could not load members. ' + (e.message||''), { title: 'Error', icon: '⚠' }));
    }
  }

  function renderMember(m) {
    const row = Utils.el('div', { class: 'member-row', dataset: { id: m.user_id } });
    row.appendChild(UI.avatarNode(m.profile || {}, 'md'));
    row.appendChild(Utils.el('div', { class: 'member-info' },
      Utils.el('div', { class: 'member-name', text: m.profile?.full_name || m.profile?.username || 'Unknown' }),
      Utils.el('div', { class: 'member-handle', text: '@' + (m.profile?.username || '?') })
    ));

    row.appendChild(Utils.el('div', { class: 'member-status' },
      Utils.el('span', { class: 'online-dot' + (m.profile?.is_online ? '' : ' muted') }),
      Utils.el('span', { text: m.profile?.is_online ? 'Online' : Utils.relativeTime(m.profile?.last_seen) })
    ));

    if (m.role === 'admin') {
      row.appendChild(Utils.el('span', { class: 'member-role admin', text: 'ADMIN' }));
    } else if (state.isAdmin && m.user_id !== state.myUserId) {
      // Admin actions: message, remove
      const actions = Utils.el('div', { class: 'row gap-sm' });
      actions.appendChild(Utils.el('button', { class: 'icon-btn', title: 'Message privately', onclick: (e) => { e.stopPropagation(); App.openDM(m.user_id); } },
        svgIcon('<path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>', 18)
      ));
      actions.appendChild(Utils.el('button', { class: 'icon-btn', title: 'Remove member', onclick: async (e) => {
        e.stopPropagation();
        const ok = await UI.confirm({
          title: 'Remove member?',
          message: `Remove ${m.profile?.full_name || m.profile?.username || 'this member'} from the room?`,
          danger: true,
          confirmLabel: 'Remove',
          size: 'modal-sm'
        });
        if (!ok) return;
        try { await LR.removeMember(state.roomId, m.user_id); UI.ok('Member removed.'); loadMembers(); }
        catch (err) { UI.err('Could not remove member. ' + (err.message||'')); }
      } }, svgIcon('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>', 18)));
      row.appendChild(actions);
    } else if (m.user_id !== state.myUserId) {
      // Member can DM another member
      row.appendChild(Utils.el('button', { class: 'icon-btn', title: 'Message privately', onclick: (e) => { e.stopPropagation(); App.openDM(m.user_id); } },
        svgIcon('<path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>', 18)
      ));
    }
    row.addEventListener('click', () => App.openProfile(m.user_id));
    return row;
  }

  async function loadRequests() {
    const wrap = document.getElementById('requestsWrap');
    if (!wrap) return;
    Utils.clear(wrap);
    try {
      const reqs = await LR.getJoinRequests(state.roomId);
      if (!reqs.length) return;
      wrap.appendChild(Utils.el('h3', { style: { fontSize: '1rem', margin: '0 0 10px' }, text: 'Pending requests' }));
      for (const r of reqs) wrap.appendChild(renderRequest(r));
    } catch (e) {
      wrap.appendChild(Utils.el('p', { class: 'text-muted text-sm', text: 'Could not load requests: ' + (e.message||'') }));
    }
  }

  function renderRequest(r) {
    const row = Utils.el('div', { class: 'request-row', dataset: { id: r.id } });
    row.appendChild(UI.avatarNode(r.profile || {}, 'md'));
    row.appendChild(Utils.el('div', { class: 'member-info' },
      Utils.el('div', { class: 'member-name', text: r.profile?.full_name || r.profile?.username || 'Unknown' }),
      Utils.el('div', { class: 'member-handle', text: '@' + (r.profile?.username || '?') + ' · requested ' + Utils.relativeTime(r.created_at) })
    ));
    row.appendChild(Utils.el('button', { class: 'icon-btn', title: 'View profile', onclick: (e) => { e.stopPropagation(); App.openProfile(r.user_id); } },
      svgIcon('<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', 18)
    ));
    const actions = Utils.el('div', { class: 'request-actions' });
    actions.appendChild(Utils.el('button', { class: 'btn btn-danger btn-sm', text: 'Decline', onclick: async (e) => { e.stopPropagation(); await decide(r.id, 'declined'); } }));
    actions.appendChild(Utils.el('button', { class: 'btn btn-primary btn-sm', text: 'Accept', onclick: async (e) => { e.stopPropagation(); await decide(r.id, 'approved'); } }));
    row.appendChild(actions);
    return row;
  }

  async function decide(requestId, status) {
    try {
      await LR.decideJoinRequest(requestId, status);
      UI.ok(status === 'approved' ? 'Request approved.' : 'Request declined.');
      loadMembers();
      loadRequests();
    } catch (e) {
      UI.err('Could not respond to request. ' + (e.message||''));
    }
  }

  function amIAdmin(roomId) {
    if (state.roomId !== roomId) return false;
    return state.isAdmin;
  }

  function svgIcon(inner, size) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.innerHTML = inner;
    return s;
  }

  return { mount, setRoom, amIAdmin };
})();
