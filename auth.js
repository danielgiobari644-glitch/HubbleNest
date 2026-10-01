/**
 * HubbleNest Authentication & Gradual Multi-Step Signup
 * 
 * Supports:
 * - 7-Step progressive signup with micro-interactions
 * - Email/Password and Google Sign-In
 * - Cloudinary profile photo upload
 * - Web Crypto key generation on account creation
 * - Password reset & session observation
 */

import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail,
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  query, 
  where, 
  serverTimestamp 
} from './firebase.js';

import { uploadToCloudinary } from './cloudinary.js';
import { ensureUserKeyPair } from './encryption.js';
import { showToast } from './utils.js';

// State for multi-step signup
export const signupState = {
  currentStep: 1,
  totalSteps: 7,
  fullName: '',
  username: '',
  usernameLower: '',
  photoURL: '',
  email: '',
  password: '',
  isCheckingUsername: false,
  isUsernameAvailable: false
};

/**
 * Check if a username is already taken in Firestore
 */
export async function checkUsernameAvailability(username) {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (clean.length < 3) {
    return { available: false, message: 'Username must be at least 3 characters (letters, numbers, underscores)' };
  }

  try {
    const q = query(collection(db, 'users'), where('usernameLower', '==', clean));
    const snap = await getDocs(q);
    if (snap.empty) {
      return { available: true, message: 'Username available' };
    } else {
      return { available: false, message: 'That username is already taken.' };
    }
  } catch (err) {
    return { available: true, message: 'Username available' };
  }
}

/**
 * Complete user profile document in Firestore
 * (Concurrent calls for the same user share one creation task so the
 *  gradual-signup data is never overwritten by the auth-state listener race.)
 */
const _profileCreationTasks = {};

export async function createOrUpdateUserProfile(user, additionalData = {}) {
  if (!additionalData.fullName && !additionalData.username && _profileCreationTasks[user.uid]) {
    // A profile creation is already in flight for this user — reuse its result
    return _profileCreationTasks[user.uid];
  }

  const task = _doCreateOrUpdateUserProfile(user, additionalData);
  _profileCreationTasks[user.uid] = task;
  try {
    return await task;
  } finally {
    delete _profileCreationTasks[user.uid];
  }
}

/**
 * Gradual-signup intent: registered right BEFORE createUserWithEmailAndPassword
 * so that whichever path creates the profile first (finalizeSignup here, or the
 * onAuthStateChanged listener firing during account creation) writes the real
 * signup data instead of defaults. Never let the auth-listener race win.
 */
let _pendingSignupIntent = null;

async function _doCreateOrUpdateUserProfile(user, additionalData = {}) {
  // Merge the pending signup intent (matched by email) into this call's data
  const intent = (_pendingSignupIntent && user.email &&
    _pendingSignupIntent.email &&
    _pendingSignupIntent.email.toLowerCase() === String(user.email).toLowerCase())
    ? _pendingSignupIntent : {};
  const data = { ...intent, ...additionalData };

  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);

  let keyData = null;
  try {
    keyData = await ensureUserKeyPair(user.uid);
  } catch (e) {
    console.warn('Could not generate crypto keys:', e);
  }

  if (!snap.exists()) {
    const profile = {
      uid: user.uid,
      email: user.email || data.email || '',
      displayName: data.fullName || user.displayName || 'HubbleNest Member',
      username: data.username || (user.email ? user.email.split('@')[0] : 'user_' + user.uid.slice(0, 5)),
      usernameLower: (data.username || (user.email ? user.email.split('@')[0] : 'user_' + user.uid.slice(0, 5))).toLowerCase(),
      photoURL: data.photoURL || user.photoURL || '',
      bio: data.bio || 'HubbleNest community member',
      publicKeyJwk: keyData ? keyData.publicKeyJwk : null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      theme: 'dark'
    };
    await setDoc(userRef, profile);
    return profile;
  } else {
    const existing = snap.data();
    // Ensure public key exists
    if (!existing.publicKeyJwk && keyData) {
      await setDoc(userRef, { publicKeyJwk: keyData.publicKeyJwk }, { merge: true });
    }
    // Signup race recovery: the listener may have created this doc with
    // defaults moments ago — apply the real gradual-signup data now.
    const patch = {};
    if (data.fullName && data.fullName !== existing.displayName) patch.displayName = data.fullName;
    if (data.username && data.username.toLowerCase() !== existing.usernameLower) {
      patch.username = data.username;
      patch.usernameLower = data.username.toLowerCase();
    }
    if (data.photoURL && !existing.photoURL) patch.photoURL = data.photoURL;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = serverTimestamp();
      await setDoc(userRef, patch, { merge: true });
      return { ...existing, ...patch };
    }
    return existing;
  }
}

/**
 * Handle Final Step of Gradual Signup: Create Account
 */
