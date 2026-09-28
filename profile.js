/* =============================================================
   LinkRoom — Profile (view / edit / onboard)
   ============================================================= */

window.Profile = (function () {
  'use strict';

  // ---------- Onboarding gate (when no profile yet) ----------
  async function initOnboardingGate() {
    const gate = document.getElementById('onboardingGate');
    const form = document.getElementById('onboardingForm');
    const avatarInput = document.getElementById('onboardAvatar');
    const avatarPreview = document.getElementById('onboardAvatarPreview');
    const nameInput = document.getElementById('onboardName');
    const usernameInput = document.getElementById('onboardUsername');

    if (!gate || !form) return false;

    let uploadedAvatarUrl = null;
    let pendingFile = null;

    // Pre-fill from auth metadata
    try {
      const { data: { user } } = await LR.getUser();
      if (user) {
        nameInput.value = user.user_metadata?.full_name || '';
        const metaUsername = user.user_metadata?.username;
        if (metaUsername) usernameInput.value = metaUsername;
      }
    } catch {}

    avatarInput.addEventListener('change', () => {
      const f = avatarInput.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { UI.err('Profile picture must be under 5 MB.'); return; }
      if (!f.type.startsWith('image/')) { UI.err('Please choose an image file.'); return; }
      pendingFile = f;
      avatarPreview.src = URL.createObjectURL(f);
      avatarPreview.classList.remove('placeholder');
    });

    // Show gate
    gate.hidden = false;
    const appShell = document.getElementById('appShell'); if (appShell) appShell.hidden = true;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = nameInput.value.trim();
      const username = usernameInput.value.trim();
      const bio = document.getElementById('onboardBio').value.trim() || null;

      if (!fullName) return UI.err('Please enter your full name.');
      if (!Utils.validUsername(username)) return UI.err('Username must be 3-24 chars, letters/numbers/underscores.');

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';

      try {
        // Upload avatar if selected
        let avatarUrl = uploadedAvatarUrl;
        if (pendingFile) {
          UI.spinner('Uploading profile picture…');
          try {
            avatarUrl = await StorageRouter.uploadImage(pendingFile);
          } catch (err) {
            UI.hideSpinner();
            return UI.err('Could not upload profile picture. Please try again.');
          }
          UI.hideSpinner();
        }

        // Ensure crypto identity (public key)
        const pubB64 = await LinkRoomCrypto.ensureIdentity();

        // Save profile
        await LR.upsertProfile({
          full_name: fullName,
          username,
          bio,
          avatar_url: avatarUrl,
          public_key: pubB64,
          is_online: true,
          last_seen: new Date().toISOString()
        });

        UI.ok('Profile created!');
        gate.hidden = false;
        gate.style.display = 'none';
        if (appShell) appShell.hidden = false;
        // Trigger dashboard refresh
        if (window.Dashboard) Dashboard.refresh();
      } catch (err) {
        const msg = err.message || '';
        if (msg.includes('username') || msg.includes('unique') || msg.includes('23505')) {
          UI.err('That username is taken. Try another.');
        } else {
          UI.err('Could not save profile. ' + msg);
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue';
      }
    });

    return true;
  }

  // ---------- Render profile view (current user) ----------
  async function renderMyProfile(container) {
    Utils.clear(container);
    try {
      const profile = await LR.getCurrentProfile();
      if (!profile) {
        container.appendChild(UI.emptyState('You don\'t have a profile yet.', { title: 'No profile', icon: '👤' }));
        return;
      }
      renderProfileCard(container, profile, { isMe: true, onEdit: () => openEditModal(profile) });
    } catch (e) {
      container.appendChild(UI.emptyState('Could not load profile.', { title: 'Error', icon: '⚠' }));
    }
  }

  // ---------- Render member profile (read-only) ----------
  async function renderMemberProfile(container, userId) {
    Utils.clear(container);
    try {
      const profile = await LR.getProfile(userId);
      if (!profile) {
        container.appendChild(UI.emptyState('This profile is not available.', { title: 'Not found', icon: '🔍' }));
        return;
      }
      renderProfileCard(container, profile, { isMe: false });
    } catch (e) {
      container.appendChild(UI.emptyState('Could not load profile.', { title: 'Error', icon: '⚠' }));
    }
  }

  // ---------- Profile card (shared) ----------
  function renderProfileCard(container, profile, opts) {
    opts = opts || {};
    const card = Utils.el('div', { class: 'profile-card reveal' });

    const banner = Utils.el('div', { class: 'profile-banner' });

    const body = Utils.el('div', { class: 'profile-body' });
    const avatar = UI.avatarNode(profile, 'xl');
    body.appendChild(avatar);

    body.appendChild(Utils.el('div', { class: 'profile-name', text: profile.full_name }));
    body.appendChild(Utils.el('div', { class: 'profile-handle', text: '@' + profile.username }));
    if (profile.bio) body.appendChild(Utils.el('p', { class: 'profile-bio', text: profile.bio }));

    const meta = Utils.el('div', { class: 'profile-meta' });
    meta.appendChild(Utils.el('div', { class: 'profile-meta-item' },
      Utils.el('span', { text: '📅' }),
      Utils.el('span', { text: 'Joined ' + Utils.fmtDate(profile.created_at) })
    ));
    meta.appendChild(Utils.el('div', { class: 'profile-meta-item' },
      Utils.el('span', { class: 'online-dot' + (profile.is_online ? '' : ' muted') }),
      Utils.el('span', { text: profile.is_online ? 'Online' : 'Last seen ' + Utils.relativeTime(profile.last_seen) })
    ));
    body.appendChild(meta);

    if (opts.isMe) {
      const btnRow = Utils.el('div', { class: 'row gap-sm', style: { marginTop: '12px' } });
      const editBtn = Utils.el('button', { class: 'btn btn-secondary btn-sm' });
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14.06 6.19l3.75 3.75 2.13-2.13a1 1 0 0 0 0-1.42l-2.33-2.33a1 1 0 0 0-1.42 0l-2.13 2.13z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg> Edit profile';
      editBtn.addEventListener('click', opts.onEdit);
      btnRow.appendChild(editBtn);
      const signOutBtn = Utils.el('button', { class: 'btn btn-danger btn-sm' });
      signOutBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Sign out';
      signOutBtn.addEventListener('click', () => App.signOut());
      btnRow.appendChild(signOutBtn);
      body.appendChild(btnRow);
    }

    card.appendChild(banner);
    card.appendChild(body);
    container.appendChild(card);
  }

  // ---------- Edit profile modal ----------
  function openEditModal(profile) {
    let pendingFile = null;
    let avatarUrl = profile.avatar_url;

    const form = Utils.el('form', { class: 'profile-edit-form' });

    // Avatar uploader
    const uploader = Utils.el('div', { class: 'avatar-uploader' });
    const circle = Utils.el('label', { class: 'avatar-uploader-circle', for: 'editAvatar' });
    const preview = profile.avatar_url
      ? Utils.el('img', { src: profile.avatar_url, alt: '', class: 'avatar avatar-xl' })
      : (function() { const p = Utils.el('div', { class: 'avatar avatar-xl placeholder' }); p.textContent = Utils.initials(profile.full_name); return p; })();
    circle.appendChild(preview);
    const editBadge = Utils.el('span', { class: 'avatar-uploader-edit' });
    editBadge.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    circle.appendChild(editBadge);
    const fileInput = Utils.el('input', { type: 'file', accept: 'image/*', id: 'editAvatar', hidden: true });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { UI.err('Profile picture must be under 5 MB.'); return; }
      if (!f.type.startsWith('image/')) { UI.err('Please choose an image file.'); return; }
      pendingFile = f;
      const newPreview = Utils.el('img', { src: URL.createObjectURL(f), alt: '', class: 'avatar avatar-xl' });
      circle.replaceChild(newPreview, preview);
    });
    uploader.appendChild(circle);
    uploader.appendChild(fileInput);
    form.appendChild(uploader);

    // Name
    const nameField = field('Full name', 'text', profile.full_name);
    form.appendChild(nameField.wrap);
    // Username
    const userField = field('Username', 'text', profile.username);
    form.appendChild(userField.wrap);
    // Bio
    const bioWrap = Utils.el('div', { class: 'field' });
    bioWrap.appendChild(Utils.el('label', { text: 'Short bio' }));
    const bioTa = Utils.el('textarea', { rows: '3', placeholder: 'Tell people a little about you' });
    bioTa.value = profile.bio || '';
    bioWrap.appendChild(bioTa);
    form.appendChild(bioWrap);
    // Phone
    const phoneField = field('Phone (optional)', 'tel', profile.phone || '');
    form.appendChild(phoneField.wrap);

    const m = UI.modal({
      title: 'Edit profile',
      body: form,
      buttons: [
        { label: 'Cancel', kind: 'ghost', onClick: () => {} },
        { label: 'Save changes', kind: 'primary', onClick: async (v, modal) => {
          const fullName = nameField.input.value.trim();
          const username = userField.input.value.trim();
          if (!fullName) return UI.err('Please enter your full name.');
          if (!Utils.validUsername(username)) return UI.err('Username must be 3-24 chars, letters/numbers/underscores.');

          const saveBtn = modal.querySelector('.btn-primary');
          saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

          try {
            let finalAvatar = avatarUrl;
            if (pendingFile) {
              UI.spinner('Uploading profile picture…');
              finalAvatar = await StorageRouter.uploadImage(pendingFile);
              UI.hideSpinner();
            }

            await LR.upsertProfile({
              full_name: fullName,
              username,
              bio: bioTa.value.trim() || null,
              phone: phoneField.input.value.trim() || null,
              avatar_url: finalAvatar,
              is_online: true,
              last_seen: new Date().toISOString()
            });

            UI.ok('Profile updated!');
            m.close();
            // Refresh current view
            const cont = document.getElementById('view-profile');
            if (cont) renderMyProfile(cont);
            // Update sidebar chip
            if (window.App) App.refreshProfileChip();
          } catch (err) {
            const msg = err.message || '';
            if (msg.includes('username') || msg.includes('unique') || msg.includes('23505')) {
              UI.err('That username is taken. Try another.');
            } else {
              UI.err('Could not save changes. ' + msg);
            }
            saveBtn.disabled = false; saveBtn.textContent = 'Save changes';
          }
          return false;
        } }
      ]
    });
  }

  function field(label, type, value) {
    const wrap = Utils.el('div', { class: 'field' });
    wrap.appendChild(Utils.el('label', { text: label }));
    const input = Utils.el('input', { type, value: value || '' });
    wrap.appendChild(input);
    return { wrap, input };
  }

  return {
    initOnboardingGate,
    renderMyProfile,
    renderMemberProfile,
    openEditModal
  };
})();
