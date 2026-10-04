/**
 * HubbleNest Main Application Controller
 * Pure Vanilla JavaScript Application Entry Point
 */

// Namespace is created as early as possible. index.html also installs no-op
// stubs in <head> so inline onclick handlers can never throw
// "Cannot read properties of undefined" even if a module fails to load.
// NOTE: ES module imports below are hoisted & evaluated before this line —
// the <head> shim covers failures inside those imports too.
window.HubbleNest = window.HubbleNest || {};

import { 
  auth, 
  db,
  onAuthStateChanged, 
  doc, 
  getDoc,
  collection,
  addDoc,
  serverTimestamp 
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
  updateSpaceCover,
  deleteSpace,
  ensureUserSupportMembership,
  ensureOfficialSupportSpace,
  OFFICIAL_SUPPORT_CODE,
  OFFICIAL_SUPPORT_SPACE_ID
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
  sendPrivateMessage,
  deletePrivateMessage,
  getConversationId
} from './private-chat.js';

import {
  sendChatRequest,
  acceptChatRequest,
  declineChatRequest,
  cancelChatRequest,
  subscribeToIncomingRequests,
  getChatRelationship
} from './chat-requests.js';

import {
  fetchPeopleDirectory,
  searchPeopleDirectory,
  fetchPublicUserCard
} from './people.js';

import {
  uploadProfilePhoto,
  updateUserProfile
} from './profile.js';

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
  markAllNotificationsAsRead,
  requestPushPermission,
  initWebPushNotifications
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

// Home community feed (reuses the Space chat system for the official community Space)
import {
  startHomeFeed,
  stopHomeFeed,
  handleHomePost,
  stageHomeAttachment as stageHomeFile,
  removeHomeAttachment,
  clearAllHomeAttachments
} from './home.js';

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
  people: [],
  incomingChatRequests: [],
  selectedUserCard: null,
  notifications: [],
  unreadNotifications: 0,
  replyingTo: null,
  pendingAttachment: null,
  pendingAttachments: [],
  directPendingAttachment: null,
  directPendingAttachments: [],
  directReplyingTo: null,
  previousView: 'dashboard'
};

/* ==========================================================================
   PWA INSTALL (hero "Download App" button) & EARLY SERVICE WORKER
   ========================================================================== */

let deferredInstallPrompt = null;

// Register the service worker as early as possible so the PWA is
// installable even on the public landing page (and works offline there).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIosSafari() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    && !/crios|fxios|edgiOS/i.test(navigator.userAgent);
}

function refreshHeroInstallButton() {
  const btn = document.getElementById('hero-install-btn');
  if (!btn) return;

  // Already installed / running as an app → no need for the button.
  if (isStandaloneDisplay()) {
    btn.style.display = 'none';
    return;
  }

  const installable = !!deferredInstallPrompt;
  const iosGuided = isIosSafari();
  if (installable || iosGuided) {
    const label = document.getElementById('hero-install-label');
    if (label) label.textContent = iosGuided && !installable ? 'Add to Home Screen' : 'Download App';
    btn.style.display = 'inline-flex';
  } else {
    btn.style.display = 'none';
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  // Capture the native install prompt so the hero button can trigger it.
  e.preventDefault();
  deferredInstallPrompt = e;
  refreshHeroInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  refreshHeroInstallButton();
  showToast('HubbleNest installed! Find it on your home screen.', 'success', 5000);
});

export async function handleInstallClick() {
  if (isIosSafari() && !deferredInstallPrompt) {
    // iOS Safari has no programmatic install prompt — show guided steps.
    const sheet = document.getElementById('modal-install-ios');
    if (sheet) sheet.style.display = 'flex';
    return;
  }
  if (!deferredInstallPrompt) {
    showToast('Your browser will offer installation shortly — or use its menu → “Install app”.', 'info', 6000);
    return;
  }
  try {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('Installing HubbleNest…', 'success');
    } else {
      showToast('No problem — you can install anytime from the Download App button.', 'info', 4000);
    }
    deferredInstallPrompt = null;
    refreshHeroInstallButton();
  } catch (err) {
    console.warn('Install prompt failed:', err);
    deferredInstallPrompt = null;
    refreshHeroInstallButton();
    showToast('The install banner is unavailable right now. Use your browser menu → “Install app”.', 'info', 6000);
  }
}

export function closeInstallIosSheet() {
  const sheet = document.getElementById('modal-install-ios');
  if (sheet) sheet.style.display = 'none';
}

/* ==========================================================================
   PUSH NOTIFICATION OPT-IN NUDGE
   ========================================================================== */

function maybeShowPushNudge() {
  const nudge = document.getElementById('push-nudge');
  if (!nudge) return;

  const supported = ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
  const dismissed = localStorage.getItem('hn-push-nudge-dismissed') === '1';

  if (supported && Notification.permission === 'default' && !dismissed) {
    nudge.style.display = 'flex';
  } else if (supported && Notification.permission === 'granted' && state.currentUser) {
    // Silently (re)register the FCM token for this device.
    initWebPushNotifications(state.currentUser.uid);
  }
}

export async function enablePushFromNudge() {
  const nudge = document.getElementById('push-nudge');
  try {
    if (!state.currentUser) return;
    const ok = await requestPushPermission(state.currentUser.uid);
    if (nudge) nudge.style.display = 'none';
    if (ok) {
      localStorage.setItem('hn-push-nudge-dismissed', '1');
      showToast('Notifications enabled! You will be alerted even when the app is closed.', 'success', 6000);
    } else {
      showToast('Notifications could not be activated in this browser.', 'warning');
    }
  } catch (err) {
    if (nudge) nudge.style.display = 'none';
    console.warn('Push opt-in failed:', err);
  }
}

export function dismissPushNudge() {
  const nudge = document.getElementById('push-nudge');
  if (nudge) nudge.style.display = 'none';
  localStorage.setItem('hn-push-nudge-dismissed', '1');
}

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

    // Compulsory official support space auto-membership
    try {
      await ensureUserSupportMembership(state.userProfile);
    } catch (err) {
      console.warn('Support space membership sync:', err);
    }

    setupAuthenticatedUI();
    loadDashboard();
    subscribeNotifications();
    checkUrlJoinParam();
  } else {
    state.currentUser = null;
    state.userProfile = null;
    showLandingPage();
  }
});

