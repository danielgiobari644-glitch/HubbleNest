/**
 * HubbleNest Main Application Controller
 * Pure Vanilla JavaScript Application Entry Point
 */

import { 
  auth, 
  onAuthStateChanged, 
  doc, 
  getDoc 
} from './firebase.js';

import { 
  signupState, 
  checkUsernameAvailability, 
  finalizeSignup, 
  loginWithEmail, 
  loginWithGoogle, 
  resetPassword, 
  logoutUser, 
  createOrUpdateUserProfile 
} from './auth.js';

import { 
  createSpace, 
  fetchUserSpaces, 
  findSpaceByCode, 
  getMembershipState, 
  requestToJoinSpace, 
  approveJoinRequest, 
  declineJoinRequest, 
  extendSpaceExpiration, 
  updateSpaceSettings, 
  deleteSpace 
} from './spaces.js';

import { 
  subscribeToSpaceMessages, 
  unsubscribeFromChat, 
  sendSpaceMessage, 
  toggleMessageReaction, 
  deleteSpaceMessage 
} from './chat.js';

import { 
  subscribeToUserConversations, 
  subscribeToPrivateMessages, 
  getOrCreateConversation, 
  sendPrivateMessage 
} from './private-chat.js';

import { 
  subscribeToSpaceFiles, 
  uploadSpaceFile, 
  deleteSpaceFile 
} from './files.js';

import { 
  subscribeToAnnouncements, 
  createAnnouncement, 
  togglePinAnnouncement, 
  deleteAnnouncement 
} from './announcements.js';

import { 
  subscribeToSpaceMembers, 
  subscribeToJoinRequests, 
  updateMemberRole, 
  removeMemberFromSpace 
} from './members.js';

import { 
  subscribeToNotifications, 
  markNotificationAsRead, 
  markAllNotificationsAsRead 
} from './notifications.js';

import { 
  uploadToCloudinary, 
  formatBytes, 
  getFileCategory 
} from './cloudinary.js';

import { 
  renderQrToCanvas, 
  generateQrDataUrl, 
  downloadQrCode 
} from './qr.js';

import { 
  executeGlobalSearch 
} from './search.js';

import { 
  initializeTheme, 
  toggleTheme 
} from './settings.js';

import { 
  showToast, 
  escapeHtml, 
  formatTimeAgo, 
  formatDateTime, 
  formatExpiration, 
  copyToClipboard, 
  getAvatarUrl, 
  openModal, 
  closeModal, 
  linkify 
} from './utils.js';

import { 
  getPublicKeyFingerprint, 
  ensureUserKeyPair 
} from './encryption.js';

// Application State
const state = {
  currentUser: null,
  userProfile: null,
  currentView: 'dashboard', // 'auth' | 'dashboard' | 'space' | 'direct'
  userSpaces: [],
  activeCategory: 'All',
  activeSpace: null,
  activeSpaceTab: 'chat',
  activeSpaceRole: 'member',
  spaceMessages: [],
  spaceFiles: [],
  spaceAnnouncements: [],
  spaceMembers: [],
  spaceJoinRequests: [],
  conversations: [],
  activeConversation: null,
  activeDirectPeer: null,
  directMessages: [],
  notifications: [],
  unreadNotifications: 0,
  replyingTo: null
};

// Initialize Theme
initializeTheme();

/* ==========================================================================
   1. AUTHENTICATION & ROUTING
   ========================================================================== */

onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.currentUser = user;
    try {
      state.userProfile = await createOrUpdateUserProfile(user);
    } catch (e) {
      console.warn('Profile sync:', e);
      state.userProfile = {
        uid: user.uid,
        displayName: user.displayName || 'Member',
        email: user.email,
        photoURL: user.photoURL || ''
      };
    }
    setupAuthenticatedUI();
    loadDashboard();
    subscribeNotifications();
    checkUrlJoinParam();
  } else {
    state.currentUser = null;
    state.userProfile = null;
    showAuthView();
  }
});

function setupAuthenticatedUI() {
  const topbar = document.getElementById('main-topbar');
  const appContainer = document.getElementById('app-container');
  const authContainer = document.getElementById('auth-container');

  if (topbar) topbar.style.display = 'flex';
  if (appContainer) appContainer.style.display = 'flex';
  if (authContainer) authContainer.style.display = 'none';

  // Update topbar avatar
  const avatarImg = document.getElementById('user-avatar-topbar');
  if (avatarImg) {
    avatarImg.src = getAvatarUrl(state.userProfile.photoURL, state.userProfile.displayName);
  }

  // Update menu info
  const menuName = document.getElementById('menu-user-name');
  const menuHandle = document.getElementById('menu-user-handle');
  if (menuName) menuName.textContent = state.userProfile.displayName || 'Member';
  if (menuHandle) menuHandle.textContent = `@${state.userProfile.username || 'user'}`;
}

function showAuthView() {
  const topbar = document.getElementById('main-topbar');
  const appContainer = document.getElementById('app-container');
  const authContainer = document.getElementById('auth-container');

  if (topbar) topbar.style.display = 'none';
  if (appContainer) appContainer.style.display = 'none';
  if (authContainer) authContainer.style.display = 'flex';

  resetSignupSteps();
  showLoginCard();
}

function checkUrlJoinParam() {
  const path = window.location.pathname;
  if (path.startsWith('/join/')) {
    const code = path.replace('/join/', '').trim();
    if (code) {
      handleCodeSearch(code);
    }
  }
}

/* ==========================================================================
   2. GRADUAL MULTI-STEP SIGNUP
   ========================================================================== */

function resetSignupSteps() {
  signupState.currentStep = 1;
  signupState.fullName = '';
  signupState.username = '';
  signupState.photoURL = '';
  signupState.email = '';
  signupState.password = '';
  updateSignupStepUI();
}

