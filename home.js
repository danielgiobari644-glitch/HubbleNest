/**
 * HubbleNest Home Community Feed
 * Presents the official HubbleNest Community Space (real data) on the dashboard,
 * reusing the existing Space chat system (chat.js) — no duplicate chat backend.
 */

import {
  subscribeToSpaceMessages,
  sendSpaceMessage,
  toggleMessageReaction,
  deleteSpaceMessage,
  unsubscribeFromChat
} from './chat.js';

import { uploadToCloudinary, formatBytes } from './cloudinary.js';

import { showToast, escapeHtml, formatTimeAgo, getAvatarUrl, linkify } from './utils.js';

// Module state
let homeUnsubscribe = null;
let homeGeneration = 0;
let homePendingAttachments = [];
let homeContext = {
  spaceId: null,
  userProfile: null,
  currentUserId: null,
  isAdmin: false
};

function getFileIconSvg(type, filename = '') {
  const t = (type || '').toLowerCase();
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  if (t.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" ${stroke}><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;
  }
  if (t.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" ${stroke}><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>`;
  }
  if (t.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" ${stroke}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 24 24" ${stroke}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

/**
 * Start (or restart) the home community feed subscription
 */
export function startHomeFeed(spaceId, userProfile, currentUserId, isAdmin = false) {
  stopHomeFeed();
  if (!spaceId || !userProfile) return;

  homeGeneration++;
  const gen = homeGeneration;
  homeContext = { spaceId, userProfile, currentUserId, isAdmin };

  homeUnsubscribe = subscribeToSpaceMessages(spaceId, (messages) => {
    if (gen !== homeGeneration) return; // stale listener (space chat took over)
    renderHomeFeed(messages);
  });
}

/**
 * Stop the home feed (no-op safe to call anytime)
 */
export function stopHomeFeed() {
  homeGeneration++;
  homeUnsubscribe = null;
  // Note: chat.js owns the shared listener; openSpace/initChatListener replaces it.
  // We only clear our own bookkeeping here.
}

function renderHomeFeed(messages) {
  const container = document.getElementById('home-feed');
  if (!container) return;

  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 34px 0;">
        <div class="empty-state-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <h4 class="empty-state-title">Start the conversation</h4>
        <p class="empty-state-desc">Say hello or share an update with the HubbleNest community.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = messages.slice(-40).map(msg => {
    const isOwn = msg.senderId === homeContext.currentUserId;
    const canDelete = isOwn || homeContext.isAdmin;

    const reactions = msg.reactions || {};
    const reactionChips = Object.keys(reactions).filter(emoji => reactions[emoji]?.length > 0).map(emoji => {
      const reacted = reactions[emoji].includes(homeContext.currentUserId);
      return `
        <span class="reaction-chip ${reacted ? 'reacted' : ''}" onclick="window.HubbleNest.toggleHomeReaction('${msg.id}', '${emoji}')">
          ${emoji} ${reactions[emoji].length}
        </span>
      `;
    }).join('');

    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
      attachmentsHtml = msg.attachments.map(att => {
        if (att.resourceType === 'image' || att.resourceType === 'images') {
          return `
            <div class="msg-attachment-preview">
              <a href="${att.url}" target="_blank" rel="noopener noreferrer">
                <img src="${att.url}" style="max-height: 240px;" alt="Image" loading="lazy" decoding="async"/>
              </a>
            </div>
          `;
        } else if (att.resourceType === 'video' || att.resourceType === 'videos') {
          return `
            <div class="msg-attachment-preview">
              <video src="${att.url}" controls style="max-height: 250px; width: 100%;"></video>
            </div>
          `;
        } else if (att.resourceType === 'audio') {
          return `
            <div class="msg-attachment-preview">
              <audio src="${att.url}" controls style="width: 100%;"></audio>
            </div>
          `;
        }
        return `
          <div class="msg-attachment-preview" style="display: flex; align-items: center; gap: 9px; background: var(--bg-surface-elevated); padding: 9px 13px; border-radius: 10px;">
            <span style="color: var(--accent-primary);">${getFileIconSvg(att.resourceType, att.originalFilename || '')}</span>
            <a href="${att.url}" target="_blank" rel="noopener noreferrer" style="font-weight: 500; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHtml(att.originalFilename || 'Document')}
            </a>
          </div>
        `;
      }).join('');
    }

    return `
      <div class="message-row ${isOwn ? 'msg-own' : ''}">
        <div class="msg-avatar">
          <img src="${getAvatarUrl(msg.senderPhoto, msg.senderName)}" class="avatar-img" alt="" loading="lazy" decoding="async"/>
        </div>
        <div class="msg-bubble-box">
          <div class="msg-header">
            <span class="msg-sender">${escapeHtml(msg.senderName)}</span>
            <span class="msg-time">${formatTimeAgo(msg.createdAt)}</span>
          </div>
          <div class="msg-bubble">
            <div>${linkify(msg.text)}</div>
            ${attachmentsHtml}
            <div class="msg-actions-hover">
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.toggleHomeReaction('${msg.id}', '👍')" title="Thumbs up">👍</button>
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.toggleHomeReaction('${msg.id}', '❤️')" title="Heart">❤️</button>
              ${canDelete ? `<button class="btn-ghost" style="padding: 2px 6px; color: var(--status-danger);" onclick="window.HubbleNest.deleteHomeMessage('${msg.id}')" title="Delete">🗑</button>` : ''}
            </div>
          </div>
          ${reactionChips ? `<div class="msg-reactions-bar">${reactionChips}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Post from the home composer to the community Space (real message flow)
 */
export async function handleHomePost(spaceId, userProfile, currentUserId, isAdmin) {
  const input = document.getElementById('home-composer-input');
  const text = input ? input.value : '';

  if (!text.trim() && homePendingAttachments.length === 0) {
    showToast('Please write something or attach a file first.', 'warning');
    return;
  }

  const sendBtn = document.getElementById('home-composer-send');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.6';
  }

  try {
    let attachments = [];
    if (homePendingAttachments.length > 0) {
      for (const file of homePendingAttachments) {
        showToast(`Uploading ${file.name}...`, 'info', 2500);
        const result = await uploadToCloudinary(file, () => {}, 100);
        attachments.push({
          url: result.url,
          resourceType: result.resourceType,
          originalFilename: result.originalFilename || file.name,
          size: result.bytes || file.size
        });
      }
    }

    clearAllHomeAttachments();
    if (input) input.value = '';

    await sendSpaceMessage(spaceId, userProfile, {
      text,
      attachments,
      replyTo: null
    });
    showToast('Posted to the community!', 'success', 2200);
  } catch (err) {
    showToast(err.message || 'Failed to post right now', 'error');
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.style.opacity = '';
    }
  }
}

export function stageHomeAttachment(file, maxMB = 100) {
  if (!file) return;
  if (file.size > maxMB * 1024 * 1024) {
    showToast(`File exceeds maximum size of ${maxMB}MB`, 'error');
    return;
  }
  homePendingAttachments.push(file);
  renderHomePendingAttachments();
  showToast(`Attached: ${file.name}`, 'info', 2000);
}

export function removeHomeAttachment(index) {
  homePendingAttachments.splice(index, 1);
  renderHomePendingAttachments();
}

export function clearAllHomeAttachments() {
  homePendingAttachments = [];
  renderHomePendingAttachments();
  const imgInput = document.getElementById('home-image-input');
  const docInput = document.getElementById('home-doc-input');
  if (imgInput) imgInput.value = '';
  if (docInput) docInput.value = '';
}

function renderHomePendingAttachments() {
  const area = document.getElementById('home-pending-attachments-area');
  const grid = document.getElementById('home-pending-attachments-grid');
  if (!area || !grid) return;

  if (homePendingAttachments.length === 0) {
    area.style.display = 'none';
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = homePendingAttachments.map((f, idx) => {
    const isImg = f.type && f.type.startsWith('image/');
    const thumbHtml = isImg
      ? `<img src="${URL.createObjectURL(f)}" class="pending-thumb-img" alt="preview" />`
      : `<span style="color: var(--accent-primary);">${getFileIconSvg(f.type, f.name)}</span>`;

    return `
      <div class="pending-attachment-card">
        <div class="pending-card-thumb">${thumbHtml}</div>
        <div class="pending-card-info">
          <div class="pending-card-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
          <div class="pending-card-size">${formatBytes(f.size)}</div>
        </div>
        <button type="button" class="pending-card-remove" onclick="window.HubbleNest.removeHomeAttachment(${idx})" title="Remove attachment">✕</button>
      </div>
    `;
  }).join('');

  area.style.display = 'block';
}

export { unsubscribeFromChat };
