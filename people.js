/**
 * HubbleNest People Directory Service
 * 
 * Allows users to discover fellow members, view public profiles,
 * and initiate privacy-respecting chat requests.
 */

import { 
  db, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  limit 
} from './firebase.js';

/**
 * Fetch all searchable people in HubbleNest
 * Strictly limits to safe public profile fields.
 */
export async function fetchPeopleDirectory(currentUserId, maxCount = 60) {
  try {
    const q = query(collection(db, 'users'), limit(maxCount));
    const snap = await getDocs(q);
    const people = [];

    snap.forEach((d) => {
      const u = d.data();
      if (u.uid && u.uid !== currentUserId) {
        people.push({
          uid: u.uid,
          displayName: u.displayName || 'HubbleNest Member',
          username: u.username || 'member',
          photoURL: u.photoURL || '',
          bio: u.bio || 'HubbleNest community member',
          createdAt: u.createdAt || null
        });
      }
    });

    // Sort alphabetically by displayName
    people.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    return people;
  } catch (err) {
    console.error('Failed to fetch people directory:', err);
    return [];
  }
}

/**
 * Search people by name or username
 */
export async function searchPeopleDirectory(term, currentUserId) {
  if (!term || term.trim().length < 1) {
    return fetchPeopleDirectory(currentUserId);
  }

  const clean = term.trim().toLowerCase();
  const all = await fetchPeopleDirectory(currentUserId, 100);
  
  return all.filter(p => {
    return (
      (p.displayName && p.displayName.toLowerCase().includes(clean)) ||
      (p.username && p.username.toLowerCase().includes(clean)) ||
      (p.bio && p.bio.toLowerCase().includes(clean))
    );
  });
}

/**
 * Fetch public profile card for a single user
 */
export async function fetchPublicUserCard(userId) {
  try {
    const ref = doc(db, 'users', userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;

    const u = snap.data();
    return {
      uid: u.uid,
      displayName: u.displayName || 'HubbleNest Member',
      username: u.username || 'member',
      photoURL: u.photoURL || '',
      bio: u.bio || 'HubbleNest community member',
      createdAt: u.createdAt || null
    };
  } catch (err) {
    console.error('Failed to fetch public user card:', err);
    return null;
  }
}