function updateSignupStepUI() {
  // Update progress bar
  const segments = document.querySelectorAll('.progress-segment');
  segments.forEach((seg, idx) => {
    if (idx < signupState.currentStep) {
      seg.classList.add('active-segment');
    } else {
      seg.classList.remove('active-segment');
    }
  });

  // Switch step panels
  const steps = document.querySelectorAll('.signup-step');
  steps.forEach((st) => st.classList.remove('active-step'));
  const currentPanel = document.getElementById(`step-${signupState.currentStep}`);
  if (currentPanel) currentPanel.classList.add('active-step');
}

export function nextSignupStep() {
  if (signupState.currentStep === 2) {
    const nameInput = document.getElementById('signup-fullname');
    if (!nameInput.value.trim()) {
      showToast('Please enter your full name.', 'warning');
      return;
    }
    signupState.fullName = nameInput.value.trim();
  } else if (signupState.currentStep === 3) {
    if (!signupState.isUsernameAvailable) {
      showToast('Please choose an available username.', 'warning');
      return;
    }
  } else if (signupState.currentStep === 5) {
    const emailInput = document.getElementById('signup-email');
    const val = emailInput.value.trim();
    if (!val || !val.includes('@') || !val.includes('.')) {
      showToast('Please enter a valid email address.', 'warning');
      return;
    }
    signupState.email = val;
  } else if (signupState.currentStep === 6) {
    const pwInput = document.getElementById('signup-password');
    const pwConfirm = document.getElementById('signup-confirm-password');
    if (pwInput.value.length < 6) {
      showToast('Password must be at least 6 characters.', 'warning');
      return;
    }
    if (pwInput.value !== pwConfirm.value) {
      showToast('Passwords do not match.', 'warning');
      return;
    }
    signupState.password = pwInput.value;
  }

  if (signupState.currentStep < 7) {
    signupState.currentStep++;
    updateSignupStepUI();

    if (signupState.currentStep === 7) {
      // Finalize creation
      finalizeSignup(() => {
        // Handled by onAuthStateChanged
      }, (err) => {
        signupState.currentStep = 6;
        updateSignupStepUI();
      });
    }
  }
}

export function prevSignupStep() {
  if (signupState.currentStep > 1) {
    signupState.currentStep--;
    updateSignupStepUI();
  }
}

function showLoginCard() {
  document.getElementById('card-signup').style.display = 'none';
  document.getElementById('card-login').style.display = 'block';
}

function showSignupCard() {
  document.getElementById('card-login').style.display = 'none';
  document.getElementById('card-signup').style.display = 'block';
  resetSignupSteps();
}

/* ==========================================================================
   3. DASHBOARD & SPACES LIST
   ========================================================================== */

async function loadDashboard() {
  state.currentView = 'dashboard';
  unsubscribeFromChat();

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-dashboard').classList.add('active-view');

  // Update nav link
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const navDash = document.getElementById('nav-dash');
  if (navDash) navDash.classList.add('active');

  const greetingEl = document.getElementById('dash-greeting');
  if (greetingEl && state.userProfile) {
    const firstName = (state.userProfile.displayName || 'Member').split(' ')[0];
    greetingEl.textContent = `Welcome back, ${firstName}`;
  }

  renderSpacesGridLoading();
  state.userSpaces = await fetchUserSpaces(state.currentUser.uid);
  renderSpacesGrid();
}

