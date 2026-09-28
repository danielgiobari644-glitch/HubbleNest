/* =============================================================
   LinkRoom — Announcements
   ============================================================= */

window.Announcements = (function () {
  'use strict';

  let state = { roomId: null, container: null, isAdmin: false };

  async function mount(container, roomId, isAdmin) {
    state.roomId = roomId;
    state.container = container;
    state.isAdmin = !!isAdmin;
    Utils.clear(container);

    const wrap = Utils.el('div', { class: 'files-host', style: { flex: '1', overflow: 'auto' } });

    const head = Utils.el('div', { class: 'dash-head', style: { marginBottom: '16px' } });
    head.appendChild(Utils.el('div', null,
      Utils.el('h2', { text: 'Announcements' }),
      Utils.el('p', { class: 'text-muted', text: 'Important updates from room admins.' })
    ));
    if (state.isAdmin) {
      head.appendChild(Utils.el('button', { class: 'btn btn-primary btn-sm', onclick: openCreateModal },
        svgIcon('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', 14),
        'New announcement'
      ));
    }
    wrap.appendChild(head);

    const list = Utils.el('div', { class: 'announcements-list', id: 'annList' });
    for (let i = 0; i < 3; i++) list.appendChild(Utils.el('div', { class: 'skeleton', style: { height: '120px' } }));
    wrap.appendChild(list);

    container.appendChild(wrap);
    await load();
  }

  async function load() {
    const list = document.getElementById('annList');
    if (!list) return;
    Utils.clear(list);
    try {
      const items = await LR.listAnnouncements(state.roomId);
      if (!items.length) {
        list.appendChild(UI.emptyState('No announcements yet.', { title: 'Quiet here', icon: '📢' }));
        return;
      }
      for (const a of items) list.appendChild(renderCard(a));
    } catch (e) {
      list.appendChild(UI.emptyState('Could not load announcements. ' + (e.message||''), { title: 'Error', icon: '⚠' }));
    }
  }

  function renderCard(a) {
    const card = Utils.el('div', { class: 'announcement-card' + (a.pinned ? ' pinned' : '') });

    const head = Utils.el('div', { class: 'announcement-head' });
    head.appendChild(Utils.el('div', null,
      Utils.el('div', { class: 'announcement-title', text: a.title }),
      Utils.el('div', { class: 'announcement-meta', text: (a.author?.full_name || a.author?.username || 'Admin') + ' · ' + Utils.relativeTime(a.created_at) })
    ));
    if (state.isAdmin) {
      const menu = Utils.el('div', { class: 'row gap-sm' });
      menu.appendChild(Utils.el('button', { class: 'chip', onclick: async () => {
        await LR.updateAnnouncement(a.id, { pinned: !a.pinned });
        UI.ok(a.pinned ? 'Unpinned.' : 'Pinned.');
        load();
      }}, text(a.pinned ? 'Unpin' : 'Pin')));
      menu.appendChild(Utils.el('button', { class: 'chip', onclick: () => openEditModal(a) }, text('Edit')));
      menu.appendChild(Utils.el('button', { class: 'chip', onclick: () => deleteAnnouncement(a) }, text('Delete')));
      head.appendChild(menu);
    }
    card.appendChild(head);

    if (a.content) card.appendChild(Utils.el('div', { class: 'announcement-content', text: a.content }));
    if (a.image_url) card.appendChild(Utils.el('img', { src: a.image_url, alt: '', class: 'announcement-image' }));
    return card;
  }

  function text(t) { const n = document.createTextNode(t); const s = document.createElement('span'); s.appendChild(n); return s; }

  function openCreateModal() { editOrNew(null); }
  function openEditModal(a) { editOrNew(a); }

  function editOrNew(existing) {
    const form = Utils.el('form', { class: 'profile-edit-form' });
    form.appendChild(field('Title *', 'text', existing?.title || ''));
    const bioWrap = Utils.el('div', { class: 'field' });
    bioWrap.appendChild(Utils.el('label', { text: 'Content' }));
    const ta = Utils.el('textarea', { rows: '5', placeholder: 'Write your announcement…' });
    ta.value = existing?.content || '';
    bioWrap.appendChild(ta);
    form.appendChild(bioWrap);

    // Image uploader
    let imageFile = null;
    const imageUploader = Utils.el('div', { class: 'field' });
    imageUploader.appendChild(Utils.el('label', { text: 'Image (optional)' }));
    const fileInput = Utils.el('input', { type: 'file', accept: 'image/*' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { UI.err('Image must be under 5 MB.'); return; }
      imageFile = f;
    });
    imageUploader.appendChild(fileInput);
    form.appendChild(imageUploader);

    const pinWrap = Utils.el('div', { class: 'field' });
    pinWrap.appendChild(Utils.el('label', { text: 'Pinned' }));
    const pinRow = Utils.el('div', { class: 'row' });
    const sw = Utils.el('div', { class: 'switch' + (existing?.pinned ? ' on' : '') });
    sw.appendChild(Utils.el('div', { class: 'switch-thumb' }));
    let pinned = !!existing?.pinned;
    sw.addEventListener('click', () => { pinned = !pinned; sw.classList.toggle('on', pinned); });
    pinRow.appendChild(sw);
    pinWrap.appendChild(pinRow);
    form.appendChild(pinWrap);

    const m = UI.modal({
      title: existing ? 'Edit announcement' : 'New announcement',
      body: form,
      size: 'modal-lg',
      buttons: [
        { label: 'Cancel', kind: 'ghost', onClick: () => {} },
        { label: existing ? 'Save' : 'Publish', kind: 'primary', onClick: async (v, modal) => {
          const title = form.querySelector('input[type="text"]').value.trim();
          if (!title) return UI.err('Please enter a title.');
          const btn = modal.querySelector('.btn-primary');
          btn.disabled = true; btn.textContent = 'Saving…';

          let imageUrl = existing?.image_url || null;
          if (imageFile) {
            UI.spinner('Uploading image…');
            try { imageUrl = await StorageRouter.uploadImage(imageFile); } catch (e) { UI.hideSpinner(); UI.err('Image upload failed.'); btn.disabled = false; btn.textContent = existing ? 'Save' : 'Publish'; return false; }
            UI.hideSpinner();
          }

          try {
            if (existing) {
              await LR.updateAnnouncement(existing.id, { title, content: ta.value.trim() || null, image_url: imageUrl, pinned });
              UI.ok('Announcement updated.');
            } else {
              await LR.createAnnouncement(state.roomId, { title, content: ta.value.trim() || null, image_url: imageUrl, pinned });
              UI.ok('Announcement published!');
            }
            m.close();
            load();
          } catch (err) { UI.err('Could not save. ' + (err.message||'')); btn.disabled = false; btn.textContent = existing ? 'Save' : 'Publish'; }
          return false;
        } }
      ]
    });
  }

  async function deleteAnnouncement(a) {
    const ok = await UI.confirm({
      title: 'Delete announcement?',
      message: `"${a.title}" will be permanently deleted.`,
      danger: true,
      confirmLabel: 'Delete',
      size: 'modal-sm'
    });
    if (!ok) return;
    try { await LR.deleteAnnouncement(a.id); UI.ok('Deleted.'); load(); }
    catch (e) { UI.err('Could not delete. ' + (e.message||'')); }
  }

  function field(label, type, value) {
    const wrap = Utils.el('div', { class: 'field' });
    wrap.appendChild(Utils.el('label', { text: label }));
    const input = Utils.el('input', { type, value: value || '' });
    wrap.appendChild(input);
    return { wrap, input };
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
