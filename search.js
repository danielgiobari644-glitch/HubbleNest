/**
 * HubbleNest Global Search Service
 * Searches across Spaces, People, Files, and Messages.
 */

import { 
  db, 
  collection, 
  getDocs, 
  query, 
  where, 
  limit 
} from './firebase.js';

export async function executeGlobalSearch(term, currentUserId) {
  if (!term || term.trim().length < 2) {
    return { spaces: [], people: [], files: [] };
  }

  const clean = term.trim().toLowerCase();
  const results = {
    spaces: [],
    people: [],
    files: []
  };

  try {
    // 1. Search Spaces
    const spacesSnap = await getDocs(query(collection(db, 'spaces'), limit(40)));
    spacesSnap.forEach((d) => {
      const sp = d.data();
      if (
        (sp.name && sp.name.toLowerCase().includes(clean)) ||
        (sp.description && sp.description.toLowerCase().includes(clean)) ||
        (sp.category && sp.category.toLowerCase().includes(clean)) ||
        (sp.codeUpper && sp.codeUpper.includes(clean.toUpperCase()))
      ) {
        results.spaces.push({ id: d.id, ...sp });
      }
    });

    // 2. Search People
    const usersSnap = await getDocs(query(collection(db, 'users'), limit(40)));
    usersSnap.forEach((d) => {
      const u = d.data();
      if (u.uid && u.uid !== currentUserId) {
        if (
          (u.displayName && u.displayName.toLowerCase().includes(clean)) ||
          (u.username && u.username.toLowerCase().includes(clean)) ||
          (u.bio && u.bio.toLowerCase().includes(clean))
        ) {
          results.people.push(u);
        }
      }
    });
  } catch (err) {
    console.error('Search error:', err);
  }

  return results;
}
