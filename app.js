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

/* --------------------------------------------------------------------------
   INVITE DEEP-LINK CAPTURE (runs the moment the module graph evaluates)
   hash "#join=CODE" / "?join=CODE" / "#share=CODE" / "?share=CODE" are saved
   to sessionStorage IMMEDIATELY so no auth flow (popup, redirect, refresh)
   can ever lose an invitation before the member is signed in.
   -------------------------------------------------------------------------- */
(function captureInviteDeepLinks() {
  try {
    const rawHash = decodeURIComponent(window.location.hash || '');
    const joinHash = rawHash.match(/^#join=([A-Za-z0-9][A-Za-z0-9-]{0,24})/i);
    const joinQuery = new URLSearchParams(window.location.search).get('join');
    const joinCode = (joinHash && joinHash[1]) || (joinQuery && joinQuery.trim());
    if (joinCode) {
      sessionStorage.setItem('pendingJoinCode', joinCode.toUpperCase());
      return;
    }
    const shareHash = rawHash.match(/^#share=([A-Za-z0-9]{6})/i);
    const shareQuery = new URLSearchParams(window.location.search).get('share');
    const shareCode = (shareHash && shareHash[1]) || (shareQuery && shareQuery.trim());
    if (shareCode) {
      sessionStorage.setItem('pendingShareCode', shareCode.toUpperCase());
    }
  } catch (e) { /* malformed URL — the auth-time parser still handles it */ }
})();

// Same-document hash navigation (user edits the URL, clicks an invite link
// or a shared bot link from inside the app): process it without a reload.
window.addEventListener('hashchange', () => {
  try {
    const h = decodeURIComponent(window.location.hash || '');
    if (/^#join=/i.test(h) || /^#share=/i.test(h)) {
      checkUrlJoinParam();
      return;
    }
    if (/^#bot=/i.test(h) || /^#bots\b/i.test(h)) {
      if (state.currentUser) handleBotDeepLink();
    }
  } catch (e) { /* non-fatal */ }
});

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
  updateDoc,
  query,
  where,
  limit,
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
  leaveSpace,
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
  subscribeToUserChatRequests,
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
  getPushActivationError,
  savePushConfig,
  sendPushToUser
} from './notifications.js';

import {
  uploadToCloudinary,
  formatBytes,
  getFileCategory,
  checkDocumentDelivery
} from './cloudinary.js';

// Universal uploads: Cloudinary first, Firestore byte-store fallback when
// Cloudinary blocks delivery of a family (PDF/ZIP account restriction) —
// attachments keep working with no account setting required.
import {
  uploadFileAnywhere,
  downloadStoredFile,
  openStoredFile,
  isStoredAttachment
} from './file-blob.js';

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
  linkify,
  handlePermissionError 
} from './utils.js';

// Community feed (real posts + ranking algorithm), Arcade, Direct Share,
// HubbleNest Bots (AI bot platform) and the Get Help AI assistant
import {
  startCommunityFeed,
  stopCommunityFeed,
  setFeedConnections,
  setFeedAdmin,
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
  feedSharePost,
  toggleRankingInfo
} from './community.js';

import {
  startArcade,
  stopArcade,
  setArcadeFilter,
  setArcadeSearch,
  setArcadeCategory,
  setArcadeSort,
  getGamesCache,
  renderArcadeGrid,
  arcGameCard,
  restartCurrentGame,
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
  scaffoldProjectWithAi,
  handleGameCoverUpload,
  removeGameCover,
  onGameLinkInput,
  clearGameLink,
  openLinkGameExternally
} from './games.js';

// Platform AI health — used by the admin AI configuration panel to show the
// exact live state (last real success/failure) and to run real test requests.
import {
  probeAiConfig,
  invalidateAiRuntimeCache,
  getLastAiFailure,
  getLastAiSuccess,
  isValidAiKey
} from './ai-client.js';

import {
  registerArcade,
  initArcadeShell,
  stopArcadeExtras,
  onArcadeGamesUpdated
} from './arcade.js';

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
  openBotsMarketplace,
  openBotStudio,
  bstGo,
  setStudioMode,
  botsSetTab,
  botsSetCategory,
  botsHandleSearch,
  botsRetry,
  botsUseBot,
  botsCardMenu,
  botsShareBotById,
  toggleBotVisibility,
  deleteBotWithConfirm,
  botStudioMarkDirty,
  botStudioPickLogoTemplate,
  botStudioPickPreviewTemplate,
  botStudioUploadLogo,
  botStudioUploadPreview,
  botStudioRemoveLogo,
  botStudioRemovePreview,
  botStudioAddCustomCap,
  botStudioRemoveCustomCap,
  botStudioSave,
  botStudioCancelEdit,
  botStudioShare,
  botStudioTest,
  botLoadForEdit,
  openBotChat,
  botChatSend,
  botChatKey,
  botChatNew,
  botChatClear,
  botChatRetry,
  botChatUseSuggested,
  openBotProfile,
  botProfileRate,
  botProfileSubmitComment,
  botProfileLikeComment,
  botProfileEditComment,
  botProfileDeleteComment,
  botProfileReportComment,
  handleBotDeepLink,
  stopAllBotsActivity
} from './bots.js';

import {
  openHelpAssistant,
  closeHelpAssistant,
  toggleHelpAssistant
} from './help-ai.js';

// Unified HubbleNest icon system — one local SVG set for the whole UI.
import { installIconSystem } from './icons.js';

