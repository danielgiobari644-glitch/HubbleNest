/* =============================================================
   LinkRoom — Links section
   Auto-detects URLs in chat messages; displays them here.
   ============================================================= */

window.Links = (function () {
  'use strict';

  let state = { roomId: null, container: null };

  async function mount(container, roomId) {
    state.roomId = roomId;
    state.container = container;
    Utils.clear(container);

    const wrap = Utils.el('div', { class: 'files-host', style: { flex: '1', overflow: 'auto' } });

    const head = Utils.el('div', { class: 'dash-head', style: { marginBottom: '16px' } });
    head.appendChild(Utils.el('div', null,
      Utils.el('h2', { text: 'Links' }),
      Utils.el('p', { class: 'text-muted', text: 'URLs shared in this room.' })
    ));
    wrap.appendChild(head);

    const list = Utils.el('div', { class: 'links-list', id: 'linksList' });
    for (let i = 0; i < 4; i++) list.appendChild(Utils.el('div', { class: 'skeleton', style: { height: '64px' } }));
    wrap.appendChild(list);

    container.appendChild(wrap);
    await load();
  }

  async function load() {
    const list = document.getElementById('linksList');
    if (!list) return;
    Utils.clear(list);
    try {
      const links = await LR.listLinks(state.roomId);
      if (!links.length) {
        list.appendChild(UI.emptyState('No links shared in this room yet.', { title: 'No links', icon: '🔗' }));
        return;
      }
      for (const l of links) list.appendChild(renderCard(l));
    } catch (e) {
      list.appendChild(UI.emptyState('Could not load links. ' + (e.message||''), { title: 'Error', icon: '⚠' }));
    }
  }

  function renderCard(l) {
    const card = Utils.el('div', { class: 'link-card' });
    const thumb = Utils.el('div', { class: 'link-thumb', text: (l.domain || '?').slice(0,2).toUpperCase() });
    card.appendChild(thumb);
    const body = Utils.el('div', { class: 'link-body' });
    if (l.title) body.appendChild(Utils.el('div', { class: 'link-title', text: l.title }));
    body.appendChild(Utils.el('div', { class: 'link-url', text: l.url }));
    if (l.description) body.appendChild(Utils.el('div', { class: 'link-desc', text: l.description.slice(0,120) }));
    card.appendChild(body);

    const actions = Utils.el('div', { class: 'row gap-sm', style: { flexShrink: 0 } });
    actions.appendChild(Utils.el('button', { class: 'icon-btn', title: 'Open', onclick: () => window.open(l.url, '_blank', 'noopener') },
      svgIcon('<path d="M14 5h5v5M19 5l-7 7M4 14v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>', 18)
    ));
    actions.appendChild(Utils.el('button', { class: 'icon-btn', title: 'Copy', onclick: async () => { await Utils.copy(l.url); UI.ok('Link copied!'); } },
      svgIcon('<rect x="9" y="9" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', 18)
    ));
    card.appendChild(actions);
    card.addEventListener('click', () => window.open(l.url, '_blank', 'noopener'));
    return card;
  }

  function svgIcon(inner, size) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.innerHTML = inner;
    return s;
  }

  function refresh(roomId) {
    if (state.container && state.roomId === roomId) load();
  }

  return { mount, refresh };
})();
