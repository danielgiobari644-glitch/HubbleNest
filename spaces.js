/**
 * HubbleNest Space Management
 *
 * Creates, manages, queries, and secures Spaces.
 * - Joining is INSTANT: anyone with the Space code becomes a member right
 *   away — no request, no admin approval step.
 * - Space admins add members straight from their contacts and can remove
 *   members from the Members tab.
 * - Every flow here is a real Firestore write; nothing is simulated.
 */

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  increment
} from './firebase.js';

import { showToast } from './utils.js';
import { sendPushToUser } from './notifications.js';

/**
 * Generate a short, unique, human-friendly Space Code
 * Example: HN-7K4P92
 */
export function generateSpaceCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `HN-${code}`;
}

/**
 * Create a new Space
 */
export async function createSpace(user, spaceData) {
  if (!user) throw new Error('You must be signed in to create a Space.');
  if (!spaceData.name || spaceData.name.trim().length < 2) {
    throw new Error('Space name must be at least 2 characters.');
  }

  const spaceRef = doc(collection(db, 'spaces'));
  const spaceId = spaceRef.id;
  const spaceCode = generateSpaceCode();

  const newSpace = {
    id: spaceId,
    name: spaceData.name.trim(),
    nameLower: spaceData.name.trim().toLowerCase(),
    description: spaceData.description ? spaceData.description.trim() : '',
    imageURL: spaceData.imageURL || '',
    category: spaceData.category || 'Community',
    type: spaceData.type === 'temporary' ? 'temporary' : 'permanent',
    expiresAt: spaceData.type === 'temporary' && spaceData.expiresAt ? new Date(spaceData.expiresAt) : null,
    code: spaceCode,
    codeUpper: spaceCode.toUpperCase(),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    memberCount: 1,
    settings: {
      whoCanPost: spaceData.whoCanPost || 'all',
      whoCanUpload: spaceData.whoCanUpload || 'all',
      maxFileSizeMB: Number(spaceData.maxFileSizeMB) || 100
    }
  };

  await setDoc(spaceRef, newSpace);

  // Add creator as Admin member
  const memberRef = doc(db, 'spaces', spaceId, 'members', user.uid);
  await setDoc(memberRef, {
    userId: user.uid,
    displayName: user.displayName || 'HubbleNest Member',
    username: user.username || 'member',
    photoURL: user.photoURL || '',
    role: 'admin',
    joinedAt: serverTimestamp()
  });

  return newSpace;
}

/**
 * Query spaces where the user is a member.
 * Only REAL memberships are returned — the app no longer invents or
 * auto-joins anything.
 */
