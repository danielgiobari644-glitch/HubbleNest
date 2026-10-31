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
  getDocs,
  setDoc,
  collection,
  deleteDoc,
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
  joinSpaceByCode,
  addMemberToSpace,
  removeSpaceMember,
  extendSpaceExpiration,
  updateSpaceSettings,
  updateSpaceCover,
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
  fetchPublicUserCard
} from './people.js';

// Contacts — People page shows ONLY your contacts; add members by username;
// contacts chat instantly with no request step.
import {
  subscribeToContacts,
  addContact,
  removeContact,
  isContact,
  findUserByUsername
} from './contacts.js';

// Rich text — real formatting (bold/italic/headings/lists/code/links) with a
// vertical multi-line layout; no Markdown symbols are ever shown raw.
import { renderRichText, richTextPreview } from './format.js';

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
  updateMemberRole, 
  removeMemberFromSpace 
} from './members.js';

import {
  subscribeToNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  requestPushPermission,
  initWebPushNotifications,
  getPushConfigStatus,
  savePushConfig,
  sendPushToUser
} from './notifications.js';

import { 
  uploadToCloudinary, 
  formatBytes, 
  getFileCategory, 
  checkDocumentDelivery 
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

// Community feed (real posts + ranking algorithm), Arcade, Direct Share,
// and the Firestore Connection Doctor (replaces the old home.js space-mirror feed)
import {
  startCommunityFeed,
  stopCommunityFeed,
  setFeedConnections,
  handleHomePost,
  stageHomeAttachment as stageHomeFile,
  removeHomeAttachment,
  clearAllHomeAttachments,
  feedSetMode,
  feedToggleLike,
  feedToggleComments,
  feedSubmitComment,
  feedDeleteComment,
  feedDeletePost,
  toggleRankingInfo
} from './community.js';

import {
  startArcade,
  stopArcade,
  setArcadeFilter,
  openGameEditor,
  closeGameEditor,
  setCodePane,
  insertStarterGame,
  scheduleGamePreview,
  saveCurrentGame,
  gameDelete,
  openGamePlayer,
  closeGamePlayer,
  gameToggleLike,
  toggleGameFullscreen,
  handleGameFilesUpload,
  removeGameFile,
  setGameEntry,
  setGameEntryByIndex,
  removeGameFileByIndex,
  clearGameFiles,
  toggleAiPanel,
  refreshAiPanelStatus,
  generateGameFromPrompt,
  scaffoldProjectWithAi
} from './games.js';

import {
  openDirectShareView,
  stopDirectShare,
  setMode as setShareMode,
  createDirectShare,
  addFilesToShare,
  copyShareLink,
  closeDirectShare,
  backToSharePicker,
  connectToShare
} from './direct-share.js';

import {
  runFirestoreDoctor,
  handlePermissionError
} from './firestore-doctor.js';

// Unified HubbleNest icon system — one local SVG set for the whole UI.
import { installIconSystem } from './icons.js';

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
  contacts: [],
  contactsUnsub: null,
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
  previousView: 'dashboard',
  conversationsUnsub: null,
  incomingReqUnsub: null,
  directChatRetried: false
};

/* ==========================================================================
   PWA INSTALL (hero "Download App" button) & EARLY SERVICE WORKER
   ========================================================================== */

let deferredInstallPrompt = null;

/* Chat message entry animations (task 19). Ids already on screen NEVER
   animate again — only genuinely NEW messages play the send/receive motion.
   null means "first render of this conversation": history loads silently. */
let spaceAnimatedIds = null;
let directAnimatedIds = null;

// Register the service worker as early as possible so the PWA is
// installable even on the public landing page (and works offline there).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });

  // DEPLOY AUTO-REFRESH: when a newly-installed service worker takes over
  // (skipWaiting + clients.claim fire controllerchange), reload ONCE so every
  // module, stylesheet and the HTML shell come from the new cache atomically.
  // Without this, the first load after a deploy renders a MIX of old cached
  // JS/CSS and new HTML — the classic "I deployed but nothing changed" bug.
  // The sessionStorage guard makes the reload happen at most once per tab
  // session, so it can never loop.
  try {
    let claimedOnce = sessionStorage.getItem('hn-sw-claimed') === '1';
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (claimedOnce) {
        sessionStorage.setItem('hn-sw-claimed', '0');
        window.location.reload();
        return;
      }
      claimedOnce = true;
      sessionStorage.setItem('hn-sw-claimed', '1');
    });
  } catch (e) { /* sessionStorage unavailable — skip auto-refresh */ }
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
  // We deliberately do NOT call e.preventDefault() here. Chrome logs
  // "Banner not shown: beforeinstallpromptevent.preventDefault() called.
  // The page must call beforeinstallpromptevent.prompt()" on every load when
  // the event is suppressed — and the banner stays invisible whenever prompt()
  // is never reached. Leaving the event un-prevented keeps Chrome's own
  // install banner alive AND still hands us the event, so the branded banner
  // and the hero button below can call prompt() from a real user gesture.
  if (isStandaloneDisplay()) return; // already running installed — nothing to offer
  deferredInstallPrompt = e;
  refreshHeroInstallButton();
  showInstallBanner(); // no-op while the banner was dismissed recently
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  refreshHeroInstallButton();
  hideInstallBanner();
  showToast('HubbleNest installed! Find it on your home screen.', 'success', 5000);
});

export async function handleInstallClick() {
  hideInstallBanner(); // clicking Install (banner or hero) retires the banner
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
   RETURNING-VISITOR BOOT SPLASH
   Only new users see the landing/portfolio. Anyone who has ever signed in on
   this device (flag persisted by the auth state listener below) boots through
   a branded splash straight into the app — or into the sign-in view when the
   session has expired. The <head> gate script hides the landing pre-paint.
   ========================================================================== */

const HAS_AUTHED_KEY = 'hn-has-authed';

function hasAuthedBefore() {
  try { return localStorage.getItem(HAS_AUTHED_KEY) === '1'; } catch (e) { return false; }
}

function markHasAuthed() {
  try { localStorage.setItem(HAS_AUTHED_KEY, '1'); } catch (e) { /* private mode */ }
}

function hideBootSplash() {
  const de = document.documentElement;
  de.classList.remove('hn-returning-visitor', 'hn-boot-timeout');
  const splash = document.getElementById('boot-splash');
  if (splash) splash.style.display = 'none';
}

/* ==========================================================================
   PWA INSTALL BANNER
   The beforeinstallprompt event is captured WITHOUT preventDefault, so the
   browser's native install banner stays available and Chrome never logs
   "Banner not shown". This branded banner is shown alongside it — bottom-left
   on desktop / above the mobile nav — and its Install button (plus the hero
   button) calls prompt() from a real user gesture. Hides while running
   installed, and stays dismissed for 3 days after the user says no.
   ========================================================================== */

const INSTALL_BANNER_DISMISS_KEY = 'hn-install-banner-dismissed-at';
const INSTALL_BANNER_DISMISS_DAYS = 3;

function installBannerRecentlyDismissed() {
  try {
    const at = parseInt(localStorage.getItem(INSTALL_BANNER_DISMISS_KEY) || '0', 10);
    if (!at) return false;
    return (Date.now() - at) < INSTALL_BANNER_DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch (e) { return false; }
}

function showInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (!banner) return;
  if (isStandaloneDisplay()) return;                  // already installed
  if (installBannerRecentlyDismissed()) return;       // user said no recently
  // On mobile, stack above the push opt-in nudge if that one is visible too.
  const nudge = document.getElementById('push-nudge');
  const nudgeVisible = !!(nudge && nudge.style.display === 'flex');
  banner.classList.toggle('hn-stacked', nudgeVisible);
  banner.style.display = 'flex';
}

function hideInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.style.display = 'none';
}

