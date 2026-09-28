/* =============================================================
   LinkRoom — Rooms (Create / Join / QR / Manage)
   ============================================================= */

window.Rooms = (function () {
  'use strict';

  // ---------- Create room modal ----------
  function openCreateModal() {
    const form = Utils.el('form', { class: 'profile-edit-form' });

    // Room image uploader
    const imageUploader = Utils.el('div', { class: 'avatar-uploader' });
    const circle = Utils.el('label', { class: 'avatar-uploader-circle', for: 'roomImage', style: { width: '88px', height: '88px', borderRadius: '20px' } });
    const placeholder = Utils.el('div', { class: 'avatar avatar-xl', style: { borderRadius: '20px', width: '88px', height: '88px' } });
    placeholder.textContent = '🖼';
    circle.appendChild(placeholder);
    const fileInput = Utils.el('input', { type: 'file', accept: 'image/*', id: 'roomImage', hidden: true });
    let imageFile = null;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { UI.err('Room image must be under 5 MB.'); return; }
      if (!f.type.startsWith('image/')) { UI.err('Please choose an image.'); return; }
      imageFile = f;
      const img = Utils.el('img', { src: URL.createObjectURL(f), alt: '', style: { width: '88px', height: '88px', objectFit: 'cover', borderRadius: '20px' } });
      circle.replaceChild(img, placeholder);
    });
    circle.appendChild(Utils.el('span', { class: 'avatar-uploader-edit' }));
    imageUploader.appendChild(circle);
    imageUploader.appendChild(fileInput);
    form.appendChild(imageUploader);

    form.appendChild(field('Room name *', 'text', '', 'My Awesome Room'));
    form.appendChild(textAreaField('Description', 'What is this room about?'));
    form.appendChild(field('Category (optional)', 'text', '', 'e.g. School, Fellowship, Team'));

    // Room type
    const typeWrap = Utils.el('div', { class: 'field' });
    typeWrap.appendChild(Utils.el('label', { text: 'Room type' }));
    const typeRow = Utils.el('div', { class: 'row gap-sm' });
    const permChip = Utils.el('button', { type: 'button', class: 'chip active', text: 'Permanent' });
    const tempChip = Utils.el('button', { type: 'button', class: 'chip', text: 'Temporary' });
    let isTemp = false;
    permChip.addEventListener('click', () => { isTemp = false; permChip.classList.add('active'); tempChip.classList.remove('active'); expWrap.style.display = 'none'; });
    tempChip.addEventListener('click', () => { isTemp = true; tempChip.classList.add('active'); permChip.classList.remove('active'); expWrap.style.display = 'flex'; });
    typeRow.appendChild(permChip); typeRow.appendChild(tempChip);
    typeWrap.appendChild(typeRow);
    form.appendChild(typeWrap);

    // Expiration (only when temporary)
    const expWrap = Utils.el('div', { class: 'field', style: { display: 'none' } });
    expWrap.appendChild(Utils.el('label', { text: 'Expires on', for: 'expAt' }));
    const dtInput = Utils.el('input', { type: 'datetime-local', id: 'expAt' });
    // Default: +1 day
    const d = new Date(Date.now() + 86400000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    dtInput.value = d.toISOString().slice(0,16);
    expWrap.appendChild(dtInput);
    form.appendChild(expWrap);

    form.appendChild(field('Motto (optional)', 'text', '', 'A short tagline'));

    const m = UI.modal({
      title: 'Create a room',
      subtitle: 'Invite members with a QR code or room code after creation.',
      body: form,
      size: 'modal-lg',
      buttons: [
        { label: 'Cancel', kind: 'ghost', onClick: () => {} },
        { label: 'Create', kind: 'primary', onClick: async (v, modal) => {
          const nameInput = form.querySelector('input[type="text"]');
          const name = form.querySelectorAll('input[type="text"]')[0].value.trim();
          if (!name) return UI.err('Please enter a room name.');

          const btn = modal.querySelector('.btn-primary');
          btn.disabled = true; btn.textContent = 'Creating…';

          try {
            // Upload image if any
            let imageUrl = null;
            if (imageFile) {
              UI.spinner('Uploading room image…');
              imageUrl = await StorageRouter.uploadImage(imageFile);
              UI.hideSpinner();
            }

            // Build payload
            const desc = form.querySelector('textarea').value.trim() || null;
            const category = form.querySelectorAll('input[type="text"]')[1].value.trim() || null;
            const motto = form.querySelectorAll('input[type="text"]')[2].value.trim() || null;
            const roomType = isTemp ? 'temporary' : 'permanent';
            const expiresAt = isTemp ? new Date(dtInput.value).toISOString() : null;

            if (isTemp && expiresAt && new Date(expiresAt) <= new Date()) return UI.err('Expiration must be in the future.');

            const room = await LR.createRoom({
              name, description: desc, motto, category, image_url: imageUrl,
              room_type: roomType, expires_at: expiresAt,
              settings: { max_file_size_mb: 500 }
            });

            UI.ok('Room created!');
            m.close();
            // Show QR / code modal
            openCreatedModal(room);
            // Refresh dashboard
            Dashboard.render();
          } catch (err) {
            UI.err('Could not create room. ' + (err.message || ''));
            btn.disabled = false; btn.textContent = 'Create';
          }
          return false;
        } }
      ]
    });
  }

  function field(label, type, value, placeholder) {
    const wrap = Utils.el('div', { class: 'field' });
    wrap.appendChild(Utils.el('label', { text: label }));
    const input = Utils.el('input', { type, value: value || '' });
    if (placeholder) input.placeholder = placeholder;
    wrap.appendChild(input);
    return { wrap, input };
  }
  function textAreaField(label, placeholder) {
    const wrap = Utils.el('div', { class: 'field' });
    wrap.appendChild(Utils.el('label', { text: label }));
    const ta = Utils.el('textarea', { rows: '3', placeholder: placeholder || '' });
    wrap.appendChild(ta);
    return { wrap, input: ta };
  }

  // ---------- Created room QR + code modal ----------
  function openCreatedModal(room) {
    const joinUrl = `${LINKROOM_CONFIG.app.url}/app.html?join=${room.join_token}`;

    const body = Utils.el('div', { class: 'qr-wrap' });
    body.appendChild(Utils.el('div', { class: 'qr-info' },
      Utils.el('h3', { text: room.name, style: { marginBottom: '6px' } }),
      Utils.el('p', { class: 'text-muted', style: { marginBottom: '14px' }, text: 'Share this code or QR code with members. They will need approval to join.' })
    ));

    // QR
    const qrWrap = Utils.el('div', { class: 'qr-canvas', id: 'qrCanvas' });
    body.appendChild(qrWrap);
    setTimeout(() => {
      if (window.QRCode) {
        QRCode.toCanvas(qrWrap, joinUrl, { width: 220, margin: 1 }, (err) => {
          if (err) {
            qrWrap.innerHTML = '<div style="text-align:center;color:#666;">QR unavailable</div>';
          }
        });
      } else {
        // Fallback: link-only
        qrWrap.innerHTML = `<div style="padding:8px;font-family:monospace;font-size:10px;word-break:break-all;max-width:220px;">${joinUrl}</div>`;
      }
    }, 80);

    body.appendChild(Utils.el('div', { class: 'qr-info' },
      Utils.el('div', { class: 'text-muted text-sm', text: 'Room code' }),
      Utils.el('div', { class: 'room-code-big', text: room.room_code })
    ));

    const btns = Utils.el('div', { class: 'row gap-sm', style: { marginTop: '8px' } });
    const copyCodeBtn = Utils.el('button', { class: 'btn btn-secondary btn-sm' });
    copyCodeBtn.textContent = 'Copy code';
    copyCodeBtn.addEventListener('click', async () => { await Utils.copy(room.room_code); UI.ok('Room code copied!'); });
    const copyLinkBtn = Utils.el('button', { class: 'btn btn-secondary btn-sm' });
    copyLinkBtn.textContent = 'Copy join link';
    copyLinkBtn.addEventListener('click', async () => { await Utils.copy(joinUrl); UI.ok('Join link copied!'); });
    const openBtn = Utils.el('button', { class: 'btn btn-primary btn-sm' });
    openBtn.textContent = 'Open room';
    openBtn.addEventListener('click', () => { UI.closeAllModals(); App.openRoom(room.id); });
    btns.appendChild(copyCodeBtn); btns.appendChild(copyLinkBtn); btns.appendChild(openBtn);
    body.appendChild(btns);

    UI.modal({
      title: 'Room ready',
      body,
      size: 'modal-sm',
      buttons: [{ label: 'Done', kind: 'primary', onClick: () => {} }]
    });
  }

  // ---------- Join by code ----------
  function openJoinModal(initialCode) {
    const form = Utils.el('form', { class: 'profile-edit-form' });
    form.appendChild(Utils.el('p', { class: 'text-muted text-sm', text: 'Enter the room code (e.g. LR-7K4P92) to request to join.' }));
    const codeField = field('Room code', 'text', (initialCode || '').toUpperCase(), 'LR-XXXXXX');
    codeField.input.style.fontFamily = 'monospace';
    codeField.input.style.letterSpacing = '0.1em';
    codeField.input.style.textTransform = 'uppercase';
    form.appendChild(codeField.wrap);

    let foundRoom = null;
    const previewWrap = Utils.el('div', { id: 'joinPreview', style: { display: 'none' } });
    form.appendChild(previewWrap);

    const lookupBtn = Utils.el('button', { type: 'button', class: 'btn btn-secondary btn-block btn-sm', text: 'Find room' });
    form.appendChild(lookupBtn);
    lookupBtn.addEventListener('click', async () => {
      const code = codeField.input.value.trim().toUpperCase();
      if (!code) return UI.err('Please enter a room code.');
      UI.spinner('Looking up room…');
      try {
        const room = await LR.getRoomByCode(code);
        UI.hideSpinner();
        if (!room) {
          foundRoom = null;
          previewWrap.style.display = 'none';
          return UI.err('That room code doesn\'t exist.');
        }
        if (room.expired || !room.is_active) {
          return UI.err('This room has expired.');
        }
        foundRoom = room;
        renderJoinPreview(previewWrap, room);
      } catch (e) {
        UI.hideSpinner();
        UI.err('Could not look up room. ' + (e.message || ''));
      }
    });

    const m = UI.modal({
      title: 'Join a room',
      subtitle: 'Enter a room code to request access.',
      body: form,
      size: 'modal-sm',
      buttons: [
        { label: 'Cancel', kind: 'ghost', onClick: () => {} },
        { label: 'Request to join', kind: 'primary', onClick: async (v, modal) => {
          if (!foundRoom) return UI.err('Find a room first.');
          const btn = modal.querySelector('.btn-primary');
          btn.disabled = true; btn.textContent = 'Sending…';
          try {
            await LR.requestJoin(foundRoom.id);
            UI.ok('Request sent! You\'ll be notified when the admin responds.');
            m.close();
          } catch (err) {
            const msg = err.message || '';
            if (msg.includes('23505') || msg.includes('unique')) {
              UI.err('You already have a pending request for this room.');
            } else {
              UI.err('Could not send request. ' + msg);
            }
            btn.disabled = false; btn.textContent = 'Request to join';
          }
          return false;
        } }
      ]
    });

    if (initialCode) lookupBtn.click();
  }

  function renderJoinPreview(wrap, room) {
    Utils.clear(wrap);
    wrap.style.display = 'block';
    const card = Utils.el('div', { class: 'room-card', style: { cursor: 'default' } });
    const banner = Utils.el('div', { class: 'room-card-banner' });
    if (room.image_url) banner.appendChild(Utils.el('img', { src: room.image_url, alt: '' }));
    card.appendChild(banner);
    const body = Utils.el('div', { class: 'room-card-body' });
    body.appendChild(Utils.el('div', { class: 'room-card-name', text: room.name }));
    if (room.description) body.appendChild(Utils.el('div', { class: 'room-card-desc', text: room.description }));
    body.appendChild(Utils.el('div', { class: 'room-card-meta' },
      Utils.el('div', { class: 'room-card-meta-item', text: room.room_type === 'temporary' ? '⏰ Temporary' : '∞ Permanent' })
    ));
    card.appendChild(body);
    wrap.appendChild(card);
  }

  // ---------- Show QR for an existing room (admin) ----------
  async function showRoomQr(room) {
    const joinUrl = `${LINKROOM_CONFIG.app.url}/app.html?join=${room.join_token}`;
    const body = Utils.el('div', { class: 'qr-wrap' });
    body.appendChild(Utils.el('div', { class: 'qr-canvas', id: 'qrCanvas' }));
    body.appendChild(Utils.el('div', { class: 'qr-info' },
      Utils.el('div', { class: 'text-muted text-sm', text: 'Room code' }),
      Utils.el('div', { class: 'room-code-big', text: room.room_code })
    ));
    const btns = Utils.el('div', { class: 'row gap-sm' });
    const copyCodeBtn = Utils.el('button', { class: 'btn btn-secondary btn-sm', text: 'Copy code' });
    copyCodeBtn.addEventListener('click', async () => { await Utils.copy(room.room_code); UI.ok('Copied!'); });
    const copyLinkBtn = Utils.el('button', { class: 'btn btn-secondary btn-sm', text: 'Copy link' });
    copyLinkBtn.addEventListener('click', async () => { await Utils.copy(joinUrl); UI.ok('Copied!'); });
    btns.appendChild(copyCodeBtn); btns.appendChild(copyLinkBtn);
    body.appendChild(btns);

    const m = UI.modal({
      title: 'Share room',
      subtitle: room.name,
      body,
      size: 'modal-sm',
      buttons: [{ label: 'Done', kind: 'primary', onClick: () => {} }]
    });

    setTimeout(() => {
      if (window.QRCode) {
        QRCode.toCanvas(body.querySelector('#qrCanvas'), joinUrl, { width: 220, margin: 1 }, (err) => {
          if (err) body.querySelector('#qrCanvas').innerHTML = '<div style="text-align:center;color:#666;">QR unavailable</div>';
        });
      }
    }, 80);
  }

  // ---------- Handle URL with ?join=TOKEN ----------
  async function handleJoinToken() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('join');
    if (!token) return false;

    // Remove from URL
    window.history.replaceState({}, '', window.location.pathname);

    UI.spinner('Finding room…');
    try {
      const room = await LR.getRoomByToken(token);
      UI.hideSpinner();
      if (!room) { UI.err('This invite link is invalid or the room no longer exists.'); return true; }
      if (room.expired || !room.is_active) { UI.err('This room has expired.'); return true; }

      openJoinModal(room.room_code);
      return true;
    } catch (e) {
      UI.hideSpinner();
      UI.err('Could not look up the room from this link.');
      return true;
    }
  }

  // ---------- Extend temporary room ----------
  async function openExtendModal(room, onExtended) {
    const form = Utils.el('form', { class: 'profile-edit-form' });
    form.appendChild(Utils.el('p', { class: 'text-muted text-sm', text: `Currently expires ${Utils.fmtDateTime(room.expires_at)}. Choose a new date/time.` }));
    const wrap = Utils.el('div', { class: 'field' });
    wrap.appendChild(Utils.el('label', { text: 'New expiration' }));
    const input = Utils.el('input', { type: 'datetime-local' });
    const d = new Date(room.expires_at ? new Date(room.expires_at).getTime() + 86400000 : Date.now() + 86400000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    input.value = d.toISOString().slice(0,16);
    wrap.appendChild(input);
    form.appendChild(wrap);

    const m = UI.modal({
      title: 'Extend room',
      subtitle: room.name,
      body: form,
      size: 'modal-sm',
      buttons: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Extend', kind: 'primary', onClick: async (v, modal) => {
          const newDate = new Date(input.value).toISOString();
          if (new Date(newDate) <= new Date()) return UI.err('Choose a future date.');
          const btn = modal.querySelector('.btn-primary');
          btn.disabled = true; btn.textContent = 'Extending…';
          try {
            await LR.updateRoom(room.id, { expires_at: newDate, expired: false, is_active: true });
            UI.ok('Room extended!');
            m.close();
            if (onExtended) onExtended();
          } catch (err) { UI.err('Could not extend room. ' + (err.message||'')); btn.disabled = false; btn.textContent = 'Extend'; }
          return false;
        } }
      ]
    });
  }

  // ---------- Delete room (admin) ----------
  async function confirmDelete(room, onDeleted) {
    const ok = await UI.confirm({
      title: 'Delete room?',
      message: `Deleting "${room.name}" will remove all messages, files, links, announcements, and memberships. This cannot be undone.`,
      danger: true,
      confirmLabel: 'Delete permanently',
      size: 'modal-sm'
    });
    if (!ok) return;
    UI.spinner('Deleting room…');
    try {
      await LR.deleteRoom(room.id);
      UI.hideSpinner();
      UI.ok('Room deleted.');
      if (onDeleted) onDeleted();
    } catch (e) {
      UI.hideSpinner();
      UI.err('Could not delete room. ' + (e.message||''));
    }
  }

  return {
    openCreateModal, openJoinModal, showRoomQr,
    handleJoinToken, openExtendModal, confirmDelete
  };
})();
