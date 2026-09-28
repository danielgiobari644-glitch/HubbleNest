/**
 * HubbleNest Space Links Directory
 */

import { 
  db, 
  collection, 
  doc, 
  addDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp 
} from './firebase.js';

import { showToast } from './utils.js';

let activeLinksUnsubscribe = null;

export function subscribeToSpaceLinks(spaceId, onLinks) {
  if (activeLinksUnsubscribe) {
    activeLinksUnsubscribe();
    activeLinksUnsubscribe = null;
  }

  const q = query(
    collection(db, 'spaces', spaceId, 'links'),
    orderBy('createdAt', 'desc')
  );

  activeLinksUnsubscribe = onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => {
      list.push({ id: d.id, ...d.data() });
    });
    onLinks(list);
  }, (err) => {
    console.error('Links listener error:', err);
  });

  return activeLinksUnsubscribe;
}

export async function addCustomLink(spaceId, userProfile, { url, title }) {
  if (!url || !url.trim()) throw new Error('Please enter a valid URL.');
  let cleanUrl = url.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = 'https://' + cleanUrl;
  }

  let domain = cleanUrl;
  try {
    domain = new URL(cleanUrl).hostname.replace(/^www\./, '');
  } catch (e) {
    throw new Error('Invalid URL format.');
  }

  const linkData = {
    spaceId: spaceId,
    url: cleanUrl,
    title: title ? title.trim() : domain,
    domain: domain,
    senderName: userProfile.displayName || 'Member',
    senderId: userProfile.uid,
    createdAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, 'spaces', spaceId, 'links'), linkData);
  showToast('Link added to Space directory.', 'success');
  return { id: docRef.id, ...linkData };
}

export async function deleteSpaceLink(spaceId, linkId) {
  await deleteDoc(doc(db, 'spaces', spaceId, 'links', linkId));
  showToast('Link removed.', 'info');
}