function renderSpacesGridLoading() {
  const container = document.getElementById('spaces-grid');
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⋯</div>
      <div class="empty-state-desc">Loading your spaces...</div>
    </div>
  `;
}

function renderSpacesGrid() {
  const container = document.getElementById('spaces-grid');
  if (!container) return;

  const filtered = state.userSpaces.filter(sp => {
    if (state.activeCategory === 'All') return true;
    return sp.category === state.activeCategory;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
            <path d="M6 6h10"/>
            <path d="M6 10h10"/>
          </svg>
        </div>
        <h3 class="empty-state-title">Your spaces will appear here</h3>
        <p class="empty-state-desc">Create your own private sanctuary or join an existing group with a code or QR invite.</p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button class="btn btn-primary" onclick="window.HubbleNest.openCreateSpaceModal()">Create a Space</button>
          <button class="btn btn-secondary" onclick="window.HubbleNest.openJoinModal()">Join with Code</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(sp => {
    const expInfo = sp.type === 'temporary' ? formatExpiration(sp.expiresAt) : null;
    const coverUrl = sp.imageURL || '';
    const isAdmin = sp.userRole === 'admin';

    return `
      <div class="space-card" onclick="window.HubbleNest.openSpace('${sp.id}')">
        <div class="space-card-cover">
          ${coverUrl ? `<img src="${coverUrl}" class="space-card-cover-img" alt="${escapeHtml(sp.name)}"/>` : `
            <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #1e293b, #0f172a); color: #3b82f6; font-size: 2rem; font-weight: 800;">
              ${escapeHtml(sp.name.slice(0, 2).toUpperCase())}
            </div>
          `}
        </div>
        <div class="space-card-body">
          <div class="space-card-meta">
            <span>${escapeHtml(sp.category || 'Space')}</span>
            <span>·</span>
            <span>${sp.memberCount || 1} members</span>
            ${isAdmin ? `<span>·</span><span class="admin-pill">Admin</span>` : ''}
          </div>
          <h4 class="space-card-title">${escapeHtml(sp.name)}</h4>
          <p class="space-card-desc">${escapeHtml(sp.description || 'Private collaborative workspace.')}</p>
          <div class="space-card-footer">
            <span class="code-chip">${escapeHtml(sp.code || 'HN-SPACE')}</span>
            ${expInfo ? `<span style="color: ${expInfo.urgent ? 'var(--status-danger)' : 'var(--text-muted)'}; font-size: 0.75rem;">${expInfo.text}</span>` : `<span style="color: var(--text-muted); font-size: 0.75rem;">Permanent</span>`}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   4. SPACE DETAIL & CHAT INTERFACE
   ========================================================================== */

export async function openSpace(spaceId) {
  state.currentView = 'space';
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-space-detail').classList.add('active-view');

  // Find space details
  const spaceSnap = await getDoc(doc(db, 'spaces', spaceId));
  if (!spaceSnap.exists()) {
    showToast('Space not found', 'error');
    loadDashboard();
    return;
  }

  state.activeSpace = { id: spaceSnap.id, ...spaceSnap.data() };
  state.activeSpaceRole = await getMembershipState(spaceId, state.currentUser.uid);

  renderSpaceHeader();
  switchSpaceTab('chat');
}

function renderSpaceHeader() {
  const sp = state.activeSpace;
  const titleEl = document.getElementById('space-detail-name');
  const descEl = document.getElementById('space-detail-desc');
  const metaEl = document.getElementById('space-detail-meta');
  const coverEl = document.getElementById('space-hero-cover-container');
  const codeChip = document.getElementById('space-header-code');
  const adminBtn = document.getElementById('space-admin-controls-btn');

  if (titleEl) titleEl.textContent = sp.name;
  if (descEl) descEl.textContent = sp.description || 'Welcome to this space.';
  if (codeChip) codeChip.textContent = sp.code || 'HN-SPACE';

  const exp = sp.type === 'temporary' ? formatExpiration(sp.expiresAt) : null;
  if (metaEl) {
    metaEl.innerHTML = `
      <span>${escapeHtml(sp.category)}</span>
      <span>·</span>
      <span>${sp.memberCount || 1} members</span>
      <span>·</span>
      ${exp ? `<span style="color: ${exp.urgent ? 'var(--status-danger)' : 'inherit'}; font-weight: 500;">${exp.text}</span>` : `<span>Permanent</span>`}
    `;
  }

  if (coverEl) {
    if (sp.imageURL) {
      coverEl.innerHTML = `<img src="${sp.imageURL}" class="space-hero-cover-img" alt="${escapeHtml(sp.name)}"/>`;
    } else {
      coverEl.innerHTML = `<div style="width: 100%; height: 100%; background: linear-gradient(135deg, #1e293b, #0f172a);"></div>`;
    }
  }

  if (adminBtn) {
    adminBtn.style.display = state.activeSpaceRole === 'admin' ? 'inline-flex' : 'none';
  }
}

export function switchSpaceTab(tabName) {
  state.activeSpaceTab = tabName;

  document.querySelectorAll('.space-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabName);
  });

  const containers = {
    chat: document.getElementById('space-tab-chat'),
    files: document.getElementById('space-tab-files'),
    links: document.getElementById('space-tab-links'),
    announcements: document.getElementById('space-tab-announcements'),
    members: document.getElementById('space-tab-members')
  };

  Object.keys(containers).forEach(k => {
    if (containers[k]) containers[k].style.display = k === tabName ? 'block' : 'none';
  });

  // Activate corresponding listeners
  if (tabName === 'chat') {
    initChatListener();
  } else if (tabName === 'files') {
    initFilesListener();
  } else if (tabName === 'links') {
    initLinksListener();
  } else if (tabName === 'announcements') {
    initAnnouncementsListener();
  } else if (tabName === 'members') {
    initMembersListener();
  }
}

