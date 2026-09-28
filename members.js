/**
 * HubbleNest Member & Role Management
 * Handles active space members and pending join requests.
 */

import { 
  db, 
  collection, 
  doc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  increment 
} from './firebase.js';

import { showToast } from './utils.js';

/**
 * Subscribe to approved space members
 */
export function subscribeToSpaceMembers(spaceId, onMembers) {
  const membersRef = collection(db, 'spaces', spaceId, 'members');
  return onSnapshot(membersRef, (snap) => {
    const list = [];
    snap.forEach((d) => {
      list.push({ id: d.id, ...d.data() });
    });
    // Sort admins first, then alphabetical
    list.sort((a, b) => {
      if (a.role === 'admin' && b.role !== 'admin') return -1;
      if (a.role !== 'admin' && b.role === 'admin') return 1;
      return (a.displayName || '').localeCompare(b.displayName || '');
    });
    onMembers(list);
  }, (err) => {
    console.error('Members listener error:', err);
  });
}

/**
 * Subscribe to pending join requests (Admin only)
 */
export function subscribeToJoinRequests(spaceId, onRequests) {
  const q = query(
    collection(db, 'spaces', spaceId, 'joinRequests'),
    where('status', '==', 'pending')
  );

  return onSnapshot(q, (snap) => {
    const requests = [];
    snap.forEach((d) => {
      requests.push({ id: d.id, ...d.data() });
    });
    onRequests(requests);
  }, (err) => {
    console.error('Join requests listener error:', err);
  });
}

/**
 * Change member role (e.g. promote to admin or demote to member)
 */
export async function updateMemberRole(spaceId, memberUserId, newRole) {
  const memberRef = doc(db, 'spaces', spaceId, 'members', memberUserId);
  await updateDoc(memberRef, { role: newRole });
  showToast(`Updated member role to ${newRole}.`, 'success');
}

/**
 * Remove member from Space (Admin Action)
 */
export async function removeMemberFromSpace(spaceId, memberUserId) {
  const memberRef = doc(db, 'spaces', spaceId, 'members', memberUserId);
  await deleteDoc(memberRef);

  // Decrement count
  await updateDoc(doc(db, 'spaces', spaceId), {
    memberCount: increment(-1)
  });

  showToast('Member removed from Space.', 'info');
}