export function dismissInstallBanner() {
  hideInstallBanner();
  try { localStorage.setItem(INSTALL_BANNER_DISMISS_KEY, String(Date.now())); } catch (e) { /* private mode */ }
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
    initWebPushNotifications(state.currentUser.uid, { silent: true });
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

// iOS Safari never fires beforeinstallprompt — surface the guided install
// banner there too (its Install button opens the "Add to Home Screen" sheet).
if (isIosSafari()) {
  showInstallBanner();
}

/* ==========================================================================
   1. AUTHENTICATION & ROUTING
   ========================================================================== */

onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.currentUser = user;
    markHasAuthed(); // remember this device has a member — future boots skip the portfolio
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
    // Tear down realtime subscriptions so a future sign-in starts clean.
    stopCommunityFeed();
    stopArcade();
    stopDirectShare();
    if (state.conversationsUnsub) { state.conversationsUnsub(); state.conversationsUnsub = null; }
    if (state.incomingReqUnsub) { state.incomingReqUnsub(); state.incomingReqUnsub = null; }
    // Only NEW users see the marketing portfolio. Anyone who has already
    // signed in on this device goes straight to the sign-in view.
    if (hasAuthedBefore()) {
      showAuthView('entry');
    } else {
      showLandingPage();
    }
  }
});

function setupAuthenticatedUI() {
  const topbar = document.getElementById('main-topbar');
  const appContainer = document.getElementById('app-container');
  const authContainer = document.getElementById('auth-container');
  const landingContainer = document.getElementById('landing-page-container');

  hideBootSplash();

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

  // Subscribe to incoming chat requests (guarded: never stack duplicates)
  if (state.incomingReqUnsub) { state.incomingReqUnsub(); state.incomingReqUnsub = null; }
  state.incomingReqUnsub = subscribeToIncomingRequests(state.currentUser.uid, (requests) => {
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

    // Connection set for the feed's affinity signal: pending requests + DMs
    setFeedConnections(computeConnectionSet());
  });

  // Offer push notification opt-in (once, dismissible) or refresh device token
  maybeShowPushNudge();

  // Direct Share deep link captured before sign-in (?share=CODE / #share=CODE)
  const pendingShare = sessionStorage.getItem('pendingShareCode');
  if (pendingShare) {
    sessionStorage.removeItem('pendingShareCode');
    openDirectShareViewWrapper(pendingShare);
  }
}

