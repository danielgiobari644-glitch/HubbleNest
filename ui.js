/* =============================================================
   LinkRoom — UI helpers: Toasts, Modals, Spinner
   ============================================================= */

window.UI = (function () {
  'use strict';

  // ---------- Toast ----------
  const TOAST_ICONS = {
    success: '✓', error: '✕', info: 'i', warning: '!'
  };

  function toast(message, opts) {
    opts = opts || {};
    const type = opts.type || 'info';
    const title = opts.title || ({
      success: 'Success', error: 'Oops', info: 'Heads up', warning: 'Notice'
    })[type];

    const node = document.createElement('div');
    node.className = 'toast ' + type;
    node.innerHTML = `
      <div class="toast-icon">${TOAST_ICONS[type]}</div>
      <div class="toast-content">
        <div class="toast-title"></div>
        <div class="toast-message"></div>
      </div>
      <button class="icon-btn toast-close" aria-label="Close">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    `;
    node.querySelector('.toast-title').textContent = title;
    node.querySelector('.toast-message').textContent = message;

    const container = document.getElementById('toastContainer') || document.body;
    container.appendChild(node);

    const dismiss = () => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 250);
    };
    node.querySelector('.toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, opts.duration || 4500);
    return node;
  }

  function ok(message, opts)   { return toast(message, Object.assign({type:'success'}, opts)); }
  function err(message, opts) { return toast(message, Object.assign({type:'error'},   opts)); }
  function info(message, opts){ return toast(message, Object.assign({type:'info'},    opts)); }
  function warn(message, opts){ return toast(message, Object.assign({type:'warning'}, opts)); }

  // ---------- Modal ----------
  function modal(opts) {
    opts = opts || {};
    const root = document.getElementById('modalRoot') || document.body;
    const size = opts.size || ''; // '', 'modal-sm', 'modal-lg'

    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal ${size}" role="dialog" aria-modal="true">
        <header class="modal-header">
          <div>
            <h3></h3>
            <p class="modal-subtitle"></p>
          </div>
          <button class="icon-btn modal-close" aria-label="Close">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </header>
        <div class="modal-body"></div>
        <footer class="modal-footer"></footer>
      </div>
    `;
    const modal = back.querySelector('.modal');
    modal.querySelector('h3').textContent = opts.title || '';
    if (opts.subtitle) modal.querySelector('.modal-subtitle').textContent = opts.subtitle;
    else modal.querySelector('.modal-subtitle').remove();

    const body = modal.querySelector('.modal-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body instanceof Node) body.appendChild(opts.body);
    else if (typeof opts.body === 'function') opts.body(body);

    const footer = modal.querySelector('.modal-footer');
    const buttons = opts.buttons || [{ label: 'Close', value: 'close', kind: 'ghost' }];
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-' + (b.kind || 'secondary');
      if (b.size === 'sm') btn.classList.add('btn-sm');
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        if (typeof b.onClick === 'function' && b.onClick(b.value, modal, back) === false) return;
        close();
      });
      footer.appendChild(btn);
    }
    if (!opts.footer) footer.remove();

    function close() {
      if (typeof opts.onClose === 'function' && opts.onClose() === false) return;
      back.remove();
    }
    back.addEventListener('click', (e) => {
      if (e.target === back && !opts.disableBackdropClose) close();
    });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onEsc);
        close();
      }
    });

    modal.querySelector('.modal-close').addEventListener('click', close);
    root.appendChild(back);

    // Auto-focus first field
    setTimeout(() => {
      const f = modal.querySelector('input,textarea,select');
      if (f && opts.autofocus !== false) f.focus();
    }, 50);

    return { root: back, modal, close, body, footer };
  }

  function confirm(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const m = modal({
        title: opts.title || 'Are you sure?',
        subtitle: opts.subtitle,
        body: opts.body || `<p style="color:var(--text-2);font-size:.92rem;line-height:1.5;">${Utils.escapeHtml(opts.message || 'This action cannot be undone.')}</p>`,
        size: opts.size || 'modal-sm',
        disableBackdropClose: opts.danger,
        buttons: [
          { label: opts.cancelLabel || 'Cancel', kind: 'ghost', value: false, onClick: () => { resolve(false); } },
          { label: opts.confirmLabel || 'Confirm', kind: opts.danger ? 'danger' : 'primary', value: true, onClick: () => { resolve(true); } }
        ]
      });
    });
  }

  // ---------- Global Spinner ----------
  function spinner(message) {
    const overlay = document.getElementById('spinnerOverlay');
    if (!overlay) return;
    overlay.hidden = false;
    if (message) {
      // Add a small caption beneath spinner if not already
      let cap = overlay.querySelector('.spinner-cap');
      if (!cap) {
        cap = document.createElement('p');
        cap.className = 'spinner-cap text-center text-muted';
        cap.style.marginTop = '12px';
        cap.style.color = '#fff';
        overlay.querySelector('.spinner').after(cap);
      }
      cap.textContent = message;
    }
  }
  function hideSpinner() {
    const overlay = document.getElementById('spinnerOverlay');
    if (overlay) overlay.hidden = true;
  }

  // ---------- Empty state helper ----------
  function emptyState(message, opts) {
    opts = opts || {};
    const icon = opts.icon || '📭';
    const node = document.createElement('div');
    node.className = 'empty-state reveal';
    node.innerHTML = `
      <div class="empty-state-icon"><span style="font-size:28px;">${icon}</span></div>
      <h3></h3>
      <p></p>
    `;
    node.querySelector('h3').textContent = opts.title || 'Nothing here yet';
    node.querySelector('p').textContent = message;
    if (opts.action) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-sm';
      btn.textContent = opts.actionLabel || 'Get started';
      btn.addEventListener('click', opts.action);
      node.appendChild(btn);
    }
    return node;
  }

  // ---------- Skeletons ----------
  function skeletonCard() {
    const node = document.createElement('div');
    node.className = 'skeleton-card';
    return node;
  }

  // ---------- Avatar DOM node ----------
  function avatarNode(user, size) {
    size = size || 'md';
    const node = document.createElement('img');
    node.className = 'avatar avatar-' + size;
    node.alt = '';
    if (user && user.avatar_url) {
      node.src = user.avatar_url;
      node.onerror = () => {
        const ph = document.createElement('div');
        ph.className = 'avatar avatar-' + size + ' placeholder';
        ph.textContent = Utils.initials(user.full_name || user.username || '?');
        node.replaceWith(ph);
      };
    } else {
      // Replace with placeholder div
      const ph = document.createElement('div');
      ph.className = 'avatar avatar-' + size + ' placeholder';
      ph.textContent = Utils.initials(user && (user.full_name || user.username) || '?');
      node.replaceWith(ph);
      return ph;
    }
    return node;
  }

  // ---------- Close any open modal ----------
  function closeAllModals() {
    const root = document.getElementById('modalRoot');
    if (root) root.innerHTML = '';
  }

  return {
    toast, ok, err, info, warn,
    modal, confirm,
    spinner, hideSpinner,
    emptyState, skeletonCard,
    avatarNode, closeAllModals
  };
})();
