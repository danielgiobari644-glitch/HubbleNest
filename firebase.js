/**
 * Firebase Modular SDK Setup for HubbleNest
 * Uses the exact provided project credentials.
 * Absolutely NO Firebase Storage is imported or initialized.
 * Includes Firestore IndexedDB Offline Persistence & Firebase Cloud Messaging (FCM).
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail, 
  updateProfile,
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { 
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp, 
  increment,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported as isMessagingSupported
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyDfMNtJ9fl_4kWdNlLcPQlhG5kuxR35CO4",
  authDomain: "hubblenest.firebaseapp.com",
  projectId: "hubblenest",
  messagingSenderId: "290433427078",
  appId: "1:290433427078:web:5d4649f35395bdae919307",
  measurementId: "G-MNWYE7T4PG"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Enable Real Firestore IndexedDB Offline Persistence
let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (e) {
  console.warn('Could not initialize multi-tab persistent cache, falling back to standard Firestore:', e);
  firestoreInstance = getFirestore(app);
}
export const db = firestoreInstance;

export const googleProvider = new GoogleAuthProvider();

// Messaging (FCM)
let messagingInstance = null;
export async function getFcmMessaging() {
  if (messagingInstance) return messagingInstance;
  try {
    const supported = await isMessagingSupported();
    if (supported) {
      messagingInstance = getMessaging(app);
      return messagingInstance;
    }
  } catch (err) {
    console.warn('FCM messaging is not supported in this environment:', err);
  }
  return null;
}

export {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove,
  getToken,
  onMessage
};