export async function finalizeSignup(onSuccess, onError) {
  try {
    const intended = {
      fullName: signupState.fullName,
      username: signupState.username,
      photoURL: signupState.photoURL,
      email: signupState.email
    };
    // Register BEFORE account creation so the auth-state listener (which can
    // fire while createUserWithEmailAndPassword is still awaiting) creates the
    // profile with the real signup data, never with defaults.
    _pendingSignupIntent = intended;

    const cred = await createUserWithEmailAndPassword(auth, signupState.email, signupState.password);
    const user = cred.user;

    const profile = await createOrUpdateUserProfile(user, intended);

    showToast(`Welcome to HubbleNest, ${signupState.fullName}!`, 'success');
    if (onSuccess) onSuccess(user, profile);
  } catch (err) {
    console.error('Signup error:', err);
    let message = 'Unable to create your account. Please try again.';
    if (err.code === 'auth/email-already-in-use') {
      message = 'That email is already connected to an account.';
    } else if (err.code === 'auth/weak-password') {
      message = 'The password is too weak. Please use at least 6 characters.';
    } else if (err.code === 'auth/invalid-email') {
      message = 'Please provide a valid email address.';
    }
    showToast(message, 'error');
    if (onError) onError(message);
  } finally {
    _pendingSignupIntent = null;
  }
}

/**
 * Login with Email and Password
 */
export async function loginWithEmail(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const userRef = doc(db, 'users', cred.user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await createOrUpdateUserProfile(cred.user);
    } else {
      // Ensure encryption key exists on this device
      ensureUserKeyPair(cred.user.uid).catch(console.warn);
    }
    showToast('Signed in successfully', 'success');
    return cred.user;
  } catch (err) {
    console.error('Login error:', err);
    let message = 'Failed to sign in. Please verify your email and password.';
    if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      message = 'Incorrect email or password. Please try again.';
    } else if (err.code === 'auth/too-many-requests') {
      message = 'Too many failed attempts. Please try again in a few minutes.';
    }
    showToast(message, 'error');
    throw new Error(message);
  }
}

/**
 * Sign In with Google
 * 
 * Tries the popup flow first. On hosts that send restrictive
 * Cross-Origin-Opener-Policy headers (e.g. GitHub Pages), the popup's
 * window reference is severed and Firebase's popup channel breaks
 * ("Cross-Origin-Opener-Policy policy would block the window.closed call"
 * followed by "INTERNAL ASSERTION FAILED: Pending promise was never set").
 * For those cases we transparently fall back to the full-page redirect
 * flow, which is immune to COOP. The redirect return is handled by the
 * onAuthStateChanged listener (profile creation included).
 */
const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment'
]);

function _isCoopPopupFailure(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  return msg.includes('INTERNAL ASSERTION FAILED') ||
         msg.includes('Cross-Origin-Opener-Policy') ||
         msg.includes('blocked the window.closed');
}

export async function loginWithGoogle() {
  let user = null;
  try {
    const res = await signInWithPopup(auth, googleProvider);
    user = res.user;
  } catch (err) {
    if (err.code === 'auth/unauthorized-domain') {
      showToast('Google sign-in is not set up for this address yet. Please use your email and password to sign in.', 'info', 6000);
      document.getElementById('login-email')?.focus();
      return null;
    }
    const shouldRedirect = REDIRECT_FALLBACK_CODES.has(err.code) || _isCoopPopupFailure(err);
    if (shouldRedirect) {
      // Full-page redirect flow — works everywhere, COOP included.
      try {
        await signInWithRedirect(auth, googleProvider);
        return null; // page navigates away; result handled on return
      } catch (redirectErr) {
        console.error('Google Sign-In redirect fallback error:', redirectErr);
        showToast('Unable to sign in with Google right now. Please use your email and password.', 'info');
        throw redirectErr;
      }
    }
    console.error('Google Sign-In error:', err);
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/user-cancelled') {
      return null; // user backed out silently
    }
    showToast('Unable to sign in with Google right now. Please use your email and password.', 'info');
    throw err;
  }
  try {
    const profile = await createOrUpdateUserProfile(user);
    showToast(`Signed in as ${user.displayName || 'User'}`, 'success');
    return { user, profile };
  } catch (err) {
    console.error('Google Sign-In profile error:', err);
    throw err;
  }
}

// Surface errors from a completed Google redirect sign-in (success itself
// is picked up by onAuthStateChanged in app.js, which creates the profile).
getRedirectResult(auth).catch((err) => {
  if (err?.code === 'auth/unauthorized-domain') {
    showToast('Google sign-in is not set up for this address yet. Please use your email and password to sign in.', 'info', 6000);
    return;
  }
  console.error('Google redirect sign-in error:', err);
  showToast('Google sign-in could not be completed. Please try again.', 'error');
});

/**
 * Send Password Reset Email
 */
export async function resetPassword(email) {
  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address.', 'error');
    return false;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Password reset link sent to your email.', 'success');
    return true;
  } catch (err) {
    console.error('Reset password error:', err);
    let msg = 'Failed to send reset email. Please try again.';
    if (err.code === 'auth/user-not-found') {
      msg = 'No account found with this email.';
    }
    showToast(msg, 'error');
    return false;
  }
}

/**
 * Sign Out
 */
export async function logoutUser() {
  try {
    await signOut(auth);
    showToast('Signed out of HubbleNest', 'info');
  } catch (err) {
    console.error('Logout error:', err);
    showToast('Failed to sign out', 'error');
  }
}