function setupAuthenticatedUI() {
  const topbar = document.getElementById('main-topbar');
  const appContainer = document.getElementById('app-container');
  const authContainer = document.getElementById('auth-container');
  const landingContainer = document.getElementById('landing-page-container');

  if (landingContainer) landingContainer.style.display = 'none';
  if (authContainer) authContainer.style.display = 'none';
  if (topbar) topbar.style.display = 'flex';
  if (appContainer) appContainer.style.display = 'flex';

  // Mobile bottom nav (Home/People/Direct/Join/Profile) belongs to the APP only —
  // never render it on the landing or auth pages.
  document.body.classList.add('hn-app-active');

  // Update topbar avatar
  const avatarImg = document.getElementById('user-avatar-topbar');
  if (avatarImg) {
    avatarImg.src = getAvatarUrl(state.userProfile.photoURL, state.userProfile.displayName);
  }

  // Update sidebar user card
  const sidebarAvatar = document.getElementById('sidebar-user-avatar');
  if (sidebarAvatar) {
    sidebarAvatar.src = getAvatarUrl(state.userProfile.photoURL, state.userProfile.displayName);
  }
  const sidebarName = document.getElementById('sidebar-user-name');
  if (sidebarName) sidebarName.textContent = state.userProfile.displayName || 'Member';
  const sidebarHandle = document.getElementById('sidebar-user-handle');
  if (sidebarHandle) sidebarHandle.textContent = `@${state.userProfile.username || 'user'}`;

  // Update home composer avatar
  const composerAvatar = document.getElementById('home-composer-avatar');
  if (composerAvatar) {
    composerAvatar.src = getAvatarUrl(state.userProfile.photoURL, state.userProfile.displayName);
  }

  // Update menu info
  const menuName = document.getElementById('menu-user-name');
  const menuHandle = document.getElementById('menu-user-handle');
  if (menuName) menuName.textContent = state.userProfile.displayName || 'Member';
  if (menuHandle) menuHandle.textContent = `@${state.userProfile.username || 'user'}`;

  // Subscribe to incoming chat requests
  subscribeToIncomingRequests(state.currentUser.uid, (requests) => {
    state.incomingChatRequests = requests;
    const badge = document.getElementById('direct-requests-badge');
    const countEl = document.getElementById('direct-requests-count');
    const container = document.getElementById('direct-requests-container');

    if (badge) {
      if (requests.length > 0) {
        badge.textContent = requests.length;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    if (countEl) countEl.textContent = requests.length;
    if (container) {
      container.style.display = requests.length > 0 ? 'block' : 'none';
    }

    renderDirectRequests();
  });

  // Offer push notification opt-in (once, dismissible) or refresh device token
  maybeShowPushNudge();
}

export function showLandingPage() {
  const topbar = document.getElementById('main-topbar');
  const appContainer = document.getElementById('app-container');
  const authContainer = document.getElementById('auth-container');
  const landingContainer = document.getElementById('landing-page-container');
  const userBanner = document.getElementById('landing-user-banner');

  if (topbar) topbar.style.display = 'none';
  if (appContainer) appContainer.style.display = 'none';
  if (authContainer) authContainer.style.display = 'none';
  if (landingContainer) landingContainer.style.display = 'block';

  // Landing page must never show the app's mobile bottom nav.
  document.body.classList.remove('hn-app-active');

  if (state.currentUser && userBanner) {
    userBanner.style.display = 'flex';
  } else if (userBanner) {
    userBanner.style.display = 'none';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function showAuthView(mode = 'entry') {
  const topbar = document.getElementById('main-topbar');
  const appContainer = document.getElementById('app-container');
  const authContainer = document.getElementById('auth-container');
  const landingContainer = document.getElementById('landing-page-container');

  if (topbar) topbar.style.display = 'none';
  if (appContainer) appContainer.style.display = 'none';
  if (landingContainer) landingContainer.style.display = 'none';
  if (authContainer) authContainer.style.display = 'flex';

  // Auth pages must never show the app's mobile bottom nav.
  document.body.classList.remove('hn-app-active');

  if (mode === 'signup') {
    showSignupCard();
  } else if (mode === 'login') {
    showLoginCard();
  } else {
    showAuthEntryCard();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function showAuthEntryCard() {
  const entryCard = document.getElementById('card-auth-entry');
  const loginCard = document.getElementById('card-login');
  const signupCard = document.getElementById('card-signup');

  if (entryCard) entryCard.style.display = 'block';
  if (loginCard) loginCard.style.display = 'none';
  if (signupCard) signupCard.style.display = 'none';
}

export function handleHeroCodeJoin() {
  const input = document.getElementById('hero-space-code-input');
  const raw = input ? input.value.trim().toUpperCase() : '';
  processLandingCode(raw);
}

export function handleLandingCodeJoin() {
  const input = document.getElementById('landing-join-code-input');
  const raw = input ? input.value.trim().toUpperCase() : '';
  processLandingCode(raw);
}

function processLandingCode(rawCode) {
  if (!rawCode) {
    showToast('Please enter a 6-character space code.', 'warning');
    return;
  }
  const cleanCode = rawCode.startsWith('HN-') ? rawCode : `HN-${rawCode}`;
  
  if (cleanCode === OFFICIAL_SUPPORT_CODE) {
    if (state.currentUser) {
      ensureUserSupportMembership(state.currentUser).then(() => {
        openSpace(OFFICIAL_SUPPORT_SPACE_ID);
      });
    } else {
      sessionStorage.setItem('pendingJoinCode', OFFICIAL_SUPPORT_CODE);
      showToast('Official HubbleNest Space! Sign in or create an account to enter.', 'info', 5000);
      showAuthView('entry');
    }
    return;
  }

  if (state.currentUser) {
    handleCodeSearch(cleanCode);
  } else {
    sessionStorage.setItem('pendingJoinCode', cleanCode);
    showToast(`Code ${cleanCode} saved! Sign in or create an account to enter this Space.`, 'info', 5000);
    showAuthView('entry');
  }
}

async function checkUrlJoinParam() {
  const pendingCode = sessionStorage.getItem('pendingJoinCode');
  if (pendingCode) {
    sessionStorage.removeItem('pendingJoinCode');
    const clean = pendingCode.trim().toUpperCase();
    if (clean === OFFICIAL_SUPPORT_CODE) {
      if (state.currentUser) {
        await ensureUserSupportMembership(state.currentUser);
        openSpace(OFFICIAL_SUPPORT_SPACE_ID);
        return;
      }
    }
    handleCodeSearch(pendingCode);
    return;
  }

  // Universal invite formats that work on ANY static host (including
  // GitHub Pages project subpaths): #join=CODE or ?join=CODE
  const hashMatch = window.location.hash.match(/^#join=([A-Za-z0-9]+)/);
  const queryMatch = new URLSearchParams(window.location.search).get('join');
  const deepLinkCode = (hashMatch && hashMatch[1]) || (queryMatch && queryMatch.trim());
  if (deepLinkCode) {
    // Clean the URL so refreshing doesn't re-trigger the join flow
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search.replace(/[?&]join=[^&]+/, '') );
    } catch (e) { /* non-fatal */ }
    processLandingCode(deepLinkCode);
    return;
  }

  const path = window.location.pathname;
  if (path.startsWith('/join/')) {
    const code = path.replace('/join/', '').trim().toUpperCase();
    if (code) {
      if (code === OFFICIAL_SUPPORT_CODE) {
        if (state.currentUser) {
          await ensureUserSupportMembership(state.currentUser);
          openSpace(OFFICIAL_SUPPORT_SPACE_ID);
          return;
        } else {
          sessionStorage.setItem('pendingJoinCode', OFFICIAL_SUPPORT_CODE);
          showAuthView('entry');
          return;
        }
      }
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

export function showLoginCard() {
  const entry = document.getElementById('card-auth-entry');
  const signup = document.getElementById('card-signup');
  const login = document.getElementById('card-login');
  if (entry) entry.style.display = 'none';
  if (signup) signup.style.display = 'none';
  if (login) login.style.display = 'block';
}

export function showSignupCard() {
  const entry = document.getElementById('card-auth-entry');
  const login = document.getElementById('card-login');
  const signup = document.getElementById('card-signup');
  if (entry) entry.style.display = 'none';
  if (login) login.style.display = 'none';
  if (signup) signup.style.display = 'block';
  resetSignupSteps();
}

/* ==========================================================================
   3. DASHBOARD & SPACES LIST
   ========================================================================== */

async function loadDashboard() {
  state.currentView = 'dashboard';
  unsubscribeFromChat();

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-dashboard')?.classList.add('active-view');

  // Update nav link
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const navDash = document.getElementById('nav-dash');
  if (navDash) navDash.classList.add('active');

  const greetingEl = document.getElementById('dash-greeting');
  if (greetingEl && state.userProfile) {
    const firstName = (state.userProfile.displayName || 'Member').split(' ')[0];
    greetingEl.textContent = `Welcome back, ${firstName} 👋`;
  }

  const avatarEl = document.getElementById('dash-hero-avatar');
  if (avatarEl && state.userProfile) {
    avatarEl.src = getAvatarUrl(state.userProfile.photoURL, state.userProfile.displayName);
  }

  renderSpacesGridLoading();
  state.userSpaces = await fetchUserSpaces(state.currentUser.uid);

  // Mobile bottom nav: Home tab active
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mob-nav-spaces')?.classList.add('active');

  updateCategoryCounts();

  renderSpacesGrid();
  renderSidebarSpaces();
  renderDashRail();
  startHomeCommunityFeed();
}

/**
 * Refresh the category badge counts on the Your Spaces page.
 */
function updateCategoryCounts() {
  const categories = ['All', 'Classroom', 'Study Group', 'Church & Fellowship', 'Team & Project', 'Community', 'Workshop'];
  const catKeyMap = {
    'All': 'All',
    'Classroom': 'Classroom',
    'Study Group': 'StudyGroup',
    'Church & Fellowship': 'Fellowship',
    'Team & Project': 'Team',
    'Community': 'Community',
    'Workshop': 'Workshop'
  };
  categories.forEach(cat => {
    const elId = `cat-count-${catKeyMap[cat]}`;
    const badge = document.getElementById(elId);
    if (badge) {
      const count = cat === 'All' ? state.userSpaces.length : state.userSpaces.filter(s => s.category === cat).length;
      badge.textContent = count;
    }
  });
}

/**
 * Dedicated "Your Spaces" page — opened from the sidebar, the dashboard
 * quick action, or anywhere else spaces need to be browsed.
 */
export async function openMySpacesPage() {
  state.currentView = 'my-spaces';
  unsubscribeFromChat();

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-my-spaces')?.classList.add('active-view');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('sidebar-nav-spaces')?.classList.add('active');

  // Mobile bottom nav has no Spaces tab — clear stale highlights
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

  // Reset search each visit for a clean slate
  state.spaceSearchQuery = '';
  const searchInput = document.getElementById('spaces-search-input');
  if (searchInput) searchInput.value = '';

  renderSpacesGridLoading();
  state.userSpaces = await fetchUserSpaces(state.currentUser.uid);
  updateCategoryCounts();
  renderSpacesGrid();
  renderSidebarSpaces();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Live search filter for the Your Spaces page (name, code, description).
 */
export function handleSpacesSearch(rawQuery) {
  state.spaceSearchQuery = (rawQuery || '').trim().toLowerCase();
  renderSpacesGrid();
}

/**
 * Render real user Spaces into the left sidebar ("YOUR SPACES")
 */
function renderSidebarSpaces() {
  const list = document.getElementById('sidebar-spaces-list');
  if (!list) return;

  if (!state.userSpaces || state.userSpaces.length === 0) {
    list.innerHTML = `<div class="sidebar-spaces-empty">No spaces yet — create one!</div>`;
    return;
  }

  const palette = [
    'linear-gradient(135deg, #5a5df0, #8b5cf6)',
    'linear-gradient(135deg, #0ea5e9, #6366f1)',
    'linear-gradient(135deg, #8b5cf6, #d946ef)',
    'linear-gradient(135deg, #34d399, #0ea5e9)',
    'linear-gradient(135deg, #f59e0b, #ef4444)',
    'linear-gradient(135deg, #64748b, #334155)'
  ];

  const hashStr = (s) => {
    let h = 0;
    for (let i = 0; i < (s || '').length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  };

  list.innerHTML = state.userSpaces.map((sp, idx) => {
    const isOfficial = sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID;
    const grad = isOfficial ? palette[0] : palette[hashStr(sp.id || sp.name) % palette.length];
    const icon = isOfficial
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/></svg>`;
    return `
      <div class="sidebar-space-item ${state.currentView === 'space' && state.activeSpace?.id === sp.id ? 'active' : ''}"
           style="animation-delay: ${Math.min(idx * 0.03, 0.3)}s;"
           onclick="window.HubbleNest.openSpace('${sp.id}')" title="${escapeHtml(sp.name)}">
        <span class="sidebar-space-icon" style="background: ${grad};">${icon}</span>
        <span class="sidebar-space-name">${escapeHtml(sp.name || 'Space')}</span>
      </div>
    `;
  }).join('');
}

/**
 * Fill the dashboard right rail with REAL data (members, featured space, activity)
 */
function renderDashRail() {
  // Featured space = official community space when available
  const featured = state.userSpaces.find(sp => sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID) || state.userSpaces[0];
  const featName = document.getElementById('rail-featured-name');
  const featDesc = document.getElementById('rail-featured-desc');
  const featBtn = document.getElementById('rail-featured-btn');
  if (featured) {
    if (featName) featName.textContent = featured.name || 'HubbleNest Community';
    if (featDesc) featDesc.textContent = featured.description || 'Have a question about HubbleNest? This is the place to ask.';
    if (featBtn) featBtn.onclick = () => openSpace(featured.id);
  }

  // Members card: fetch real directory
  if (state.currentUser) {
    fetchPeopleDirectory(state.currentUser.uid).then(people => {
      state.people = people || [];

      const stack = document.getElementById('rail-members-avatars');
      const count = document.getElementById('rail-members-count');
      if (count) count.textContent = `${state.people.length} member${state.people.length === 1 ? '' : 's'}`;
      if (stack) {
        const top = state.people.slice(0, 7);
        stack.innerHTML = top.map(p => `
          <span class="stack-avatar" title="${escapeHtml(p.displayName)}">
            <img src="${getAvatarUrl(p.photoURL, p.displayName)}" alt="${escapeHtml(p.displayName)}" loading="lazy" decoding="async" />
          </span>
        `).join('') + (state.people.length > 7 ? `<span class="stack-more">+${state.people.length - 7}</span>` : '');
        if (state.people.length === 0) {
          stack.innerHTML = `<div class="rail-activity-empty">No members found yet.</div>`;
        }
      }
    }).catch(err => console.warn('People directory fetch:', err));
  }
}

/**
 * Start the community feed on Home (official support Space via existing chat system)
 */
function startHomeCommunityFeed() {
  const official = state.userSpaces.find(sp => sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID);
  const spaceId = official ? official.id : OFFICIAL_SUPPORT_SPACE_ID;
  startHomeFeed(
    spaceId,
    state.userProfile,
    state.currentUser?.uid,
    state.activeSpaceRole === 'admin' || official?.userRole === 'admin'
  );
  window.HubbleNest._homeSpaceId = spaceId;
}

/**
 * Render Recent Activity rail from REAL notifications
 */
function renderRailActivity() {
  const list = document.getElementById('rail-activity-list');
  if (!list) return;

  if (!state.notifications || state.notifications.length === 0) {
    list.innerHTML = `<div class="rail-activity-empty">No recent activity yet.</div>`;
    return;
  }

  list.innerHTML = state.notifications.slice(0, 6).map(n => {
    const icon = n.type === 'chat_request'
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`
      : n.type === 'private_message'
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
    return `
      <div class="rail-activity-item" onclick="window.HubbleNest.handleNotificationClick('${n.id}', '${n.spaceId || ''}')">
        <span class="rail-activity-icon">${icon}</span>
        <span class="rail-activity-text">
          <b>${escapeHtml(n.title || 'Notification')}</b> ${escapeHtml(n.body || '')}
          <span class="rail-activity-time">${formatTimeAgo(n.createdAt)}</span>
        </span>
      </div>
    `;
  }).join('');
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

  const searchQ = (state.spaceSearchQuery || '').trim().toLowerCase();
  const filtered = state.userSpaces.filter(sp => {
    if (state.activeCategory !== 'All' && sp.category !== state.activeCategory) return false;
    if (searchQ) {
      const haystack = `${sp.name || ''} ${sp.description || ''} ${sp.code || ''} ${sp.category || ''}`.toLowerCase();
      if (!haystack.includes(searchQ)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 64px 20px;">
        <div class="empty-state-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
            <path d="M6 6h10"/>
            <path d="M6 10h10"/>
          </svg>
        </div>
        <h3 class="empty-state-title">Your spaces will appear here</h3>
        <p class="empty-state-desc">Create your own private sanctuary or join an existing group with a code or QR invite.</p>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <button class="btn btn-primary" onclick="window.HubbleNest.openCreateSpacePage()">Create a Space</button>
          <button class="btn btn-secondary" onclick="window.HubbleNest.openJoinSpacePage()">Join with Code</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(sp => {
    const isOfficial = sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID;
    const expInfo = sp.type === 'temporary' ? formatExpiration(sp.expiresAt) : null;
    const coverUrl = sp.imageURL || '';
    const isAdmin = sp.userRole === 'admin';

    if (isOfficial) {
      return `
        <div class="space-card official-space-card" onclick="window.HubbleNest.openSpace('${sp.id}')">
          <div class="space-card-cover" style="position: relative;">
            ${coverUrl ? `<img src="${coverUrl}" class="space-card-cover-img" alt="${escapeHtml(sp.name || 'HubbleNest Help & Community')}" loading="lazy" decoding="async"/>` : `
              <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 50% 30%, #3b82f6 0%, #1e1b4b 100%); color: #ffffff; font-size: 2.2rem; font-weight: 800;">
                HN
              </div>
            `}
            <div style="position: absolute; bottom: 8px; left: 12px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px); padding: 3px 10px; border-radius: var(--radius-full); border: 1px solid rgba(59, 130, 246, 0.4); font-size: 0.72rem; font-weight: 700; color: #93c5fd; display: flex; align-items: center; gap: 6px;">
              <span style="color: #60a5fa;">✦</span> Official Community & Support
            </div>
          </div>
          <div class="space-card-body">
            <div class="space-card-meta">
              <span class="official-pill">✦ HubbleNest Official</span>
              <span>·</span>
              <span>Questions & Help</span>
              <span>·</span>
              <span>${sp.memberCount || 1} members</span>
            </div>
            <h4 class="space-card-title">${escapeHtml(sp.name || 'HubbleNest Help & Community')}</h4>
            <p class="space-card-desc">${escapeHtml(sp.description || 'Have a question about HubbleNest? Need help or want to share feedback? This is the place to ask.')}</p>
            <div class="space-card-footer">
              <span class="code-chip official-code-chip" onclick="event.stopPropagation(); window.HubbleNest.copyLinkUrl('${escapeHtml(sp.code || OFFICIAL_SUPPORT_CODE)}')">${escapeHtml(sp.code || OFFICIAL_SUPPORT_CODE)} <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="space-card-btn-enter official-btn-enter">Open Community →</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="space-card" onclick="window.HubbleNest.openSpace('${sp.id}')">
        <div class="space-card-cover">
          ${coverUrl ? `<img src="${coverUrl}" class="space-card-cover-img" alt="${escapeHtml(sp.name)}" loading="lazy" decoding="async"/>` : `
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
            <span class="code-chip" onclick="event.stopPropagation(); window.HubbleNest.copyLinkUrl('${escapeHtml(sp.code)}')">${escapeHtml(sp.code || 'HN-SPACE')} <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></span>
            <div style="display: flex; align-items: center; gap: 8px;">
              ${expInfo ? `<span style="color: ${expInfo.urgent ? 'var(--status-danger)' : 'var(--text-muted)'}; font-size: 0.75rem;">${expInfo.text}</span>` : `<span style="color: var(--text-muted); font-size: 0.75rem;">Permanent</span>`}
              <span class="space-card-btn-enter">Enter →</span>
            </div>
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
  let spaceSnap = await getDoc(doc(db, 'spaces', spaceId));
  if (!spaceSnap.exists()) {
    // If opening official support space, ensure it
    if (spaceId === OFFICIAL_SUPPORT_SPACE_ID) {
      await ensureOfficialSupportSpace();
      spaceSnap = await getDoc(doc(db, 'spaces', spaceId));
    }
    if (!spaceSnap.exists()) {
      showToast('Space not found', 'error');
      loadDashboard();
      return;
    }
  }

  state.activeSpace = { id: spaceSnap.id, ...spaceSnap.data() };
  state.activeSpaceRole = await getMembershipState(spaceId, state.currentUser.uid);

  renderSpaceHeader();
  switchSpaceTab('chat');
}

function renderSpaceHeader() {
  const sp = state.activeSpace;
  const isOfficial = sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID;
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
    if (isOfficial) {
      metaEl.innerHTML = `
        <span class="official-pill">✦ HubbleNest Official</span>
        <span>·</span>
        <span>Questions, Help & Feedback</span>
        <span>·</span>
        <span>${sp.memberCount || 1} members</span>
      `;
    } else {
      metaEl.innerHTML = `
        <span>${escapeHtml(sp.category)}</span>
        <span>·</span>
        <span>${sp.memberCount || 1} members</span>
        <span>·</span>
        ${exp ? `<span style="color: ${exp.urgent ? 'var(--status-danger)' : 'inherit'}; font-weight: 500;">${exp.text}</span>` : `<span>Permanent</span>`}
      `;
    }
  }

  if (coverEl) {
    const isAdmin = state.activeSpaceRole === 'admin';
    const coverHtml = sp.imageURL 
      ? `<img src="${sp.imageURL}" class="space-hero-cover-img" alt="${escapeHtml(sp.name)}" decoding="async"/>` 
      : `<div style="width: 100%; height: 100%; background: linear-gradient(135deg, #1e293b, #0f172a); display: flex; align-items: center; justify-content: center;"><span style="color: var(--text-muted); font-size: 1.1rem; font-weight: 500;">HubbleNest Sanctuary</span></div>`;

    const adminCoverBtn = isAdmin ? `
      <input type="file" id="space-cover-file-input" accept="image/*" style="display: none;" onchange="window.HubbleNest.handleUpdateSpaceCover(this.files[0])" />
      <button class="btn btn-sm btn-secondary change-cover-overlay-btn" onclick="document.getElementById('space-cover-file-input').click()">
        📷 Change Cover
      </button>
    ` : '';

    coverEl.innerHTML = `
      ${coverHtml}
      <div class="cover-gradient-scrim"></div>
      ${adminCoverBtn}
    `;
  }

  if (adminBtn) {
    adminBtn.style.display = state.activeSpaceRole === 'admin' ? 'inline-flex' : 'none';
  }

  const settingsTabNav = document.getElementById('space-tab-nav-settings');
  if (settingsTabNav) {
    settingsTabNav.style.display = state.activeSpaceRole === 'admin' ? 'inline-block' : 'none';
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
    members: document.getElementById('space-tab-members'),
    invite: document.getElementById('space-tab-invite'),
    settings: document.getElementById('space-tab-settings')
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
  } else if (tabName === 'invite') {
    initInviteTab();
  } else if (tabName === 'settings') {
    initSettingsTab();
  }
}

function initInviteTab() {
  if (!state.activeSpace) return;
  const canvas = document.getElementById('space-qr-canvas-tab');
  const codeText = document.getElementById('qr-tab-code-display');
  const nameText = document.getElementById('invite-tab-space-name');

  const joinUrl = buildJoinLink(state.activeSpace.code);

  if (canvas) renderQrToCanvas(canvas, joinUrl, 260);
  if (codeText) codeText.textContent = state.activeSpace.code;
  if (nameText) nameText.textContent = `Invite to ${state.activeSpace.name}`;
}

function initSettingsTab() {
  if (!state.activeSpace) return;
  const nameInput = document.getElementById('edit-space-name-tab');
  const descInput = document.getElementById('edit-space-desc-tab');
  if (nameInput) nameInput.value = state.activeSpace.name || '';
  if (descInput) descInput.value = state.activeSpace.description || '';
}

export async function handleSaveSpaceSettingsFromTab() {
  if (!state.activeSpace) return;
  const nameInput = document.getElementById('edit-space-name-tab');
  const descInput = document.getElementById('edit-space-desc-tab');
  const name = nameInput ? nameInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : '';

  if (!name) {
    showToast('Space name cannot be empty', 'warning');
    return;
  }

  try {
    await updateSpaceSettings(state.activeSpace.id, { name, description: desc });
    state.activeSpace.name = name;
    state.activeSpace.description = desc;
    renderSpaceHeader();
    showToast('Space settings saved successfully!', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to save space settings', 'error');
  }
}

export function toggleAnnouncementComposer(show) {
  const box = document.getElementById('announcement-inline-composer');
  if (!box) return;
  if (show === undefined) {
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  } else {
    box.style.display = show ? 'block' : 'none';
  }
  if (box.style.display === 'block') {
    document.getElementById('ann-title-input-inline')?.focus();
  }
}

export async function handleCreateAnnouncementInline() {
  const titleInput = document.getElementById('ann-title-input-inline');
  const contentInput = document.getElementById('ann-content-input-inline');
  const pinnedInput = document.getElementById('ann-pinned-input-inline');
  const title = titleInput ? titleInput.value.trim() : '';
  const content = contentInput ? contentInput.value.trim() : '';
  const pinned = pinnedInput ? pinnedInput.checked : false;

  if (!title || !content) {
    showToast('Please enter both title and content.', 'warning');
    return;
  }

  try {
    await createAnnouncement(state.activeSpace.id, state.userProfile, { title, content, isPinned: pinned });
    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';
    if (pinnedInput) pinnedInput.checked = false;
    toggleAnnouncementComposer(false);
    showToast('Announcement published!', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to publish announcement', 'error');
  }
}

function initChatListener() {
  subscribeToSpaceMessages(state.activeSpace.id, (messages) => {
    state.spaceMessages = messages;
    renderChatMessages();
  });
}

function getFileIcon(type, filename = '') {
  const t = (type || '').toLowerCase();
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const svg = (paths) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  if (t.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'image', 'images'].includes(ext) || t === 'image' || t === 'images') {
    return svg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>');
  }
  if (t.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm', 'video', 'videos'].includes(ext) || t === 'video' || t === 'videos') {
    return svg('<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>');
  }
  if (t.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'audio'].includes(ext) || t === 'audio') {
    return svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>');
  }
  if (['pdf'].includes(ext) || t.includes('pdf')) {
    return svg('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M9.5 13h5"/><path d="M9.5 17h5"/>');
  }
  if (['doc', 'docx'].includes(ext) || t.includes('word')) {
    return svg('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M9.5 13h5"/>');
  }
  if (['xls', 'xlsx', 'csv'].includes(ext) || t.includes('sheet') || t.includes('excel')) {
    return svg('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/>');
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || t.includes('zip')) {
    return svg('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M12 7v4"/><path d="M12 15h.01"/>');
  }
  return svg('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>');
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  if (state.spaceMessages.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 40px 0;">
        <div class="empty-state-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
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
                <img src="${att.url}" style="max-height: 200px; border-radius: 6px;" alt="Image" loading="lazy" decoding="async"/>
              </a>
              <div style="margin-top: 4px;">
                <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px;" onclick="window.HubbleNest.replyToFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Image')}', '${escapeHtml(att.url)}', 'image')">
                  ↩ Reply to this image
                </button>
              </div>
            </div>
          `;
        } else if (att.resourceType === 'video' || att.resourceType === 'videos') {
          return `
            <div class="msg-attachment-preview">
              <video src="${att.url}" controls style="max-height: 220px; width: 100%; border-radius: 6px;"></video>
              <div style="margin-top: 4px;">
                <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px;" onclick="window.HubbleNest.replyToFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Video')}', '${escapeHtml(att.url)}', 'video')">
                  ↩ Reply to this video
                </button>
              </div>
            </div>
          `;
        } else if (att.resourceType === 'audio') {
          return `
            <div class="msg-attachment-preview">
              <audio src="${att.url}" controls style="width: 100%;"></audio>
              <div style="margin-top: 4px;">
                <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px;" onclick="window.HubbleNest.replyToFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Audio')}', '${escapeHtml(att.url)}', 'audio')">
                  ↩ Reply to this audio
                </button>
              </div>
            </div>
          `;
        } else {
          return `
            <div class="msg-attachment-preview" style="background: var(--bg-surface-elevated); padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg></span>
                <a href="${att.url}" target="_blank" rel="noopener noreferrer" style="font-weight: 500; font-size: 0.85rem; color: var(--accent-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${escapeHtml(att.originalFilename || 'Document')}
                </a>
              </div>
              <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px;" onclick="window.HubbleNest.replyToFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Document')}', '${escapeHtml(att.url)}', '${att.resourceType || 'document'}')">
                ↩ Reply
              </button>
            </div>
          `;
        }
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
            ${msg.replyTo ? (
              msg.replyTo.isFileReply || msg.replyTo.fileUrl ? `
                <div class="file-reply-snippet">
                  <span style="color: var(--accent-primary); flex-shrink: 0; display: inline-flex;">${getFileIcon(msg.replyTo.fileType, msg.replyTo.fileName || msg.replyTo.text)}</span>
                  <div style="min-width: 0; flex: 1;">
                    <div style="font-size: 0.72rem; color: var(--accent-primary); font-weight: 700; text-transform: uppercase;">Replying to File</div>
                    <div>
                      <a href="${msg.replyTo.fileUrl || '#'}" target="_blank" rel="noopener noreferrer" class="reply-file-link" onclick="event.stopPropagation();">
                        ${escapeHtml(msg.replyTo.fileName || msg.replyTo.text)} ↗
                      </a>
                    </div>
                  </div>
                </div>
              ` : `
                <div class="msg-reply-snippet">
                  <strong>${escapeHtml(msg.replyTo.senderName)}</strong>: ${escapeHtml(msg.replyTo.text)}
                </div>
              `
            ) : ''}
            <div>${linkify(msg.text)}</div>
            ${attachmentsHtml}
            <div class="msg-actions-hover">
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.startReply('${msg.id}', '${escapeHtml(msg.senderName)}', '${escapeHtml(msg.text || (msg.attachments && msg.attachments[0] ? msg.attachments[0].originalFilename : 'Attachment'))}')" title="Reply">↩</button>
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.toggleReaction('${msg.id}', '👍')" title="Thumbs up">👍</button>
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.toggleReaction('${msg.id}', '❤️')" title="Heart">❤️</button>
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.toggleReaction('${msg.id}', '🔥')" title="Fire">🔥</button>
              ${canDelete ? `<button class="btn-ghost" style="padding: 2px 6px; color: var(--status-danger);" onclick="window.HubbleNest.deleteMessage('${msg.id}')" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>` : ''}
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

export function stageChatAttachment(file) {
  if (!file) return;
  const maxMB = state.activeSpace?.settings?.maxFileSizeMB || 100;
  if (file.size > maxMB * 1024 * 1024) {
    showToast(`File exceeds maximum size of ${maxMB}MB`, 'error');
    return;
  }

  if (!state.pendingAttachments) state.pendingAttachments = [];
  state.pendingAttachments.push(file);
  state.pendingAttachment = state.pendingAttachments[0];

  renderChatPendingAttachments();
  document.getElementById('chat-input-text')?.focus();
  showToast(`Attached: ${file.name}`, 'info', 2000);
}

export function removeChatAttachment(index) {
  if (!state.pendingAttachments) return;
  state.pendingAttachments.splice(index, 1);
  state.pendingAttachment = state.pendingAttachments[0] || null;
  renderChatPendingAttachments();
}

export function clearAllChatAttachments() {
  state.pendingAttachments = [];
  state.pendingAttachment = null;
  renderChatPendingAttachments();
  const imgInput = document.getElementById('chat-image-input');
  const docInput = document.getElementById('chat-doc-input');
  if (imgInput) imgInput.value = '';
  if (docInput) docInput.value = '';
}

export function cancelPendingAttachment() {
  clearAllChatAttachments();
}

function renderChatPendingAttachments() {
  const area = document.getElementById('chat-pending-attachments-area');
  const grid = document.getElementById('chat-pending-attachments-grid');
  const legacyBar = document.getElementById('chat-pending-attachment-bar');

  if (!state.pendingAttachments || state.pendingAttachments.length === 0) {
    if (area) area.style.display = 'none';
    if (grid) grid.innerHTML = '';
    if (legacyBar) legacyBar.style.display = 'none';
    return;
  }

  if (legacyBar) legacyBar.style.display = 'none';

  if (grid) {
    grid.innerHTML = state.pendingAttachments.map((f, idx) => {
      const isImg = f.type && f.type.startsWith('image/');
      let thumbHtml = '';
      if (isImg) {
        const url = URL.createObjectURL(f);
        thumbHtml = `<img src="${url}" class="pending-thumb-img" alt="preview" />`;
      } else {
        thumbHtml = `<span style="color: var(--accent-primary);">${getFileIcon(f.type, f.name)}</span>`;
      }

      return `
        <div class="pending-attachment-card">
          <div class="pending-card-thumb">${thumbHtml}</div>
          <div class="pending-card-info">
            <div class="pending-card-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
            <div class="pending-card-size">${formatBytes(f.size)}</div>
          </div>
          <button type="button" class="pending-card-remove" onclick="window.HubbleNest.removeChatAttachment(${idx})" title="Remove attachment">✕</button>
        </div>
      `;
    }).join('');
  }

  if (area) area.style.display = 'block';
}

export function replyToFile(fileId, fileName, fileUrl, fileType = 'document') {
  state.replyingTo = {
    id: fileId,
    senderName: 'File',
    text: fileName,
    fileName: fileName,
    fileUrl: fileUrl,
    fileType: fileType,
    isFileReply: true
  };

  switchSpaceTab('chat');
  const bar = document.getElementById('chat-replying-bar');
  const textEl = document.getElementById('replying-to-text');
  const iconEl = document.getElementById('replying-icon');
  if (iconEl) iconEl.innerHTML = getFileIcon(fileType, fileName);
  if (bar && textEl) {
    textEl.innerHTML = `<span style="color: var(--accent-primary); font-weight: 700;">Replying to file:</span> <a href="${fileUrl || '#'}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; margin-left: 4px;" onclick="event.stopPropagation();">${escapeHtml(fileName)}</a>`;
    bar.style.display = 'flex';
  }
  document.getElementById('chat-input-text')?.focus();
  showToast(`Replying to "${fileName}" — add text or attach a document/image to send`, 'info', 2500);
}

export async function handleSendMessage() {
  const input = document.getElementById('chat-input-text');
  const text = input ? input.value : '';
  const pendingFiles = (state.pendingAttachments && state.pendingAttachments.length > 0)
    ? state.pendingAttachments
    : (state.pendingAttachment ? [state.pendingAttachment] : []);

  if (!text.trim() && pendingFiles.length === 0 && !state.replyingTo) {
    showToast('Please type a message, attach a file, or reply to a file.', 'warning');
    return;
  }

  const sendBtn = document.getElementById('btn-send-chat-msg');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = pendingFiles.length > 0 ? 'Uploading...' : 'Sending...';
  }

  try {
    let attachments = [];
    if (pendingFiles.length > 0) {
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        showToast(`Uploading ${file.name} (${i + 1}/${pendingFiles.length})...`, 'info', 2500);
        const result = await uploadToCloudinary(file, () => {}, state.activeSpace?.settings?.maxFileSizeMB || 100);
        attachments.push({
          url: result.url,
          resourceType: result.resourceType,
          originalFilename: result.originalFilename || file.name,
          size: result.bytes || file.size
        });

        // Also record in space files library for quick archival
        try {
          await addDoc(collection(db, 'spaces', state.activeSpace.id, 'files'), {
            spaceId: state.activeSpace.id,
            name: result.originalFilename || file.name,
            size: result.bytes || file.size,
            type: file.type || 'application/octet-stream',
            extension: (file.name.split('.').pop() || '').toLowerCase(),
            category: getFileCategory(file),
            cloudinaryUrl: result.url,
            publicId: result.publicId,
            resourceType: result.resourceType,
            uploadedBy: state.userProfile.uid,
            uploaderName: state.userProfile.displayName || 'Member',
            uploaderPhoto: state.userProfile.photoURL || '',
            createdAt: serverTimestamp()
          });
        } catch (e) {
          console.warn('Could not record to space files collection', e);
        }
      }
    }

    const reply = state.replyingTo;
    cancelReply();
    clearAllChatAttachments();
    if (input) input.value = '';

    await sendSpaceMessage(state.activeSpace.id, state.userProfile, {
      text: text,
      attachments: attachments,
      replyTo: reply
    });
  } catch (err) {
    showToast(err.message || 'Failed to send message', 'error');
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  }
}

export function startReply(id, senderName, text) {
  state.replyingTo = { id, senderName, text };
  const bar = document.getElementById('chat-replying-bar');
  const textEl = document.getElementById('replying-to-text');
  const iconEl = document.getElementById('replying-icon');
  if (iconEl) iconEl.textContent = '↩';
  if (bar && textEl) {
    textEl.textContent = `Replying to ${senderName}: "${text.slice(0, 45)}..."`;
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
  stageChatAttachment(file);
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
        <div class="empty-state-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg></div>
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
            ${f.category === 'images' ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>' : f.category === 'videos' ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>' : f.category === 'audio' ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' : '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>'}
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
          <button type="button" class="btn-file-reply" onclick="window.HubbleNest.replyToFile('${f.id}', '${escapeHtml(f.name)}', '${escapeHtml(f.cloudinaryUrl)}', '${f.category || 'document'}')">
            ↩ Reply in Chat
          </button>
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
        <div class="empty-state-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg></div>
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
        ${ann.imageURL ? `<img src="${ann.imageURL}" class="announcement-img" alt="" loading="lazy" decoding="async"/>` : ''}
        <div style="display: flex; gap: 8px; margin-top: 10px; align-items: center; flex-wrap: wrap;">
          ${ann.imageURL ? `
            <button type="button" class="btn-file-reply" onclick="window.HubbleNest.replyToFile('${ann.id}', '${escapeHtml(ann.title)} (Image)', '${escapeHtml(ann.imageURL)}', 'image')">
              ↩ Reply to this image in Chat
            </button>
          ` : `
            <button type="button" class="btn-file-reply" onclick="window.HubbleNest.replyToFile('${ann.id}', '${escapeHtml(ann.title)} (Announcement)', '', 'announcement')">
              ↩ Reply in Chat
            </button>
          `}
        </div>
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
      <div class="member-card" style="cursor: pointer;" onclick="window.HubbleNest.openUserCardModal('${m.userId}')">
        <div class="msg-avatar" style="width: 42px; height: 42px;">
          <img src="${getAvatarUrl(m.photoURL, m.displayName)}" class="avatar-img" alt="${escapeHtml(m.displayName)}" loading="lazy" decoding="async"/>
        </div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(m.displayName)} ${isMe ? '(You)' : ''}</div>
          <div class="member-role">${isAdmin ? '★ Administrator' : 'Member'}</div>
        </div>
        <div style="display: flex; gap: 6px;" onclick="event.stopPropagation();">
          ${!isMe ? `
            <button class="btn btn-sm btn-secondary" onclick="window.HubbleNest.openUserCardModal('${m.userId}')" title="View Member Profile">
              Profile
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
          <img src="${getAvatarUrl(req.photoURL, req.displayName)}" class="avatar-img" alt="" loading="lazy" decoding="async"/>
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
            <div class="empty-state-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
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
              <div class="file-icon-box"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
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
   10. PEOPLE DIRECTORY & USER PROFILE CARDS
   ========================================================================== */

export async function openPeopleView() {
  state.currentView = 'people';
  unsubscribeFromChat();

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-people')?.classList.add('active-view');

  // Update nav links
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('nav-people')?.classList.add('active');

  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mob-nav-people')?.classList.add('active');

  await loadPeopleDirectory();
}

export async function loadPeopleDirectory() {
  const container = document.getElementById('people-directory-grid');
  if (container) {
    container.innerHTML = `<div style="grid-column: 1 / -1; padding: 48px 0; text-align: center; color: var(--text-muted);">Finding members on HubbleNest...</div>`;
  }

  const people = await fetchPeopleDirectory(state.currentUser?.uid);
  state.people = people;
  renderPeopleGrid(people);
}

function renderPeopleGrid(peopleList) {
  const container = document.getElementById('people-directory-grid');
  if (!container) return;

  if (!peopleList || peopleList.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 60px 0;">
        <div class="empty-state-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
        <h3 class="empty-state-title">No members found</h3>
        <p class="empty-state-desc">Try searching with a different name or invite members with a Space code.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = peopleList.map(p => {
    return `
      <div class="person-card" onclick="window.HubbleNest.openUserCardModal('${p.uid}')">
        <div class="person-header">
          <div class="person-avatar">
            <img src="${getAvatarUrl(p.photoURL, p.displayName)}" alt="${escapeHtml(p.displayName)}" loading="lazy" decoding="async" />
          </div>
          <div style="flex: 1; min-width: 0;">
            <div class="person-name">${escapeHtml(p.displayName)}</div>
            <div class="person-handle">@${escapeHtml(p.username)}</div>
          </div>
        </div>
        <div class="person-bio">${escapeHtml(p.bio || 'HubbleNest community member')}</div>
        <div class="person-footer">
          <span style="font-size: 0.8rem; color: var(--text-muted);">HubbleNest Member</span>
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); window.HubbleNest.openUserCardModal('${p.uid}')">
            View Profile
          </button>
        </div>
      </div>
    `;
  }).join('');
}

export async function handlePeopleSearch(term) {
  if (!state.currentUser) return;
  const filtered = await searchPeopleDirectory(term, state.currentUser.uid);
  renderPeopleGrid(filtered);
}

/**
 * Open a Member's Profile Page (No Popups!) with Chat Request status
 */
export async function openMemberProfilePage(userId) {
  if (!userId) return;
  if (state.currentView !== 'member-profile') {
    state.previousView = state.currentView;
  }
  state.currentView = 'member-profile';
  unsubscribeFromChat();
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-member-profile')?.classList.add('active-view');

  const pageContent = document.getElementById('page-member-profile-content');
  if (pageContent) {
    pageContent.innerHTML = `<div style="padding: 40px 0; text-align: center; color: var(--text-muted);">Loading member profile...</div>`;
  }

  const peerData = await fetchPublicUserCard(userId);
  if (!peerData) {
    if (pageContent) pageContent.innerHTML = `<div style="padding: 32px; text-align: center; color: var(--text-muted);">Member not found.</div>`;
    return;
  }

  state.selectedUserCard = peerData;
  const isMe = userId === state.currentUser?.uid;

  // Check relationship & existing request status
  let rel = null;
  if (!isMe) {
    rel = await getChatRelationship(state.currentUser?.uid, userId);
  }

  let statusBadgeHtml = '';
  let actionsHtml = '';

  if (isMe) {
    statusBadgeHtml = `<div class="user-card-status-badge" style="background: rgba(59, 130, 246, 0.12); color: var(--accent-primary);">This is your profile</div>`;
    actionsHtml = `
      <button class="btn btn-primary" onclick="window.HubbleNest.openProfilePage()">
        Edit My Profile & Settings
      </button>
    `;
  } else if (rel && (rel.data?.status === 'accepted' || rel.direction === 'connected')) {
    statusBadgeHtml = `<div class="user-card-status-badge status-badge-connected">✓ Connected in Private Chat</div>`;
    actionsHtml = `
      <button class="btn btn-primary" onclick="window.HubbleNest.openDirectChatWithPeer('${userId}')">
        Open Private Chat
      </button>
    `;
  } else if (rel && rel.data?.status === 'pending' && rel.direction === 'sent') {
    statusBadgeHtml = `<div class="user-card-status-badge status-badge-pending">⏳ Chat Request Pending</div>`;
    actionsHtml = `
      <button class="btn btn-secondary" disabled style="opacity: 0.8; cursor: default;">
        Request Pending
      </button>
      <button class="btn btn-ghost" style="color: var(--text-muted);" onclick="window.HubbleNest.cancelSentRequest('${rel.data.id}', '${userId}')">
        Cancel Request
      </button>
    `;
  } else if (rel && rel.data?.status === 'pending' && rel.direction === 'received') {
    statusBadgeHtml = `<div class="user-card-status-badge status-badge-pending">✉ ${escapeHtml(peerData.displayName)} wants to chat with you</div>`;
    actionsHtml = `
      <button class="btn btn-primary" onclick="window.HubbleNest.handleAcceptRequest('${rel.data.id}')">
        Accept Request
      </button>
      <button class="btn btn-secondary" onclick="window.HubbleNest.handleDeclineRequest('${rel.data.id}')">
        Decline
      </button>
    `;
  } else if (rel && rel.data?.status === 'declined') {
    statusBadgeHtml = `<div class="user-card-status-badge status-badge-declined">Request Declined</div>`;
    actionsHtml = `
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0;">This member is not accepting chat requests right now.</p>
    `;
  } else {
    actionsHtml = `
      <button class="btn btn-primary" id="btn-request-to-chat" onclick="window.HubbleNest.handleSendChatRequest('${userId}')">
        ✉ Request to Chat
      </button>
    `;
  }

  const profileCardHtml = `
    <div class="user-card-avatar" style="width: 80px; height: 80px; margin: 0 auto 16px;">
      <img src="${getAvatarUrl(peerData.photoURL, peerData.displayName)}" alt="${escapeHtml(peerData.displayName)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" decoding="async" />
    </div>
    <div class="user-card-name" style="text-align: center; font-size: 1.4rem; font-weight: 700;">${escapeHtml(peerData.displayName)}</div>
    <div class="user-card-handle" style="text-align: center; font-size: 0.9rem; color: var(--accent-primary); margin-bottom: 12px;">@${escapeHtml(peerData.username)}</div>
    <div style="text-align: center; margin-bottom: 16px;">${statusBadgeHtml}</div>
    <div class="user-card-bio" style="text-align: center; font-size: 0.95rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 24px; padding: 12px 16px; background: var(--bg-surface-elevated); border-radius: var(--radius-md);">${escapeHtml(peerData.bio || 'HubbleNest community member')}</div>
    <div class="user-card-actions" style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
      ${actionsHtml}
    </div>
  `;

  if (pageContent) pageContent.innerHTML = profileCardHtml;
  const modalContent = document.getElementById('user-card-modal-content');
  if (modalContent) modalContent.innerHTML = profileCardHtml;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function openUserCardModal(userId) {
  openMemberProfilePage(userId);
}

export function goBackFromMemberProfile() {
  const prev = state.previousView || 'people';
  if (prev === 'dashboard') loadDashboard();
  else if (prev === 'space' && state.activeSpace) openSpace(state.activeSpace.id);
  else if (prev === 'direct') openDirectMessagesView();
  else openPeopleView();
}

export async function handleSendChatRequest(targetUserId) {
  const btn = document.getElementById('btn-request-to-chat');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending request...';
  }

  try {
    const peerData = state.selectedUserCard || await fetchPublicUserCard(targetUserId);
    await sendChatRequest(state.userProfile, peerData);
    // Refresh the modal view to show pending state
    await openUserCardModal(targetUserId);
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✉ Request to Chat';
    }
  }
}

export async function handleAcceptRequest(requestId) {
  try {
    const res = await acceptChatRequest(requestId, state.userProfile);
    closeModal('modal-user-card');
    if (res && res.conversation) {
      openDirectMessagesView();
      setTimeout(() => {
        selectConversation(res.conversation.id, res.peer.uid);
      }, 250);
    }
  } catch (err) {
    console.error('Failed to accept request:', err);
  }
}

export async function handleDeclineRequest(requestId) {
  try {
    await declineChatRequest(requestId);
    closeModal('modal-user-card');
  } catch (err) {
    console.error('Failed to decline request:', err);
  }
}

export async function cancelSentRequest(requestId, targetUserId) {
  try {
    await cancelChatRequest(requestId);
    await openUserCardModal(targetUserId);
  } catch (err) {
    console.error('Failed to cancel request:', err);
  }
}

export async function openDirectChatWithPeer(peerUserId) {
  closeModal('modal-user-card');
  const convId = getConversationId(state.currentUser.uid, peerUserId);
  openDirectMessagesView();
  setTimeout(() => {
    selectConversation(convId, peerUserId);
  }, 250);
}

/* ==========================================================================
   11. PRIVATE DIRECT MESSAGING
   ========================================================================== */

export async function openDirectMessagesView() {
  state.currentView = 'direct';
  unsubscribeFromChat();

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-direct-messages')?.classList.add('active-view');

  // Update nav link
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('nav-direct')?.classList.add('active');

  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mob-nav-direct')?.classList.add('active');

  // Render pending requests box
  renderDirectRequests();

  // Subscribe to conversations
  subscribeToUserConversations(state.currentUser.uid, (convs) => {
    state.conversations = convs;
    renderConversationsList();
  });
}

function renderDirectRequests() {
  const container = document.getElementById('direct-requests-container');
  const countBadge = document.getElementById('direct-requests-count');
  const listEl = document.getElementById('direct-requests-list');
  if (!container || !listEl) return;

  if (!state.incomingChatRequests || state.incomingChatRequests.length === 0) {
    container.style.display = 'none';
    if (countBadge) countBadge.textContent = '0';
    return;
  }

  container.style.display = 'block';
  if (countBadge) countBadge.textContent = state.incomingChatRequests.length;

  listEl.innerHTML = state.incomingChatRequests.map(req => {
    return `
      <div class="direct-request-item">
        <div class="direct-request-item-top" onclick="window.HubbleNest.openUserCardModal('${req.senderId}')" style="cursor: pointer;">
          <div class="direct-request-avatar">
            <img src="${getAvatarUrl(req.senderPhoto, req.senderName)}" alt="${escapeHtml(req.senderName)}" loading="lazy" decoding="async" />
          </div>
          <div class="direct-request-info">
            <div class="direct-request-name">${escapeHtml(req.senderName)}</div>
            <div class="direct-request-handle">@${escapeHtml(req.senderUsername)}</div>
          </div>
        </div>
        <div class="direct-request-actions">
          <button class="btn btn-primary btn-sm" onclick="window.HubbleNest.handleAcceptRequest('${req.id}')">
            Accept
          </button>
          <button class="btn btn-secondary btn-sm" onclick="window.HubbleNest.handleDeclineRequest('${req.id}')">
            Decline
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderConversationsList() {
  const container = document.getElementById('direct-conv-list');
  if (!container) return;

  if (state.conversations.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem; line-height: 1.5;">
        No conversations yet.<br>Connect with members in the People directory to start chatting.
      </div>
    `;
    return;
  }

  container.innerHTML = state.conversations.map(conv => {
    const peerUid = conv.participants.find(p => p !== state.currentUser.uid);
    const peerData = conv.participantData?.[peerUid] || { displayName: 'Member' };
    const isActive = state.activeConversation?.id === conv.id;

    return `
      <div class="nav-link ${isActive ? 'active' : ''}" style="padding: 10px 12px; border-radius: var(--radius-md);" onclick="window.HubbleNest.selectConversation('${conv.id}', '${peerUid}')">
        <div class="msg-avatar" style="width: 36px; height: 36px; flex-shrink: 0;">
          <img src="${getAvatarUrl(peerData.photoURL, peerData.displayName)}" class="avatar-img" alt="${escapeHtml(peerData.displayName)}" decoding="async"/>
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.9rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${escapeHtml(peerData.displayName)}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${conv.lastMessage ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Private message' : 'Protected conversation'}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export async function selectConversation(convId, peerUid) {
  const peerSnap = await getDoc(doc(db, 'users', peerUid));
  if (!peerSnap.exists()) return;

  const peerData = peerSnap.data();
  state.activeDirectPeer = peerData;
  state.activeConversation = { id: convId };

  // Update header with peer's details
  const headerName = document.getElementById('direct-chat-peer-name');
  const headerHandle = document.getElementById('direct-chat-peer-handle');
  const headerAvatar = document.getElementById('direct-chat-peer-avatar');
  const emptyPlaceholder = document.getElementById('direct-chat-empty');
  const activeChatBox = document.getElementById('direct-chat-active');

  if (headerName) headerName.textContent = peerData.displayName || 'Member';
  if (headerHandle) headerHandle.textContent = `@${peerData.username || 'member'}`;
  if (headerAvatar) {
    headerAvatar.src = getAvatarUrl(peerData.photoURL, peerData.displayName);
  }

  if (emptyPlaceholder) emptyPlaceholder.style.display = 'none';
  if (activeChatBox) activeChatBox.style.display = 'flex';

  renderConversationsList();

  // Subscribe to messages with local client-side decryption
  subscribeToPrivateMessages(convId, state.userProfile, peerData, (messages) => {
    state.directMessages = messages;
    renderDirectMessages();
  });
}

function renderDirectMessages() {
  const container = document.getElementById('direct-messages-feed');
  if (!container) return;

  if (state.directMessages.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 40px 0;">
        <div class="empty-state-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <h4 class="empty-state-title">This conversation is private</h4>
        <p class="empty-state-desc">Messages sent here are end-to-end encrypted between you and ${escapeHtml(state.activeDirectPeer?.displayName || 'this member')}.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.directMessages.map(msg => {
    const isOwn = msg.senderId === state.currentUser.uid;
    const decrypted = msg.decrypted || { text: '...' };
    const senderPhoto = isOwn ? state.userProfile.photoURL : state.activeDirectPeer?.photoURL;
    const senderName = isOwn ? state.userProfile.displayName : state.activeDirectPeer?.displayName;

    // Attachments render
    let attachmentsHtml = '';
    if (decrypted.attachments && decrypted.attachments.length > 0) {
      attachmentsHtml = decrypted.attachments.map(att => {
        if (att.resourceType === 'image' || att.resourceType === 'images') {
          return `
            <div class="msg-attachment-preview">
              <a href="${att.url}" target="_blank" rel="noopener noreferrer">
                <img src="${att.url}" style="max-height: 200px; border-radius: 6px;" alt="Image" loading="lazy" decoding="async"/>
              </a>
              <div style="margin-top: 4px;">
                <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px;" onclick="window.HubbleNest.replyToDirectFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Image')}', '${escapeHtml(att.url)}', 'image')">
                  ↩ Reply to this image
                </button>
              </div>
            </div>
          `;
        } else if (att.resourceType === 'video' || att.resourceType === 'videos') {
          return `
            <div class="msg-attachment-preview">
              <video src="${att.url}" controls style="max-height: 220px; width: 100%; border-radius: 6px;"></video>
              <div style="margin-top: 4px;">
                <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px;" onclick="window.HubbleNest.replyToDirectFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Video')}', '${escapeHtml(att.url)}', 'video')">
                  ↩ Reply to this video
                </button>
              </div>
            </div>
          `;
        } else if (att.resourceType === 'audio') {
          return `
            <div class="msg-attachment-preview">
              <audio src="${att.url}" controls style="width: 100%;"></audio>
              <div style="margin-top: 4px;">
                <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px;" onclick="window.HubbleNest.replyToDirectFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Audio')}', '${escapeHtml(att.url)}', 'audio')">
                  ↩ Reply to this audio
                </button>
              </div>
            </div>
          `;
        } else {
          return `
            <div class="msg-attachment-preview" style="background: var(--bg-surface-elevated); padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <span>${getFileIcon(att.resourceType, att.originalFilename)}</span>
                <a href="${att.url}" target="_blank" rel="noopener noreferrer" style="font-weight: 500; font-size: 0.85rem; color: var(--accent-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${escapeHtml(att.originalFilename || 'Document')}
                </a>
              </div>
              <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary); display: inline-flex; align-items: center; gap: 4px;" onclick="window.HubbleNest.replyToDirectFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Document')}', '${escapeHtml(att.url)}', '${att.resourceType || 'document'}')">
                ↩ Reply
              </button>
            </div>
          `;
        }
      }).join('');
    }

    // Reply context snippet render
    let replySnippetHtml = '';
    if (decrypted.replyTo) {
      if (decrypted.replyTo.isFileReply || decrypted.replyTo.fileUrl) {
        replySnippetHtml = `
          <div class="file-reply-snippet">
            <span style="color: var(--accent-primary); flex-shrink: 0; display: inline-flex;">${getFileIcon(decrypted.replyTo.fileType, decrypted.replyTo.fileName || decrypted.replyTo.text)}</span>
            <div style="min-width: 0; flex: 1;">
              <div style="font-size: 0.72rem; color: var(--accent-primary); font-weight: 700; text-transform: uppercase;">Replying to File</div>
              <div>
                <a href="${decrypted.replyTo.fileUrl || '#'}" target="_blank" rel="noopener noreferrer" class="reply-file-link" onclick="event.stopPropagation();">
                  ${escapeHtml(decrypted.replyTo.fileName || decrypted.replyTo.text)} ↗
                </a>
              </div>
            </div>
          </div>
        `;
      } else {
        replySnippetHtml = `
          <div class="msg-reply-snippet">
            <strong>${escapeHtml(decrypted.replyTo.senderName || 'Member')}</strong>: ${escapeHtml(decrypted.replyTo.text || '')}
          </div>
        `;
      }
    }

    return `
      <div class="message-row ${isOwn ? 'msg-own' : ''}">
        <div class="msg-avatar" style="width: 32px; height: 32px;">
          <img src="${getAvatarUrl(senderPhoto, senderName)}" class="avatar-img" alt="${escapeHtml(senderName || '')}" loading="lazy" decoding="async" />
        </div>
        <div class="msg-bubble-box">
          <div class="msg-bubble">
            ${replySnippetHtml}
            ${decrypted.text ? `<div>${linkify(decrypted.text)}</div>` : ''}
            ${attachmentsHtml}
            <div class="msg-actions-hover">
              <button class="btn-ghost" style="padding: 2px 6px;" onclick="window.HubbleNest.replyToDirectMessage('${msg.id}', '${escapeHtml(senderName)}', '${escapeHtml(decrypted.text || (decrypted.attachments && decrypted.attachments[0] ? decrypted.attachments[0].originalFilename : 'Attachment'))}')" title="Reply">↩</button>
              ${isOwn ? `
                <button class="btn-ghost msg-delete-action" style="padding: 2px 6px; color: var(--status-danger);" onclick="window.HubbleNest.deleteDirectMessage('${msg.id}')" title="Delete message">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              ` : ''}
            </div>
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 3px; text-align: ${isOwn ? 'right' : 'left'};">
            ${formatTimeAgo(msg.createdAt)} · <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Private
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

export function stageDirectAttachment(file) {
  if (!file) return;
  const maxMB = 100;
  if (file.size > maxMB * 1024 * 1024) {
    showToast(`File exceeds maximum size of ${maxMB}MB`, 'error');
    return;
  }

  if (!state.directPendingAttachments) state.directPendingAttachments = [];
  state.directPendingAttachments.push(file);
  state.directPendingAttachment = state.directPendingAttachments[0];

  renderDirectPendingAttachments();
  document.getElementById('direct-message-input')?.focus();
  showToast(`Attached: ${file.name}`, 'info', 2000);
}

export function removeDirectAttachment(index) {
  if (!state.directPendingAttachments) return;
  state.directPendingAttachments.splice(index, 1);
  state.directPendingAttachment = state.directPendingAttachments[0] || null;
  renderDirectPendingAttachments();
}

export function clearAllDirectAttachments() {
  state.directPendingAttachments = [];
  state.directPendingAttachment = null;
  renderDirectPendingAttachments();
  const imgInput = document.getElementById('direct-image-input');
  const docInput = document.getElementById('direct-doc-input');
  if (imgInput) imgInput.value = '';
  if (docInput) docInput.value = '';
}

export function cancelDirectPendingAttachment() {
  clearAllDirectAttachments();
}

function renderDirectPendingAttachments() {
  const area = document.getElementById('direct-pending-attachments-area');
  const grid = document.getElementById('direct-pending-attachments-grid');
  const legacyBar = document.getElementById('direct-pending-attachment-bar');

  if (!state.directPendingAttachments || state.directPendingAttachments.length === 0) {
    if (area) area.style.display = 'none';
    if (grid) grid.innerHTML = '';
    if (legacyBar) legacyBar.style.display = 'none';
    return;
  }

  if (legacyBar) legacyBar.style.display = 'none';

  if (grid) {
    grid.innerHTML = state.directPendingAttachments.map((f, idx) => {
      const isImg = f.type && f.type.startsWith('image/');
      let thumbHtml = '';
      if (isImg) {
        const url = URL.createObjectURL(f);
        thumbHtml = `<img src="${url}" class="pending-thumb-img" alt="preview" />`;
      } else {
        thumbHtml = `<span style="color: var(--accent-primary);">${getFileIcon(f.type, f.name)}</span>`;
      }

      return `
        <div class="pending-attachment-card">
          <div class="pending-card-thumb">${thumbHtml}</div>
          <div class="pending-card-info">
            <div class="pending-card-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
            <div class="pending-card-size">${formatBytes(f.size)}</div>
          </div>
          <button type="button" class="pending-card-remove" onclick="window.HubbleNest.removeDirectAttachment(${idx})" title="Remove attachment">✕</button>
        </div>
      `;
    }).join('');
  }

  if (area) area.style.display = 'block';
}

export function replyToDirectMessage(id, senderName, text) {
  state.directReplyingTo = { id, senderName, text };
  const bar = document.getElementById('direct-replying-bar');
  const textEl = document.getElementById('direct-replying-to-text');
  const iconEl = document.getElementById('direct-replying-icon');
  if (iconEl) iconEl.textContent = '↩';
  if (bar && textEl) {
    textEl.textContent = `Replying to ${senderName}: "${(text || '').slice(0, 45)}..."`;
    bar.style.display = 'flex';
  }
  document.getElementById('direct-message-input')?.focus();
}

export function replyToDirectFile(fileId, fileName, fileUrl, fileType = 'document') {
  state.directReplyingTo = {
    id: fileId,
    senderName: 'File',
    text: fileName,
    fileName: fileName,
    fileUrl: fileUrl,
    fileType: fileType,
    isFileReply: true
  };

  const bar = document.getElementById('direct-replying-bar');
  const textEl = document.getElementById('direct-replying-to-text');
  const iconEl = document.getElementById('direct-replying-icon');
  if (iconEl) iconEl.innerHTML = getFileIcon(fileType, fileName);
  if (bar && textEl) {
    textEl.innerHTML = `<span style="color: var(--accent-primary); font-weight: 700;">Replying to file:</span> <a href="${fileUrl || '#'}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; margin-left: 4px;" onclick="event.stopPropagation();">${escapeHtml(fileName)}</a>`;
    bar.style.display = 'flex';
  }
  document.getElementById('direct-message-input')?.focus();
  showToast(`Replying to "${fileName}" — add text or attach a document/image to send`, 'info', 2500);
}

export function cancelDirectReply() {
  state.directReplyingTo = null;
  const bar = document.getElementById('direct-replying-bar');
  if (bar) bar.style.display = 'none';
}

export async function deleteDirectMessage(msgId) {
  if (!state.activeConversation || !msgId) return;
  try {
    await deletePrivateMessage(state.activeConversation.id, msgId);
  } catch (err) {
    showToast('Failed to delete message', 'error');
  }
}

export async function handleSendDirectMessage() {
  const input = document.getElementById('direct-message-input');
  const text = input ? input.value : '';
  const pendingFiles = (state.directPendingAttachments && state.directPendingAttachments.length > 0)
    ? state.directPendingAttachments
    : (state.directPendingAttachment ? [state.directPendingAttachment] : []);

  if (!state.activeDirectPeer) {
    showToast('No active peer selected for direct chat.', 'error');
    return;
  }

  if (!text.trim() && pendingFiles.length === 0 && !state.directReplyingTo) {
    showToast('Please type a message, attach a file, or reply to a file.', 'warning');
    return;
  }

  const sendBtn = document.getElementById('btn-send-direct-msg');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = pendingFiles.length > 0 ? 'Uploading...' : 'Sending...';
  }

  try {
    let attachments = [];
    if (pendingFiles.length > 0) {
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
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

    const reply = state.directReplyingTo;
    cancelDirectReply();
    clearAllDirectAttachments();
    if (input) input.value = '';

    await sendPrivateMessage(state.userProfile, state.activeDirectPeer, {
      text: text,
      attachments: attachments,
      replyTo: reply
    });
  } catch (err) {
    showToast(err.message || 'Unable to send message right now', 'error');
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  }
}

/**
 * Handle Profile Photo Upload in My Profile Modal
 */
export async function handleProfilePhotoUpload(file) {
  if (!file) return;

  const statusEl = document.getElementById('profile-photo-upload-status');
  const previewImg = document.getElementById('profile-edit-avatar-preview');
  if (statusEl) statusEl.textContent = 'Uploading picture...';

  try {
    const photoURL = await uploadProfilePhoto(file, (percent, status) => {
      if (statusEl) statusEl.textContent = `${status}`;
    });

    if (previewImg) previewImg.src = photoURL;
    if (statusEl) {
      statusEl.textContent = 'Picture uploaded ✓';
      statusEl.style.color = 'var(--status-success)';
    }

    // Save directly to user profile
    await updateUserProfile(state.currentUser.uid, { photoURL });
    state.userProfile.photoURL = photoURL;

    // Update topbar avatar
    const topbarAvatar = document.getElementById('user-avatar-topbar');
    if (topbarAvatar) topbarAvatar.src = photoURL;

    showToast('Profile picture updated!', 'success');
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Upload failed. Please try again.';
      statusEl.style.color = 'var(--status-danger)';
    }
    showToast('Failed to upload picture. Please try another image.', 'error');
  }
}

/**
 * Handle Notification Click
 */
export function handleNotificationClick(notifId, spaceId) {
  markNotificationAsRead(notifId);
  const notif = state.notifications.find(n => n.id === notifId);
  document.getElementById('notifications-dropdown-menu')?.classList.remove('menu-active');

  if (notif?.type === 'chat_request' && notif.senderId) {
    openUserCardModal(notif.senderId);
  } else if (notif?.type === 'chat_request_accepted' && notif.senderId) {
    openDirectChatWithPeer(notif.senderId);
  } else if (notif?.type === 'private_message' && notif.senderId) {
    openDirectChatWithPeer(notif.senderId);
  } else if (spaceId) {
    openSpace(spaceId);
  }
}

/* ==========================================================================
   11. NOTIFICATIONS
   ========================================================================== */

function subscribeNotifications() {
  subscribeToNotifications(state.currentUser.uid, (notifs, unread) => {
    state.notifications = notifs;
    state.unreadNotifications = unread;

    const countText = unread > 9 ? '9+' : String(unread);

    // Topbar bell count badge
    const badge = document.getElementById('notif-badge-dot');
    if (badge) {
      badge.textContent = countText;
      badge.style.display = unread > 0 ? 'inline-flex' : 'none';
    }

    // Sidebar Notifications badge
    const sideBadge = document.getElementById('sidebar-notif-badge');
    if (sideBadge) {
      sideBadge.textContent = countText;
      sideBadge.style.display = unread > 0 ? 'inline-flex' : 'none';
    }

    renderNotificationsPanel();
    renderRailActivity();
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

/**
 * Build a shareable invite link that works on ANY static host — root domain,
 * GitHub Pages project subpaths, Firebase Hosting — by using a #join= hash
 * fragment relative to the current page instead of an absolute /join/ path.
 */
function buildJoinLink(code) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#join=${code}`;
}

export function openQrModal() {
  if (!state.activeSpace) return;
  const canvas = document.getElementById('space-qr-canvas');
  const codeText = document.getElementById('qr-modal-code-display');
  const spaceNameText = document.getElementById('qr-modal-space-name');

  const joinUrl = buildJoinLink(state.activeSpace.code);

  if (canvas) renderQrToCanvas(canvas, joinUrl, 260);
  if (codeText) codeText.textContent = state.activeSpace.code;
  if (spaceNameText) spaceNameText.textContent = state.activeSpace.name;

  openModal('modal-space-qr');
}

export async function downloadSpaceQr() {
  if (!state.activeSpace) return;
  const joinUrl = buildJoinLink(state.activeSpace.code);
  const dataUrl = await generateQrDataUrl(joinUrl, 400);
  downloadQrCode(dataUrl, state.activeSpace.name, state.activeSpace.code);
}

export function copySpaceJoinLink() {
  if (!state.activeSpace) return;
  const joinUrl = buildJoinLink(state.activeSpace.code);
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

  const cleanCode = code.trim().toUpperCase();
  if (cleanCode === OFFICIAL_SUPPORT_CODE) {
    closeModal('modal-join-space');
    closeModal('modal-space-preview');
    if (state.currentUser) {
      await ensureUserSupportMembership(state.currentUser);
      openSpace(OFFICIAL_SUPPORT_SPACE_ID);
    } else {
      sessionStorage.setItem('pendingJoinCode', OFFICIAL_SUPPORT_CODE);
      showAuthView('entry');
    }
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
   14. CREATE SPACE HANDLERS (PAGE & MODAL COMPATIBLE)
   ========================================================================== */

export function openCreateSpacePage() {
  state.currentView = 'create-space';
  unsubscribeFromChat();
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-create-space')?.classList.add('active-view');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const nameInput = document.getElementById('page-create-space-name');
  if (nameInput) nameInput.value = '';
  const descInput = document.getElementById('page-create-space-desc');
  if (descInput) descInput.value = '';
  const previewTitle = document.getElementById('create-preview-title');
  if (previewTitle) previewTitle.textContent = 'New Space Name';
  const previewDesc = document.getElementById('create-preview-desc');
  if (previewDesc) previewDesc.textContent = 'Your space description will appear here.';
  const previewImg = document.getElementById('create-preview-cover-img');
  if (previewImg) previewImg.style.display = 'none';
  const previewFallback = document.getElementById('create-preview-cover-fallback');
  if (previewFallback) previewFallback.style.display = 'flex';
  const fileInput = document.getElementById('page-create-space-cover-file');
  if (fileInput) fileInput.value = '';
  const coverPreview = document.getElementById('page-create-space-cover-preview');
  if (coverPreview) coverPreview.style.display = 'none';
  const coverPlaceholder = document.getElementById('page-create-space-cover-placeholder');
  if (coverPlaceholder) coverPlaceholder.style.display = 'flex';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export async function handleCreateSpaceFromPage() {
  const nameInput = document.getElementById('page-create-space-name');
  const descInput = document.getElementById('page-create-space-desc');
  const catInput = document.getElementById('page-create-space-category');
  const typeInput = document.getElementById('page-create-space-type');
  const expInput = document.getElementById('page-create-space-expiration');
  const coverFileInput = document.getElementById('page-create-space-cover-file');
  const submitBtn = document.getElementById('btn-submit-create-space-page');

  if (!nameInput || !nameInput.value.trim()) {
    showToast('Space name is required.', 'warning');
    nameInput?.focus();
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating Space...';
  }

  try {
    let coverUrl = '';
    if (coverFileInput && coverFileInput.files && coverFileInput.files[0]) {
      showToast('Uploading space cover image...', 'info');
      const coverRes = await uploadToCloudinary(coverFileInput.files[0], null, 15);
      coverUrl = coverRes.url;
    }

    const newSpace = await createSpace(state.currentUser, {
      name: nameInput.value.trim(),
      description: descInput ? descInput.value.trim() : '',
      category: catInput ? catInput.value : 'Classroom',
      type: typeInput ? typeInput.value : 'permanent',
      expiresAt: expInput && expInput.value ? expInput.value : null,
      imageURL: coverUrl
    });

    showToast(`"${newSpace.name}" created!`, 'success');
    openSpace(newSpace.id);
  } catch (err) {
    showToast(err.message || 'Failed to create Space', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Space';
    }
  }
}

export async function handleCreateSpaceSubmit() {
  return handleCreateSpaceFromPage();
}

/**
 * Handle Cover Image Update for active space by Admin
 */
export async function handleUpdateSpaceCover(file) {
  if (!file || !state.activeSpace) return;
  showToast('Uploading new cover image...', 'info');
  try {
    const res = await uploadToCloudinary(file, null, 15);
    await updateSpaceCover(state.activeSpace.id, res.url);
    state.activeSpace.imageURL = res.url;
    renderSpaceHeader();
    showToast('Space cover image updated!', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to update cover', 'error');
  }
}

/* ==========================================================================
   15. JOIN SPACE VIA CODE (PAGE & QUICK JOIN)
   ========================================================================== */

export function openJoinSpacePage() {
  state.currentView = 'join-space';
  unsubscribeFromChat();
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-join-space')?.classList.add('active-view');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('nav-join')?.classList.add('active');

  const input = document.getElementById('page-join-code-input');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
  const resultBox = document.getElementById('join-page-result-box');
  if (resultBox) resultBox.style.display = 'none';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export async function handleQuickCodeJoin() {
  const input = document.getElementById('dash-quick-join-input');
  const code = input ? input.value.trim().toUpperCase() : '';
  if (!code) {
    showToast('Please enter a 6-character space code.', 'warning');
    return;
  }

  showToast('Locating space...', 'info', 1200);
  const foundSpace = await findSpaceByCode(code);
  if (!foundSpace) {
    showToast('No Space found matching this code.', 'error');
    return;
  }

  const currentStatus = await getMembershipState(foundSpace.id, state.currentUser?.uid);
  if (currentStatus === 'member' || currentStatus === 'admin') {
    showToast(`Entering "${foundSpace.name}"...`, 'success', 1000);
    openSpace(foundSpace.id);
  } else {
    openJoinSpacePage();
    const joinInput = document.getElementById('page-join-code-input');
    if (joinInput) joinInput.value = code;
    await handleJoinPageCodeSearch(code);
  }
}

export async function handleJoinPageCodeSearch(code) {
  if (!code || !code.trim()) {
    showToast('Please enter a Space code.', 'warning');
    return;
  }
  const cleanCode = code.trim().toUpperCase();

  if (cleanCode === OFFICIAL_SUPPORT_CODE) {
    if (state.currentUser) {
      await ensureUserSupportMembership(state.currentUser);
      openSpace(OFFICIAL_SUPPORT_SPACE_ID);
    } else {
      sessionStorage.setItem('pendingJoinCode', OFFICIAL_SUPPORT_CODE);
      showAuthView('entry');
    }
    return;
  }

  showToast('Locating Space...', 'info', 1200);
  const foundSpace = await findSpaceByCode(cleanCode);
  const resultBox = document.getElementById('join-page-result-box');

  if (!foundSpace) {
    showToast('No Space found matching this code.', 'error');
    if (resultBox) resultBox.style.display = 'none';
    return;
  }

  const nameEl = document.getElementById('page-preview-space-name');
  const descEl = document.getElementById('page-preview-space-desc');
  const metaEl = document.getElementById('page-preview-space-meta');
  const btn = document.getElementById('page-btn-request-join');

  if (nameEl) nameEl.textContent = foundSpace.name;
  if (descEl) descEl.textContent = foundSpace.description || 'Welcome to this private space.';
  if (metaEl) {
    metaEl.textContent = `${foundSpace.category} · ${foundSpace.memberCount || 1} members · ${foundSpace.type === 'temporary' ? 'Temporary' : 'Permanent'}`;
  }

  const currentStatus = await getMembershipState(foundSpace.id, state.currentUser?.uid);
  if (btn) {
    if (currentStatus === 'member' || currentStatus === 'admin') {
      btn.textContent = 'Enter Space';
      btn.disabled = false;
      btn.onclick = () => openSpace(foundSpace.id);
    } else if (currentStatus === 'pending') {
      btn.textContent = 'Request Pending';
      btn.disabled = true;
    } else {
      btn.textContent = 'Request to Join';
      btn.disabled = false;
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'Requesting...';
        await requestToJoinSpace(foundSpace.id, state.userProfile);
        btn.textContent = 'Request Pending';
      };
    }
  }

  if (resultBox) {
    resultBox.style.display = 'block';
    resultBox.scrollIntoView({ behavior: 'smooth' });
  }
}

/* ==========================================================================
   16. PROFILE & SETTINGS PAGE (NO POPUPS)
   ========================================================================== */

export function openProfilePage() {
  state.currentView = 'profile';
  unsubscribeFromChat();
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-profile')?.classList.add('active-view');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('nav-profile')?.classList.add('active');

  if (!state.userProfile) return;
  const nameInput = document.getElementById('page-profile-name');
  const handleInput = document.getElementById('page-profile-handle');
  const bioInput = document.getElementById('page-profile-bio');
  const avatarEl = document.getElementById('page-profile-avatar-preview');
  const statusEl = document.getElementById('page-profile-photo-status');

  if (nameInput) nameInput.value = state.userProfile.displayName || '';
  if (handleInput) handleInput.value = `@${state.userProfile.username || 'user'}`;
  if (bioInput) bioInput.value = state.userProfile.bio || '';
  if (avatarEl) avatarEl.src = getAvatarUrl(state.userProfile.photoURL, state.userProfile.displayName);
  if (statusEl) {
    statusEl.textContent = 'Click to upload a new picture';
    statusEl.style.color = 'var(--text-muted)';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export async function handleSaveProfileFromPage() {
  const name = document.getElementById('page-profile-name')?.value;
  const bio = document.getElementById('page-profile-bio')?.value;
  const { updateUserProfile } = await import('./profile.js');
  await updateUserProfile(state.currentUser.uid, { displayName: name, bio });
  state.userProfile.displayName = name;
  state.userProfile.bio = bio;
  setupAuthenticatedUI();
  showToast('Profile updated successfully!', 'success');
}

export async function handleProfilePhotoUploadPage(file) {
  if (!file) return;
  const statusEl = document.getElementById('page-profile-photo-status');
  const previewImg = document.getElementById('page-profile-avatar-preview');
  if (statusEl) statusEl.textContent = 'Uploading picture...';

  try {
    const photoURL = await uploadProfilePhoto(file, (percent, status) => {
      if (statusEl) statusEl.textContent = `${status}`;
    });

    if (previewImg) previewImg.src = photoURL;
    if (statusEl) {
      statusEl.textContent = 'Picture uploaded ✓';
      statusEl.style.color = 'var(--status-success)';
    }

    await updateUserProfile(state.currentUser.uid, { photoURL });
    state.userProfile.photoURL = photoURL;
    const topbarAvatar = document.getElementById('user-avatar-topbar');
    if (topbarAvatar) topbarAvatar.src = photoURL;
    const heroAvatar = document.getElementById('dash-hero-avatar');
    if (heroAvatar) heroAvatar.src = photoURL;

    showToast('Profile picture updated!', 'success');
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Upload failed. Try again.';
      statusEl.style.color = 'var(--status-danger)';
    }
    showToast('Failed to upload picture.', 'error');
  }
}

/* ==========================================================================
   17. GLOBAL SEARCH
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg> <span>${escapeHtml(s.name)}</span> <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: auto;">${escapeHtml(s.code || '')}</span>
      </div>
    `).join('');
  }

  if (results.people.length > 0) {
    html += `<div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); padding: 8px 12px; font-weight: 600;">People</div>`;
    html += results.people.map(p => `
      <div class="menu-item" onclick="window.HubbleNest.handleSelectSearchResult('user', '${p.uid}')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg> <span>${escapeHtml(p.displayName)}</span> <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: auto;">@${escapeHtml(p.username)}</span>
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

// Object.assign (not reassignment) keeps the window.HubbleNest object
// identity stable with the no-op stubs installed in index.html <head>.
Object.assign(window.HubbleNest, {
  // Navigation & Pages (No Popups!)
  showLandingPage,
  openAuth: (mode) => showAuthView(mode),
  scrollToSection: (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  },
  loadDashboard,
  openMySpacesPage,
  handleSpacesSearch,
  openSpace,
  switchSpaceTab,
  openDirectMessagesView,
  openPeopleView,

  // Dedicated Pages (Replacing intrusive popups)
  openCreateSpacePage,
  openJoinSpacePage,
  openProfilePage,
  openMemberProfilePage,
  goBackFromMemberProfile,
  handleQuickCodeJoin,
  handleJoinPageCodeSearch,
  handleCreateSpaceFromPage,
  handleSaveProfileFromPage,
  handleProfilePhotoUploadPage,

  // Backward compatibility aliases
  openCreateSpaceModal: openCreateSpacePage,
  openJoinModal: openJoinSpacePage,
  openProfileModal: openProfilePage,
  openUserCardModal: openMemberProfilePage,
  openAdminSettingsModal: () => switchSpaceTab('settings'),
  openQrModal: () => switchSpaceTab('invite'),
  openNewAnnouncementModal: () => toggleAnnouncementComposer(true),

  // People Directory & Chat Requests
  loadPeopleDirectory,
  handlePeopleSearch,
  handleSendChatRequest,
  handleAcceptRequest,
  handleDeclineRequest,
  cancelSentRequest,
  openDirectChatWithPeer,
  handleProfilePhotoUpload,

  // Landing Page & Auth
  showLandingPage,
  showAuthView,
  showAuthEntryCard,
  handleHeroCodeJoin,
  handleLandingCodeJoin,
  setupAuthenticatedUI,
  showLoginCard,
  showSignupCard,
  nextSignupStep,
  prevSignupStep,

  // PWA Install & Push Opt-in
  handleInstallClick,
  closeInstallIosSheet,
  enablePushFromNudge,
  dismissPushNudge,

  loginWithEmail: async () => {
    const e = document.getElementById('login-email').value;
    const p = document.getElementById('login-password').value;
    await loginWithEmail(e, p);
  },
  loginWithGoogle: async () => {
    try {
      return await loginWithGoogle();
    } catch {
      // Error already surfaced to the user via toast; avoid unhandled rejection noise.
    }
  },
  resetPassword: () => {
    const e = prompt('Enter your account email for password reset:');
    if (e) resetPassword(e);
  },
  logoutUser,

  // Spaces
  handleCreateSpaceSubmit,
  handleCodeSearch,
  downloadSpaceQr,
  copySpaceJoinLink,
  handleUpdateSpaceCover,
  handleSaveSpaceSettingsFromTab,

  // Chat & Message Deletion
  handleSendMessage,
  startReply,
  cancelReply,
  replyToFile,
  stageChatAttachment,
  removeChatAttachment,
  clearAllChatAttachments,
  cancelPendingAttachment,
  toggleReaction: (msgId, emoji) => toggleMessageReaction(state.activeSpace.id, msgId, emoji, state.currentUser.uid),
  deleteMessage: (msgId) => deleteSpaceMessage(state.activeSpace.id, msgId),
  deleteDirectMessage,
  triggerChatAttachmentUpload,

  // Direct Messages
  selectConversation,
  handleSendDirectMessage,
  stageDirectAttachment,
  removeDirectAttachment,
  clearAllDirectAttachments,
  cancelDirectPendingAttachment,
  replyToDirectMessage,
  replyToDirectFile,
  cancelDirectReply,

  // Notifications
  handleNotificationClick,

  // Files
  handleSpaceFileUpload,
  deleteFile: (fileId) => deleteSpaceFile(state.activeSpace.id, fileId),

  // Announcements (Inline)
  toggleAnnouncementComposer,
  handleCreateAnnouncementInline,
  handleCreateAnnouncement: async () => {
    const title = document.getElementById('ann-title-input')?.value || document.getElementById('ann-title-input-inline')?.value;
    const content = document.getElementById('ann-content-input')?.value || document.getElementById('ann-content-input-inline')?.value;
    const pinned = document.getElementById('ann-pinned-input')?.checked || document.getElementById('ann-pinned-input-inline')?.checked;
    await createAnnouncement(state.activeSpace.id, state.userProfile, { title, content, isPinned: pinned });
    closeModal('modal-create-announcement');
    toggleAnnouncementComposer(false);
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
  handleSaveSpaceSettings: async () => {
    const name = document.getElementById('edit-space-name')?.value || document.getElementById('edit-space-name-tab')?.value;
    const desc = document.getElementById('edit-space-desc')?.value || document.getElementById('edit-space-desc-tab')?.value;
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
    else if (type === 'user') openMemberProfilePage(id);
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
  handleSaveProfile: handleSaveProfileFromPage,

  // Modals / Helpers
  closeModal: (id) => closeModal(id),
  copyLinkUrl: (url) => copyToClipboard(url, 'Copied to clipboard'),
  copySpaceCode: () => {
    if (state.activeSpace?.code) copyToClipboard(state.activeSpace.code, 'Space code copied');
  },

  // Home community feed (official Space via existing chat system)
  resolveHomeSpaceId: () => {
    const official = state.userSpaces.find(sp => sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID);
    return official ? official.id : OFFICIAL_SUPPORT_SPACE_ID;
  },
  handleHomePost: () => {
    if (!state.userProfile || !state.currentUser) return;
    handleHomePost(
      window.HubbleNest.resolveHomeSpaceId(),
      state.userProfile,
      state.currentUser.uid,
      state.activeSpaceRole === 'admin' || state.userSpaces.some(sp => (sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID) && sp.userRole === 'admin')
    );
  },
  stageHomeAttachment: (file) => stageHomeFile(file, 100),
  removeHomeAttachment,
  clearAllHomeAttachments,
  toggleHomeReaction: (msgId, emoji) => {
    toggleMessageReaction(window.HubbleNest.resolveHomeSpaceId(), msgId, emoji, state.currentUser.uid);
  },
  deleteHomeMessage: (msgId) => {
    deleteSpaceMessage(window.HubbleNest.resolveHomeSpaceId(), msgId);
  },

  // Sidebar "Spaces" shortcut: open the dedicated Your Spaces page
  openSpacesSection: () => openMySpacesPage(),

  // Official HubbleNest Community Space (real Get Help / Featured Space targets)
  getOfficialSpaceId: () => {
    const official = state.userSpaces.find(sp => sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID);
    return official ? official.id : OFFICIAL_SUPPORT_SPACE_ID;
  },
  openCommunitySpace: async () => {
    const official = state.userSpaces.find(sp => sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID);
    if (official) {
      await openSpace(official.id);
      return;
    }
    try {
      await ensureUserSupportMembership(state.currentUser);
    } catch (e) { /* membership already ensured at auth */ }
    await openSpace(OFFICIAL_SUPPORT_SPACE_ID);
  },
  openCommunityMembers: async () => {
    const official = state.userSpaces.find(sp => sp.isOfficialSupport || sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.id === OFFICIAL_SUPPORT_SPACE_ID);
    if (official) {
      await openSpace(official.id);
      switchSpaceTab('members');
      return;
    }
    try {
      await ensureUserSupportMembership(state.currentUser);
    } catch (e) { /* membership already ensured at auth */ }
    await openSpace(OFFICIAL_SUPPORT_SPACE_ID);
    switchSpaceTab('members');
  },

  // Inline links panel (fixes previously broken Add Link button in empty state)
  openAddLinkModal: () => {
    const form = document.getElementById('inline-link-adder');
    if (form) {
      form.style.display = (form.style.display === 'none' || !form.style.display) ? 'block' : 'none';
      if (form.style.display === 'block') document.getElementById('inline-link-url')?.focus();
    } else {
      switchSpaceTab('links');
    }
  }
});

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