// Application State
const state = {
  currentUser: null,
  userProfile: null,
  currentView: 'dashboard', // 'auth' | 'dashboard' | 'space' | 'direct'
  isAdmin: false,
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
  pendingFriendUids: new Set(),
  friendReqUnsub: null,
  adminTargetUser: null,
  adminTargetSpace: null,
  adminSpaceMembers: [],
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
   PLATFORM ADMIN — the HubbleNest creator (danielgiobari644@gmail.com / @gee)
   Matched on the AUTH email (never client-writable) with the username as a
   display fallback. Every moderation surface in the UI keys off this flag,
   and the Firestore rules enforce the same check server-side.
   ========================================================================== */

const ADMIN_EMAIL = 'danielgiobari644@gmail.com';
const ADMIN_USERNAME = 'gee';

function isPlatformAdmin() {
  const p = state.userProfile || {};
  const email = String(p.email || state.currentUser?.email || '').trim().toLowerCase();
  const username = String(p.username || '').trim().toLowerCase();
  return email === ADMIN_EMAIL || username === ADMIN_USERNAME;
}

function profileBanState(profile) {
  if (!profile) return { active: false };
  if (profile.banned === true) {
    return { active: true, mode: 'banned', reason: profile.banReason || '' };
  }
  const until = Number(profile.suspendedUntilMs || 0);
  if (until > Date.now()) {
    return { active: true, mode: 'suspended', until, reason: profile.suspensionReason || '' };
  }
  return { active: false };
}

function showBannedGate(info) {
  const gate = document.getElementById('banned-gate');
  if (!gate) return;
  const title = document.getElementById('banned-gate-title');
  const body = document.getElementById('banned-gate-body');
  if (title) {
    title.textContent = info.mode === 'banned'
      ? 'Account banned'
      : 'Account suspended';
  }
  if (body) {
    const untilText = info.mode === 'suspended' && info.until
      ? ` The suspension lifts on ${new Date(info.until).toLocaleString()}.`
      : '';
    const reasonText = info.reason ? ` Reason: ${info.reason}` : '';
    body.textContent =
      `Your HubbleNest account was ${info.mode} by the platform admin.` +
      reasonText + untilText +
      ' If you believe this is a mistake, contact the HubbleNest creator.';
  }
  gate.style.display = 'flex';
}

export function dismissBannedGate() {
  const gate = document.getElementById('banned-gate');
  if (gate) gate.style.display = 'none';
  logoutUser();
}

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
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js');

      // DEPLOY WATCH: the browser only re-downloads the service worker script
      // on page navigation — a tab or installed PWA that stays open for hours
      // would otherwise NEVER discover a new deploy, which is exactly why
      // members had to refresh manually to see new HubbleNest changes. A
      // periodic check (plus a check whenever the tab becomes visible again
      // or the network returns) finds every new build on its own; the new
      // service worker skipWaiting+claims, and the controllerchange handler
      // below reloads the page once so the new code goes live instantly.
      const checkForDeploy = () => { try { reg.update().catch(() => {}); } catch (e) { /* noop */ } };
      setInterval(checkForDeploy, 20 * 60 * 1000);          // every 20 minutes
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForDeploy();
      });
      window.addEventListener('online', checkForDeploy);
      checkForDeploy();
    } catch (e) { /* registration failed — the app still works from the network */ }
  });

  // DEPLOY AUTO-REFRESH (reworked): when a newly-installed service worker
  // takes over an ALREADY-controlled page (skipWaiting + clients.claim fire
  // controllerchange), reload ONCE per page lifetime so every module,
  // stylesheet and the HTML shell come from the new cache atomically.
  // The previous sessionStorage state machine mis-armed across page loads and
  // swallowed the reload on the second deploy of the same tab session — this
  // in-memory guard can never skip a deploy and can never loop: a reload
  // starts a fresh page whose controller is already the new worker, so no
  // further controllerchange fires until the NEXT deploy.
  let swReloadArmed = !!navigator.serviceWorker.controller; // first-ever claim on a brand-new tab needs no reload
  let swReloadDone = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!swReloadArmed || swReloadDone) return;
    swReloadDone = true;
    window.location.reload();
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

    state.isAdmin = isPlatformAdmin();

    // BAN / SUSPENSION GATE — a moderated account never reaches the app.
    const ban = profileBanState(state.userProfile);
    if (ban.active && !state.isAdmin) {
      stopCommunityFeed();
      stopArcade();
      stopDirectShare();
      showBannedGate(ban);
      return;
    }
    const gateEl = document.getElementById('banned-gate');
    if (gateEl) gateEl.style.display = 'none';

    setupAuthenticatedUI();
    loadDashboard();
    subscribeNotifications();
    checkUrlJoinParam();
    // Bot deep links (#bot=ID / #bots) — only when no invite link claimed the URL.
    if (!sessionStorage.getItem('pendingJoinCode') && !sessionStorage.getItem('pendingShareCode')) {
      handleBotDeepLink();
    }
  } else {
    state.currentUser = null;
    state.userProfile = null;
    // Tear down realtime subscriptions so a future sign-in starts clean.
    stopCommunityFeed();
    stopArcade();
    stopDirectShare();
    stopAllBotsActivity();
    closeHelpAssistant();
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

  // Admin-only surfaces: sidebar Admin console and the push / AI
  // configuration sections. Everyone else — including signed-out visitors —
  // never sees them. (The Connection Doctor was retired in v25.)
  syncAdminOnlyUI();

  // Pending-friend map (sent & received requests) drives the "Pending"
  // chips on the People page and keeps the friend-request gate honest.
  if (state.friendReqUnsub) { state.friendReqUnsub(); state.friendReqUnsub = null; }
  state.friendReqUnsub = subscribeToUserChatRequests(state.currentUser.uid, (reqs) => {
    const pend = new Set();
    (reqs || []).forEach(r => {
      if (r.status !== 'pending') return;
      pend.add(r.direction === 'sent' ? r.receiverId : r.senderId);
    });
    state.pendingFriendUids = pend;
    if (state.currentView === 'people') renderPeopleGrid(applyPeopleFilter());
  });

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

    // The Messages tile in the dashboard Quick Actions rail mirrors the badge
    const railBadge = document.getElementById('rail-messages-badge');
    if (railBadge) {
      railBadge.textContent = requests.length;
      railBadge.style.display = requests.length > 0 ? 'inline-block' : 'none';
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

/**
 * Show or hide every admin-only surface based on the signed-in account.
 * - Sidebar "Admin" console entry
 * - Profile page push + AI configuration sections
 * ("Get Help" is the AI assistant now — visible to every member.)
 */
function syncAdminOnlyUI() {
  const admin = isPlatformAdmin();
  state.isAdmin = admin;

  const adminNav = document.getElementById('nav-admin');
  if (adminNav) adminNav.style.display = admin ? 'flex' : 'none';

  const railHelp = document.getElementById('rail-get-help-quick');
  if (railHelp) railHelp.style.display = 'inline-flex';

  const pushCfg = document.getElementById('admin-push-config');
  if (pushCfg) pushCfg.style.display = admin ? 'block' : 'none';
  const aiCfg = document.getElementById('admin-ai-config');
  if (aiCfg) aiCfg.style.display = admin ? 'block' : 'none';

  // The feed delete-any-post capability follows the same flag.
  setFeedAdmin(admin);
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
  if (!rawCode || !String(rawCode).trim()) {
    showToast('Please enter a 6-character space code.', 'warning');
    return;
  }
  // Accept "HN-7K4P92", "7K4P92" and "hn-7k4p92" alike — codes are uppercase
  // everywhere and the HN- prefix is added only when it is missing.
  const clean = String(rawCode).trim().toUpperCase();
  const target = clean.startsWith('HN-') ? clean : `HN-${clean}`;

  if (state.currentUser) {
    handleCodeSearch(target);
  } else {
    sessionStorage.setItem('pendingJoinCode', target);
    showToast(`Code ${target} saved! Sign in or create an account to enter this Space.`, 'info', 5000);
    showAuthView('entry');
  }
}

async function checkUrlJoinParam() {
  const pendingCode = sessionStorage.getItem('pendingJoinCode');
  if (pendingCode) {
    sessionStorage.removeItem('pendingJoinCode');
    // Also strip the invite hash/query so a refresh doesn't re-trigger it.
    try {
      const cleanedHash = window.location.hash.replace(/^#join=[^&]*/i, '');
      const cleanedSearch = window.location.search.replace(/[?&]join=[^&]+/, '').replace(/^\?(?=$)/, '');
      history.replaceState(null, '', window.location.pathname + cleanedSearch + cleanedHash);
    } catch (e) { /* non-fatal */ }
    handleCodeSearch(pendingCode);
    return;
  }

  // Universal invite formats that work on ANY static host (including
  // GitHub Pages project subpaths): #join=CODE or ?join=CODE.
  // The regex MUST accept the hyphen in "HN-7K4P92" — the old [A-Za-z0-9]+
  // class stopped at the "-", captured just "HN" and turned every deep link
  // into a lookup for the nonexistent Space "HN-HN".
  let deepLinkCode = null;
  try {
    const rawHash = decodeURIComponent(window.location.hash || '');
    const hashMatch = rawHash.match(/^#join=([A-Za-z0-9][A-Za-z0-9-]{0,24})/i);
    if (hashMatch) deepLinkCode = hashMatch[1];
  } catch (e) { /* malformed escape — fall through to the query param */ }
  if (!deepLinkCode) {
    const queryJoin = new URLSearchParams(window.location.search).get('join');
    if (queryJoin && queryJoin.trim()) deepLinkCode = queryJoin.trim();
  }
  if (deepLinkCode) {
    deepLinkCode = deepLinkCode.toUpperCase();
    // Clean the URL so refreshing doesn't re-trigger the join flow
    try {
      const cleanedSearch = window.location.search.replace(/[?&]join=[^&]+/, '').replace(/^\?(?=$)/, '');
      history.replaceState(null, '', window.location.pathname + cleanedSearch);
    } catch (e) { /* non-fatal */ }
    processLandingCode(deepLinkCode);
    return;
  }

  // Direct Share deep links: ?share=CODE or #share=CODE (encoded in the QR)
  let shareCode = null;
  try {
    const rawHash = decodeURIComponent(window.location.hash || '');
    const shareHash = rawHash.match(/^#share=([A-Za-z0-9]{6})/i);
    if (shareHash) shareCode = shareHash[1];
  } catch (e) { /* malformed escape — fall through to the query param */ }
  if (!shareCode) {
    const shareQuery = new URLSearchParams(window.location.search).get('share');
    if (shareQuery && shareQuery.trim()) shareCode = shareQuery.trim();
  }
  shareCode = (shareCode || '').toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(shareCode)) {
    try {
      const cleanedSearch = window.location.search.replace(/[?&]share=[^&]+/, '').replace(/^\?(?=$)/, '');
      history.replaceState(null, '', window.location.pathname + cleanedSearch);
    } catch (e) { /* non-fatal */ }
    if (state.currentUser) {
      openDirectShareViewWrapper(shareCode);
    } else {
      sessionStorage.setItem('pendingShareCode', shareCode);
    }
    return;
  }

  // Path-style invites (/join/CODE) — tolerant of GitHub Pages project
  // subpaths ("/HubbleNest/join/HN-7K4P92") and trailing slashes.
  const joinMatch = window.location.pathname.match(/\/join\/([A-Za-z0-9][A-Za-z0-9-]{0,24})\/?$/i);
  if (joinMatch) {
    handleCodeSearch(joinMatch[1]);
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
    const firstName = escapeHtml((state.userProfile.displayName || 'Member').split(' ')[0]);
    greetingEl.innerHTML = `Welcome back, <span class="welcome-name">${firstName}</span> 👋`;
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
  // Featured space = the Space the platform admin featured (spaces.featured).
  // Falls back to the member's most recent Space when nothing is featured.
  (async () => {
    let featured = null;
    try {
      const snap = await getDocs(query(
        collection(db, 'spaces'),
        where('featured', '==', true),
        limit(1)
      ));
      if (!snap.empty) featured = { id: snap.docs[0].id, ...snap.docs[0].data() };
    } catch (e) { /* fallback below */ }
    if (!featured) featured = state.userSpaces[0] || null;

    const featName = document.getElementById('rail-featured-name');
    const featDesc = document.getElementById('rail-featured-desc');
    const featBtn = document.getElementById('rail-featured-btn');
    if (featured) {
      if (featName) featName.textContent = featured.name || 'HubbleSpace Community';
      if (featDesc) featDesc.textContent = featured.description || 'For Everyone Who Needs Help Around The App';
      if (featBtn) featBtn.onclick = () => openSpace(featured.id);
    }
  })();

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
  setFeedAdmin(isPlatformAdmin());
  startCommunityFeed(state.userProfile, state.currentUser?.uid, computeConnectionSet());
}

/**
 * Render Recent Activity rail from REAL notifications.
 * Each row: colored type tile · text + time · thumbnail (the sender's real
 * avatar when one exists, otherwise a gradient tile with the type glyph).
 */
function renderRailActivity() {
  const list = document.getElementById('rail-activity-list');
  if (!list) return;

  if (!state.notifications || state.notifications.length === 0) {
    list.innerHTML = `<div class="rail-activity-empty">No recent activity yet.</div>`;
    return;
  }

  const toneByType = (type) => {
    if (type === 'game_score' || type === 'game_challenge' || (type || '').startsWith('game')) return 'act-purple';
    if (type === 'chat_request' || type === 'private_message' || type === 'space_join') return 'act-green';
    if (type === 'feed_comment' || type === 'feed_like' || type === 'share') return 'act-blue';
    return 'act-purple';
  };

  const glyphByType = (type) => {
    if ((type || '').startsWith('game')) {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6.5" width="19" height="11" rx="4.5"/><path d="M6.5 12h4"/><path d="M8.5 10v4"/><circle cx="15.6" cy="13.4" r=".6"/><circle cx="17.9" cy="10.9" r=".6"/></svg>`;
    }
    if (type === 'chat_request' || type === 'private_message' || type === 'space_join') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    }
    if (type === 'feed_like') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
    }
    if (type === 'feed_comment') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    }
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 3-9.5 18-2.6-7.9L1 10.5Z"/><path d="M21 3 8.9 13.1"/></svg>`;
  };

  list.innerHTML = state.notifications.slice(0, 6).map(n => {
    const tone = toneByType(n.type);
    const glyph = glyphByType(n.type);
    const senderAvatar = n.senderPhoto || n.photoURL || '';
    const thumb = senderAvatar
      ? `<img class="rail-activity-thumb" src="${escapeHtml(senderAvatar)}" alt="" loading="lazy" decoding="async" />`
      : `<span class="rail-activity-thumb rail-activity-thumb-tile ${tone}" aria-hidden="true">${glyph}</span>`;
    return `
      <div class="rail-activity-item" onclick="window.HubbleNest.handleNotificationClick('${n.id}', '${n.spaceId || ''}')">
        <span class="rail-activity-icon ${tone}">${glyph}</span>
        <span class="rail-activity-text">
          <b>${escapeHtml(n.title || 'Notification')}</b> ${escapeHtml(n.body || '')}
          <span class="rail-activity-time">${formatTimeAgo(n.createdAt)}</span>
        </span>
        ${thumb}
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
    const spaceStatus = spaceModerationState(sp);

    return `<div class="space-card" data-space-id="${sp.id}" onclick="window.HubbleNest.openSpace('${sp.id}')">
        <div class="space-card-cover">
          ${coverUrl ? `<img src="${coverUrl}" class="space-card-cover-img" alt="${escapeHtml(sp.name)}" loading="lazy" decoding="async"/>` : `
            <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #1e293b, #0f172a); color: #3b82f6; font-size: 2rem; font-weight: 800;">
              ${escapeHtml(sp.name.slice(0, 2).toUpperCase())}
            </div>
          `}
          ${sp.featured ? `<span class="featured-pill">★ Featured</span>` : ''}
        </div>
        <div class="space-card-body">
          <div class="space-card-meta">
            <span>${escapeHtml(sp.category || 'Space')}</span>
            <span>·</span>
            <span>${sp.memberCount || 1} members</span>
            ${isAdmin ? `<span>·</span><span class="admin-pill">Admin</span>` : ''}
            ${spaceStatus ? `<span>·</span><span class="moderation-pill">${escapeHtml(spaceStatus)}</span>` : ''}
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

/**
 * Human label for a Space's moderation state ('' when clean).
 */
function spaceModerationState(sp) {
  if (!sp) return '';
  if (sp.status === 'banned') return 'Banned';
  const until = Number(sp.suspendedUntilMs || 0);
  if (until > Date.now()) return 'Suspended';
  return '';
}

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

  // Space-level moderation: banned / suspended Spaces are closed to members
  // (the platform admin can still enter them to manage content).
  const modState = spaceModerationState(state.activeSpace);
  if (modState && !state.isAdmin) {
    showToast(`This Space is currently ${modState.toLowerCase()} by the HubbleNest admin.`, 'warning', 6000);
    loadDashboard();
    return;
  }

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
    const isAdmin = state.activeSpaceRole === 'admin' || state.isAdmin;
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
    adminBtn.style.display = (state.activeSpaceRole === 'admin' || state.isAdmin) ? 'inline-flex' : 'none';
  }

  // Leave button — every member can leave; hidden for non-members.
  const leaveBtn = document.getElementById('space-leave-btn');
  if (leaveBtn) {
    leaveBtn.style.display = state.activeSpaceRole === 'none' ? 'none' : 'inline-flex';
  }

  // Moderation banner when the admin banned / suspended this Space.
  const modBanner = document.getElementById('space-moderation-banner');
  if (modBanner) {
    const modState = spaceModerationState(sp);
    if (modState) {
      modBanner.textContent = `⚠ This Space is ${modState.toLowerCase()} by the HubbleNest admin — members cannot interact with it until it is restored.`;
      modBanner.style.display = 'block';
    } else {
      modBanner.style.display = 'none';
    }
  }

  const settingsTabNav = document.getElementById('space-tab-nav-settings');
  if (settingsTabNav) {
    settingsTabNav.style.display = (state.activeSpaceRole === 'admin' || state.isAdmin) ? 'inline-block' : 'none';
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

/** Composer quick action: attach a video to the home post (real upload path). */
export function composerPickVideo() {
  document.getElementById('home-video-input')?.click();
}

/**
 * Composer quick action: append a share link to the post text.
 * Asks for the URL, validates it, and inserts it at the cursor — the same
 * text the Post button publishes; nothing simulated.
 */
export function composerInsertLink(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const raw = window.prompt('Paste the link to share (https://…)', 'https://');
  if (raw === null) return; // cancelled
  let url = raw.trim();
  if (!url) { showToast('No link entered.', 'warning'); return; }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { new URL(url); } catch (e) {
    showToast('That does not look like a valid link.', 'warning');
    return;
  }
  const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
  const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const needsSpaceBefore = before && !/\s$/.test(before) ? ' ' : '';
  el.value = `${before}${needsSpaceBefore}${url} ${after.replace(/^\s+/, '')}`;
  el.focus({ preventScroll: true });
  const caret = (before + needsSpaceBefore + url + ' ').length;
  try { el.setSelectionRange(caret, caret); } catch (e) { /* textarea in some state */ }
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
 * Render an attachment that lives in the app's own secure Firestore store
 * (used when Cloudinary blocks a file family). Open + Download both pull the
 * REAL bytes back out of Firestore — nothing simulated.
 */
function storedFileCardHtml(att, replyOnclick = null) {
  const name = escapeHtml(att.originalFilename || 'File');
  const size = att.size ? ` · ${formatBytes(att.size)}` : '';
  return `
    <div class="msg-attachment-preview msg-attachment-doc stored-file-card" style="background: var(--bg-surface-elevated); padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
        <span>${getFileIcon(att.resourceType, att.originalFilename)}</span>
        <span style="font-weight: 500; font-size: 0.85rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</span>
        <span style="font-size: 0.7rem; color: var(--text-muted); white-space: nowrap;">${size} · secured on HubbleNest</span>
      </div>
      <div style="display: inline-flex; gap: 6px; align-items: center;">
        <button type="button" class="btn-ghost" style="padding: 2px 8px; font-size: 0.75rem; color: var(--accent-primary);" onclick="window.HubbleNest.openStoredFile('${escapeHtml(att.blobId)}', '${name}')">Open ↗</button>
        <button type="button" class="btn-ghost" style="padding: 2px 8px; font-size: 0.75rem; color: var(--accent-primary);" onclick="window.HubbleNest.downloadStoredFile('${escapeHtml(att.blobId)}', '${name}')">Download</button>
        ${replyOnclick || ''}
      </div>
    </div>
  `;
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
          if (isStoredAttachment(att)) {
            return storedFileCardHtml(att, `
              <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary);" onclick="window.HubbleNest.replyToFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Document')}', '', '${att.resourceType || 'document'}', '${escapeHtml(att.blobId)}')">
                ↩ Reply
              </button>
            `);
          }
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
                      ${msg.replyTo.fileBlobId
                        ? `<a href="javascript:void(0)" class="reply-file-link" onclick="event.stopPropagation(); window.HubbleNest.openStoredFile('${escapeHtml(msg.replyTo.fileBlobId)}', '${escapeHtml(msg.replyTo.fileName || msg.replyTo.text)}')">${escapeHtml(msg.replyTo.fileName || msg.replyTo.text)} ↗</a>`
                        : `<a href="${msg.replyTo.fileUrl || '#'}" target="_blank" rel="noopener noreferrer" class="reply-file-link" onclick="event.stopPropagation();">${escapeHtml(msg.replyTo.fileName || msg.replyTo.text)} ↗</a>`}
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

export function replyToFile(fileId, fileName, fileUrl, fileType = 'document', fileBlobId = null) {
  state.replyingTo = {
    id: fileId,
    senderName: 'File',
    text: fileName,
    fileName: fileName,
    fileUrl: fileUrl,
    fileBlobId: fileBlobId || null,
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
        const result = await uploadFileAnywhere(file, () => {}, state.activeSpace?.settings?.maxFileSizeMB || 100);
        attachments.push({
          url: result.url || '',
          blobId: result.blobId || null,
          fallbackStored: !!result.fallbackStored,
          mime: file.type || 'application/octet-stream',
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
            cloudinaryUrl: result.url || '',
            blobId: result.blobId || null,
            publicId: result.publicId || null,
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
          ${f.blobId
            ? `<button type="button" class="btn btn-sm btn-secondary" onclick="window.HubbleNest.openStoredFile('${escapeHtml(f.blobId)}', '${escapeHtml(f.name)}')">Open</button>
               <button type="button" class="btn-file-reply" onclick="window.HubbleNest.replyToFile('${f.id}', '${escapeHtml(f.name)}', '', '${f.category || 'document'}', '${escapeHtml(f.blobId)}')">↩ Reply in Chat</button>`
            : `<a href="${f.cloudinaryUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary">Open</a>
               <button type="button" class="btn-file-reply" onclick="window.HubbleNest.replyToFile('${f.id}', '${escapeHtml(f.name)}', '${escapeHtml(f.cloudinaryUrl)}', '${f.category || 'document'}')">↩ Reply in Chat</button>`}
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

  // Space admins AND the platform admin manage members here.
  const canManageHere = state.activeSpaceRole === 'admin' || state.isAdmin;
  const adminPanel = canManageHere ? `
    <div class="space-contacts-admin">
      <div class="space-contacts-admin-head">
        <div>
          <b>Member management</b>
          <div class="space-contacts-admin-sub">Add members by their EXACT username (or from your contacts), remove existing members. Anyone with the Space code also joins instantly.</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.toggleSpaceContactsPicker()">+ Add contacts</button>
      </div>
      <div class="space-add-by-username">
        <input type="text" id="space-add-username-input" class="form-input" placeholder="Exact username, e.g. gee" autocomplete="off" spellcheck="false" />
        <button type="button" class="btn btn-primary btn-sm" id="space-add-username-btn" onclick="window.HubbleNest.addSpaceMemberByUsername()">Add member</button>
      </div>
      <div id="space-add-username-result"></div>
      <div id="space-contacts-picker" style="display: none;"></div>
    </div>` : '';

  container.innerHTML = adminPanel + state.spaceMembers.map(m => {
    const isMe = m.userId === state.currentUser.uid;
    const isAdmin = m.role === 'admin';
    const canManage = canManageHere && !isMe;

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
  if (state.activeSpaceRole !== 'admin' && !state.isAdmin) return;
  const contact = (state.contacts || []).find(c => c.uid === memberUid);
  if (!contact) return;
  try {
    const res = await addMemberToSpace(state.activeSpace.id, {
      uid: contact.uid,
      displayName: contact.displayName,
      username: contact.username,
      photoURL: contact.photoURL
    }, 'member');
    if (!res.already) await notifySpaceMemberAdded(state.activeSpace, contact);
    showToast(res.already
      ? `${contact.displayName} is already a member.`
      : `${contact.displayName} added to the Space.`, res.already ? 'info' : 'success');
    renderSpaceContactsPicker();
  } catch (err) {
    console.error('Add member failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'Adding members was blocked — check the sign-in state and try again, or ask the Get Help assistant.'
      : 'Could not add this member.', 'error');
  }
}

/**
 * Real off-app + in-app notice for a member added to a Space by an admin.
 * The notification carries the adder's identity; the RECIPIENT decides how
 * prominent the "not in your contacts" warning and the leave opt-out are —
 * contacts are owner-private, so the adder cannot (and must not) read them.
 * Fire-and-forget: a notification failure never undoes the membership.
 */
async function notifySpaceMemberAdded(space, memberProfile) {
  try {
    const adder = state.currentUser;
    if (!space?.id || !memberProfile?.uid || !adder || memberProfile.uid === adder.uid) return;
    const body = `${adder.displayName || adder.username || 'A space admin'} added you to "${space.name || 'a Space'}".`;
    await setDoc(doc(collection(db, 'notifications')), {
      userId: memberProfile.uid,
      type: 'space_added',
      title: 'Added to a Space',
      body,
      spaceId: space.id,
      spaceName: space.name || '',
      adderUid: adder.uid,
      adderName: adder.displayName || '',
      adderUsername: adder.username || '',
      isRead: false,
      createdAt: serverTimestamp()
    });
    sendPushToUser(memberProfile.uid, {
      title: 'Added to a Space',
      body,
      tag: 'space_added'
    }).catch(() => {});
  } catch (e) {
    console.warn('[HubbleNest] space-add notification skipped:', e?.code || e);
  }
}

/**
 * SPACE ADMIN — add a member by their EXACT username.
 * Real username lookup (findUserByUsername), real membership write
 * (addMemberToSpace), real notification + off-app push to the added member.
 */
export async function addSpaceMemberByUsername() {
  if (state.activeSpaceRole !== 'admin' && !state.isAdmin) return;
  const input = document.getElementById('space-add-username-input');
  const btn = document.getElementById('space-add-username-btn');
  const result = document.getElementById('space-add-username-result');
  const raw = (input?.value || '').trim().replace(/^@/, '');
  if (!raw) { showToast('Type the member\'s exact username first.', 'info'); return; }
  if (!state.activeSpace) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  const showResult = (html) => { if (result) { result.style.display = 'block'; result.innerHTML = html; } };
  try {
    const peer = await findUserByUsername(raw);
    if (!peer) {
      showResult(`<div class="space-add-miss">No HubbleNest member has the username <b>@${escapeHtml(raw)}</b>. Usernames are exact — check the spelling.</div>`);
      return;
    }
    if (peer.uid === state.currentUser.uid) {
      showResult(`<div class="space-add-miss">That is you — you are already a member of this Space.</div>`);
      return;
    }
    const res = await addMemberToSpace(state.activeSpace.id, {
      uid: peer.uid,
      displayName: peer.displayName,
      username: peer.username,
      photoURL: peer.photoURL
    }, 'member');
    if (!res.already) await notifySpaceMemberAdded(state.activeSpace, peer);
    showResult(`<div class="space-add-hit"><b>@${escapeHtml(peer.username)}</b> (${escapeHtml(peer.displayName || 'Member')}) ${res.already ? 'is already a member of this Space.' : 'is now a member — they have been notified.'}</div>`);
    if (input) input.value = '';
    renderMembersList();
  } catch (err) {
    console.error('Add member by username failed:', err);
    showResult(`<div class="space-add-miss">Could not add this member${err?.code === 'permission-denied' ? ' — the write was blocked, check your sign-in state and admin role' : ''}. Please try again.</div>`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Add member'; }
  }
}

export async function removeSpaceMemberByUid(memberUid) {
  if (state.activeSpaceRole !== 'admin' && !state.isAdmin) return;
  const m = (state.spaceMembers || []).find(x => x.userId === memberUid);
  if (!m) return;
  if (m.userId === state.activeSpace?.createdBy && !state.isAdmin) {
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
      ? 'Removing members was blocked — you may no longer be an admin of this Space.'
      : 'Could not remove this member.', 'error');
  }
}

/**
 * LEAVE the currently open Space — real self-removal, available to every
 * member (the Space creator gets an extra warning because leaving surrenders
 * their admin powers over it).
 */
export async function leaveActiveSpace() {
  const sp = state.activeSpace;
  if (!sp || !state.currentUser) return;
  const isCreator = sp.createdBy === state.currentUser.uid;
  const warn = isCreator
    ? `You created "${sp.name || 'this Space'}". Leaving means giving up admin control of it. Leave anyway?`
    : `Leave "${sp.name || 'this Space'}"? You will need a new invite or Space code to rejoin.`;
  if (!window.confirm(warn)) return;
  try {
    const removed = await leaveSpace(sp.id, state.currentUser.uid);
    if (removed) {
      showToast(`You left ${sp.name || 'the Space'}.`, 'info');
      state.activeSpace = null;
      state.activeSpaceRole = 'none';
      await loadDashboard();
    } else {
      showToast('You are not a member of this Space.', 'info');
      loadDashboard();
    }
  } catch (err) {
    console.error('Leave space failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'Leaving was blocked — check your connection, sign in again and retry.'
      : 'Could not leave this Space. Please try again.', 'error');
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
      <div class="feed-error-desc">${escapeHtml(err.code || 'error')} — check your connection and sign-in state, then retry. The Get Help assistant can walk you through it.</div>
      <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.openHelpAssistant()">Get Help</button></div>`;
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
 * FRIEND REQUEST FORM (People page bar — username box + personalized note).
 * Looks the member up by their EXACT username and sends a real friend
 * request. Chat stays locked until the recipient accepts — even when the
 * username is known exactly.
 */
export async function sendFriendRequestByUsername() {
  const input = document.getElementById('add-contact-username');
  const msgInput = document.getElementById('friend-request-message');
  const resultBox = document.getElementById('add-contact-result');
  const btn = document.getElementById('add-contact-btn');
  const raw = (input?.value || '').trim();
  const message = (msgInput?.value || '').trim().slice(0, 120);
  state.foundContactCandidate = null;

  if (!raw) { showToast('Enter the username of the member you want to add.', 'info'); return; }
  if (!state.currentUser) { showToast('Sign in first.', 'info'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (resultBox) { resultBox.style.display = 'block'; resultBox.innerHTML = `<div class="add-contact-searching">Looking up @${escapeHtml(raw.replace(/^@/, ''))}…</div>`; }

  try {
    const peer = await findUserByUsername(raw);
    if (!peer) {
      if (resultBox) resultBox.innerHTML = `<div class="add-contact-miss">No HubbleNest member has the username <b>@${escapeHtml(raw.replace(/^@/, ''))}</b>. Check the spelling — usernames are exact.</div>`;
      return;
    }
    if (peer.uid === state.currentUser.uid) {
      if (resultBox) resultBox.innerHTML = `<div class="add-contact-miss">That's you. You are already your own friend.</div>`;
      return;
    }

    const rel = await getChatRelationship(state.currentUser.uid, peer.uid);
    const status = rel?.data?.status;

    if (rel && (status === 'accepted' || rel.direction === 'connected')) {
      if (resultBox) resultBox.innerHTML = `
        <div class="add-contact-card add-contact-connected">
          <img src="${getAvatarUrl(peer.photoURL, peer.displayName)}" alt="" class="add-contact-avatar" />
          <div class="add-contact-info">
            <div class="add-contact-name">${escapeHtml(peer.displayName)}</div>
            <div class="add-contact-handle">@${escapeHtml(peer.username)}</div>
          </div>
          <span class="add-contact-already">✓ Already friends — chat is open</span>
        </div>`;
      return;
    }

    if (rel && status === 'pending') {
      if (rel.direction === 'received') {
        if (resultBox) resultBox.innerHTML = `<div class="add-contact-miss">@${escapeHtml(peer.username)} already sent <b>you</b> a friend request — accept it from the Messages page.</div>`;
      } else {
        if (resultBox) resultBox.innerHTML = `<div class="add-contact-miss">Your friend request to @${escapeHtml(peer.username)} is already pending — chat unlocks once they accept.</div>`;
      }
      return;
    }

    if (rel && status === 'declined') {
      const updatedSeconds = rel.data.updatedAt?.seconds || 0;
      if (Math.floor(Date.now() / 1000) - updatedSeconds < 86400) {
        if (resultBox) resultBox.innerHTML = `<div class="add-contact-miss">@${escapeHtml(peer.username)} is not accepting friend requests right now.</div>`;
        return;
      }
    }

    // Keep the sender's People page aware of this pending relationship.
    await addContact(state.userProfile, peer).catch(() => {});

    const sent = await sendChatRequest(state.userProfile, peer, message);
    if (sent && resultBox) {
      resultBox.innerHTML = `
        <div class="add-contact-card add-contact-sent">
          <img src="${getAvatarUrl(peer.photoURL, peer.displayName)}" alt="" class="add-contact-avatar" />
          <div class="add-contact-info">
            <div class="add-contact-name">${escapeHtml(peer.displayName)} <span class="add-contact-sent-check">✓ request sent</span></div>
            <div class="add-contact-handle">@${escapeHtml(peer.username)}</div>
            ${message ? `<div class="add-contact-bio">Your note: “${escapeHtml(message)}”</div>` : ''}
          </div>
        </div>`;
      if (input) input.value = '';
      if (msgInput) { msgInput.value = ''; handleFriendRequestMessageInput(); }
      renderPeopleGrid(applyPeopleFilter());
    }
  } catch (err) {
    console.error('Friend request failed:', err);
    if (resultBox) resultBox.innerHTML = `<div class="add-contact-miss">Could not send the request (${escapeHtml(err?.code || err?.message || 'error')}). Try again.</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Friend Request'; }
  }
}

/** Live 120-character counter under the "Personalize your request" box. */
export function handleFriendRequestMessageInput() {
  const ta = document.getElementById('friend-request-message');
  const counter = document.getElementById('fr-char-count');
  if (ta && counter) counter.textContent = String(120 - (ta.value || '').length);
}

/** Legacy alias — the People bar now sends friend requests. */
export async function addContactByUsername() {
  return sendFriendRequestByUsername();
}

/** Legacy confirm-card entry point — now also routes through the request flow. */
export async function addFoundContact() {
  return sendFriendRequestByUsername();
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
        <h3 class="empty-state-title">${searching ? 'No contacts match your search' : 'No friends yet'}</h3>
        <p class="empty-state-desc">${searching
          ? 'No contact matches that name or username.'
          : 'Send a friend request by exact username in the bar above — chat unlocks once they accept.'}</p>
      </div>
    `;
    return;
  }

  const pendingSet = state.pendingFriendUids instanceof Set ? state.pendingFriendUids : new Set();

  container.innerHTML = list.map(p => {
    const isPending = pendingSet.has(p.uid);
    return `
      <div class="person-card">
        <div class="person-header" onclick="window.HubbleNest.openUserCardModal('${p.uid}')" title="View profile">
          <div class="person-avatar">
            <img src="${getAvatarUrl(p.photoURL, p.displayName)}" alt="${escapeHtml(p.displayName)}" loading="lazy" decoding="async" />
          </div>
          <div style="flex: 1; min-width: 0;">
            <div class="person-name">${escapeHtml(p.displayName)}${isPending ? '<span class="pending-chip">⏳ Pending</span>' : ''}</div>
            <div class="person-handle">@${escapeHtml(p.username || '')}</div>
          </div>
        </div>
        ${p.bio ? `<div class="person-bio">${escapeHtml(p.bio)}</div>` : ''}
        <div class="person-footer">
          <span style="font-size: 0.8rem; color: var(--text-muted);">${isPending ? 'Waiting for acceptance' : 'Friend'}</span>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm btn-primary" onclick="window.HubbleNest.chatWithPerson('${p.uid}')" title="${isPending ? 'Chat unlocks once your request is accepted' : `Open your private chat with ${escapeHtml(p.displayName)}`}" ${isPending ? 'style="opacity: 0.75;"' : ''}>
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

  let statusBadgeHtml = '';
  let actionsHtml = '';

  // Relationship status FIRST — the friend-request gate outranks contacts.
  let rel = null;
  if (!isMe) {
    rel = await getChatRelationship(state.currentUser?.uid, userId);
  }
  const relConnected = rel && (rel.data?.status === 'accepted' || rel.direction === 'connected');

  // Contact relationship (legacy pairs may predate the friend-request gate).
  const contactFlag = !isMe ? await isContact(state.currentUser?.uid, userId) : false;

  if (isMe) {
    statusBadgeHtml = `<div class="user-card-status-badge" style="background: rgba(59, 130, 246, 0.12); color: var(--accent-primary);">This is your profile</div>`;
    actionsHtml = `
      <button class="btn btn-primary" onclick="window.HubbleNest.openProfilePage()">
        Edit My Profile & Settings
      </button>
    `;
  } else if (relConnected) {
    statusBadgeHtml = `<div class="user-card-status-badge status-badge-connected">✓ Connected — chat unlocked</div>`;
    actionsHtml = `
      <button class="btn btn-primary" onclick="window.HubbleNest.openDirectChatWithPeer('${userId}')">
        Open Private Chat
      </button>
      ${contactFlag ? `<button class="btn btn-secondary" onclick="window.HubbleNest.removeContactFromProfile('${userId}')">
        Remove from contacts
      </button>` : ''}
    `;
  } else if (rel && rel.data?.status === 'pending' && rel.direction === 'sent') {
    statusBadgeHtml = `<div class="user-card-status-badge status-badge-pending">⏳ Friend Request Pending</div>`;
    actionsHtml = `
      <button class="btn btn-secondary" disabled style="opacity: 0.8; cursor: default;">
        Request Pending
      </button>
      <button class="btn btn-ghost" style="color: var(--text-muted);" onclick="window.HubbleNest.cancelSentRequest('${rel.data.id}', '${userId}')">
        Cancel Request
      </button>
    `;
  } else if (rel && rel.data?.status === 'pending' && rel.direction === 'received') {
    statusBadgeHtml = `<div class="user-card-status-badge status-badge-pending">✉ ${escapeHtml(peerData.displayName)} wants to be your friend</div>`;
    actionsHtml = `
      ${rel.data.message ? `<div class="user-card-request-msg">“${escapeHtml(rel.data.message)}”</div>` : ''}
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
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0;">This member is not accepting friend requests right now.</p>
    `;
  } else {
    // No relationship yet — even contacts with an exact username must be
    // accepted before chat unlocks (the friend-request gate).
    statusBadgeHtml = contactFlag
      ? `<div class="user-card-status-badge status-badge-pending">In your contacts — send a friend request to unlock chat</div>`
      : '';
    actionsHtml = `
      <button class="btn btn-primary" id="btn-request-to-chat" onclick="window.HubbleNest.handleSendChatRequest('${userId}')">
        ✉ Send Friend Request
      </button>
      ${contactFlag ? `<button class="btn btn-secondary" onclick="window.HubbleNest.removeContactFromProfile('${userId}')">
        Remove from contacts
      </button>` : `
      <button class="btn btn-secondary" onclick="window.HubbleNest.addContactFromProfile('${userId}')">
        + Add to contacts
      </button>`}
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
    await addContact(state.userProfile, peerData).catch(() => {});
    await sendChatRequest(state.userProfile, peerData, '');
    // Refresh the modal view to show pending state
    await openUserCardModal(targetUserId);
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✉ Send Friend Request';
    }
  }
}

export async function handleAcceptRequest(requestId) {
  try {
    const res = await acceptChatRequest(requestId, state.userProfile);
    // The acceptor keeps the sender on their People page too.
    if (res && res.peer) {
      await addContact(state.userProfile, res.peer).catch(() => {});
    }
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
  // Contacts no longer bypass the gate — adding is now a friend request.
  await handleSendChatRequest(targetUserId);
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
 * One-tap "Chat" from the People cards, search results and profiles.
 *
 * FRIEND-REQUEST GATE — acceptance is required before ANY private chat, even
 * when the exact username is known or the member is in your contacts:
 *  - an accepted request / existing conversation → open the chat instantly
 *  - THEY sent you a request                     → accept it and open the chat
 *  - YOUR request is pending                     → clear explanation, no duplicates
 *  - they declined within 24 h                   → say so, no spam
 *  - no relationship yet                         → send a friend request right away
 */
export async function chatWithPerson(targetUserId) {
  if (!state.currentUser) { showToast('Sign in first.', 'info'); return; }
  if (!targetUserId || targetUserId === state.currentUser.uid) {
    showToast('Pick another member to chat with.', 'info');
    return;
  }

  try {
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
          if (res.peer) await addContact(state.userProfile, res.peer).catch(() => {});
          openDirectMessagesView();
          setTimeout(() => selectConversation(res.conversation.id, res.peer.uid), 250);
        }
      } else {
        showToast('Your friend request is still pending — you can chat once they accept.', 'info', 4500);
      }
      return;
    }

    if (rel && status === 'declined') {
      const updatedSeconds = rel.data.updatedAt?.seconds || 0;
      if (Math.floor(Date.now() / 1000) - updatedSeconds < 86400) {
        showToast('This member is not accepting friend requests right now.', 'info');
        return;
      }
    }

    const peerData = state.selectedUserCard || await fetchPublicUserCard(targetUserId);
    if (!peerData) { showToast('Could not load this member.', 'error'); return; }

    // Keep the sender's People page aware of the pending relationship.
    await addContact(state.userProfile, peerData).catch(() => {});

    const sent = await sendChatRequest(
      state.userProfile,
      peerData,
      'Hi! I would like to add you as a friend.'
    );
    if (sent) {
      showToast(`Friend request sent — you can chat with ${peerData.displayName || 'them'} once they accept.`, 'success', 4500);
    }
  } catch (err) {
    console.error('Friend request from People card failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'The friend request could not be sent — check your connection and try again.'
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
  // Arcade 2.0 shell: rail router, dashboard, hero, chips (data arrives via
  // the games snapshot → onArcadeGamesUpdated). Signed-out state is handled
  // inside (honest sign-in prompts, no fake content).
  initArcadeShell();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * "Create with AI" entry points (welcome card, Arcade top bar): jump straight
 * into the game editor with the AI prompt panel already open.
 */
export function openGameWithAi() {
  openArcadeView();
  openGameEditor(null, { ai: true });
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
            <div class="direct-request-handle">@${escapeHtml(req.senderUsername || 'member')}</div>
          </div>
        </div>
        ${req.message ? `<div class="direct-request-msg">“${escapeHtml(req.message)}”</div>` : ''}
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
        ? 'Your account is being refused read access on this conversation. Sign in again, then retry — if it persists, the Get Help assistant and the project admin can help.'
        : 'Check your connection and try again.'}</div>
      <div class="chat-error-actions">
        <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.openHelpAssistant()">Get Help</button>
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
 * textarea auto-grows while the member types (up to 520px, then scrolls).
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
    el.style.height = Math.min(el.scrollHeight, 520) + 'px';
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
          if (isStoredAttachment(att)) {
            return storedFileCardHtml(att, `
              <button type="button" class="btn-ghost" style="padding: 2px 6px; font-size: 0.75rem; color: var(--accent-primary);" onclick="window.HubbleNest.replyToDirectFile('${msg.id}', '${escapeHtml(att.originalFilename || 'Document')}', '', '${att.resourceType || 'document'}', '${escapeHtml(att.blobId)}')">
                ↩ Reply
              </button>
            `);
          }
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
                ${decrypted.replyTo.fileBlobId
                  ? `<a href="javascript:void(0)" class="reply-file-link" onclick="event.stopPropagation(); window.HubbleNest.openStoredFile('${escapeHtml(decrypted.replyTo.fileBlobId)}', '${escapeHtml(decrypted.replyTo.fileName || decrypted.replyTo.text)}')">${escapeHtml(decrypted.replyTo.fileName || decrypted.replyTo.text)} ↗</a>`
                  : `<a href="${decrypted.replyTo.fileUrl || '#'}" target="_blank" rel="noopener noreferrer" class="reply-file-link" onclick="event.stopPropagation();">${escapeHtml(decrypted.replyTo.fileName || decrypted.replyTo.text)} ↗</a>`}
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

export function replyToDirectFile(fileId, fileName, fileUrl, fileType = 'document', fileBlobId = null) {
  state.directReplyingTo = {
    id: fileId,
    senderName: 'File',
    text: fileName,
    fileName: fileName,
    fileUrl: fileUrl,
    fileBlobId: fileBlobId || null,
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
        const result = await uploadFileAnywhere(file, () => {}, 100);
        attachments.push({
          url: result.url || '',
          blobId: result.blobId || null,
          fallbackStored: !!result.fallbackStored,
          mime: file.type || 'application/octet-stream',
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
    // "Added to a Space" rows get a decorated slot: when the adder is not in
    // the recipient's contacts, decorateSpaceAddedNotifications() fills it
    // with the warning and the real leave opt-out.
    const spaceAddedSlot = (n.type === 'space_added' && n.spaceId && n.adderUid)
      ? `<div id="space-added-extra-${n.id}" style="margin-top: 8px; display: none;"></div>`
      : '';
    return `
      <div class="menu-item ${n.isRead ? '' : 'unread'}" style="flex-direction: column; align-items: flex-start; cursor: pointer; border-left: ${n.isRead ? 'none' : '3px solid var(--accent-primary)'};" onclick="window.HubbleNest.handleNotificationClick('${n.id}', '${n.spaceId || ''}')">
        <div style="font-weight: 600; font-size: 0.85rem;">${escapeHtml(n.title)}</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(n.body)}</div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">${formatTimeAgo(n.createdAt)}</div>
        ${spaceAddedSlot}
      </div>
    `;
  }).join('');

  decorateSpaceAddedNotifications();
}

/**
 * "Added to a Space" notifications: when the adder is NOT in the recipient's
 * contacts (no accepted friend/chat relationship and no contacts entry), the
 * recipient sees an explicit warning and a one-click opt-out that really
 * removes them from the Space. Contacts are owner-private, so this check can
 * only run on the recipient's own side — the admin who added them can never
 * read (or fake) this state.
 */
async function decorateSpaceAddedNotifications() {
  const myUid = state.currentUser?.uid;
  if (!myUid) return;
  const targets = state.notifications.filter(n => n.type === 'space_added' && n.spaceId && n.adderUid);
  for (const n of targets) {
    const slot = document.getElementById(`space-added-extra-${n.id}`);
    if (!slot || slot.dataset.done === '1') continue;
    let connected = false;
    try {
      const rel = await getChatRelationship(myUid, n.adderUid);
      const status = rel?.data?.status;
      if (rel && (status === 'accepted' || rel.direction === 'connected')) connected = true;
      if (!connected) {
        const contactSnap = await getDoc(doc(db, 'contacts', `${myUid}_${n.adderUid}`));
        connected = contactSnap.exists();
      }
    } catch (e) { /* read failure — the row just renders plain */ }
    slot.dataset.done = '1';
    if (connected) {
      slot.style.display = 'none';
    } else {
      slot.style.display = 'block';
      slot.innerHTML = `
        <div class="notif-optout">
          <div class="notif-optout-warn">⚠ @${escapeHtml(n.adderUsername || n.adderName || 'this member')} is not in your contacts.</div>
          <button type="button" class="btn btn-sm btn-ghost notif-optout-leave" onclick="event.stopPropagation(); window.HubbleNest.leaveSpaceFromNotification('${n.id}')">Leave "${escapeHtml(n.spaceName || 'this Space')}"</button>
        </div>`;
    }
  }
}

/**
 * Opt-out: leave a Space directly from its "added to a Space" notification —
 * a real leaveSpace write (the same self-removal as the Space header's Leave
 * button), then the notification is cleaned up.
 */
export async function leaveSpaceFromNotification(notifId) {
  const notif = state.notifications.find(n => n.id === notifId);
  if (!notif?.spaceId || !state.currentUser) return;
  const adderLabel = notif.adderName ? notif.adderName : (notif.adderUsername ? '@' + notif.adderUsername : 'a space admin');
  if (!window.confirm(`Leave "${notif.spaceName || 'this Space'}"? You were added by ${adderLabel}, who is not in your contacts.`)) return;
  try {
    const removed = await leaveSpace(notif.spaceId, state.currentUser.uid);
    try { await deleteDoc(doc(db, 'notifications', notifId)); } catch (e) { /* best-effort */ }
    state.notifications = state.notifications.filter(n => n.id !== notifId);
    renderNotificationsPanel();
    showToast(removed ? `You left ${notif.spaceName || 'the Space'}.` : 'You were not a member of that Space.', 'info');
  } catch (err) {
    console.error('Opt-out leave failed:', err);
    showToast('Could not leave the Space — check your connection and try again.', 'error');
  }
}

/* ==========================================================================
   12. QR CODE & SPACE CODE MODALS
   ========================================================================== */

/**
 * Build a shareable invite link that works on ANY static host — root domain,
 * GitHub Pages project subpaths, Firebase Hosting — by using a #join= hash
 * fragment relative to the app entry page instead of an absolute /join/ path.
 * The code is uppercased so the link and the QR always carry "HN-7K4P92".
 */
function buildJoinLink(code) {
  const { origin, pathname } = window.location;
  const clean = String(code || '').trim().toUpperCase();
  let p = pathname;
  if (/\/[^/]*\.html?$/i.test(p)) {
    p = p.replace(/[^/]*$/, 'index.html');   // invite created on a subpage → point at the app entry
  } else if (!p.endsWith('/')) {
    p = `${p}/`;                             // bare directory path ("…/HubbleNest")
  }
  return `${origin}${p}#join=${clean}`;
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
  if (!code || !String(code).trim()) {
    showToast('Please enter a Space code.', 'warning');
    return;
  }

  // Normalize: uppercase, HN- prefix added when missing — so bare codes from
  // any invite format ("7K4P92") resolve to the same Space as "HN-7K4P92".
  const cleanCode = String(code).trim().toUpperCase();
  const canonical = cleanCode.startsWith('HN-') ? cleanCode : `HN-${cleanCode}`;

  showToast('Locating Space...', 'info', 1500);
  const foundSpace = await findSpaceByCode(canonical);

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
            ? 'Joining was blocked — double-check the code, your connection, and try once more.'
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
            ? 'Joining was blocked — double-check the code, your connection, and try once more.'
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
  // Push + AI config cards are ADMIN-ONLY — non-admins never load them.
  if (state.isAdmin) {
    initPushSettingsUI().catch(() => {});
    initAiSettingsUI().catch(() => {});
  }
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
   17. GLOBAL SEARCH — pages, spaces, people
   ========================================================================== */

/**
 * Every navigable in-app page. The global search bar matches these by name
 * or keywords and jumps straight there — plus spaces and people below.
 */
const APP_PAGES = [
  { key: 'home',        label: 'Home',                desc: 'Dashboard, welcome card & community feed', keywords: 'home dashboard welcome feed composer post', go: () => loadDashboard() },
  { key: 'spaces',      label: 'My Spaces',           desc: 'All Spaces you belong to',                 keywords: 'spaces my groups list categories', go: () => openMySpacesPage() },
  { key: 'people',      label: 'People',              desc: 'Friends & friend requests',                keywords: 'people contacts friends request add username', go: () => openPeopleView() },
  { key: 'messages',    label: 'Private Messages',    desc: 'Chats & incoming friend requests',         keywords: 'messages chat direct dm inbox requests', go: () => openDirectMessagesView() },
  { key: 'arcade',      label: 'Arcade — Play Games', desc: 'Play, like and rate community games',      keywords: 'arcade games play fun scores leaderboard gaming', go: () => openArcadeView() },
  { key: 'create-game', label: 'Create a Game',       desc: 'Arcade game editor (code, AI or link)',    keywords: 'create game editor build new game ai link', go: () => { openArcadeView(); openGameEditor(null); } },
  { key: 'bots',        label: 'Bots Marketplace',    desc: 'Discover & use community AI bots',         keywords: 'bots ai assistant marketplace discover robot chat', go: () => openBotsMarketplace() },
  { key: 'create-bot',  label: 'Create a Bot',        desc: 'Bot studio — personality, logo, skills',   keywords: 'create bot ai studio personality logo publish', go: () => openBotStudio('create') },
  { key: 'my-bots',     label: 'My Bots',             desc: 'Manage the bots you created',              keywords: 'my bots manage edit delete publish visibility', go: () => openBotStudio('update') },
  { key: 'get-help',    label: 'Get Help — AI Assistant', desc: 'Chat with the HubbleNest Helper',      keywords: 'help assistant ai support guide how to troubleshoot', go: () => openHelpAssistant() },
  { key: 'create-space',label: 'Create a Space',      desc: 'Start your own community',                 keywords: 'create new space group build community', go: () => openCreateSpacePage() },
  { key: 'join',        label: 'Join a Space',        desc: 'Enter a Space code or scan a QR invite',   keywords: 'join code invite qr enter space', go: () => openJoinSpacePage() },
  { key: 'direct-share',label: 'Direct Share',        desc: 'Hand off files with a 6-letter code',      keywords: 'direct share files transfer handoff qr code', go: () => openDirectShareViewWrapper() },
  { key: 'profile',     label: 'Profile & Settings',  desc: 'Your account, photo, bio & security',      keywords: 'profile settings account avatar bio theme', go: () => openProfilePage() }
];

function findPageByKey(key) {
  return APP_PAGES.find(p => p.key === key) || null;
}

export async function handleSearchInput(term) {
  const resultsContainer = document.getElementById('global-search-results');
  if (!resultsContainer) return;

  if (!term || term.trim().length < 2) {
    resultsContainer.innerHTML = `<div style="padding: 16px; color: var(--text-muted); text-align: center;">Type at least 2 characters to search pages, spaces and people...</div>`;
    return;
  }

  const clean = term.trim().toLowerCase();

  // 1. PAGES — instant, local, always available.
  const pageHits = APP_PAGES.filter(p =>
    p.label.toLowerCase().includes(clean) || p.keywords.includes(clean) || p.desc.toLowerCase().includes(clean)
  );

  const results = await executeGlobalSearch(term, state.currentUser?.uid);

  let html = '';
  if (pageHits.length > 0) {
    html += `<div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); padding: 8px 12px; font-weight: 600;">Pages</div>`;
    html += pageHits.map(p => `
      <div class="menu-item" onclick="window.HubbleNest.handleSelectSearchResult('page', '${p.key}')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>
        <span>${escapeHtml(p.label)}</span>
        <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: auto;">${escapeHtml(p.desc)}</span>
      </div>
    `).join('');
  }

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

  if (results.bots && results.bots.length > 0) {
    html += `<div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); padding: 8px 12px; font-weight: 600;">Bots</div>`;
    html += results.bots.map(b => `
      <div class="menu-item" onclick="window.HubbleNest.handleSelectSearchResult('bot', '${b.id}')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="5"/><path d="M12 8V5.2"/><circle cx="12" cy="3.6" r="1.4"/><path d="M9.5 13.5v2M14.5 13.5v2"/></svg> <span>${escapeHtml(b.name || 'Bot')}</span> <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: auto;">${escapeHtml(b.shortDescription || b.category || 'AI bot')}</span>
      </div>
    `).join('');
  }

  if (!html) {
    html = `<div style="padding: 16px; color: var(--text-muted); text-align: center;">No pages, spaces or people match “${escapeHtml(term.trim())}”.</div>`;
  }

  resultsContainer.innerHTML = html;
}

/* ==========================================================================
   18. ADMIN CONSOLE — platform creator only (danielgiobari644@gmail.com)
   Ban / suspend members, ban / suspend / feature Spaces, remove any member
   from any Space, delete any post (see community.js) and send notifications
   to one member or to everyone. Every action is a REAL Firestore write that
   the security rules gate behind the admin's auth email.
   ========================================================================== */

export function openAdminPage() {
  if (!state.isAdmin) {
    showToast('The Admin Console is only available to the HubbleNest creator.', 'warning');
    return;
  }
  state.currentView = 'admin';
  unsubscribeFromChat();
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-admin')?.classList.add('active-view');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('nav-admin')?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function adminToggleNotifMode(mode) {
  const row = document.getElementById('admin-notif-target-row');
  if (row) row.style.display = mode === 'one' ? 'block' : 'none';
}

async function adminNotifyUser(uid, title, body) {
  await addDoc(collection(db, 'notifications'), {
    userId: uid,
    type: 'admin_message',
    title: title || 'Message from HubbleNest',
    body: body || '',
    fromAdmin: true,
    adminName: state.userProfile?.displayName || 'HubbleNest Admin',
    isRead: false,
    createdAt: serverTimestamp()
  });
  sendPushToUser(uid, { title: title || 'Message from HubbleNest', body: body || '', tag: 'admin_message' }).catch(() => {});
}

export async function adminSendNotification() {
  if (!state.isAdmin) return;
  const modeEl = document.querySelector('input[name="admin-notif-mode"]:checked');
  const mode = modeEl?.value || 'one';
  const titleInput = document.getElementById('admin-notif-title');
  const bodyInput = document.getElementById('admin-notif-body');
  const usernameInput = document.getElementById('admin-notif-username');
  const btn = document.getElementById('admin-notif-send-btn');
  const statusEl = document.getElementById('admin-notif-status');
  const title = (titleInput?.value || '').trim();
  const body = (bodyInput?.value || '').trim();

  if (!title || !body) {
    showToast('Write both a title and a message first.', 'warning');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (statusEl) statusEl.textContent = '';

  try {
    if (mode === 'one') {
      const raw = (usernameInput?.value || '').trim();
      if (!raw) { showToast('Enter the member\'s username.', 'warning'); return; }
      const peer = await findUserByUsername(raw);
      if (!peer) { showToast(`No member has the username @${raw.replace(/^@/, '')}.`, 'error'); return; }
      await adminNotifyUser(peer.uid, title, body);
      if (statusEl) statusEl.textContent = `✓ Delivered to @${peer.username}.`;
      showToast(`Notification sent to @${peer.username}.`, 'success');
    } else {
      const snap = await getDocs(query(collection(db, 'users'), limit(500)));
      const targets = [];
      snap.forEach(d => {
        const u = d.data();
        if (u.uid && u.uid !== state.currentUser.uid) targets.push(u.uid);
      });
      let sent = 0;
      for (const uid of targets) {
        await adminNotifyUser(uid, title, body).catch(() => {});
        sent++;
        if (statusEl && sent % 10 === 0) statusEl.textContent = `Delivering… ${sent}/${targets.length}`;
      }
      if (statusEl) statusEl.textContent = `✓ Delivered to ${sent} member${sent === 1 ? '' : 's'}.`;
      showToast(`Notification broadcast to ${sent} member${sent === 1 ? '' : 's'}.`, 'success');
    }
    if (titleInput) titleInput.value = '';
    if (bodyInput) bodyInput.value = '';
  } catch (err) {
    console.error('Admin notification failed:', err);
    if (statusEl) statusEl.textContent = `✕ Failed (${escapeHtml(err?.code || 'error')}).`;
    showToast('Could not send the notification.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send notification'; }
  }
}

function adminUserStatusHtml(u) {
  if (u.banned === true) return `<span class="admin-status-badge admin-status-banned">Banned${u.banReason ? ` — ${escapeHtml(u.banReason)}` : ''}</span>`;
  const until = Number(u.suspendedUntilMs || 0);
  if (until > Date.now()) {
    return `<span class="admin-status-badge admin-status-suspended">Suspended until ${new Date(until).toLocaleString()}</span>`;
  }
  return `<span class="admin-status-badge admin-status-ok">Active</span>`;
}

export async function adminSearchUser() {
  if (!state.isAdmin) return;
  const input = document.getElementById('admin-user-lookup');
  const box = document.getElementById('admin-user-result');
  const raw = (input?.value || '').trim();
  if (!raw) { showToast('Enter a username to moderate.', 'info'); return; }
  if (box) box.innerHTML = `<div class="add-contact-searching">Looking up @${escapeHtml(raw.replace(/^@/, ''))}…</div>`;
  try {
    const peer = await findUserByUsername(raw);
    if (!peer) {
      if (box) box.innerHTML = `<div class="add-contact-miss">No member has the username <b>@${escapeHtml(raw.replace(/^@/, ''))}</b>.</div>`;
      return;
    }
    // Full profile for moderation state (public card fields + flags).
    const snap = await getDoc(doc(db, 'users', peer.uid));
    const full = snap.exists() ? snap.data() : peer;
    state.adminTargetUser = { ...peer, ...full, uid: peer.uid };
    if (box) {
      box.innerHTML = `
        <div class="add-contact-card">
          <img src="${getAvatarUrl(full.photoURL, full.displayName)}" alt="" class="add-contact-avatar" />
          <div class="add-contact-info">
            <div class="add-contact-name">${escapeHtml(full.displayName || peer.displayName)}</div>
            <div class="add-contact-handle">@${escapeHtml(peer.username)}</div>
            ${adminUserStatusHtml(full)}
          </div>
        </div>
        <div class="admin-action-row">
          <button type="button" class="btn btn-sm btn-primary" onclick="window.HubbleNest.adminViewMember('${peer.uid}')">View profile</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.HubbleNest.adminUnbanUser()" ${full.banned !== true && Number(full.suspendedUntilMs || 0) <= Date.now() ? 'disabled' : ''}>Lift ban / suspension</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.HubbleNest.adminSuspendUser()">Suspend 7 days</button>
          <button type="button" class="btn btn-sm btn-ghost admin-danger-btn" onclick="window.HubbleNest.adminBanUser()">Ban permanently</button>
        </div>`;
    }
  } catch (err) {
    console.error('Admin user lookup failed:', err);
    if (box) box.innerHTML = `<div class="add-contact-miss">Lookup failed (${escapeHtml(err?.code || 'error')}).</div>`;
  }
}

export function adminViewMember(uid) {
  openMemberProfilePage(uid);
}

export async function adminBanUser() {
  if (!state.isAdmin || !state.adminTargetUser) return;
  const u = state.adminTargetUser;
  const reason = window.prompt(`Ban @${u.username} permanently? Type the reason shown to them:`, 'Violation of the HubbleNest community guidelines');
  if (reason === null) return;
  try {
    await updateDoc(doc(db, 'users', u.uid), {
      banned: true,
      banReason: reason || '',
      bannedAt: Date.now()
    });
    await adminNotifyUser(u.uid, 'Account banned', `Your HubbleNest account was banned by the admin. ${reason || ''}`).catch(() => {});
    showToast(`@${u.username} is banned.`, 'success');
    adminSearchUser();
  } catch (err) {
    console.error('Ban failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'The rules refuse this write — publish the new firestore.rules first.'
      : 'Could not ban this member.', 'error', 6000);
  }
}

export async function adminSuspendUser() {
  if (!state.isAdmin || !state.adminTargetUser) return;
  const u = state.adminTargetUser;
  const days = Number(window.prompt(`Suspend @${u.username} for how many days?`, '7'));
  if (!days || days <= 0) return;
  try {
    await updateDoc(doc(db, 'users', u.uid), {
      suspendedUntilMs: Date.now() + days * 24 * 60 * 60 * 1000,
      suspensionReason: ''
    });
    await adminNotifyUser(u.uid, 'Account suspended', `Your HubbleNest account was suspended for ${days} day${days === 1 ? '' : 's'}.`).catch(() => {});
    showToast(`@${u.username} is suspended for ${days} day${days === 1 ? '' : 's'}.`, 'success');
    adminSearchUser();
  } catch (err) {
    console.error('Suspend failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'The rules refuse this write — publish the new firestore.rules first.'
      : 'Could not suspend this member.', 'error', 6000);
  }
}

export async function adminUnbanUser() {
  if (!state.isAdmin || !state.adminTargetUser) return;
  const u = state.adminTargetUser;
  try {
    await updateDoc(doc(db, 'users', u.uid), {
      banned: false,
      suspendedUntilMs: 0,
      banReason: '',
      suspensionReason: ''
    });
    showToast(`@${u.username} can sign in again.`, 'success');
    adminSearchUser();
  } catch (err) {
    console.error('Unban failed:', err);
    showToast('Could not lift the moderation flags.', 'error');
  }
}

export async function adminSearchSpace() {
  if (!state.isAdmin) return;
  const input = document.getElementById('admin-space-lookup');
  const box = document.getElementById('admin-space-result');
  const raw = (input?.value || '').trim();
  if (!raw) { showToast('Enter a Space code (e.g. HN-7K4P92).', 'info'); return; }
  if (box) box.innerHTML = `<div class="add-contact-searching">Looking up ${escapeHtml(raw.toUpperCase())}…</div>`;
  try {
    const sp = await findSpaceByCode(raw);
    if (!sp) {
      if (box) box.innerHTML = `<div class="add-contact-miss">No Space has the code <b>${escapeHtml(raw.toUpperCase())}</b>.</div>`;
      return;
    }
    state.adminTargetSpace = sp;
    const mod = spaceModerationState(sp);
    if (box) {
      box.innerHTML = `
        <div class="add-contact-card">
          <div class="add-contact-info">
            <div class="add-contact-name">${escapeHtml(sp.name || 'Space')} ${sp.featured ? '<span class="featured-pill">★ Featured</span>' : ''}</div>
            <div class="add-contact-handle">${escapeHtml(sp.code || '')} · ${sp.memberCount || 1} members</div>
            ${mod ? `<span class="admin-status-badge admin-status-banned">${escapeHtml(mod)}</span>` : ''}
          </div>
        </div>
        <div class="admin-action-row">
          <button type="button" class="btn btn-sm btn-primary" onclick="window.HubbleNest.adminOpenSpace('${sp.id}')">Open Space</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.HubbleNest.adminLoadSpaceMembers()">Members</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.HubbleNest.adminFeatureSpace()" ${sp.featured ? 'disabled' : ''}>★ Feature</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.HubbleNest.adminUnfeatureSpace()" ${!sp.featured ? 'disabled' : ''}>Unfeature</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.HubbleNest.adminSuspendSpace()">Suspend 7 days</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="window.HubbleNest.adminUnbanSpace()" ${!mod ? 'disabled' : ''}>Restore</button>
          <button type="button" class="btn btn-sm btn-ghost admin-danger-btn" onclick="window.HubbleNest.adminBanSpace()" ${sp.status === 'banned' ? 'disabled' : ''}>Ban Space</button>
        </div>
        <div id="admin-space-members-box" style="margin-top: 12px;"></div>`;
    }
  } catch (err) {
    console.error('Admin space lookup failed:', err);
    if (box) box.innerHTML = `<div class="add-contact-miss">Lookup failed (${escapeHtml(err?.code || 'error')}).</div>`;
  }
}

function adminRefreshSpaceCard() {
  const input = document.getElementById('admin-space-lookup');
  if (input && input.value.trim()) adminSearchSpace();
}

export async function adminFeatureSpace() {
  if (!state.isAdmin || !state.adminTargetSpace) return;
  try {
    await updateDoc(doc(db, 'spaces', state.adminTargetSpace.id), {
      featured: true,
      featuredAt: Date.now(),
      featuredBy: state.currentUser.uid
    });
    showToast(`"${state.adminTargetSpace.name}" is now featured on every dashboard.`, 'success');
    adminRefreshSpaceCard();
  } catch (err) {
    console.error('Feature failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'The rules refuse this write — publish the new firestore.rules first.'
      : 'Could not feature this Space.', 'error', 6000);
  }
}

export async function adminUnfeatureSpace() {
  if (!state.isAdmin || !state.adminTargetSpace) return;
  try {
    await updateDoc(doc(db, 'spaces', state.adminTargetSpace.id), { featured: false });
    showToast('Space removed from the featured slot.', 'info');
    adminRefreshSpaceCard();
  } catch (err) {
    console.error('Unfeature failed:', err);
    showToast('Could not unfeature this Space.', 'error');
  }
}

export async function adminBanSpace() {
  if (!state.isAdmin || !state.adminTargetSpace) return;
  const sp = state.adminTargetSpace;
  if (!window.confirm(`Ban "${sp.name}"? Members lose access until you restore it.`)) return;
  try {
    await updateDoc(doc(db, 'spaces', sp.id), { status: 'banned' });
    showToast(`"${sp.name}" is banned.`, 'success');
    adminRefreshSpaceCard();
  } catch (err) {
    console.error('Space ban failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'The rules refuse this write — publish the new firestore.rules first.'
      : 'Could not ban this Space.', 'error', 6000);
  }
}

export async function adminSuspendSpace() {
  if (!state.isAdmin || !state.adminTargetSpace) return;
  const sp = state.adminTargetSpace;
  const days = Number(window.prompt(`Suspend "${sp.name}" for how many days?`, '7'));
  if (!days || days <= 0) return;
  try {
    await updateDoc(doc(db, 'spaces', sp.id), {
      status: 'suspended',
      suspendedUntilMs: Date.now() + days * 24 * 60 * 60 * 1000
    });
    showToast(`"${sp.name}" is suspended for ${days} day${days === 1 ? '' : 's'}.`, 'success');
    adminRefreshSpaceCard();
  } catch (err) {
    console.error('Space suspend failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'The rules refuse this write — publish the new firestore.rules first.'
      : 'Could not suspend this Space.', 'error', 6000);
  }
}

export async function adminUnbanSpace() {
  if (!state.isAdmin || !state.adminTargetSpace) return;
  try {
    await updateDoc(doc(db, 'spaces', state.adminTargetSpace.id), {
      status: 'active',
      suspendedUntilMs: 0
    });
    showToast('Space restored.', 'success');
    adminRefreshSpaceCard();
  } catch (err) {
    console.error('Space restore failed:', err);
    showToast('Could not restore this Space.', 'error');
  }
}

export function adminOpenSpace(spaceId) {
  closeModalForAdmin();
  openSpace(spaceId);
}

function closeModalForAdmin() { /* navigation away from the console is enough */ }

export async function adminLoadSpaceMembers() {
  if (!state.isAdmin || !state.adminTargetSpace) return;
  const box = document.getElementById('admin-space-members-box');
  if (!box) return;
  box.innerHTML = `<div class="add-contact-searching">Loading members…</div>`;
  try {
    const snap = await getDocs(collection(db, 'spaces', state.adminTargetSpace.id, 'members'));
    const members = [];
    snap.forEach(d => members.push({ id: d.id, ...d.data() }));
    state.adminSpaceMembers = members;
    if (members.length === 0) {
      box.innerHTML = `<div class="add-contact-miss">This Space has no members.</div>`;
      return;
    }
    box.innerHTML = members.map(m => `
      <div class="member-card">
        <div class="msg-avatar" style="width: 34px; height: 34px;">
          <img src="${getAvatarUrl(m.photoURL, m.displayName)}" class="avatar-img" alt="" loading="lazy" decoding="async"/>
        </div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(m.displayName || 'Member')} ${m.role === 'admin' ? '<span class="admin-pill">admin</span>' : ''}</div>
          <div class="member-role">@${escapeHtml(m.username || 'member')}</div>
        </div>
        <button type="button" class="btn btn-sm btn-ghost admin-danger-btn" onclick="window.HubbleNest.adminRemoveMemberFromSpace('${m.id}')" title="Remove from Space">Remove</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Admin members load failed:', err);
    box.innerHTML = `<div class="add-contact-miss">Could not load members (${escapeHtml(err?.code || 'error')}).</div>`;
  }
}

export async function adminRemoveMemberFromSpace(memberUid) {
  if (!state.isAdmin || !state.adminTargetSpace) return;
  const m = state.adminSpaceMembers.find(x => x.id === memberUid);
  if (!m) return;
  if (!window.confirm(`Remove ${m.displayName || 'this member'} from "${state.adminTargetSpace.name}"?`)) return;
  try {
    await removeSpaceMember(state.adminTargetSpace.id, memberUid);
    showToast(`${m.displayName || 'Member'} removed from the Space.`, 'info');
    state.adminSpaceMembers = state.adminSpaceMembers.filter(x => x.id !== memberUid);
    adminLoadSpaceMembers();
  } catch (err) {
    console.error('Admin member removal failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'The rules refuse this write — publish the new firestore.rules first.'
      : 'Could not remove this member.', 'error', 6000);
  }
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
  setArcadeSearch,
  setArcadeCategory,
  setArcadeSort,
  getGamesCache,
  renderArcadeGrid,
  arcGameCard,
  restartCurrentGame,
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
  handleGameCoverUpload,
  removeGameCover,
  onGameLinkInput,
  clearGameLink,
  openLinkGameExternally,

  // Secure in-app file store (Firestore fallback for blocked Cloudinary families)
  downloadStoredFile,
  openStoredFile,

  // Direct Share (code / QR file handoff)
  openDirectShareView: openDirectShareViewWrapper,
  setShareMode,
  createDirectShare,
  addFilesToShare,
  copyShareLink,
  closeDirectShare,
  backToSharePicker,
  connectToShare,

  // HubbleNest Bots — marketplace · studio · chat · profile
  openBotsView: openBotsMarketplace,
  openBotsMarketplace,
  openBotStudio,
  bstGo,
  setStudioMode,
  botsSetTab,
  botsSetCategory,
  botsHandleSearch,
  botsRetry,
  botsUseBot,
  botsCardMenu,
  botsShareBotById,
  toggleBotVisibility,
  deleteBotWithConfirm,
  botStudioMarkDirty,
  botStudioPickLogoTemplate,
  botStudioPickPreviewTemplate,
  botStudioUploadLogo,
  botStudioUploadPreview,
  botStudioRemoveLogo,
  botStudioRemovePreview,
  botStudioAddCustomCap,
  botStudioRemoveCustomCap,
  botStudioSave,
  botStudioCancelEdit,
  botStudioShare,
  botStudioTest,
  botLoadForEdit,
  openBotChat,
  botChatSend,
  botChatKey,
  botChatNew,
  botChatClear,
  botChatRetry,
  botChatUseSuggested,
  openBotProfile,
  botProfileRate,
  botProfileSubmitComment,
  botProfileLikeComment,
  botProfileEditComment,
  botProfileDeleteComment,
  botProfileReportComment,
  handleBotDeepLink,
  openGameWithAi,

  // Get Help — the HubbleNest Helper (AI assistant)
  openHelpAssistant,
  closeHelpAssistant,
  toggleHelpAssistant,

  // Notifications
  handleNotificationClick,
  leaveSpaceFromNotification,

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
  addSpaceMemberByUsername,

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
    if (type === 'page') {
      const page = findPageByKey(id);
      if (page) page.go();
    }
    else if (type === 'space') openSpace(id);
    else if (type === 'user') openMemberProfilePage(id);
    else if (type === 'bot') openBotProfile(id);
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
  composerPickVideo,
  composerInsertLink,
  stageHomeAttachment: (file) => stageHomeFile(file, 100),
  removeHomeAttachment,
  clearAllHomeAttachments,
  feedSetMode,
  feedToggleLike,
  feedToggleComments,
  feedSubmitComment,
  feedDeleteComment,
  feedDeletePost,
  feedSharePost,
  toggleRankingInfo,

  // Sidebar "Spaces" shortcut: open the dedicated Your Spaces page
  openSpacesSection: () => openMySpacesPage(),

  // Rail quick actions — REAL targets only (no simulated official space):
  // with no featured Space yet, "View Space" opens the Spaces section.
  openCommunitySpace: () => openSpacesSection(),
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
  sendFriendRequestByUsername,
  handleFriendRequestMessageInput,
  addFoundContact,
  removeContactFromList,
  addContactFromProfile,
  removeContactFromProfile,
  leaveActiveSpace,

  // Admin console — platform creator only
  openAdminPage,
  adminToggleNotifMode,
  adminSendNotification,
  adminSearchUser,
  adminViewMember,
  adminBanUser,
  adminSuspendUser,
  adminUnbanUser,
  adminSearchSpace,
  adminOpenSpace,
  adminLoadSpaceMembers,
  adminRemoveMemberFromSpace,
  adminFeatureSpace,
  adminUnfeatureSpace,
  adminBanSpace,
  adminSuspendSpace,
  adminUnbanSpace,
  dismissBannedGate,

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
  testAiFromSettings,

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
    const activationErr = getPushActivationError();
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
      ${activationErr ? `
      <div class="push-status-row push-status-warn">
        <span class="push-status-dot"></span>
        <span><b>Activation failed on this device</b> (${escapeHtml(activationErr.code || 'error')}).
          For a 401 / token-subscribe-failed this is a one-time PROJECT fix only the owner can do:
          <b>1.</b> open the Firebase Console link below → <b>2.</b> make sure Firebase Cloud Messaging API is enabled
          <b>3.</b> under “Web Push certificates” press <b>Generate key pair</b>
          <b>4.</b> paste the public key below and press Save — every device retries automatically, no reload needed.</span>
      </div>` : ''}
      <div class="push-status-row push-status-info">
        <span class="push-status-dot"></span>
        <span>Reminder: the Firebase Cloud Messaging API must stay <b>enabled</b> for the hubblenest project (Google Cloud Console → APIs &amp; Services). That project setting also persists — it is never affected by re-uploading the app.</span>
      </div>
      <div class="push-status-row push-status-info" style="justify-content: flex-end; gap: 10px; flex-wrap: wrap;">
        <a class="btn btn-secondary" style="padding: 6px 14px; font-size: 0.8rem; text-decoration: none;" href="https://console.firebase.google.com/u/0/project/hubblenest/settings/cloudmessaging" target="_blank" rel="noopener noreferrer">Open Firebase Console → Cloud Messaging ↗</a>
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
      ? 'Only the member who configured push first can update it.'
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
    const ok = getLastAiSuccess();
    const fail = getLastAiFailure();
    if (snap.exists() && snap.data().apiKey) {
      const d = snap.data();
      const model = String(d.model || 'gemini-2.5-flash').trim();
      const key = String(d.apiKey || '');
      const fp = `${key.slice(0, 7)}…${key.slice(-4)}`;
      const health = fail
        ? `<div class="push-status-row push-status-warn">
             <span class="push-status-dot"></span>
             <span><b>The last AI request failed</b> (${escapeHtml(String(fail.message || fail.kind).slice(0, 170))}). Press <b>Test AI configuration</b> to verify a fix once you have replaced the key.</span>
           </div>`
        : (ok ? `<div class="push-status-row push-status-ok">
             <span class="push-status-dot"></span>
             <span><b>AI verified working</b> — the most recent real request succeeded.</span>
           </div>` : '');
      statusEl.innerHTML = `
        <div class="push-status-row push-status-ok">
          <span class="push-status-dot"></span>
          <span><b>Key saved:</b> ${escapeHtml(fp)} · model ${escapeHtml(model)} — Arcade prompts, every HubbleNest Bot and the Get Help assistant run on it. Stored in Firestore and survives every redeploy.</span>
        </div>
        ${health}`;
      const modelInput = document.getElementById('ai-model-input');
      if (modelInput && !modelInput.value) modelInput.value = model;
    } else {
      statusEl.innerHTML = `
        <div class="push-status-row push-status-info">
          <span class="push-status-dot"></span>
          <span><b>No AI key yet</b> — the Arcade uses its built-in game engine (real playable games, zero config), while Bots and the Get Help assistant wait for a key. Get a free Google AI Studio key to switch everything on.</span>
        </div>`;
    }
  } catch (err) {
    console.warn('AI config status failed:', err);
    statusEl.innerHTML = `<div class="push-status-row push-status-warn"><span class="push-status-dot"></span><span>Could not read the AI configuration (${escapeHtml(err?.code || 'error')}).</span></div>`;
  }
}

/**
 * REAL configuration test — sends one tiny genuine request through the exact
 * same request layer bots/games/helper use, and reports the exact verdict
 * (invalid key, blocked key, quota, wrong model …) instead of a guess.
 * Tests the typed key first (before saving), otherwise the saved one.
 */
export async function testAiFromSettings() {
  const statusEl = document.getElementById('ai-config-status');
  const btn = document.getElementById('ai-test-btn');
  const typedKey = (document.getElementById('ai-key-input')?.value || '').trim();
  const typedModel = (document.getElementById('ai-model-input')?.value || '').trim();
  if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
  if (statusEl) statusEl.innerHTML = `<div class="push-status-loading">Sending a real test request to the AI…</div>`;
  try {
    const res = await probeAiConfig(typedKey ? { apiKey: typedKey, model: typedModel } : {});
    let row;
    if (res.ok) {
      row = `<div class="push-status-row push-status-ok">
        <span class="push-status-dot"></span>
        <span><b>AI test passed</b> — the service answered in ${res.ms} ms on ${escapeHtml(res.model)} ("${escapeHtml(res.reply || 'ready')}"). Bots, Get Help and AI game creation are live${typedKey ? ' — press Save AI configuration to keep the key you typed' : ''}.</span>
      </div>`;
      showToast('AI test passed — the configuration is working.', 'success');
    } else {
      row = `<div class="push-status-row push-status-warn">
        <span class="push-status-dot"></span>
        <span><b>AI test FAILED</b> — ${escapeHtml(res.detail || 'unknown reason')}<br>
        Fix: create a fresh key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary);">aistudio.google.com/app/apikey</a>, paste it below, then press <b>Save AI configuration</b> (the key is tested automatically right after saving).</span>
      </div>`;
      showToast('AI test failed — the exact reason is shown in the panel.', 'error', 6000);
    }
    if (statusEl) statusEl.innerHTML = row + statusEl.innerHTML;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Test AI configuration'; }
  }
}

export async function saveAiConfigFromSettings() {
  const uid = state.currentUser?.uid;
  if (!uid) { showToast('Sign in first.', 'info'); return; }
  const keyInput = document.getElementById('ai-key-input');
  const modelInput = document.getElementById('ai-model-input');
  const btn = document.getElementById('ai-save-btn');
  const apiKey = (keyInput?.value || '').trim();
  const model = (modelInput?.value || '').trim() || 'gemini-2.5-flash';
  if (!apiKey) {
    showToast('Paste your Google AI Studio key first — create one free at aistudio.google.com/app/apikey.', 'warning', 6000);
    return;
  }
  // The project's Firebase Web API key is NOT an AI key — catch this common
  // mix-up before it is saved (it would make every AI request fail).
  if (apiKey === 'AIzaSyDfMNtJ9fl_4kWdNlLcPQlhG5kuxR35CO4') {
    showToast('That is this project\'s Firebase Web API key, not an AI Studio key. Create a separate key at aistudio.google.com/app/apikey and paste that.', 'error', 8000);
    return;
  }
  if (!isValidAiKey(apiKey)) {
    showToast('That is not a valid Google AI Studio key. Google now issues "AQ." Auth keys — they start with "AQ." and contain dots (classic "AIza" keys are accepted while they still work, but Google is retiring them). Create a fresh key at aistudio.google.com/app/apikey.', 'error', 8000);
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
    if (keyInput) keyInput.value = '';
    invalidateAiRuntimeCache();
    // Verify the saved key with a REAL request immediately — the admin learns
    // in seconds whether bots/games/helper are actually live, with the exact
    // failure reason when they are not.
    const probe = await probeAiConfig();
    await initAiSettingsUI();
    const statusEl = document.getElementById('ai-config-status');
    if (statusEl) {
      const row = probe.ok
        ? `<div class="push-status-row push-status-ok"><span class="push-status-dot"></span><span><b>AI test passed</b> — the service answered in ${probe.ms} ms on ${escapeHtml(probe.model)}. Arcade prompts, bots and Get Help are live.</span></div>`
        : `<div class="push-status-row push-status-warn"><span class="push-status-dot"></span><span><b>Saved — but the test request FAILED</b> — ${escapeHtml(probe.detail || 'unknown reason')}<br>Fix: get a fresh key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary);">aistudio.google.com/app/apikey</a> and save it again.</span></div>`;
      statusEl.innerHTML = row + statusEl.innerHTML;
    }
    showToast(probe.ok
      ? 'AI configuration saved and verified — bots, Get Help and AI game creation are live.'
      : 'AI configuration saved, but the test request failed — see the reason in the panel.',
      probe.ok ? 'success' : 'error', 8000);
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

// Arcade 2.0 experience layer — installs arcGo/openGameDetail/gameplay
// controls on the global bus. Games.js hooks call these via optional
// chaining, so ordering is safe.
registerArcade();
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

// Connectivity changes — calm, honest notices. Firestore's offline cache
// keeps the app fully usable while offline; writes queue and sync on return.
window.addEventListener('offline', () => {
  showToast('You are offline — HubbleNest keeps working, and everything you post syncs automatically when the connection returns.', 'info', 5200);
});
window.addEventListener('online', () => {
  showToast('Back online — syncing your data now.', 'success', 3000);
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