function initChatListener() {
  subscribeToSpaceMessages(state.activeSpace.id, (messages) => {
    state.spaceMessages = messages;
    renderChatMessages();
  });
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  if (state.spaceMessages.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 40px 0;">
        <div class="empty-state-icon">💬</div>
        <h4 class="empty-state-title">Start the conversation</h4>
        <p class="empty-state-desc">Say hello or share an update with the members of this Space.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.spaceMessages.map(msg => {
    const isOwn = msg.senderId === state.currentUser.uid;
    const canDelete = isOwn || state.activeSpaceRole === 'admin';

    // Reactions render
    const reactions = msg.reactions || {};
    const reactionChips = Object.keys(reactions).filter(emoji => reactions[emoji]?.length > 0).map(emoji => {
      const reacted = reactions[emoji].includes(state.currentUser.uid);
      return `
        <span class="reaction-chip ${reacted ? 'reacted' : ''}" onclick="window.HubbleNest.toggleReaction('${msg.id}', '${emoji}')">
          ${emoji} ${reactions[emoji].length}
        </span>
      `;
    }).join('');

    // Attachments render
    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
      attachmentsHtml = msg.attachments.map(att => {
        if (att.resourceType === 'image' || att.resourceType === 'images') {
          return `
            <div class="msg-attachment-preview">
              <a href="${att.url}" target="_blank" rel="noopener noreferrer">
                <img src="${att.url}" style="max-height: 200px; border-radius: 6px;" alt="Image"/>
              </a>
            </div>
          `;
        } else if (att.resourceType === 'video' || att.resourceType === 'videos') {
          return `
            <div class="msg-attachment-preview">
              <video src="${att.url}" controls style="max-height: 220px; width: 100%; border-radius: 6px;"></video>
            </div>
          `;
        } else if (att.resourceType === 'audio') {
          return `
            <div class="msg-attachment-preview">
              <audio src="${att.url}" controls style="width: 100%;"></audio>
            </div>
          `;
        } else {
          return `
            <div class="msg-attachment-preview" style="background: var(--bg-surface-elevated); padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
              <span>📄</span>
              <a href="${att.url}" target="_blank" rel="noopener noreferrer" style="font-weight: 500; font-size: 0.85rem; color: var(--accent-primary);">
                ${escapeHtml(att.originalFilename || 'Document')}
              </a>
            </div>
          `;
        }
      }).join('');
    }

    return `
      <div class="message-row ${isOwn ? 'msg-own' : ''}">
        <div class="msg-avatar">
          <img src="${getAvatarUrl(msg.senderPhoto, msg.senderName)}" class="avatar-img" alt=""/>
        </div>
        <div class="msg-bubble-box">
          <div class="msg-header">
            <span class="msg-sender">${escapeHtml(msg.senderName)}</span>
            <span class="msg-time">${formatTimeAgo(msg.createdAt)}</span>
          </div>
          <div class="msg-bubble">
            ${msg.replyTo ? `
              <div class="msg-reply-snippet">
                <strong>${escapeHtml(msg.replyTo.senderName)}</strong>: ${escapeHtml(msg.replyTo.text)}
              </div>
            ` : ''}
            <div>${linkify(msg.text)}</div>
            ${attachmentsHtml}
            <div class="msg-actions-hover">
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.startReply('${msg.id}', '${escapeHtml(msg.senderName)}', '${escapeHtml(msg.text || 'Attachment')}')" title="Reply">↩</button>
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.toggleReaction('${msg.id}', '👍')" title="Thumbs up">👍</button>
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.toggleReaction('${msg.id}', '❤️')" title="Heart">❤️</button>
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.toggleReaction('${msg.id}', '🔥')" title="Fire">🔥</button>
              ${canDelete ? `<button class="btn-ghost" style="padding: 2px 6px; color: var(--status-danger);" onclick="window.HubbleNest.deleteMessage('${msg.id}')" title="Delete">🗑</button>` : ''}
            </div>
          </div>
          ${reactionChips ? `<div class="msg-reactions-bar">${reactionChips}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

export async function handleSendMessage() {
  const input = document.getElementById('chat-input-text');
  const text = input ? input.value : '';

  if (!text.trim()) return;

  try {
    input.value = '';
    const reply = state.replyingTo;
    cancelReply();

    await sendSpaceMessage(state.activeSpace.id, state.userProfile, {
      text: text,
      attachments: [],
      replyTo: reply
    });
  } catch (err) {
    showToast(err.message || 'Failed to send message', 'error');
  }
}

export function startReply(id, senderName, text) {
  state.replyingTo = { id, senderName, text };
  const bar = document.getElementById('chat-replying-bar');
  const textEl = document.getElementById('replying-to-text');
  if (bar && textEl) {
    textEl.textContent = `Replying to ${senderName}: "${text.slice(0, 40)}..."`;
    bar.style.display = 'flex';
  }
  document.getElementById('chat-input-text')?.focus();
}

export function cancelReply() {
  state.replyingTo = null;
  const bar = document.getElementById('chat-replying-bar');
  if (bar) bar.style.display = 'none';
}

/* ==========================================================================
   5. CLOUDINARY ATTACHMENT UPLOAD IN CHAT
   ========================================================================== */

export async function triggerChatAttachmentUpload(file) {
  if (!file) return;

  showToast(`Uploading ${file.name}...`, 'info');
  try {
    const result = await uploadToCloudinary(file, (percent, status) => {
      // Progress reporting
    }, state.activeSpace.settings?.maxFileSizeMB || 100);

    await sendSpaceMessage(state.activeSpace.id, state.userProfile, {
      text: '',
      attachments: [{
        url: result.url,
        resourceType: result.resourceType,
        originalFilename: result.originalFilename,
        size: result.bytes
      }]
    });

    showToast('File sent to chat', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to upload attachment', 'error');
  }
}

/* ==========================================================================
   6. FILES LIBRARY SECTION
   ========================================================================== */

function initFilesListener() {
  subscribeToSpaceFiles(state.activeSpace.id, (files) => {
    state.spaceFiles = files;
    renderFilesLibrary();
  });
}

function renderFilesLibrary() {
  const container = document.getElementById('space-files-grid');
  if (!container) return;

  if (state.spaceFiles.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 48px 0;">
        <div class="empty-state-icon">📁</div>
        <h4 class="empty-state-title">No files shared yet</h4>
        <p class="empty-state-desc">Files shared in this Space will appear here for easy access and organization.</p>
        <button class="btn btn-primary" onclick="document.getElementById('file-upload-input').click()">Upload File</button>
      </div>
    `;
    return;
  }

  container.innerHTML = state.spaceFiles.map(f => {
    const canDelete = f.uploadedBy === state.currentUser.uid || state.activeSpaceRole === 'admin';
    return `
      <div class="file-card">
        <div class="file-header">
          <div class="file-icon-box">
            ${f.category === 'images' ? '🖼️' : f.category === 'videos' ? '🎬' : f.category === 'audio' ? '🎵' : '📄'}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
            <div class="file-meta">${formatBytes(f.size)} · ${formatTimeAgo(f.createdAt)}</div>
          </div>
        </div>
        <div class="file-actions">
          <a href="${f.cloudinaryUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary">
            Open
          </a>
          ${canDelete ? `
            <button class="btn btn-sm btn-ghost" style="color: var(--status-danger);" onclick="window.HubbleNest.deleteFile('${f.id}')">
              Delete
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

export async function handleSpaceFileUpload(file) {
  if (!file) return;

  const progressModal = document.getElementById('modal-upload-progress');
  const bar = document.getElementById('upload-progress-bar');
  const text = document.getElementById('upload-progress-text');

  openModal('modal-upload-progress');

  try {
    await uploadSpaceFile(
      state.activeSpace.id,
      state.userProfile,
      file,
      (percent, status) => {
        if (bar) bar.style.width = `${percent}%`;
        if (text) text.textContent = `${status}`;
      },
      state.activeSpace.settings?.maxFileSizeMB || 100
    );
    closeModal('modal-upload-progress');
  } catch (err) {
    closeModal('modal-upload-progress');
    showToast(err.message || 'File upload failed', 'error');
  }
}

/* ==========================================================================
   7. ANNOUNCEMENTS SECTION
   ========================================================================== */

function initAnnouncementsListener() {
  subscribeToAnnouncements(state.activeSpace.id, (announcements) => {
    state.spaceAnnouncements = announcements;
    renderAnnouncementsList();
  });
}

function renderAnnouncementsList() {
  const container = document.getElementById('announcements-list-container');
  const postBtn = document.getElementById('btn-new-announcement');
  if (postBtn) postBtn.style.display = state.activeSpaceRole === 'admin' ? 'inline-flex' : 'none';

  if (!container) return;

  if (state.spaceAnnouncements.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 48px 0;">
        <div class="empty-state-icon">📢</div>
        <h4 class="empty-state-title">No announcements yet</h4>
        <p class="empty-state-desc">Administrators can post important news, guidelines, and updates here.</p>
        ${state.activeSpaceRole === 'admin' ? `<button class="btn btn-primary" onclick="window.HubbleNest.openNewAnnouncementModal()">Create Announcement</button>` : ''}
      </div>
    `;
    return;
  }

  container.innerHTML = state.spaceAnnouncements.map(ann => {
    const isAdmin = state.activeSpaceRole === 'admin';
    return `
      <div class="announcement-card ${ann.isPinned ? 'pinned' : ''}">
        ${ann.isPinned ? `
          <div class="pinned-badge">
            📌 Pinned Announcement
          </div>
        ` : ''}
        <h3 class="announcement-title">${escapeHtml(ann.title)}</h3>
        <div style="font-size: 0.8rem; color: var(--text-muted);">
          Posted by ${escapeHtml(ann.authorName)} · ${formatDateTime(ann.createdAt)}
        </div>
        <div class="announcement-content">${escapeHtml(ann.content)}</div>
        ${ann.imageURL ? `<img src="${ann.imageURL}" class="announcement-img" alt=""/>` : ''}
        ${isAdmin ? `
          <div style="display: flex; gap: 8px; margin-top: 12px; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
            <button class="btn btn-sm btn-ghost" onclick="window.HubbleNest.togglePin('${ann.id}', ${ann.isPinned})">
              ${ann.isPinned ? 'Unpin' : 'Pin to top'}
            </button>
            <button class="btn btn-sm btn-ghost" style="color: var(--status-danger);" onclick="window.HubbleNest.deleteAnn('${ann.id}')">
              Delete
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   8. MEMBERS & JOIN REQUESTS SECTION
   ========================================================================== */

function initMembersListener() {
  subscribeToSpaceMembers(state.activeSpace.id, (members) => {
    state.spaceMembers = members;
    renderMembersList();
  });

  if (state.activeSpaceRole === 'admin') {
    subscribeToJoinRequests(state.activeSpace.id, (requests) => {
      state.spaceJoinRequests = requests;
      renderJoinRequests();
    });
  }
}

function renderMembersList() {
  const container = document.getElementById('members-list-grid');
  if (!container) return;

  container.innerHTML = state.spaceMembers.map(m => {
    const isMe = m.userId === state.currentUser.uid;
    const isAdmin = m.role === 'admin';
    const canManage = state.activeSpaceRole === 'admin' && !isMe;

    return `
      <div class="member-card">
        <div class="msg-avatar">
          <img src="${getAvatarUrl(m.photoURL, m.displayName)}" class="avatar-img" alt=""/>
        </div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(m.displayName)} ${isMe ? '(You)' : ''}</div>
          <div class="member-role">${isAdmin ? '★ Administrator' : 'Member'}</div>
        </div>
        <div style="display: flex; gap: 6px;">
          ${!isMe ? `
            <button class="btn btn-sm btn-secondary" onclick="window.HubbleNest.startDirectChatWithUser('${m.userId}')" title="Send Private Message">
              Message
            </button>
          ` : ''}
          ${canManage ? `
            <button class="btn btn-sm btn-ghost" onclick="window.HubbleNest.toggleRole('${m.userId}', '${m.role}')" title="Change role">
              ${isAdmin ? 'Demote' : 'Promote'}
            </button>
            <button class="btn btn-sm btn-ghost" style="color: var(--status-danger);" onclick="window.HubbleNest.removeMember('${m.userId}')" title="Remove member">
              ✕
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderJoinRequests() {
  const container = document.getElementById('join-requests-container');
  const countBadge = document.getElementById('join-requests-count-badge');
  if (!container) return;

  if (state.spaceJoinRequests.length === 0) {
    container.style.display = 'none';
    if (countBadge) countBadge.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  if (countBadge) {
    countBadge.textContent = state.spaceJoinRequests.length;
    countBadge.style.display = 'inline-block';
  }

  const listEl = document.getElementById('join-requests-list');
  if (!listEl) return;

  listEl.innerHTML = state.spaceJoinRequests.map(req => {
    return `
      <div class="member-card" style="border-left: 3px solid var(--accent-primary);">
        <div class="msg-avatar">
          <img src="${getAvatarUrl(req.photoURL, req.displayName)}" class="avatar-img" alt=""/>
        </div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(req.displayName)} (@${escapeHtml(req.username)})</div>
          <div class="member-role">${escapeHtml(req.bio || 'Applicant')} · ${formatTimeAgo(req.requestedAt)}</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-sm btn-primary" onclick="window.HubbleNest.approveRequest('${req.userId}')">
            Accept
          </button>
          <button class="btn btn-sm btn-secondary" onclick="window.HubbleNest.declineRequest('${req.userId}')">
            Decline
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   9. LINKS SECTION
   ========================================================================== */

function initLinksListener() {
  import('./links.js').then(mod => {
    mod.subscribeToSpaceLinks(state.activeSpace.id, (links) => {
      const container = document.getElementById('space-links-list');
      if (!container) return;

      if (links.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding: 48px 0;">
            <div class="empty-state-icon">🔗</div>
            <h4 class="empty-state-title">No links saved yet</h4>
            <p class="empty-state-desc">Any URLs shared in chat or added directly will appear here.</p>
            <button class="btn btn-secondary" onclick="window.HubbleNest.openAddLinkModal()">Add Link</button>
          </div>
        `;
        return;
      }

      container.innerHTML = links.map(l => {
        return `
          <div class="file-card">
            <div class="file-header">
              <div class="file-icon-box">🔗</div>
              <div style="flex: 1; min-width: 0;">
                <div class="file-name">${escapeHtml(l.title || l.domain)}</div>
                <div class="file-meta">${escapeHtml(l.domain)} · Shared by ${escapeHtml(l.senderName)}</div>
              </div>
            </div>
            <div class="file-actions">
              <a href="${l.url}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-primary">
                Visit Link
              </a>
              <button class="btn btn-sm btn-secondary" onclick="window.HubbleNest.copyLinkUrl('${escapeHtml(l.url)}')">
                Copy
              </button>
            </div>
          </div>
        `;
      }).join('');
    });
  });
}

/* ==========================================================================
   10. DIRECT MESSAGING (E2E ENCRYPTED)
   ========================================================================== */

export async function openDirectMessagesView() {
  state.currentView = 'direct';
  unsubscribeFromChat();

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-direct-messages').classList.add('active-view');

  // Update nav link
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('nav-direct')?.classList.add('active');

  // Subscribe to conversations
  subscribeToUserConversations(state.currentUser.uid, (convs) => {
    state.conversations = convs;
    renderConversationsList();
  });
}

function renderConversationsList() {
  const container = document.getElementById('direct-conv-list');
  if (!container) return;

  if (state.conversations.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No private conversations yet.<br>Click "+ New" to begin messaging a member.
      </div>
    `;
    return;
  }

  container.innerHTML = state.conversations.map(conv => {
    const peerUid = conv.participants.find(p => p !== state.currentUser.uid);
    const peerData = conv.participantData?.[peerUid] || { displayName: 'Member' };
    const isActive = state.activeConversation?.id === conv.id;

    return `
      <div class="nav-link ${isActive ? 'active' : ''}" onclick="window.HubbleNest.selectConversation('${conv.id}', '${peerUid}')">
        <div class="msg-avatar" style="width: 28px; height: 28px;">
          <img src="${getAvatarUrl(peerData.photoURL, peerData.displayName)}" class="avatar-img" alt=""/>
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.875rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${escapeHtml(peerData.displayName)}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">
            End-to-End Encrypted
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export async function selectConversation(convId, peerUid) {
  // Fetch peer profile
  const peerSnap = await getDoc(doc(db, 'users', peerUid));
  if (!peerSnap.exists()) return;

  const peerData = peerSnap.data();
  state.activeDirectPeer = peerData;
  state.activeConversation = { id: convId };

  // Update header
  const headerName = document.getElementById('direct-chat-peer-name');
  const headerFingerprint = document.getElementById('direct-chat-peer-fingerprint');
  const emptyPlaceholder = document.getElementById('direct-chat-empty');
  const activeChatBox = document.getElementById('direct-chat-active');

  if (headerName) headerName.textContent = peerData.displayName || 'Member';
  if (headerFingerprint) {
    headerFingerprint.textContent = `E2E Security: ${getPublicKeyFingerprint(peerData.publicKeyJwk)}`;
  }

  if (emptyPlaceholder) emptyPlaceholder.style.display = 'none';
  if (activeChatBox) activeChatBox.style.display = 'flex';

  renderConversationsList();

  // Subscribe to messages with local decryption
  subscribeToPrivateMessages(convId, state.userProfile, peerData, (messages) => {
    state.directMessages = messages;
    renderDirectMessages();
  });
}

function renderDirectMessages() {
  const container = document.getElementById('direct-messages-feed');
  if (!container) return;

  container.innerHTML = state.directMessages.map(msg => {
    const isOwn = msg.senderId === state.currentUser.uid;
    const decrypted = msg.decrypted || { text: '...' };

    return `
      <div class="message-row ${isOwn ? 'msg-own' : ''}">
        <div class="msg-bubble-box">
          <div class="msg-bubble">
            ${escapeHtml(decrypted.text || '[Attachment]')}
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; text-align: ${isOwn ? 'right' : 'left'};">
            ${formatTimeAgo(msg.createdAt)} · 🔒 Encrypted
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

export async function handleSendDirectMessage() {
  const input = document.getElementById('direct-message-input');
  if (!input || !input.value.trim() || !state.activeDirectPeer) return;

  const text = input.value.trim();
  input.value = '';

  try {
    await sendPrivateMessage(state.userProfile, state.activeDirectPeer, {
      text: text,
      attachments: []
    });
  } catch (err) {
    showToast(err.message || 'Encryption transmission failed', 'error');
  }
}

export async function startDirectChatWithUser(targetUserId) {
  const userSnap = await getDoc(doc(db, 'users', targetUserId));
  if (!userSnap.exists()) {
    showToast('Member not found', 'error');
    return;
  }

  const peerData = userSnap.data();
  const conv = await getOrCreateConversation(state.userProfile, peerData);
  openDirectMessagesView();
  setTimeout(() => {
    selectConversation(conv.id, targetUserId);
  }, 200);
}

/* ==========================================================================
   11. NOTIFICATIONS
   ========================================================================== */

function subscribeNotifications() {
  subscribeToNotifications(state.currentUser.uid, (notifs, unread) => {
    state.notifications = notifs;
    state.unreadNotifications = unread;

    const badge = document.getElementById('notif-badge-dot');
    if (badge) badge.style.display = unread > 0 ? 'block' : 'none';

    renderNotificationsPanel();
  });
}

function renderNotificationsPanel() {
  const listEl = document.getElementById('notifications-dropdown-list');
  if (!listEl) return;

  if (state.notifications.length === 0) {
    listEl.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">You're all caught up.</div>`;
    return;
  }

  listEl.innerHTML = state.notifications.map(n => {
    return `
      <div class="menu-item ${n.isRead ? '' : 'unread'}" style="flex-direction: column; align-items: flex-start; cursor: pointer; border-left: ${n.isRead ? 'none' : '3px solid var(--accent-primary)'};" onclick="window.HubbleNest.handleNotificationClick('${n.id}', '${n.spaceId || ''}')">
        <div style="font-weight: 600; font-size: 0.85rem;">${escapeHtml(n.title)}</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(n.body)}</div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">${formatTimeAgo(n.createdAt)}</div>
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   12. QR CODE & SPACE CODE MODALS
   ========================================================================== */

export function openQrModal() {
  if (!state.activeSpace) return;
  const canvas = document.getElementById('space-qr-canvas');
  const codeText = document.getElementById('qr-modal-code-display');
  const spaceNameText = document.getElementById('qr-modal-space-name');

  const joinUrl = `${window.location.origin}/join/${state.activeSpace.code}`;

  if (canvas) renderQrToCanvas(canvas, joinUrl, 260);
  if (codeText) codeText.textContent = state.activeSpace.code;
  if (spaceNameText) spaceNameText.textContent = state.activeSpace.name;

  openModal('modal-space-qr');
}

export async function downloadSpaceQr() {
  if (!state.activeSpace) return;
  const joinUrl = `${window.location.origin}/join/${state.activeSpace.code}`;
  const dataUrl = await generateQrDataUrl(joinUrl, 400);
  downloadQrCode(dataUrl, state.activeSpace.name, state.activeSpace.code);
}

export function copySpaceJoinLink() {
  if (!state.activeSpace) return;
  const joinUrl = `${window.location.origin}/join/${state.activeSpace.code}`;
  copyToClipboard(joinUrl, 'Join link copied to clipboard');
}

/* ==========================================================================
   13. JOIN SPACE VIA CODE OR URL
   ========================================================================== */

export async function handleCodeSearch(code) {
  if (!code || !code.trim()) {
    showToast('Please enter a Space code.', 'warning');
    return;
  }

  showToast('Locating Space...', 'info', 1500);
  const foundSpace = await findSpaceByCode(code);

  if (!foundSpace) {
    showToast('No Space found matching this code.', 'error');
    return;
  }

  // Show Preview Modal
  const previewName = document.getElementById('preview-space-name');
  const previewDesc = document.getElementById('preview-space-desc');
  const previewMeta = document.getElementById('preview-space-meta');
  const previewBtn = document.getElementById('btn-request-join-action');

  if (previewName) previewName.textContent = foundSpace.name;
  if (previewDesc) previewDesc.textContent = foundSpace.description || 'Private Space';
  if (previewMeta) {
    previewMeta.textContent = `${foundSpace.category} · ${foundSpace.memberCount || 1} members · ${foundSpace.type === 'temporary' ? 'Temporary' : 'Permanent'}`;
  }

  // Check current status
  const currentStatus = await getMembershipState(foundSpace.id, state.currentUser?.uid);
  if (previewBtn) {
    if (currentStatus === 'member' || currentStatus === 'admin') {
      previewBtn.textContent = 'Open Space';
      previewBtn.onclick = () => {
        closeModal('modal-space-preview');
        openSpace(foundSpace.id);
      };
    } else if (currentStatus === 'pending') {
      previewBtn.textContent = 'Request Pending';
      previewBtn.disabled = true;
    } else {
      previewBtn.textContent = 'Request to Join';
      previewBtn.disabled = false;
      previewBtn.onclick = async () => {
        await requestToJoinSpace(foundSpace.id, state.userProfile);
        closeModal('modal-space-preview');
      };
    }
  }

  closeModal('modal-join-space');
  openModal('modal-space-preview');
}

/* ==========================================================================
   14. CREATE SPACE HANDLER
   ========================================================================== */

export async function handleCreateSpaceSubmit() {
  const nameInput = document.getElementById('create-space-name');
  const descInput = document.getElementById('create-space-desc');
  const catInput = document.getElementById('create-space-category');
  const typeInput = document.getElementById('create-space-type');
  const expInput = document.getElementById('create-space-expiration');
  const submitBtn = document.getElementById('btn-submit-create-space');

  if (!nameInput.value.trim()) {
    showToast('Space name is required.', 'warning');
    return;
  }

  if (submitBtn) submitBtn.classList.add('btn-loading');

  try {
    const newSpace = await createSpace(state.currentUser, {
      name: nameInput.value.trim(),
      description: descInput ? descInput.value.trim() : '',
      category: catInput ? catInput.value : 'Community',
      type: typeInput ? typeInput.value : 'permanent',
      expiresAt: expInput && expInput.value ? expInput.value : null
    });

    closeModal('modal-create-space');
    showToast(`"${newSpace.name}" created!`, 'success');
    openSpace(newSpace.id);
  } catch (err) {
    showToast(err.message || 'Failed to create Space', 'error');
  } finally {
    if (submitBtn) submitBtn.classList.remove('btn-loading');
  }
}

/* ==========================================================================
   15. GLOBAL SEARCH
   ========================================================================== */

export async function handleSearchInput(term) {
  const resultsContainer = document.getElementById('global-search-results');
  if (!resultsContainer) return;

  if (!term || term.trim().length < 2) {
    resultsContainer.innerHTML = `<div style="padding: 16px; color: var(--text-muted); text-align: center;">Type at least 2 characters to search...</div>`;
    return;
  }

  const results = await executeGlobalSearch(term, state.currentUser?.uid);

  let html = '';
  if (results.spaces.length > 0) {
    html += `<div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); padding: 8px 12px; font-weight: 600;">Spaces</div>`;
    html += results.spaces.map(s => `
      <div class="menu-item" onclick="window.HubbleNest.handleSelectSearchResult('space', '${s.id}')">
        📁 <span>${escapeHtml(s.name)}</span> <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: auto;">${escapeHtml(s.code || '')}</span>
      </div>
    `).join('');
  }

  if (results.people.length > 0) {
    html += `<div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); padding: 8px 12px; font-weight: 600;">People</div>`;
    html += results.people.map(p => `
      <div class="menu-item" onclick="window.HubbleNest.handleSelectSearchResult('user', '${p.uid}')">
        👤 <span>${escapeHtml(p.displayName)}</span> <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: auto;">@${escapeHtml(p.username)}</span>
      </div>
    `).join('');
  }

  if (!html) {
    html = `<div style="padding: 16px; color: var(--text-muted); text-align: center;">No matches found.</div>`;
  }

  resultsContainer.innerHTML = html;
}

/* ==========================================================================
   WINDOW EXPOSURES (FOR ONCLICK HANDLERS IN CLEAN VANILLA JS)
   ========================================================================== */

window.HubbleNest = {
  // Navigation
  loadDashboard,
  openSpace,
  switchSpaceTab,
  openDirectMessagesView,

  // Auth & Signup
  showLoginCard,
  showSignupCard,
  nextSignupStep,
  prevSignupStep,
  loginWithEmail: async () => {
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    await loginWithEmail(e, p);
  },
  loginWithGoogle,
  resetPassword: () => {
    const e = prompt('Enter your account email for password reset:');
    if (e) resetPassword(e);
  },
  logoutUser,

  // Spaces
  openCreateSpaceModal: () => openModal('modal-create-space'),
  handleCreateSpaceSubmit,
  openJoinModal: () => openModal('modal-join-space'),
  handleCodeSearch,
  openQrModal,
  downloadSpaceQr,
  copySpaceJoinLink,

  // Chat
  handleSendMessage,
  startReply,
  cancelReply,
  toggleReaction: (msgId, emoji) => toggleMessageReaction(state.activeSpace.id, msgId, emoji, state.currentUser.uid),
  deleteMessage: (msgId) => deleteSpaceMessage(state.activeSpace.id, msgId),
  triggerChatAttachmentUpload,

  // Direct Messages
  selectConversation,
  handleSendDirectMessage,
  startDirectChatWithUser,

  // Files
  handleSpaceFileUpload,
  deleteFile: (fileId) => deleteSpaceFile(state.activeSpace.id, fileId),

  // Announcements
  openNewAnnouncementModal: () => openModal('modal-create-announcement'),
  handleCreateAnnouncement: async () => {
    const title = document.getElementById('ann-title-input').value;
    const content = document.getElementById('ann-content-input').value;
    const pinned = document.getElementById('ann-pinned-input').checked;
    await createAnnouncement(state.activeSpace.id, state.userProfile, { title, content, isPinned: pinned });
    closeModal('modal-create-announcement');
  },
  togglePin: (id, curr) => togglePinAnnouncement(state.activeSpace.id, id, curr),
  deleteAnn: (id) => deleteAnnouncement(state.activeSpace.id, id),

  // Members & Admin
  toggleRole: (uid, currRole) => updateMemberRole(state.activeSpace.id, uid, currRole === 'admin' ? 'member' : 'admin'),
  removeMember: (uid) => removeMemberFromSpace(state.activeSpace.id, uid),
  approveRequest: (uid) => {
    const req = state.spaceJoinRequests.find(r => r.userId === uid);
    if (req) approveJoinRequest(state.activeSpace.id, req);
  },
  declineRequest: (uid) => {
    const req = state.spaceJoinRequests.find(r => r.userId === uid);
    if (req) declineJoinRequest(state.activeSpace.id, req);
  },

  // Space Admin Controls
  openAdminSettingsModal: () => {
    if (!state.activeSpace) return;
    document.getElementById('edit-space-name').value = state.activeSpace.name || '';
    document.getElementById('edit-space-desc').value = state.activeSpace.description || '';
    openModal('modal-space-settings');
  },
  handleSaveSpaceSettings: async () => {
    const name = document.getElementById('edit-space-name').value;
    const desc = document.getElementById('edit-space-desc').value;
    await updateSpaceSettings(state.activeSpace.id, { name, description: desc });
    state.activeSpace.name = name;
    state.activeSpace.description = desc;
    renderSpaceHeader();
    closeModal('modal-space-settings');
  },
  handleExtendExpiration: async () => {
    await extendSpaceExpiration(state.activeSpace.id, 7);
    closeModal('modal-space-settings');
    openSpace(state.activeSpace.id);
  },
  handleDeleteSpace: async () => {
    if (confirm(`Are you sure you want to delete "${state.activeSpace.name}"? This action cannot be undone.`)) {
      await deleteSpace(state.activeSpace.id);
      closeModal('modal-space-settings');
      loadDashboard();
    }
  },

  // Search & Global
  openSearchModal: () => {
    openModal('modal-global-search');
    document.getElementById('global-search-input')?.focus();
  },
  handleSearchInput,
  handleSelectSearchResult: (type, id) => {
    closeModal('modal-global-search');
    if (type === 'space') openSpace(id);
    else if (type === 'user') startDirectChatWithUser(id);
  },

  // Profile & Theme
  toggleTheme,
  toggleProfileMenu: () => {
    const menu = document.getElementById('profile-dropdown-menu');
    if (menu) menu.classList.toggle('menu-active');
  },
  toggleNotificationsMenu: () => {
    const menu = document.getElementById('notifications-dropdown-menu');
    if (menu) menu.classList.toggle('menu-active');
  },
  openProfileModal: () => {
    if (!state.userProfile) return;
    document.getElementById('profile-edit-name').value = state.userProfile.displayName || '';
    document.getElementById('profile-edit-bio').value = state.userProfile.bio || '';
    document.getElementById('profile-fingerprint-display').textContent = getPublicKeyFingerprint(state.userProfile.publicKeyJwk);
    openModal('modal-user-profile');
  },
  handleSaveProfile: async () => {
    const name = document.getElementById('profile-edit-name').value;
    const bio = document.getElementById('profile-edit-bio').value;
    const { updateUserProfile } = await import('./profile.js');
    await updateUserProfile(state.currentUser.uid, { displayName: name, bio });
    state.userProfile.displayName = name;
    state.userProfile.bio = bio;
    setupAuthenticatedUI();
    closeModal('modal-user-profile');
  },

  // Modals
  closeModal: (id) => closeModal(id),
  copyLinkUrl: (url) => copyToClipboard(url, 'Link copied'),
  copySpaceCode: () => {
    if (state.activeSpace?.code) copyToClipboard(state.activeSpace.code, 'Space code copied');
  }
};

// Global click to close dropdown menus
document.addEventListener('click', (e) => {
  if (!e.target.closest('#user-avatar-btn') && !e.target.closest('#profile-dropdown-menu')) {
    document.getElementById('profile-dropdown-menu')?.classList.remove('menu-active');
  }
  if (!e.target.closest('#notif-bell-btn') && !e.target.closest('#notifications-dropdown-menu')) {
    document.getElementById('notifications-dropdown-menu')?.classList.remove('menu-active');
  }
});

// Category filtering click handlers
document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.category-tabs .tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      state.activeCategory = btn.dataset.category || 'All';
      renderSpacesGrid();
    });
  });
});
