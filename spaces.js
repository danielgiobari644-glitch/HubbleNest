/**
 * HubbleNest Space Management
 * 
 * Creates, manages, queries, and secures Spaces.
 * Handles Space Codes (e.g., HN-7K4P92), Join Requests, Admin Approval, and Expiration.
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

export const OFFICIAL_SUPPORT_CODE = 'HN-JM96Q7';
export const OFFICIAL_SUPPORT_SPACE_ID = 'hubblenest-support';

/**
 * Ensures the official HubbleNest Support & Community Space exists in Firestore.
 */
export async function ensureOfficialSupportSpace() {
  try {
    const spaceRef = doc(db, 'spaces', OFFICIAL_SUPPORT_SPACE_ID);
    const snap = await getDoc(spaceRef);
    if (snap.exists()) {
      return snap.data();
    }

    // Also check if any space already has this code
    const q = query(collection(db, 'spaces'), where('codeUpper', '==', OFFICIAL_SUPPORT_CODE));
    const codeSnap = await getDocs(q);
    if (!codeSnap.empty) {
      return codeSnap.docs[0].data();
    }

    // Create the official support space
    const officialSpace = {
      id: OFFICIAL_SUPPORT_SPACE_ID,
      name: 'HubbleNest Help & Community',
      nameLower: 'hubblenest help & community',
      description: 'Have a question about HubbleNest? Need help or want to share feedback? This is the place to ask.',
      imageURL: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
      category: 'Official Support',
      type: 'permanent',
      expiresAt: null,
      code: OFFICIAL_SUPPORT_CODE,
      codeUpper: OFFICIAL_SUPPORT_CODE,
      isOfficialSupport: true,
      createdBy: 'hubblenest-team',
      createdAt: serverTimestamp(),
      memberCount: 1,
      settings: {
        whoCanPost: 'all',
        whoCanUpload: 'all',
        maxFileSizeMB: 100
      }
    };

    await setDoc(spaceRef, officialSpace);
    return officialSpace;
  } catch (err) {
    console.warn('ensureOfficialSupportSpace warning:', err);
    return {
      id: OFFICIAL_SUPPORT_SPACE_ID,
      name: 'HubbleNest Help & Community',
      description: 'Have a question about HubbleNest? Need help or want to share feedback? This is the place to ask.',
      imageURL: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
      category: 'Official Support',
      type: 'permanent',
      code: OFFICIAL_SUPPORT_CODE,
      codeUpper: OFFICIAL_SUPPORT_CODE,
      isOfficialSupport: true,
      memberCount: 1
    };
  }
}

/**
 * Automatically & idempotently ensures a user is a member of the compulsory HubbleNest Support space.
 * If user is not already a member -> creates membership.
 * If user is already a member -> does nothing.
 */
export async function ensureUserSupportMembership(user) {
  if (!user || (!user.uid && !user.id)) return null;
  const uid = user.uid || user.id;

  try {
    const space = await ensureOfficialSupportSpace();
    const spaceId = space?.id || OFFICIAL_SUPPORT_SPACE_ID;

    const memberRef = doc(db, 'spaces', spaceId, 'members', uid);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      await setDoc(memberRef, {
        userId: uid,
        displayName: user.displayName || 'HubbleNest Member',
        username: user.username || 'member',
        photoURL: user.photoURL || '',
        role: 'member',
        isOfficialSupport: true,
        joinedAt: serverTimestamp()
      });

      try {
        await updateDoc(doc(db, 'spaces', spaceId), {
          memberCount: increment(1)
        });
      } catch (e) {}
    }

    return space;
  } catch (err) {
    console.warn('ensureUserSupportMembership warning:', err);
    return null;
  }
}

/**
 * Query spaces where the user is an approved member
 */
