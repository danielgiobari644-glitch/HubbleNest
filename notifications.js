/* =============================================================
   LinkRoom — Notifications
   ============================================================= */

window.Notifications = (function () {
  'use strict';

  let subscription = null;
  let unreadCount = 0;

  async function refreshUnread() {
    try {
      unreadCount = await LR.unreadNotificationCount();
      updateBadges(unreadCount);
      return unreadCount;
    } catch { return 0; }
  }

  function updateBadges(n) {
    unreadCount = n;
    const show = n > 0;
    for (const id of ['notifBadge', 'notifBadgeMobile']) {
      const el = document.getElementById(id);
      if (el) { el.hidden = !show; if (show) el.textContent = n > 99 ? '99+' : String(n); }
    }
    const dot = document.getElementById('notifDot');
    if (dot) dot.hidden = !show;
  }

  // ---------- Realtime subscription ----------
  function subscribe() {
    if (subscription) return;
    subscription = LR.subscribe('linkroom-notifications');
    subscription
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications'
      }, (payload) => {
        const n = payload.new;
        // Only show toast + badge if it belongs to current user
        LR.getUser().then(({ data: { user } }) => {
          if (!user) return;
          if (n.user_id !== user.id) return;
          refreshUnread();
          // Live toast for new notification
          showLiveToast(n);
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'notifications'
      }, () => { refreshUnread(); })
      .subscribe();
  }

  let lastToastKey = null;
  function showLiveToast(n) {
    const key = n.id + ':' + n.created_at;
    if (lastToastKey === key) return;
    lastToastKey = key;
    UI.info(n.title + (n.body ? ' — ' + n.body : ''), { title: 'Notification' });
  }

  function unsubscribe() {
    if (subscription) {
      LR.removeChannel(subscription);
      subscription = null;
    }
  }

  // ---------- Render notifications view ----------
  async function renderView(container) {
    Utils.clear(container);
    container.appendChild(renderHeader());

    const listWrap = Utils.el('div', { style: { padding: '20px', overflowY: 'auto', flex: '1' } });
    const loading = Utils.el('div', { class: 'col gap-md', text: '' });
    for (let i = 0; i < 6; i++) {
      const s = Utils.el('div', { class: 'skeleton', style: { height: '64px' } });
      loading.appendChild(s);
    }
    listWrap.appendChild(loading);
    container.appendChild(listWrap);

    try {
      const items = await LR.listNotifications();
      Utils.clear(listWrap);

      if (!items.length) {
        listWrap.appendChild(UI.emptyState('You\'re all caught up.', { title: 'No notifications', icon: '✓', actionLabel: 'Refresh', action: () => renderView(container) }));
        return;
      }

      // Mark all as read on view
      await LR.markAllNotificationsRead();
      refreshUnread();

      const list = Utils.el('div', { class: 'col' });
      for (const n of items) list.appendChild(renderRow(n));
      listWrap.appendChild(list);
    } catch (e) {
      Utils.clear(listWrap);
      listWrap.appendChild(UI.emptyState('Could not load notifications. ' + (e.message||''), { title: 'Error', icon: '⚠' }));
    }
  }

  function renderHeader() {
    const head = Utils.el('div', { class: 'dash-head', style: { padding: '24px 28px 0', flexShrink: '0' } });
    head.appendChild(Utils.el('div', null,
      Utils.el('h2', { text: 'Notifications' }),
      Utils.el('p', { text: 'Stay up to date with what matters.' })
    ));
    return head;
  }

  function renderRow(n) {
    const row = Utils.el('div', { class: 'request-row', dataset: { id: n.id } });
    if (!n.read) row.style.background = 'var(--accent-soft)';

    const iconWrap = Utils.el('div', { class: 'stat-icon', style: { width: '36px', height: '36px' } });
    iconWrap.textContent = iconForType(n.type);
    row.appendChild(iconWrap);

    const body = Utils.el('div', { class: 'member-info' });
    body.appendChild(Utils.el('div', { class: 'member-name', text: n.title }));
    if (n.body) body.appendChild(Utils.el('div', { class: 'member-handle', text: n.body }));
    row.appendChild(body);

    const meta = Utils.el('div', { class: 'member-status', style: { flexShrink: '0' } });
    meta.textContent = Utils.relativeTime(n.created_at);
    row.appendChild(meta);

    if (n.room_id) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        App.openRoom(n.room_id);
      });
    }
    return row;
  }

  function iconForType(type) {
    const map = {
      join_request: '👤',
      request_approved: '✓',
      request_declined: '✕',
      room_message: '💬',
      private_message: '🔒',
      announcement: '📢',
      file_upload: '📎',
      room_expiring: '⏰',
      room_expired: '⛔',
      reaction: '👍',
      reply: '↩',
      member_removed: '🚪'
    };
    return map[type] || '🔔';
  }

  return { refreshUnread, subscribe, unsubscribe, renderView };
})();
