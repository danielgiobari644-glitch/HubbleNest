/* =============================================================
   LinkRoom — Files Library
   ============================================================= */

window.Files = (function () {
  'use strict';

  let state = { roomId: null, category: 'recent', search: '', container: null };

  async function mount(container, roomId) {
    state.roomId = roomId;
    state.container = container;
    Utils.clear(container);

    const wrap = Utils.el('div', { class: 'files-host', style: { flex: '1', overflow: 'auto' } });

    // Header with search + upload
    const head = Utils.el('div', { class: 'dash-head', style: { marginBottom: '16px' } });
    head.appendChild(Utils.el('div', null,
      Utils.el('h2', { text: 'Files' }),
      Utils.el('p', { class: 'text-muted', text: 'All shared files in this room.' })
    ));
    head.appendChild(Utils.el('div', { class: 'row gap-sm' },
      searchInput(),
      uploadButton()
    ));
    wrap.appendChild(head);

    // Filter chips
    const chips = Utils.el('div', { class: 'filter-chips', style: { marginBottom: '14px' } });
    for (const [k, label] of Object.entries({ recent: 'Recent', images: 'Images', videos: 'Videos', audio: 'Audio', documents: 'Documents', other: 'Other' })) {
      const c = Utils.el('button', { class: 'chip' + (state.category === k ? ' active' : ''), dataset: { cat: k }, text: label });
      c.addEventListener('click', () => { state.category = k; mount(container, roomId); });
      chips.appendChild(c);
    }
    wrap.appendChild(chips);

    // Grid
    const grid = Utils.el('div', { class: 'files-grid', id: 'filesGrid' });
    for (let i = 0; i < 6; i++) grid.appendChild(Utils.el('div', { class: 'skeleton', style: { height: '180px', borderRadius: '14px' } }));
    wrap.appendChild(grid);

    container.appendChild(wrap);

    await load();
  }

  function searchInput() {
    const input = Utils.el('input', { type: 'search', placeholder: 'Search files…', value: state.search, style: { padding: '8px 12px', background: 'var(--field-bg)', border: '1px solid var(--field-border)', borderRadius: '10px', color: 'var(--text)', outline: 'none', width: '220px' } });
    input.addEventListener('input', Utils.debounce(() => { state.search = input.value.trim(); load(); }, 300));
    return input;
  }

  function uploadButton() {
    const btn = Utils.el('button', { class: 'btn btn-primary btn-sm' });
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Upload';
    const fileInput = Utils.el('input', { type: 'file', hidden: true });
    btn.appendChild(fileInput);
    btn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0]; if (!f) return;
      fileInput.value = '';
      uploadFile(f);
    });
    return btn;
  }

  async function load() {
    const grid = document.getElementById('filesGrid');
    if (!grid) return;
    Utils.clear(grid);

    try {
      let files = await LR.listFiles(state.roomId, state.category);
      if (state.search) {
        const q = state.search.toLowerCase();
        files = files.filter(f => f.original_name.toLowerCase().includes(q));
      }
      if (!files.length) {
        grid.appendChild(UI.emptyState('No files have been shared yet.', { title: 'No files', icon: '📁', actionLabel: 'Upload a file', action: () => {
          const btn = document.querySelector('.files-host .btn-primary');
          if (btn) { const inp = btn.querySelector('input'); if (inp) inp.click(); }
        } }));
        return;
      }
      for (const f of files) grid.appendChild(renderCard(f));
    } catch (e) {
      grid.appendChild(UI.emptyState('Could not load files. ' + (e.message||''), { title: 'Error', icon: '⚠' }));
    }
  }

  function renderCard(f) {
    const card = Utils.el('div', { class: 'file-card', dataset: { id: f.id } });

    // Thumbnail / icon
    const thumb = Utils.el('div', { class: 'file-thumb' });
    if (f.thumbnail_url) {
      thumb.appendChild(Utils.el('img', { src: f.thumbnail_url, alt: '' }));
    } else if (f.category === 'images' && f.url) {
      thumb.appendChild(Utils.el('img', { src: f.url, alt: '' }));
    } else {
      thumb.appendChild(Utils.el('span', { text: Utils.fileIcon(f.mime_type, f.original_name), style: { fontSize: '28px' } }));
    }
    card.appendChild(thumb);

    card.appendChild(Utils.el('div', { class: 'file-name', text: f.original_name }));
    card.appendChild(Utils.el('div', { class: 'file-meta' },
      Utils.el('span', { text: Utils.humanBytes(f.size_bytes) }),
      Utils.el('span', { text: '·' }),
      Utils.el('span', { text: Utils.relativeTime(f.created_at) })
    ));

    const actions = Utils.el('div', { class: 'file-actions' });
    actions.appendChild(actionBtn('↗', 'Open', () => window.open(f.url, '_blank', 'noopener')));
    actions.appendChild(actionBtn('⤓', 'Download', () => Utils.downloadUrl(f.url, f.original_name)));
    actions.appendChild(actionBtn('⧉', 'Copy link', async () => { await Utils.copy(f.url); UI.ok('Link copied!'); }));

    // Delete if mine or admin
    LR.getUser().then(({ data: { user } }) => {
      if (user && (f.uploader_id === user.id || Members.amIAdmin(state.roomId))) {
        actions.appendChild(actionBtn('🗑', 'Delete', () => deleteFile(f)));
      }
    });
    card.appendChild(actions);

    return card;
  }

  function actionBtn(icon, label, onClick) {
    const b = Utils.el('button', { class: 'icon-btn', title: label, 'aria-label': label, text: icon, style: { fontSize: '14px' } });
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  async function uploadFile(file) {
    const maxBytes = (LINKROOM_CONFIG.app?.maxFileSizeMb || 500) * 1024 * 1024;
    if (file.size > maxBytes) return UI.err(`This file is larger than the ${LINKROOM_CONFIG.app.maxFileSizeMb} MB upload limit.`);

    // Show progress modal
    const progress = Utils.el('div', { class: 'col gap-md', style: { minWidth: '320px' } });
    progress.appendChild(Utils.el('div', { class: 'text-center', text: 'Uploading ' + file.name }));
    const bar = Utils.el('div', { class: 'upload-bar', style: { height: '6px' } });
    const fill = Utils.el('div', { class: 'upload-bar-fill', style: { width: '0%' } });
    bar.appendChild(fill);
    progress.appendChild(bar);
    progress.appendChild(Utils.el('div', { class: 'text-center text-muted', id: 'uploadPct', text: '0%' }));

    const m = UI.modal({
      title: 'Uploading file',
      body: progress,
      size: 'modal-sm',
      disableBackdropClose: true,
      buttons: [{ label: 'Close', kind: 'ghost', onClick: () => {} }]
    });

    try {
      const meta = await StorageRouter.uploadFile(file, state.roomId, {
        onProgress: (p) => {
          fill.style.width = p.toFixed(0) + '%';
          const pct = document.getElementById('uploadPct');
          if (pct) pct.textContent = p.toFixed(0) + '%';
        }
      });
      await LR.insertFile(state.roomId, meta);
      UI.ok('File uploaded.');
      m.close();
      load();
    } catch (e) {
      m.close();
      UI.err('This file couldn\'t be uploaded. Try again. ' + (e.message||''));
    }
  }

  async function deleteFile(file) {
    const ok = await UI.confirm({
      title: 'Delete file?',
      message: `"${file.original_name}" will be permanently removed from this room.`,
      danger: true,
      confirmLabel: 'Delete',
      size: 'modal-sm'
    });
    if (!ok) return;
    try {
      await LR.deleteFile(file.id);
      UI.ok('File deleted.');
      load();
    } catch (e) {
      UI.err('Could not delete file. ' + (e.message||''));
    }
  }

  function refresh(roomId) {
    if (state.container && state.roomId === roomId) mount(state.container, roomId);
  }

  return { mount, refresh };
})();
