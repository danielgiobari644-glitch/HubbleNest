/* =============================================================
   LinkRoom — Global Search (rooms, members, messages, files, links)
   ============================================================= */

window.Search = (function () {
  'use strict';

  async function renderView(container, initialQuery) {
    Utils.clear(container);

    const wrap = Utils.el('div', { style: { padding: '24px 28px', flex: '1', overflow: 'auto' } });

    wrap.appendChild(Utils.el('div', { class: 'dash-head', style: { marginBottom: '20px' } },
      Utils.el('div', null,
        Utils.el('h2', { text: 'Search' }),
        Utils.el('p', { class: 'text-muted', text: 'Find rooms, members, files, and more.' })
      )
    ));

    const input = Utils.el('input', { type: 'search', placeholder: 'Search members by name or username…', value: initialQuery || '', style: { width: '100%', padding: '12px 16px', background: 'var(--field-bg)', border: '1px solid var(--field-border)', borderRadius: '12px', color: 'var(--text)', outline: 'none', fontSize: '1rem' } });
    wrap.appendChild(input);

    const resultsWrap = Utils.el('div', { id: 'searchResults', style: { marginTop: '20px' } });
    wrap.appendChild(resultsWrap);

    container.appendChild(wrap);

    const doSearch = Utils.debounce(async (q) => {
      await runSearch(q, resultsWrap);
    }, 350);

    input.addEventListener('input', () => doSearch(input.value.trim()));

    if (initialQuery) doSearch(initialQuery);
    else resultsWrap.appendChild(UI.emptyState('Search for people to start. You can search within a room from its tabs.', { title: 'Start typing', icon: '🔍' }));

    input.focus();
  }

  async function runSearch(query, container) {
    Utils.clear(container);
    if (!query || query.length < 2) {
      container.appendChild(UI.emptyState('Type at least 2 characters to search members.', { title: 'Keep typing', icon: '⌨' }));
      return;
    }

    container.appendChild(Utils.el('div', { class: 'text-muted text-sm', text: 'Searching…' }));

    try {
      // 1. Search members (public)
      const users = await LR.searchProfiles(query);

      // 2. Search my rooms by name
      const myRooms = await LR.listMyRooms();
      const matchedRooms = myRooms.filter(r => r.name?.toLowerCase().includes(query.toLowerCase()) || r.description?.toLowerCase().includes(query.toLowerCase()));

      Utils.clear(container);

      if (!users.length && !matchedRooms.length) {
        container.appendChild(UI.emptyState(`No results for "${query}".`, { title: 'No matches', icon: '🔍' }));
        return;
      }

      if (matchedRooms.length) {
        container.appendChild(Utils.el('h3', { style: { fontSize: '0.9rem', color: 'var(--text-3)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }, text: 'Rooms' }));
        const grid = Utils.el('div', { class: 'room-grid', style: { marginBottom: '20px' } });
        for (const r of matchedRooms) grid.appendChild(dashboardRoomCard(r));
        container.appendChild(grid);
      }

      if (users.length) {
        container.appendChild(Utils.el('h3', { style: { fontSize: '0.9rem', color: 'var(--text-3)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }, text: 'People' }));
        const list = Utils.el('div', { class: 'members-list' });
        for (const u of users) list.appendChild(userRow(u));
        container.appendChild(list);
      }
    } catch (e) {
      Utils.clear(container);
      container.appendChild(UI.emptyState('Could not search. ' + (e.message||''), { title: 'Error', icon: '⚠' }));
    }
  }

  function userRow(u) {
    const row = Utils.el('div', { class: 'member-row', dataset: { id: u.id } });
    row.appendChild(UI.avatarNode(u, 'md'));
    row.appendChild(Utils.el('div', { class: 'member-info' },
      Utils.el('div', { class: 'member-name', text: u.full_name }),
      Utils.el('div', { class: 'member-handle', text: '@' + u.username })
    ));
    if (u.bio) row.appendChild(Utils.el('div', { class: 'member-handle', text: u.bio.slice(0,60) }));
    row.addEventListener('click', () => App.openProfile(u.id));
    return row;
  }

  function dashboardRoomCard(r) {
    const card = Utils.el('div', { class: 'room-card', dataset: { id: r.id } });
    const banner = Utils.el('div', { class: 'room-card-banner' });
    if (r.image_url) banner.appendChild(Utils.el('img', { src: r.image_url, alt: '' }));
    card.appendChild(banner);
    const body = Utils.el('div', { class: 'room-card-body' });
    body.appendChild(Utils.el('div', { class: 'room-card-name', text: r.name }));
    if (r.description) body.appendChild(Utils.el('div', { class: 'room-card-desc', text: r.description }));
    body.appendChild(Utils.el('div', { class: 'room-card-meta' },
      Utils.el('div', { class: 'room-card-meta-item', text: r.my_role === 'admin' ? '👑 Admin' : 'Member' })
    ));
    card.appendChild(body);
    card.addEventListener('click', () => App.openRoom(r.id));
    return card;
  }

  return { renderView };
})();