export function showLandingPage() {
  const topbar = document.getElementById('main-topbar');
  const appContainer = document.getElementById('app-container');
  const authContainer = document.getElementById('auth-container');
  const landingContainer = document.getElementById('landing-page-container');
  const userBanner = document.getElementById('landing-user-banner');

  hideBootSplash(); // explicit "Explore Landing Page" visits clear the gate too

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

  hideBootSplash();

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

  // Direct Share deep links: ?share=CODE or #share=CODE (encoded in the QR)
  const shareHash = window.location.hash.match(/^#share=([A-Za-z0-9]{6})/);
  const shareQuery = new URLSearchParams(window.location.search).get('share');
  const shareCode = ((shareHash && shareHash[1]) || (shareQuery && shareQuery.trim()) || '').toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(shareCode)) {
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search.replace(/[?&]share=[^&]+/, ''));
    } catch (e) { /* non-fatal */ }
    if (state.currentUser) {
      openDirectShareViewWrapper(shareCode);
    } else {
      sessionStorage.setItem('pendingShareCode', shareCode);
    }
    return;
  }

  const path = window.location.pathname;
  if (path.startsWith('/join/')) {
    const code = path.replace('/join/', '').trim().toUpperCase();
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
  stopArcade();
  stopDirectShare();

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
    const grad = palette[hashStr(sp.id || sp.name) % palette.length];
    const icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/></svg>`;
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
  // Featured space = your most recent Space (real data only)
  const featured = state.userSpaces[0];
  const featName = document.getElementById('rail-featured-name');
  const featDesc = document.getElementById('rail-featured-desc');
  const featBtn = document.getElementById('rail-featured-btn');
  if (featured) {
    if (featName) featName.textContent = featured.name || 'HubbleNest Community';
    if (featDesc) featDesc.textContent = featured.description || 'Have a question about HubbleNest? This is the place to ask.';
    if (featBtn) featBtn.onclick = () => openSpace(featured.id);
  }

  // Members card: show YOUR contacts (real data, live count)
  if (state.currentUser) {
    // One live subscription per session — re-calling renderDashRail replaces
    // the previous listener instead of stacking duplicates.
    if (typeof state.contactsUnsub === 'function') state.contactsUnsub();
    state.contactsUnsub = subscribeToContacts(state.currentUser.uid, (contacts) => {
      state.contacts = contacts || [];

      const stack = document.getElementById('rail-members-avatars');
      const count = document.getElementById('rail-members-count');
      if (count) count.textContent = `${state.contacts.length} contact${state.contacts.length === 1 ? '' : 's'}`;
      if (stack) {
        const top = state.contacts.slice(0, 7);
        stack.innerHTML = top.map(p => `
          <span class="stack-avatar" title="${escapeHtml(p.displayName)}">
            <img src="${getAvatarUrl(p.photoURL, p.displayName)}" alt="${escapeHtml(p.displayName)}" loading="lazy" decoding="async" />
          </span>
        `).join('') + (state.contacts.length > 7 ? `<span class="stack-more">+${state.contacts.length - 7}</span>` : '');
        if (state.contacts.length === 0) {
          stack.innerHTML = `<div class="rail-activity-empty">No contacts yet — add people by their username.</div>`;
        }
      }
    }, (err) => console.warn('Contacts listener:', err?.code || err));
  }
}

/**
 * Start the community feed on Home (real feedPosts + transparent ranking).
 * The affinity signal uses this member's real connections: accepted DMs and
 * pending chat requests, refreshed whenever either changes.
 */
function computeConnectionSet() {
  const set = new Set();
  (state.contacts || []).forEach(c => { if (c.uid) set.add(c.uid); });
  (state.incomingChatRequests || []).forEach(r => { if (r.senderId) set.add(r.senderId); });
  (state.conversations || []).forEach(c => (c.participants || []).forEach(p => { if (p !== state.currentUser?.uid) set.add(p); }));
  return set;
}

function startHomeCommunityFeed() {
  startCommunityFeed(state.userProfile, state.currentUser?.uid, computeConnectionSet());
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
    const expInfo = sp.type === 'temporary' ? formatExpiration(sp.expiresAt) : null;
    const coverUrl = sp.imageURL || '';
    const isAdmin = sp.userRole === 'admin';

    return `<div class="space-card" data-space-id="${sp.id}" onclick="window.HubbleNest.openSpace('${sp.id}')">
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
  const spaceSnap = await getDoc(doc(db, 'spaces', spaceId));
  if (!spaceSnap.exists()) {
    showToast('Space not found', 'error');
    loadDashboard();
    return;
  }

  state.activeSpace = { id: spaceSnap.id, ...spaceSnap.data() };
  spaceAnimatedIds = null; // new Space → chat history loads silently
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
  if (descEl) {
    // Group descriptions render as real rich text — vertical, multi-line,
    // honoring headings/lists/bold, never showing raw Markdown symbols.
    descEl.innerHTML = renderRichText(sp.description) || '<span class="space-desc-empty">Welcome to this space.</span>';
  }
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
  const publicInput = document.getElementById('edit-space-public-tab');
  if (publicInput) publicInput.checked = state.activeSpace.isPublic === true;
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

/** Close the composer options dropdown if a click lands outside it. */
export function closeComposerMenu() {
  const menu = document.getElementById('composer-menu');
  const btn = document.getElementById('composer-menu-btn');
  if (menu) menu.setAttribute('hidden', '');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

/** Toggle the composer options dropdown (＋ button under the post box). */
export function toggleComposerMenu(ev) {
  if (ev) { ev.stopPropagation(); }
  const menu = document.getElementById('composer-menu');
  const btn = document.getElementById('composer-menu-btn');
  if (!menu) return;
  const isOpen = !menu.hasAttribute('hidden');
  if (isOpen) {
    closeComposerMenu();
  } else {
    menu.removeAttribute('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }
}

/** Apply a formatting action from the dropdown, then close it. */
export function composerMenuApply(inputId, kind) {
  closeComposerMenu();
  const el = document.getElementById(inputId);
  if (el) { el.focus({ preventScroll: true }); }
  if (typeof window.HubbleNest?.rtWrap === 'function') {
    window.HubbleNest.rtWrap(inputId, kind);
  }
}

/** Pick an image / any file from the dropdown. */
export function composerMenuPickImage() {
  closeComposerMenu();
  document.getElementById('home-image-input')?.click();
}
export function composerMenuPickFile() {
  closeComposerMenu();
  document.getElementById('home-doc-input')?.click();
}

// Click-outside + Escape close the composer dropdown (registered once).
document.addEventListener('click', (ev) => {
  if (ev.target && typeof ev.target.closest === 'function' && !ev.target.closest('.composer-menu-wrap')) {
    closeComposerMenu();
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeComposerMenu();
});

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

/**
 * Post-render delivery audit for document attachments (Space chat + DMs).
 * Cloudinary accounts ship with "PDF and ZIP delivery" disabled, which turns
 * every uploaded document link into a 401 the user only discovers on click.
 * Each doc link is probed once (HEAD, cached); a blocked file swaps the dead
 * link for a card that names the exact one-time fix.
 */
async function enhanceDocumentDelivery(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) return;
  const links = rootEl.querySelectorAll('a.msg-doc-link[data-doc-url]');
  for (const a of links) {
    if (a.dataset.deliveryChecked === '1') continue;
    a.dataset.deliveryChecked = '1';
    const url = a.getAttribute('data-doc-url');
    if (!url || !url.includes('res.cloudinary.com')) continue;
    let status = 'unknown';
    try { status = await checkDocumentDelivery(url); } catch (e) { status = 'unknown'; }
    if (status !== 'blocked' || !a.isConnected) continue;
    const card = a.closest('.msg-attachment-doc');
    if (!card) continue;
    card.classList.add('msg-doc-blocked');
    card.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--status-warning, #fbbf24); font-weight: 600;">
          <span>🔒</span><span>This file is blocked by the storage account's security setting (PDF &amp; ZIP delivery).</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.45;">
          One-time fix for the whole app: open
          <a href="https://console.cloudinary.com/settings/security" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary);">console.cloudinary.com/settings/security</a>
          → tick <b>"Allow delivery of PDF and ZIP files"</b> → Save. Existing files (this one included) become downloadable right away.
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <a href="${url}" target="_blank" rel="noopener noreferrer" class="btn-ghost" style="padding: 2px 8px; font-size: 0.75rem; color: var(--accent-primary);">Try opening anyway ↗</a>
          <span style="font-size: 0.7rem; color: var(--text-muted);">(usually answers 401 until the setting is on)</span>
        </div>
      </div>
    `;
  }
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

    // Entry animation ONLY for messages that appeared after the initial
    // history render — sends slide in from the right, receives from the left.
    let enterCls = '';
    if (!spaceAnimatedIds) {
      spaceAnimatedIds = new Set(state.spaceMessages.map((m) => m.id));
    } else if (!spaceAnimatedIds.has(msg.id)) {
      spaceAnimatedIds.add(msg.id);
      enterCls = isOwn ? 'msg-enter-send' : 'msg-enter-recv';
    }

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
            <div class="msg-attachment-preview msg-attachment-doc" style="background: var(--bg-surface-elevated); padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg></span>
                <a href="${att.url}" data-doc-url="${att.url}" class="msg-doc-link" target="_blank" rel="noopener noreferrer" style="font-weight: 500; font-size: 0.85rem; color: var(--accent-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
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
      <div class="message-row ${isOwn ? 'msg-own' : ''} ${enterCls}">
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
            <div class="rt-msg">${renderRichText(msg.text)}</div>
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

  container.scrollTop = container.scrollHeight;
  enhanceDocumentDelivery(container);
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
        <div class="announcement-content rich-text">${renderRichText(ann.content)}</div>
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
  // NOTE: joining is INSTANT with a valid Space code — the old
  // request/approval queue no longer exists, so there is nothing to listen to.
}

function renderMembersList() {
  const container = document.getElementById('members-list-grid');
  if (!container) return;

  const adminPanel = state.activeSpaceRole === 'admin' ? `
    <div class="space-contacts-admin">
      <div class="space-contacts-admin-head">
        <div>
          <b>Member management</b>
          <div class="space-contacts-admin-sub">Add from your contacts, or remove existing members. Anyone with the Space code joins instantly.</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.toggleSpaceContactsPicker()">+ Add contacts</button>
      </div>
      <div id="space-contacts-picker" style="display: none;"></div>
    </div>` : '';

  container.innerHTML = adminPanel + state.spaceMembers.map(m => {
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
            <button class="btn btn-sm btn-ghost" style="color: var(--status-danger);" onclick="window.HubbleNest.removeSpaceMemberByUid('${m.userId}')" title="Remove member">
              ✕
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   ADMIN MEMBER MANAGEMENT — add members straight from your contacts.
   (Joining by code is instant for everyone else; no approval queue exists.)
   ========================================================================== */

export function toggleSpaceContactsPicker() {
  const panel = document.getElementById('space-contacts-picker');
  if (!panel) return;
  const show = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = show ? 'block' : 'none';
  if (show) renderSpaceContactsPicker();
}

function renderSpaceContactsPicker() {
  const panel = document.getElementById('space-contacts-picker');
  if (!panel) return;
  const memberUids = new Set((state.spaceMembers || []).map(m => m.userId));
  const candidates = (state.contacts || []).filter(c => !memberUids.has(c.uid));

  if ((state.contacts || []).length === 0) {
    panel.innerHTML = `<div class="space-contacts-empty">None of your contacts are available yet — add contacts from the People page first.</div>`;
    return;
  }
  if (candidates.length === 0) {
    panel.innerHTML = `<div class="space-contacts-empty">All of your contacts are already members of this Space.</div>`;
    return;
  }

  panel.innerHTML = candidates.map(c => `
    <div class="member-card">
      <div class="msg-avatar" style="width: 38px; height: 38px;">
        <img src="${getAvatarUrl(c.photoURL, c.displayName)}" class="avatar-img" alt="" loading="lazy" decoding="async"/>
      </div>
      <div class="member-info">
        <div class="member-name">${escapeHtml(c.displayName)}</div>
        <div class="member-role">@${escapeHtml(c.username || '')}</div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="window.HubbleNest.addSpaceMemberFromContacts('${c.uid}')">Add</button>
    </div>
  `).join('');
}

export async function addSpaceMemberFromContacts(memberUid) {
  if (state.activeSpaceRole !== 'admin') return;
  const contact = (state.contacts || []).find(c => c.uid === memberUid);
  if (!contact) return;
  try {
    const res = await addMemberToSpace(state.activeSpace.id, {
      uid: contact.uid,
      displayName: contact.displayName,
      username: contact.username,
      photoURL: contact.photoURL
    }, 'member');
    showToast(res.already
      ? `${contact.displayName} is already a member.`
      : `${contact.displayName} added to the Space.`, res.already ? 'info' : 'success');
    renderSpaceContactsPicker();
  } catch (err) {
    console.error('Add member failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'Your Firestore rules block adding members — run Connection Doctor.'
      : 'Could not add this member.', 'error');
  }
}

export async function removeSpaceMemberByUid(memberUid) {
  if (state.activeSpaceRole !== 'admin') return;
  const m = (state.spaceMembers || []).find(x => x.userId === memberUid);
  if (!m) return;
  if (m.userId === state.activeSpace?.createdBy) {
    showToast('The Space creator cannot be removed.', 'warning');
    return;
  }
  if (!window.confirm(`Remove ${m.displayName || 'this member'} from the Space?`)) return;
  try {
    await removeSpaceMember(state.activeSpace.id, memberUid);
    showToast(`${m.displayName || 'Member'} removed from the Space.`, 'info');
  } catch (err) {
    console.error('Remove member failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'Your Firestore rules block removing members — run Connection Doctor.'
      : 'Could not remove this member.', 'error');
  }
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

  await loadMyContacts();
}

/**
 * CONTACTS-FIRST People page.
 * Shows ONLY members you added to your contacts — never the full directory.
 * New contacts are added by their exact username in the bar above the grid.
 */
export async function loadMyContacts() {
  const container = document.getElementById('people-directory-grid');
  if (!container) return;
  if (!state.currentUser) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; padding: 48px 0;">
      <h3 class="empty-state-title">Sign in to see your contacts</h3>
      <p class="empty-state-desc">Your contacts are private to your account.</p></div>`;
    return;
  }

  container.innerHTML = `<div style="grid-column: 1 / -1; padding: 48px 0; text-align: center; color: var(--text-muted);">Loading your contacts...</div>`;

  if (typeof state.peopleUnsub === 'function') state.peopleUnsub();
  state.peopleUnsub = subscribeToContacts(state.currentUser.uid, (contacts) => {
    state.contacts = contacts || [];
    renderPeopleGrid(applyPeopleFilter());
  }, (err) => {
    console.error('Contacts listener error:', err);
    container.innerHTML = `<div class="feed-error-card">
      <div class="feed-error-title">Your contacts could not load</div>
      <div class="feed-error-desc">${escapeHtml(err.code || 'error')} — the Connection Doctor can pinpoint the exact rule to fix.</div>
      <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.runFirestoreDoctor()">Run Connection Doctor</button></div>`;
    if (err?.code === 'permission-denied') handlePermissionError('contacts');
  });
}

function applyPeopleFilter() {
  const q = (state.peopleSearchQuery || '').trim().toLowerCase();
  if (!q) return state.contacts || [];
  return (state.contacts || []).filter(c =>
    `${c.displayName || ''} ${c.username || ''}`.toLowerCase().includes(q));
}

/**
 * Search a member by their EXACT username and show a verification card.
 * Only safe public profile fields are shown — no emails, no private data.
 */
export async function addContactByUsername() {
  const input = document.getElementById('add-contact-username');
  const resultBox = document.getElementById('add-contact-result');
  const btn = document.getElementById('add-contact-btn');
  const raw = (input?.value || '').trim();
  state.foundContactCandidate = null;

  if (!raw) { showToast('Enter the username of the member you want to add.', 'info'); return; }
  if (!state.currentUser) { showToast('Sign in first.', 'info'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Searching…'; }
  if (resultBox) { resultBox.style.display = 'block'; resultBox.innerHTML = `<div class="add-contact-searching">Looking up @${escapeHtml(raw.replace(/^@/, ''))}…</div>`; }

  try {
    const peer = await findUserByUsername(raw);
    if (!peer) {
      if (resultBox) resultBox.innerHTML = `<div class="add-contact-miss">No HubbleNest member has the username <b>@${escapeHtml(raw.replace(/^@/, ''))}</b>. Check the spelling — usernames are exact.</div>`;
      return;
    }
    if (peer.uid === state.currentUser.uid) {
      if (resultBox) resultBox.innerHTML = `<div class="add-contact-miss">That's you. You are already your own contact.</div>`;
      return;
    }
    const already = (state.contacts || []).some(c => c.uid === peer.uid);
    state.foundContactCandidate = peer;
    if (resultBox) {
      resultBox.innerHTML = `
        <div class="add-contact-card">
          <img src="${getAvatarUrl(peer.photoURL, peer.displayName)}" alt="" class="add-contact-avatar" />
          <div class="add-contact-info">
            <div class="add-contact-name">${escapeHtml(peer.displayName)}</div>
            <div class="add-contact-handle">@${escapeHtml(peer.username)}</div>
            ${peer.bio ? `<div class="add-contact-bio">${escapeHtml(peer.bio)}</div>` : ''}
          </div>
          ${already
            ? `<span class="add-contact-already">Already in contacts</span>`
            : `<button type="button" class="btn btn-primary btn-sm" id="add-contact-confirm-btn" onclick="window.HubbleNest.addFoundContact()">Add to contacts</button>`}
        </div>`;
    }
  } catch (err) {
    console.error('Username lookup failed:', err);
    if (resultBox) resultBox.innerHTML = `<div class="add-contact-miss">Lookup failed (${escapeHtml(err.code || err.message || 'error')}). Try again.</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Add contact'; }
  }
}

/** Add the verified username match to your contacts (real Firestore write). */
export async function addFoundContact() {
  const peer = state.foundContactCandidate;
  if (!peer) return;
  try {
    await addContact(state.userProfile, peer);
    state.foundContactCandidate = null;
    showToast(`${peer.displayName} is now in your contacts — you can chat instantly.`, 'success', 4500);
    const box = document.getElementById('add-contact-result');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    const input = document.getElementById('add-contact-username');
    if (input) input.value = '';
    // The live listener re-renders the grid; also refresh from cache at once.
    renderPeopleGrid(applyPeopleFilter());
  } catch (err) {
    console.error('Add contact failed:', err);
    showToast(err?.message === 'You are already your own contact.' ? err.message
      : (err?.code === 'permission-denied'
        ? 'Your Firestore rules block contacts — run Connection Doctor.'
        : 'Could not add this contact. Please try again.'), 'error');
    if (err?.code === 'permission-denied') handlePermissionError('contacts add');
  }
}

/** Remove a contact from the People grid. */
export async function removeContactFromList(contactUid) {
  if (!contactUid || !state.currentUser) return;
  const c = (state.contacts || []).find(x => x.uid === contactUid);
  if (!c) return;
  if (!window.confirm(`Remove ${c.displayName || 'this member'} from your contacts? Your private chat history stays, but you will no longer see them here.`)) return;
  try {
    await removeContact(state.currentUser.uid, contactUid);
    showToast('Contact removed.', 'info');
  } catch (err) {
    console.error('Remove contact failed:', err);
    showToast('Could not remove this contact.', 'error');
  }
}

function renderPeopleGrid(contactsList) {
  const container = document.getElementById('people-directory-grid');
  if (!container) return;

  const list = contactsList || [];
  if (list.length === 0) {
    const searching = (state.peopleSearchQuery || '').trim();
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 60px 0;">
        <div class="empty-state-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
        <h3 class="empty-state-title">${searching ? 'No contacts match your search' : 'Your contact list is empty'}</h3>
        <p class="empty-state-desc">${searching
          ? 'No contact matches that name or username.'
          : 'Add people by their exact username in the bar above — then chat with them instantly, no requests needed.'}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(p => {
    return `
      <div class="person-card">
        <div class="person-header" onclick="window.HubbleNest.openUserCardModal('${p.uid}')" title="View profile">
          <div class="person-avatar">
            <img src="${getAvatarUrl(p.photoURL, p.displayName)}" alt="${escapeHtml(p.displayName)}" loading="lazy" decoding="async" />
          </div>
          <div style="flex: 1; min-width: 0;">
            <div class="person-name">${escapeHtml(p.displayName)}</div>
            <div class="person-handle">@${escapeHtml(p.username || '')}</div>
          </div>
        </div>
        ${p.bio ? `<div class="person-bio">${escapeHtml(p.bio)}</div>` : ''}
        <div class="person-footer">
          <span style="font-size: 0.8rem; color: var(--text-muted);">Contact</span>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm btn-primary" onclick="window.HubbleNest.openDirectChatWithPeer('${p.uid}')" title="Open your private chat with ${escapeHtml(p.displayName)}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Chat
            </button>
            <button class="btn btn-sm btn-secondary" onclick="window.HubbleNest.openUserCardModal('${p.uid}')">
              Profile
            </button>
            <button class="btn btn-sm btn-ghost" style="color: var(--text-muted);" onclick="window.HubbleNest.removeContactFromList('${p.uid}')" title="Remove from contacts">✕</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export function handlePeopleSearch(term) {
  state.peopleSearchQuery = term || '';
  renderPeopleGrid(applyPeopleFilter());
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

  // Contact relationship drives the primary actions (contacts chat instantly).
  const contactFlag = !isMe ? await isContact(state.currentUser?.uid, userId) : false;

  if (isMe) {
    statusBadgeHtml = `<div class="user-card-status-badge" style="background: rgba(59, 130, 246, 0.12); color: var(--accent-primary);">This is your profile</div>`;
    actionsHtml = `
      <button class="btn btn-primary" onclick="window.HubbleNest.openProfilePage()">
        Edit My Profile & Settings
      </button>
    `;
  } else if (contactFlag) {
    statusBadgeHtml = `<div class="user-card-status-badge status-badge-connected">✓ In your contacts</div>`;
    actionsHtml = `
      <button class="btn btn-primary" onclick="window.HubbleNest.openDirectChatWithPeer('${userId}')">
        Open Private Chat
      </button>
      <button class="btn btn-secondary" onclick="window.HubbleNest.removeContactFromProfile('${userId}')">
        Remove from contacts
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
      <button class="btn btn-secondary" onclick="window.HubbleNest.addContactFromProfile('${userId}')">
        + Add to contacts
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

export async function addContactFromProfile(targetUserId) {
  try {
    const peer = state.selectedUserCard || await fetchPublicUserCard(targetUserId);
    if (!peer) { showToast('Could not load this member.', 'error'); return; }
    await addContact(state.userProfile, peer);
    showToast(`${peer.displayName} is now in your contacts.`, 'success');
    await openUserCardModal(targetUserId);
  } catch (err) {
    if (err?.message !== 'You are already your own contact.') {
      console.error('Add contact failed:', err);
      showToast(err?.code === 'permission-denied'
        ? 'Your Firestore rules block contacts — run Connection Doctor.'
        : 'Could not add this contact.', 'error');
    }
  }
}

export async function removeContactFromProfile(targetUserId) {
  try {
    await removeContact(state.currentUser.uid, targetUserId);
    showToast('Contact removed.', 'info');
    await openUserCardModal(targetUserId);
  } catch (err) {
    console.error('Remove contact failed:', err);
    showToast('Could not remove this contact.', 'error');
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

/**
 * One-tap "Chat" from the People directory cards.
 *
 * Respects the privacy-first request flow but removes every dead end:
 *  - already connected            → open the chat instantly
 *  - THEY sent you a request      → accept it and open the chat
 *  - YOUR request is pending      → clear explanation, no duplicate send
 *  - they declined within 24 h    → say so, no spam
 *  - no relationship yet          → send the chat request right away
 */
export async function chatWithPerson(targetUserId) {
  if (!state.currentUser) { showToast('Sign in first.', 'info'); return; }
  if (!targetUserId || targetUserId === state.currentUser.uid) {
    showToast('Pick another member to chat with.', 'info');
    return;
  }

  try {
    // CONTACTS CHAT INSTANTLY — no request, no acceptance, no dead ends.
    if (await isContact(state.currentUser.uid, targetUserId)) {
      await openDirectChatWithPeer(targetUserId);
      return;
    }

    const rel = await getChatRelationship(state.currentUser.uid, targetUserId);
    const status = rel?.data?.status;

    if (rel && (status === 'accepted' || rel.direction === 'connected')) {
      await openDirectChatWithPeer(targetUserId);
      return;
    }

    if (rel && status === 'pending') {
      if (rel.direction === 'received') {
        const res = await acceptChatRequest(rel.data.id, state.userProfile);
        if (res && res.conversation) {
          openDirectMessagesView();
          setTimeout(() => selectConversation(res.conversation.id, res.peer.uid), 250);
        }
      } else {
        showToast('Your chat request is still pending — you can chat once they accept.', 'info', 4500);
      }
      return;
    }

    if (rel && status === 'declined') {
      const updatedSeconds = rel.data.updatedAt?.seconds || 0;
      if (Math.floor(Date.now() / 1000) - updatedSeconds < 86400) {
        showToast('This member is not accepting chat requests right now.', 'info');
        return;
      }
    }

    const peerData = state.selectedUserCard || await fetchPublicUserCard(targetUserId);
    if (!peerData) { showToast('Could not load this member.', 'error'); return; }
    const sent = await sendChatRequest(state.userProfile, peerData);
    if (sent) {
      showToast(`Chat request sent — you will chat with ${peerData.displayName || 'them'} once they accept.`, 'success', 4500);
    }
  } catch (err) {
    console.error('Chat request from People card failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'Your Firestore rules block chat requests — run Connection Doctor.'
      : 'Could not start this chat. Please try again.', 'error');
    if (err?.code === 'permission-denied') handlePermissionError('people chat button');
  }
}

/* ==========================================================================
   10b. ARCADE & DIRECT SHARE VIEWS
   ========================================================================== */

export function openArcadeView() {
  state.currentView = 'arcade';
  unsubscribeFromChat();
  stopDirectShare();
  stopCommunityFeed();

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-arcade')?.classList.add('active-view');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('nav-arcade')?.classList.add('active');
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

  startArcade();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function openDirectShareViewWrapper(deepLinkCode = null) {
  state.currentView = 'direct-share';
  unsubscribeFromChat();
  stopArcade();
  stopCommunityFeed();

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-direct-share')?.classList.add('active-view');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('nav-direct-share')?.classList.add('active');
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));

  openDirectShareView(deepLinkCode);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==========================================================================
   11. PRIVATE DIRECT MESSAGING
   ========================================================================== */

export async function openDirectMessagesView() {
  state.currentView = 'direct';
  unsubscribeFromChat();
  stopArcade();
  stopDirectShare();

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-direct-messages')?.classList.add('active-view');

  // Update nav link
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('nav-direct')?.classList.add('active');

  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mob-nav-direct')?.classList.add('active');

  // Render pending requests box
  renderDirectRequests();

  // Subscribe to conversations (guarded: opening the view twice must not
  // stack duplicate realtime listeners — the old bug behind phantom
  // "Conversations listener error" spam in the console).
  if (state.conversationsUnsub) { state.conversationsUnsub(); state.conversationsUnsub = null; }
  state.conversationsUnsub = subscribeToUserConversations(state.currentUser.uid, (convs) => {
    state.conversations = convs;
    renderConversationsList();
    setFeedConnections(computeConnectionSet());
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
  state.directMessages = [];
  directAnimatedIds = null; // new conversation → first batch loads silently
  state.directChatRetried = false;

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

  hideDirectChatError();
  if (emptyPlaceholder) emptyPlaceholder.style.display = 'none';
  if (activeChatBox) activeChatBox.style.display = 'flex';

  renderConversationsList();
  showDirectMessagesSkeleton();

  // Subscribe to messages with local client-side decryption
  subscribeToPrivateMessages(convId, state.userProfile, peerData, (messages) => {
    state.directMessages = messages;
    renderDirectMessages();
  }, (err) => {
    // Real, visible failure state — never a silent dead chat.
    showDirectChatError(err);
  });
}

function showDirectMessagesSkeleton() {
  const container = document.getElementById('direct-messages-feed');
  if (!container) return;
  const widths = ['68%', '44%', '76%', '52%', '38%'];
  container.innerHTML = widths.map((w, i) => `
    <div class="message-row ${i % 2 ? 'msg-own' : ''}">
      <div class="msg-avatar" style="width: 32px; height: 32px;"></div>
      <div class="msg-bubble-box">
        <div class="msg-bubble msg-skeleton-bubble">
          <span class="msg-skeleton-line" style="width: ${w};"></span>
          <span class="msg-skeleton-line msg-skeleton-line-short" style="width: ${Math.round(parseInt(w) * 0.55)}%;"></span>
        </div>
      </div>
    </div>`).join('');
}

function showDirectChatError(err) {
  const card = document.getElementById('direct-chat-error');
  const feed = document.getElementById('direct-messages-feed');
  if (!card) return;
  const denied = err?.code === 'permission-denied' ||
    String(err?.message || '').includes('Missing or insufficient permissions');
  card.innerHTML = `
    <div class="chat-error-card">
      <div class="chat-error-title">${denied ? 'This conversation is blocked by your Firestore rules' : 'This conversation could not load'}</div>
      <div class="chat-error-desc">${denied
        ? 'Your Firebase project\'s published rules are refusing the read. The Connection Doctor checks every rule live and tells you exactly which line to fix — most people are back in under a minute.'
        : 'Check your connection and try again.'}</div>
      <div class="chat-error-actions">
        <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.runFirestoreDoctor()">Run Connection Doctor</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.HubbleNest.retryActiveDirectChat()">Retry</button>
      </div>
    </div>`;
  card.style.display = 'block';
  if (feed) feed.style.display = 'none';
}

function hideDirectChatError() {
  const card = document.getElementById('direct-chat-error');
  const feed = document.getElementById('direct-messages-feed');
  if (card) { card.style.display = 'none'; card.innerHTML = ''; }
  if (feed) feed.style.display = 'block';
}

export function retryActiveDirectChat() {
  if (!state.activeConversation || !state.activeDirectPeer) return;
  hideDirectChatError();
  showDirectMessagesSkeleton();
  subscribeToPrivateMessages(
    state.activeConversation.id,
    state.userProfile,
    state.activeDirectPeer,
    (messages) => {
      state.directMessages = messages;
      renderDirectMessages();
    },
    (err) => showDirectChatError(err)
  );
}

/**
 * Home feed composer: Enter posts, Shift+Enter inserts a newline, and the
 * textarea auto-grows while the member types (up to 280px, then scrolls).
 */
export function handleHomeComposerKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleHomePost();
    const el = document.getElementById('home-composer-input');
    if (el) el.style.height = 'auto';
    return;
  }
  const el = event.target;
  if (el && el.tagName === 'TEXTAREA') {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 280) + 'px';
  }
}

/** Enter sends, Shift+Enter newline, composer auto-grows while typing. */
export function handleDirectComposerKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSendDirectMessage();
    const el = document.getElementById('direct-message-input');
    if (el) el.style.height = 'auto';
    return;
  }
  const el = event.target;
  if (el && el.tagName === 'TEXTAREA') {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 280) + 'px';
  }
}

function renderDirectMessages() {
  const container = document.getElementById('direct-messages-feed');
  if (!container) return;

  // A successful snapshot means the listener is healthy — clear any error card.
  hideDirectChatError();

  if (state.directMessages.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 40px 0;">
        <div class="empty-state-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <h4 class="empty-state-title">This conversation is private</h4>
        <p class="empty-state-desc">Messages sent here are end-to-end encrypted between you and ${escapeHtml(state.activeDirectPeer?.displayName || 'this member')}. Nobody else — not even HubbleNest — can read them.</p>
      </div>
    `;
    return;
  }

  let lastDayKey = '';
  const html = state.directMessages.map(msg => {
    const isOwn = msg.senderId === state.currentUser.uid;
    const decrypted = msg.decrypted || { text: '...' };
    const senderPhoto = isOwn ? state.userProfile.photoURL : state.activeDirectPeer?.photoURL;
    const senderName = isOwn ? state.userProfile.displayName : state.activeDirectPeer?.displayName;

    // Entry animation ONLY for messages that arrived after the first render
    // (sends slide from the right, receives from the left with a soft glow).
    let enterCls = '';
    if (!directAnimatedIds) {
      directAnimatedIds = new Set(state.directMessages.map((m) => m.id));
    } else if (!directAnimatedIds.has(msg.id)) {
      directAnimatedIds.add(msg.id);
      enterCls = isOwn ? 'msg-enter-send' : 'msg-enter-recv';
    }

    // Day divider between messages sent on different calendar days
    const ts = msg.createdAt?.toDate ? msg.createdAt.toDate() : (msg.createdAt?.seconds ? new Date(msg.createdAt.seconds * 1000) : null);
    let dividerHtml = '';
    if (ts) {
      const dayKey = ts.toDateString();
      if (dayKey !== lastDayKey) {
        lastDayKey = dayKey;
        dividerHtml = `<div class="chat-day-divider"><span>${formatDayLabel(ts)}</span></div>`;
      }
    }

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
            <div class="msg-attachment-preview msg-attachment-doc" style="background: var(--bg-surface-elevated); padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <span>${getFileIcon(att.resourceType, att.originalFilename)}</span>
                <a href="${att.url}" data-doc-url="${att.url}" class="msg-doc-link" target="_blank" rel="noopener noreferrer" style="font-weight: 500; font-size: 0.85rem; color: var(--accent-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
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
      ${dividerHtml}
      <div class="message-row ${isOwn ? 'msg-own' : ''} ${enterCls}">
        <div class="msg-avatar" style="width: 32px; height: 32px;">
          <img src="${getAvatarUrl(senderPhoto, senderName)}" class="avatar-img" alt="${escapeHtml(senderName || '')}" loading="lazy" decoding="async" />
        </div>
        <div class="msg-bubble-box">
          <div class="msg-bubble">
            ${replySnippetHtml}
            ${decrypted.text ? `<div class="rt-msg">${renderRichText(decrypted.text)}</div>` : ''}
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
          <div class="msg-meta">
            ${msg.decrypted?.isDecryptionError ? '<span class="msg-meta-warn">Undecryptable on this device</span> · ' : ''}
            ${ts ? `<span class="msg-meta-time" title="${escapeHtml(ts.toLocaleString())}">${escapeHtml(ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span>` : formatTimeAgo(msg.createdAt)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
  enhanceDocumentDelivery(container);
}

function formatDayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
  } else if ((notif?.type === 'feed_like' || notif?.type === 'feed_comment') && notif.postId) {
    loadDashboard();
    setTimeout(() => {
      const card = document.getElementById(`feed-post-${notif.postId}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('feed-post-flash');
        setTimeout(() => card.classList.remove('feed-post-flash'), 2000);
      }
    }, 600);
  } else if (notif?.type === 'game_like' && notif.gameId) {
    openArcadeView();
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
    } else {
      // INSTANT JOIN — the valid Space code IS the invitation. No approval.
      previewBtn.textContent = 'Join Space';
      previewBtn.disabled = false;
      previewBtn.onclick = async () => {
        previewBtn.disabled = true;
        previewBtn.textContent = 'Joining…';
        try {
          await joinSpaceByCode(foundSpace, state.userProfile);
          closeModal('modal-space-preview');
          openSpace(foundSpace.id);
        } catch (err) {
          console.error('Join failed:', err);
          previewBtn.disabled = false;
          previewBtn.textContent = 'Join Space';
          showToast(err?.code === 'permission-denied'
            ? 'Your Firestore rules block joining — run Connection Doctor.'
            : (err.message || 'Could not join this Space.'), 'error');
        }
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
    } else {
      // INSTANT JOIN with a valid code — no approval step.
      btn.textContent = 'Join Space';
      btn.disabled = false;
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'Joining…';
        try {
          await joinSpaceByCode(foundSpace, state.userProfile);
          if (resultBox) resultBox.style.display = 'none';
          openSpace(foundSpace.id);
        } catch (err) {
          console.error('Join failed:', err);
          btn.disabled = false;
          btn.textContent = 'Join Space';
          showToast(err?.code === 'permission-denied'
            ? 'Your Firestore rules block joining — run Connection Doctor.'
            : (err.message || 'Could not join this Space.'), 'error');
        }
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
  // Push notification one-time setup card (status + saved values)
  initPushSettingsUI().catch(() => {});
  // AI Game Builder one-time setup card (Gemini key status)
  initAiSettingsUI().catch(() => {});
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

  // People (Contacts) & Chat Requests
  loadMyContacts,
  handlePeopleSearch,
  handleSendChatRequest,
  handleAcceptRequest,
  handleDeclineRequest,
  cancelSentRequest,
  openDirectChatWithPeer,
  chatWithPerson,
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
  dismissInstallBanner,
  enablePushFromNudge,
  dismissPushNudge,

  loginWithEmail: async () => {
    const emailEl = document.getElementById('login-email');
    const passEl = document.getElementById('login-password');
    const btn = document.getElementById('login-submit-btn');
    const errEl = document.getElementById('login-inline-error');
    const email = emailEl ? emailEl.value : '';
    const password = passEl ? passEl.value : '';

    // Clear any previous inline error before retrying
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Signing in…'; }

    try {
      await loginWithEmail(email, password);
    } catch (err) {
      // auth.js already toasted the reason — ALSO mirror it inline on the
      // card so the failure is visible exactly where the user is typing,
      // instead of surfacing as an uncaught promise rejection in the console.
      if (errEl) {
        errEl.textContent = (err && err.message) ? err.message : 'Could not sign in. Please try again.';
        errEl.style.display = 'block';
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Sign In'; }
    }
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
  logoutUser: async () => {
    // Prune THIS account's push tokens on sign-out so background pushes no
    // longer reach a browser the member has logged out of.
    try {
      const uid = state.currentUser?.uid;
      if (uid) {
        const snap = await getDocs(collection(db, 'users', uid, 'pushTokens'));
        const jobs = [];
        snap.forEach((d) => jobs.push(deleteDoc(d.ref).catch(() => {})));
        await Promise.all(jobs);
      }
    } catch (e) { /* token cleanup is best-effort — never blocks sign-out */ }
    await logoutUser();
  },

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
  handleDirectComposerKey,
  retryActiveDirectChat,
  stageDirectAttachment,
  removeDirectAttachment,
  clearAllDirectAttachments,
  cancelDirectPendingAttachment,
  replyToDirectMessage,
  replyToDirectFile,
  cancelDirectReply,

  // Arcade (user-created HTML/CSS/JS games)
  openArcadeView,
  setArcadeFilter,
  openGameEditor,
  closeGameEditor,
  setCodePane,
  insertStarterGame,
  scheduleGamePreview,
  saveCurrentGame,
  gameDelete,
  openGamePlayer,
  closeGamePlayer,
  gameToggleLike,

  // Direct Share (code / QR file handoff)
  openDirectShareView: openDirectShareViewWrapper,
  setShareMode,
  createDirectShare,
  addFilesToShare,
  copyShareLink,
  closeDirectShare,
  backToSharePicker,
  connectToShare,

  // Firestore Connection Doctor
  runFirestoreDoctor,

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
  removeSpaceMemberByUid,
  toggleSpaceContactsPicker,
  addSpaceMemberFromContacts,

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

  // Home community feed — real feedPosts with ranking
  handleHomePost: () => {
    if (!state.userProfile || !state.currentUser) return;
    handleHomePost();
  },
  handleHomeComposerKey,
  toggleComposerMenu,
  closeComposerMenu,
  composerMenuApply,
  composerMenuPickImage,
  composerMenuPickFile,
  stageHomeAttachment: (file) => stageHomeFile(file, 100),
  removeHomeAttachment,
  clearAllHomeAttachments,
  feedSetMode,
  feedToggleLike,
  feedToggleComments,
  feedSubmitComment,
  feedDeleteComment,
  feedDeletePost,
  toggleRankingInfo,

  // Sidebar "Spaces" shortcut: open the dedicated Your Spaces page
  openSpacesSection: () => openMySpacesPage(),

  // Rail quick actions — REAL targets only (no simulated official space):
  // "Get Help" runs the live Connection Doctor; "View Members" opens contacts.
  openCommunitySpace: async () => {
    runFirestoreDoctor();
  },
  openCommunityMembers: async () => {
    await openPeopleView();
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
  },

  // Contacts (People page & member profiles)
  addContactByUsername,
  addFoundContact,
  removeContactFromList,
  addContactFromProfile,
  removeContactFromProfile,

  // Arcade: multi-file projects + fullscreen player
  toggleGameFullscreen,
  handleGameFilesUpload,
  removeGameFile,
  setGameEntry,
  setGameEntryByIndex,
  removeGameFileByIndex,
  clearGameFiles,
  toggleAiPanel,
  refreshAiPanelStatus,
  generateGameFromPrompt,
  scaffoldProjectWithAi,

  // Push notifications — one-time configuration (survives redeploys)
  savePushConfigFromSettings,
  testPushFromSettings,
  retryPushActivation,
  initAiSettingsUI,
  saveAiConfigFromSettings,

  // Rich-text compose toolbar
  rtWrap
});

/* ==========================================================================
   RICH-TEXT COMPOSE TOOLBAR
   Wraps the textarea selection in lightweight formatting markers that
   format.js renders as REAL bold/italic/underline/headings/lists/code.
   The stored text stays plain and portable; nothing executable is saved.
   ========================================================================== */

const RT_WRAPS = {
  bold: { pre: '**', post: '**', placeholder: 'bold text' },
  italic: { pre: '_', post: '_', placeholder: 'italic text' },
  underline: { pre: '++', post: '++', placeholder: 'underline text' },
  code: { pre: '`', post: '`', placeholder: 'code' },
  h: { pre: '## ', post: '', placeholder: 'Heading' },
  ul: { pre: '- ', post: '', placeholder: 'list item' }
};

export function rtWrap(textareaId, kind) {
  const ta = document.getElementById(textareaId);
  const spec = RT_WRAPS[kind];
  if (!ta || !spec) return;
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e) || spec.placeholder;
  const next = value.slice(0, s) + spec.pre + selected + spec.post + value.slice(e);
  ta.value = next;
  const caret = s + spec.pre.length + selected.length + spec.post.length;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  // Let composers react (previews, autosize, draft autosave).
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ==========================================================================
   PUSH NOTIFICATIONS — ONE-TIME SETUP UI (Profile & Settings page)
   The Web Push certificate key and the background-push service account are
   stored ONCE in Firestore `config/push` — server data that survives every
   zip redeploy, so the owner never edits generated files again.
   ========================================================================== */

export async function initPushSettingsUI() {
  const statusEl = document.getElementById('push-config-status');
  if (!statusEl) return;
  statusEl.innerHTML = `<div class="push-status-loading">Reading your push configuration…</div>`;
  try {
    const st = await getPushConfigStatus();
    const vapidShort = st.publicKey
      ? `${st.publicKey.slice(0, 10)}…${st.publicKey.slice(-6)}`
      : null;
    statusEl.innerHTML = `
      <div class="push-status-row ${st.publicKeyIsEmbedded ? 'push-status-warn' : 'push-status-ok'}">
        <span class="push-status-dot"></span>
        <span><b>Web Push certificate:</b> ${st.publicKeyIsEmbedded
          ? 'using the built-in fallback key (recommended: save YOUR project key below once)'
          : `saved in this project's Firestore (${vapidShort}) — survives redeploys`}</span>
      </div>
      <div class="push-status-row ${st.senderConfigured ? 'push-status-ok' : 'push-status-warn'}">
        <span class="push-status-dot"></span>
        <span><b>Background push delivery:</b> ${st.senderConfigured
          ? 'configured — members can push to each other even when the app is closed'
          : 'not configured — in-app alerts work; background pushes need the service account below'}</span>
      </div>
      <div class="push-status-row push-status-info">
        <span class="push-status-dot"></span>
        <span>Reminder: the Firebase Cloud Messaging API must stay <b>enabled</b> for the hubblenest project (Google Cloud Console → APIs &amp; Services). That project setting also persists — it is never affected by re-uploading the app.</span>
      </div>
      <div class="push-status-row push-status-info" style="justify-content: flex-end; gap: 10px;">
        <button type="button" class="btn btn-secondary" style="padding: 6px 14px; font-size: 0.8rem;" onclick="window.HubbleNest.retryPushActivation()">Retry activation on this device</button>
      </div>`;
    // Pre-fill the VAPID field when a project key is already stored.
    if (!st.publicKeyIsEmbedded && st.publicKey) {
      const input = document.getElementById('push-vapid-input');
      if (input && !input.value) input.value = st.publicKey;
    }
  } catch (err) {
    console.warn('Push status load failed:', err);
    statusEl.innerHTML = `<div class="push-status-row push-status-warn"><span class="push-status-dot"></span><span>Could not read the push configuration (${escapeHtml(err.code || 'error')}).</span></div>`;
  }
}

export async function savePushConfigFromSettings() {
  const vapid = document.getElementById('push-vapid-input')?.value || '';
  const email = document.getElementById('push-client-email-input')?.value || '';
  const key = document.getElementById('push-private-key-input')?.value || '';
  const btn = document.getElementById('push-save-btn');
  const statusEl = document.getElementById('push-config-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await savePushConfig(
      { publicKey: vapid, clientEmail: email, privateKey: key },
      state.userProfile
    );
    showToast('Push configuration saved — this persists for every future deploy.', 'success', 5000);
    const pk = document.getElementById('push-private-key-input');
    if (pk) pk.value = '';
    await initPushSettingsUI();
    // Activate push RIGHT NOW with the fresh configuration — no reload, no
    // waiting for the next boot. Fails soft (a toast) when the project still
    // needs its Cloud Messaging API enabled.
    try {
      const uid = state.currentUser?.uid;
      if (uid) await initWebPushNotifications(uid, { silent: false, force: true });
    } catch (e) { /* surfaced by initWebPushNotifications itself */ }
  } catch (err) {
    console.error('Push config save failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'Only the member who configured push first (or the rules) can update it — run Connection Doctor for details.'
      : (err.message || 'Could not save the push configuration.'), 'error', 6000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save push configuration'; }
  }
}

/**
 * Re-run the push activation flow on demand (Settings → "Retry activation").
 * Deliberately passes force:true — a earlier project-side 401 pauses only the
 * AUTOMATIC background attempts, never an explicit user action.
 */
export async function retryPushActivation() {
  const uid = state.currentUser?.uid;
  if (!uid) { showToast('Sign in first.', 'info'); return false; }
  showToast('Retrying push activation…', 'info', 2500);
  const ok = await initWebPushNotifications(uid, { silent: false, force: true });
  if (ok) {
    showToast('Push notifications are active on this device now.', 'success', 5000);
    initPushSettingsUI();
  } else {
    initPushSettingsUI();
  }
  return ok;
}

/** Send a real test push to THIS device through the configured FCM path. */
export async function testPushFromSettings() {
  const uid = state.currentUser?.uid;
  if (!uid) { showToast('Sign in first.', 'info'); return; }
  showToast('Preparing a test push…', 'info');
  try {
    const granted = await requestPushPermission(uid);
    if (!granted) {
      showToast('Could not mint a registration token — check the status panel above and the browser permission.', 'warning', 6000);
      return;
    }
    const res = await sendPushToUser(uid, {
      title: 'HubbleNest test push',
      body: 'If you can read this while HubbleNest is closed, off-app notifications work.',
      tag: 'push-test'
    });
    if (res.ok) showToast(`Test push delivered to ${res.sent} device(s).`, 'success');
    else if (res.reason === 'not-configured') showToast('Background delivery is not configured yet — save the service account fields above first.', 'warning', 6000);
    else showToast(`Test push failed (${res.reason || res.error || 'unknown'}). In-app notifications still work.`, 'error', 6000);
  } catch (err) {
    console.warn('Test push failed:', err);
    showToast('Test push could not run — see the console for the exact error.', 'warning');
  }
}

/* ==========================================================================
   AI GAME BUILDER CONFIG — one-time Gemini key in Firestore config/ai,
   mirroring the push config pattern (owner claims the doc on first save).
   ========================================================================== */

export async function initAiSettingsUI() {
  const statusEl = document.getElementById('ai-config-status');
  if (!statusEl) return;
  statusEl.innerHTML = `<div class="push-status-loading">Reading your AI configuration…</div>`;
  try {
    const snap = await getDoc(doc(db, 'config', 'ai'));
    if (snap.exists() && snap.data().apiKey) {
      const d = snap.data();
      const model = d.model || 'gemini-2.0-flash';
      statusEl.innerHTML = `
        <div class="push-status-row push-status-ok">
          <span class="push-status-dot"></span>
          <span><b>Gemini connected:</b> model ${escapeHtml(model)} — Arcade prompts write fully custom games. The key survives every redeploy.</span>
        </div>`;
      const keyInput = document.getElementById('ai-key-input');
      const modelInput = document.getElementById('ai-model-input');
      if (modelInput && !modelInput.value) modelInput.value = model;
    } else {
      statusEl.innerHTML = `
        <div class="push-status-row push-status-info">
          <span class="push-status-dot"></span>
          <span><b>No AI key yet</b> — the Arcade uses its built-in game engine (real playable games, zero config). Add a free Gemini key for fully AI-written games.</span>
        </div>`;
    }
  } catch (err) {
    console.warn('AI config status failed:', err);
    statusEl.innerHTML = `<div class="push-status-row push-status-warn"><span class="push-status-dot"></span><span>Could not read the AI configuration (${escapeHtml(err?.code || 'error')}).</span></div>`;
  }
}

export async function saveAiConfigFromSettings() {
  const uid = state.currentUser?.uid;
  if (!uid) { showToast('Sign in first.', 'info'); return; }
  const keyInput = document.getElementById('ai-key-input');
  const modelInput = document.getElementById('ai-model-input');
  const btn = document.getElementById('ai-save-btn');
  const apiKey = (keyInput?.value || '').trim();
  const model = (modelInput?.value || '').trim() || 'gemini-2.0-flash';
  if (!apiKey) {
    showToast('Paste your Gemini API key first (aistudio.google.com → Get API key).', 'warning', 5000);
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await setDoc(doc(db, 'config', 'ai'), {
      apiKey,
      model,
      ownerUid: uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
    showToast('AI configuration saved — the Arcade can now write games with Gemini.', 'success', 5000);
    if (keyInput) keyInput.value = '';
    await initAiSettingsUI();
  } catch (err) {
    console.error('AI config save failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'The AI config is claimed by another member — only its owner can change it.'
      : (err.message || 'Could not save the AI configuration.'), 'error', 6000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save AI configuration'; }
  }
}

// Live references used by the Arcade / Direct Share modules and their
// inline onclick handlers (identity of window.HubbleNest stays stable).
window.HubbleNest._state = state;
const playerGameIdRef = { id: null };
Object.defineProperty(window.HubbleNest, '_playerGameId', {
  get: () => playerGameIdRef.id,
  set: (v) => { playerGameIdRef.id = v; }
});

// Keep the player like-button wired to the currently open game.
const _openGamePlayer = window.HubbleNest.openGamePlayer;
window.HubbleNest.openGamePlayer = function (gameId) {
  window.HubbleNest._playerGameId = gameId;
  return _openGamePlayer(gameId);
};

// Unified icon system: upgrade every [data-hn-icon] placeholder (sidebar,
// mobile nav, buttons) and keep working for content rendered later.
installIconSystem();
document.addEventListener('DOMContentLoaded', () => installIconSystem());

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
