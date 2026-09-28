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
 */
export async function createOrUpdateUserProfile(user, additionalData = {}) {
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
      email: user.email || additionalData.email || '',
      displayName: additionalData.fullName || user.displayName || 'HubbleNest Member',
      username: additionalData.username || (user.email ? user.email.split('@')[0] : 'user_' + user.uid.slice(0, 5)),
      usernameLower: (additionalData.username || (user.email ? user.email.split('@')[0] : 'user_' + user.uid.slice(0, 5))).toLowerCase(),
      photoURL: additionalData.photoURL || user.photoURL || '',
      bio: additionalData.bio || 'HubbleNest community member',
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
    return existing;
  }
}

/**
 * Handle Final Step of Gradual Signup: Create Account
 */
export async function finalizeSignup(onSuccess, onError) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, signupState.email, signupState.password);
    const user = cred.user;

    const profile = await createOrUpdateUserProfile(user, {
      fullName: signupState.fullName,
      username: signupState.username,
      photoURL: signupState.photoURL,
      email: signupState.email
    });

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
 */
export async function loginWithGoogle() {
  try {
    const res = await signInWithPopup(auth, googleProvider);
    const user = res.user;
    const profile = await createOrUpdateUserProfile(user);
    showToast(`Signed in as ${user.displayName || 'User'}`, 'success');
    return { user, profile };
  } catch (err) {
    if (err.code === 'auth/unauthorized-domain') {
      const currentHost = window.location.hostname;
      showToast(`Domain "${currentHost}" must be added to Firebase Console -> Authentication -> Authorized domains. Please use Email/Password login below in the meantime!`, 'warning', 7000);
      document.getElementById('login-email')?.focus();
      return null;
    }
    console.error('Google Sign-In error:', err);
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Could not complete Google Sign-In. Please sign in with Email & Password.', 'error');
    }
    throw err;
  }
}

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