export async function fetchUserSpaces(userId, userProfile) {
  try {
    // Automatically ensure the compulsory support space membership
    if (userId) {
      await ensureUserSupportMembership(userProfile || { uid: userId });
    }

    const q = query(collection(db, 'spaces'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const spaces = [];
    let hasOfficialSupport = false;

    for (const d of snap.docs) {
      const sp = d.data();
      const isOfficial = sp.codeUpper === OFFICIAL_SUPPORT_CODE || sp.isOfficialSupport === true || sp.id === OFFICIAL_SUPPORT_SPACE_ID;

      if (isOfficial) {
        hasOfficialSupport = true;
        spaces.push({
          ...sp,
          isOfficialSupport: true,
          userRole: sp.createdBy === userId ? 'admin' : 'member'
        });
        continue;
      }

      if (userId) {
        const memberDoc = await getDoc(doc(db, 'spaces', sp.id, 'members', userId));
        if (memberDoc.exists()) {
          spaces.push({
            ...sp,
            userRole: memberDoc.data().role || 'member'
          });
        }
      }
    }

    // If official support space was not found in spaces collection snapshot, ensure and prepend it
    if (!hasOfficialSupport) {
      const officialSp = await ensureOfficialSupportSpace();
      spaces.unshift({
        ...officialSp,
        isOfficialSupport: true,
        userRole: 'member'
      });
    } else {
      // Sort so official support space is ALWAYS at the very top
      spaces.sort((a, b) => {
        if (a.isOfficialSupport || a.codeUpper === OFFICIAL_SUPPORT_CODE) return -1;
        if (b.isOfficialSupport || b.codeUpper === OFFICIAL_SUPPORT_CODE) return 1;
        return 0;
      });
    }

    return spaces;
  } catch (err) {
    console.error('Fetch user spaces error:', err);
    // Return at least the official support space so the user never gets an empty/broken dashboard
    return [{
      id: OFFICIAL_SUPPORT_SPACE_ID,
      name: 'HubbleNest Help & Community',
      description: 'Have a question about HubbleNest? Need help or want to share feedback? This is the place to ask.',
      imageURL: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
      category: 'Official Support',
      type: 'permanent',
      code: OFFICIAL_SUPPORT_CODE,
      codeUpper: OFFICIAL_SUPPORT_CODE,
      isOfficialSupport: true,
      userRole: 'member',
      memberCount: 1
    }];
  }
}

/**
 * Find Space by Code (e.g., HN-7K4P92)
 */
export async function findSpaceByCode(code) {
  const cleanCode = code.trim().toUpperCase();

  // If looking for the compulsory support space, ensure it exists
  if (cleanCode === OFFICIAL_SUPPORT_CODE) {
    const supportSpace = await ensureOfficialSupportSpace();
    return supportSpace;
  }

  const q = query(collection(db, 'spaces'), where('codeUpper', '==', cleanCode));
  const snap = await getDocs(q);
  if (snap.empty) {
    return null;
  }
  return snap.docs[0].data();
}

/**
 * Get user membership state in a space: 'admin' | 'member' | 'pending' | 'none'
 */
export async function getMembershipState(spaceId, userId) {
  if (!userId) return 'none';
  try {
    // Check if this space is the compulsory official support space
    if (spaceId === OFFICIAL_SUPPORT_SPACE_ID) {
      return 'member';
    }

    const spaceRef = doc(db, 'spaces', spaceId);
    const spaceSnap = await getDoc(spaceRef);
    if (spaceSnap.exists()) {
      const spData = spaceSnap.data();
      if (spData.codeUpper === OFFICIAL_SUPPORT_CODE || spData.isOfficialSupport === true) {
        return spData.createdBy === userId ? 'admin' : 'member';
      }
    }

    const memberDoc = await getDoc(doc(db, 'spaces', spaceId, 'members', userId));
    if (memberDoc.exists()) {
      return memberDoc.data().role === 'admin' ? 'admin' : 'member';
    }

    const reqDoc = await getDoc(doc(db, 'spaces', spaceId, 'joinRequests', userId));
    if (reqDoc.exists()) {
      const data = reqDoc.data();
      if (data.status === 'pending') return 'pending';
      if (data.status === 'declined') return 'declined';
    }

    return 'none';
  } catch (err) {
    console.error('Get membership state error:', err);
    return 'none';
  }
}

/**
 * Submit request to join a Space
 */
export async function requestToJoinSpace(spaceId, userProfile) {
  if (!userProfile || !userProfile.uid) {
    throw new Error('You must be signed in to request membership.');
  }

  const reqRef = doc(db, 'spaces', spaceId, 'joinRequests', userProfile.uid);
  const existing = await getDoc(reqRef);

  if (existing.exists() && existing.data().status === 'pending') {
    showToast('Your join request is already pending administrator approval.', 'info');
    return false;
  }

  const requestData = {
    userId: userProfile.uid,
    displayName: userProfile.displayName || 'Applicant',
    username: userProfile.username || 'user',
    photoURL: userProfile.photoURL || '',
    bio: userProfile.bio || '',
    status: 'pending',
    requestedAt: serverTimestamp()
  };

  await setDoc(reqRef, requestData);

  // Notify space creator / admins
  try {
    const spaceSnap = await getDoc(doc(db, 'spaces', spaceId));
    if (spaceSnap.exists()) {
      const space = spaceSnap.data();
      await setDoc(doc(collection(db, 'notifications')), {
        userId: space.createdBy,
        type: 'join_request',
        title: 'New Join Request',
        body: `${userProfile.displayName} requested to join "${space.name}"`,
        spaceId: spaceId,
        spaceName: space.name,
        requesterId: userProfile.uid,
        isRead: false,
        createdAt: serverTimestamp()
      });

      // Deliver a real background push (works even when HubbleNest is closed)
      sendPushToUser(space.createdBy, {
        title: 'New Join Request',
        body: `${userProfile.displayName} requested to join "${space.name}"`,
        tag: 'join_request'
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('Could not post admin notification', e);
  }

  showToast('Join request sent! You will be notified once approved.', 'success');
  return true;
}

/**
 * Approve Join Request (Admin Action)
 */
export async function approveJoinRequest(spaceId, applicant) {
  // Add to members
  const memberRef = doc(db, 'spaces', spaceId, 'members', applicant.userId);
  await setDoc(memberRef, {
    userId: applicant.userId,
    displayName: applicant.displayName || 'Member',
    username: applicant.username || 'member',
    photoURL: applicant.photoURL || '',
    role: 'member',
    joinedAt: serverTimestamp()
  });

  // Delete/Update request
  await updateDoc(doc(db, 'spaces', spaceId, 'joinRequests', applicant.userId), {
    status: 'accepted'
  });

  // Increment member count
  await updateDoc(doc(db, 'spaces', spaceId), {
    memberCount: increment(1)
  });

  // Send notification to approved member
  try {
    const spaceSnap = await getDoc(doc(db, 'spaces', spaceId));
    const spaceName = spaceSnap.exists() ? spaceSnap.data().name : 'the Space';
    await setDoc(doc(collection(db, 'notifications')), {
      userId: applicant.userId,
      type: 'request_accepted',
      title: 'Join Request Approved!',
      body: `You are now a member of "${spaceName}".`,
      spaceId: spaceId,
      spaceName: spaceName,
      isRead: false,
      createdAt: serverTimestamp()
    });

    // Deliver a real background push (works even when HubbleNest is closed)
    sendPushToUser(applicant.userId, {
      title: 'Join Request Approved!',
      body: `You are now a member of "${spaceName}".`,
      tag: 'request_accepted'
    }).catch(() => {});
  } catch (e) {
    console.warn('Could not notify member of approval', e);
  }

  showToast(`Approved ${applicant.displayName} into the Space`, 'success');
}

/**
 * Decline Join Request (Admin Action)
 */
export async function declineJoinRequest(spaceId, applicant) {
  await updateDoc(doc(db, 'spaces', spaceId, 'joinRequests', applicant.userId), {
    status: 'declined'
  });

  // Notify member
  try {
    const spaceSnap = await getDoc(doc(db, 'spaces', spaceId));
    const spaceName = spaceSnap.exists() ? spaceSnap.data().name : 'the Space';
    await setDoc(doc(collection(db, 'notifications')), {
      userId: applicant.userId,
      type: 'request_declined',
      title: 'Join Request Update',
      body: `Your request to join "${spaceName}" was declined by an administrator.`,
      spaceId: spaceId,
      spaceName: spaceName,
      isRead: false,
      createdAt: serverTimestamp()
    });

    // Deliver a real background push (works even when HubbleNest is closed)
    sendPushToUser(applicant.userId, {
      title: 'Join Request Update',
      body: `Your request to join "${spaceName}" was declined by an administrator.`,
      tag: 'request_declined'
    }).catch(() => {});
  } catch (e) {
    console.warn(e);
  }

  showToast(`Declined join request from ${applicant.displayName}`, 'info');
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
