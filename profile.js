/**
 * HubbleNest User Profile Service
 * Manages user accounts, profile details, and Cloudinary avatar updates.
 */

import { 
  db, 
  doc, 
  getDoc, 
  updateDoc, 
  serverTimestamp 
} from './firebase.js';

import { uploadToCloudinary } from './cloudinary.js';
import { showToast } from './utils.js';

/**
 * Fetch a user's public profile
 */
export async function fetchUserProfile(userId) {
  const ref = doc(db, 'users', userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}

/**
 * Update current user's profile
 */
export async function updateUserProfile(userId, { displayName, bio, photoURL }) {
  const ref = doc(db, 'users', userId);
  const updates = {
    updatedAt: serverTimestamp()
  };

  if (displayName) updates.displayName = displayName.trim();
  if (bio !== undefined) updates.bio = bio.trim();
  if (photoURL !== undefined) updates.photoURL = photoURL;

  await updateDoc(ref, updates);
  showToast('Profile updated successfully.', 'success');
  return updates;
}

/**
 * Upload profile photo to Cloudinary
 */
export async function uploadProfilePhoto(file, onProgress) {
  const res = await uploadToCloudinary(file, onProgress, 10); // max 10MB for avatar
  return res.url;
}
