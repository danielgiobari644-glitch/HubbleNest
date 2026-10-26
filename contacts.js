/**
 * HubbleNest Contacts Service
 *
 * A contact is a member YOU added by their username. Your People page shows
 * ONLY your contacts. Contacts chat instantly — no request, no approval:
 * opening a chat with a contact creates the encrypted conversation on the
 * spot (asymmetry of the old request flow is gone for contacts).
 *
 * Data model (Firestore `contacts` collection):
 *   doc id  = `${ownerUid}_${contactUid}`   (deterministic, one per pair/direction)
 *   fields  = { ownerUid, uid, displayName, username, photoURL, addedAt }
 *
 * Every flow here is a real Firestore write — nothing simulated.
 */

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  limit
} from './firebase.js';

/**
 * Deterministic contact doc id for an owner→contact pair.
 */
export function contactDocId(ownerUid, contactUid) {
  return `${ownerUid}_${contactUid}`;
}

/**
 * Subscribe (realtime) to the signed-in user's contacts.
 * @returns unsubscribe function
 */
export function subscribeToContacts(ownerUid, onUpdate, onError = null) {
  const q = query(
    collection(db, 'contacts'),
    where('ownerUid', '==', ownerUid),
    limit(200)
  );
  return onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => {
      const c = d.data();
      list.push({ id: d.id, ...c });
    });
    list.sort((a, b) =>
      String(a.displayName || '').localeCompare(String(b.displayName || '')));
    onUpdate(list);
  }, (err) => {
    console.error('Contacts listener error:', err);
    if (typeof onError === 'function') onError(err);
  });
}

/**
 * Is this member in the owner's contacts?
 */
export async function isContact(ownerUid, contactUid) {
  if (!ownerUid || !contactUid || ownerUid === contactUid) return false;
  try {
    const snap = await getDoc(doc(db, 'contacts', contactDocId(ownerUid, contactUid)));
    return snap.exists();
  } catch (err) {
    console.warn('isContact check failed:', err?.code || err);
    return false;
  }
}

/**
 * Add a member to the owner's contacts.
 * @param {object} ownerProfile  signed-in user's profile {uid, displayName, username, photoURL}
 * @param {object} peerProfile   fetched public card of the member to add
 */
export async function addContact(ownerProfile, peerProfile) {
  if (!ownerProfile?.uid || !peerProfile?.uid) throw new Error('Missing member to add.');
  if (ownerProfile.uid === peerProfile.uid) throw new Error('You are already your own contact.');

  const id = contactDocId(ownerProfile.uid, peerProfile.uid);
  const ref = doc(db, 'contacts', id);

  const existing = await getDoc(ref);
  if (existing.exists()) return { already: true };

  await setDoc(ref, {
    ownerUid: ownerProfile.uid,
    uid: peerProfile.uid,
    displayName: peerProfile.displayName || 'HubbleNest Member',
    username: peerProfile.username || 'member',
    usernameLower: String(peerProfile.username || 'member').toLowerCase(),
    photoURL: peerProfile.photoURL || '',
    addedAt: serverTimestamp()
  });
  return { already: false };
}

/**
 * Remove a member from the owner's contacts.
 */
export async function removeContact(ownerUid, contactUid) {
  if (!ownerUid || !contactUid) throw new Error('Missing member to remove.');
  await deleteDoc(doc(db, 'contacts', contactDocId(ownerUid, contactUid)));
}

/**
 * Find exactly one member by their username (case-insensitive).
 * Returns a safe public card or null when no member has that username.
 */
export async function findUserByUsername(username) {
  const clean = String(username || '').trim().toLowerCase().replace(/^@/, '');
  if (!clean) return null;
  const q = query(collection(db, 'users'), where('usernameLower', '==', clean), limit(5));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const u = snap.docs[0].data();
  return {
    uid: u.uid || snap.docs[0].id,
    displayName: u.displayName || 'HubbleNest Member',
    username: u.username || u.usernameLower || clean,
    usernameLower: u.usernameLower || clean,
    photoURL: u.photoURL || '',
    bio: u.bio || 'HubbleNest community member'
  };
}