export async function fetchUserSpaces(userId) {
  try {
    const q = query(collection(db, 'spaces'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const spaces = [];

    for (const d of snap.docs) {
      const sp = d.data();
      if (!userId) continue;
      const memberDoc = await getDoc(doc(db, 'spaces', d.id, 'members', userId));
      if (memberDoc.exists()) {
        spaces.push({
          ...sp,
          id: d.id,
          userRole: memberDoc.data().role || 'member'
        });
      }
    }

    return spaces;
  } catch (err) {
    console.error('Fetch user spaces error:', err);
    return [];
  }
}

/**
 * Find Space by Code (e.g., HN-7K4P92)
 */
export async function findSpaceByCode(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) return null;

  const q = query(collection(db, 'spaces'), where('codeUpper', '==', cleanCode));
  const snap = await getDocs(q);
  if (snap.empty) {
    return null;
  }
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * Membership state in a space: 'admin' | 'member' | 'none'
 */
export async function getMembershipState(spaceId, userId) {
  if (!userId || !spaceId) return 'none';
  try {
    const memberDoc = await getDoc(doc(db, 'spaces', spaceId, 'members', userId));
    if (memberDoc.exists()) {
      return memberDoc.data().role === 'admin' ? 'admin' : 'member';
    }
    return 'none';
  } catch (err) {
    console.error('Get membership state error:', err);
    return 'none';
  }
}

/**
 * Create a membership document for one member (shared by self-join and
 * admin-add — the rules require either isUser(memberId) or space admin).
 */
export async function addMemberToSpace(spaceId, memberProfile, role = 'member') {
  if (!spaceId || !memberProfile?.uid) throw new Error('Missing member or Space.');
  const memberRef = doc(db, 'spaces', spaceId, 'members', memberProfile.uid);
  const existing = await getDoc(memberRef);
  if (existing.exists()) return { already: true };

  await setDoc(memberRef, {
    userId: memberProfile.uid,
    displayName: memberProfile.displayName || 'Member',
    username: memberProfile.username || 'member',
    photoURL: memberProfile.photoURL || '',
    role,
    joinedAt: serverTimestamp()
  });

  try {
    await updateDoc(doc(db, 'spaces', spaceId), { memberCount: increment(1) });
  } catch (e) { /* counter drift is non-fatal */ }
  return { already: false };
}

/**
 * Remove a member from a Space (admin action).
 */
export async function removeSpaceMember(spaceId, memberUserId) {
  if (!spaceId || !memberUserId) throw new Error('Missing member or Space.');
  await deleteDoc(doc(db, 'spaces', spaceId, 'members', memberUserId));
  try {
    await updateDoc(doc(db, 'spaces', spaceId), { memberCount: increment(-1) });
  } catch (e) { /* counter drift is non-fatal */ }
}

/**
 * INSTANT join with a Space code — no request, no approval.
 * The code IS the invitation: whoever holds it and signs in becomes a
 * member the moment they press Join.
 */
export async function joinSpaceByCode(foundSpace, userProfile) {
  if (!foundSpace?.id) throw new Error('Space not found.');
  if (!userProfile || !userProfile.uid) {
    throw new Error('You must be signed in to join a Space.');
  }

  const res = await addMemberToSpace(foundSpace.id, userProfile, 'member');

  if (!res.already) {
    // Notify the space creator that their Space grew (best-effort).
    try {
      const spaceSnap = await getDoc(doc(db, 'spaces', foundSpace.id));
      if (spaceSnap.exists() && spaceSnap.data().createdBy && spaceSnap.data().createdBy !== userProfile.uid) {
        await setDoc(doc(collection(db, 'notifications')), {
          userId: spaceSnap.data().createdBy,
          type: 'space_joined',
          title: 'New member joined',
          body: `${userProfile.displayName || 'A member'} joined "${spaceSnap.data().name}" with your Space code.`,
          spaceId: foundSpace.id,
          spaceName: spaceSnap.data().name,
          memberId: userProfile.uid,
          isRead: false,
          createdAt: serverTimestamp()
        }).catch(() => {});
        sendPushToUser(spaceSnap.data().createdBy, {
          title: 'New member joined',
          body: `${userProfile.displayName || 'A member'} joined "${spaceSnap.data().name}" with your Space code.`,
          tag: 'space_joined'
        }).catch(() => {});
      }
    } catch (e) { /* notification is best-effort */ }

    showToast(`Welcome to ${foundSpace.name || 'the Space'}! You are a member now.`, 'success');
  }
  return res;
}

/**
 * Extend expiration for a temporary space (Admin Action)
 */
export async function extendSpaceExpiration(spaceId, additionalDays = 7) {
  const spaceRef = doc(db, 'spaces', spaceId);
  const snap = await getDoc(spaceRef);
  if (!snap.exists()) throw new Error('Space not found');

  const currentExp = snap.data().expiresAt ? snap.data().expiresAt.toDate() : new Date();
  const base = currentExp > new Date() ? currentExp : new Date();
  const newExp = new Date(base.getTime() + additionalDays * 24 * 60 * 60 * 1000);

  await updateDoc(spaceRef, {
    expiresAt: newExp
  });

  showToast(`Space expiration extended by ${additionalDays} days.`, 'success');
  return newExp;
}

/**
 * Update Space Settings (Admin Action)
 */
export async function updateSpaceSettings(spaceId, updates) {
  const spaceRef = doc(db, 'spaces', spaceId);
  await updateDoc(spaceRef, {
    ...updates,
    updatedAt: serverTimestamp()
  });
  showToast('Space settings updated successfully.', 'success');
}

/**
 * Update Space Cover Image (Admin Action)
 */
export async function updateSpaceCover(spaceId, coverUrl) {
  const spaceRef = doc(db, 'spaces', spaceId);
  await updateDoc(spaceRef, {
    imageURL: coverUrl,
    updatedAt: serverTimestamp()
  });
  showToast('Space cover image updated!', 'success');
}

/**
 * Delete a Space (Admin Action)
 */
export async function deleteSpace(spaceId) {
  const spaceRef = doc(db, 'spaces', spaceId);
  await deleteDoc(spaceRef);
  showToast('Space has been deleted.', 'info');
}
