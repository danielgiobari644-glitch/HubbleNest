/**
 * HubbleNest File Library & Cloudinary Asset Management
 * 
 * All media is uploaded directly to Cloudinary.
 * Firestore stores strictly metadata references.
 * Absolutely NO Firebase Storage is used.
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

import { uploadToCloudinary, getFileCategory, formatBytes } from './cloudinary.js';
import { showToast } from './utils.js';

let activeFilesUnsubscribe = null;

/**
 * Subscribe to a space's files in realtime
 */
export function subscribeToSpaceFiles(spaceId, onFilesUpdate) {
  if (activeFilesUnsubscribe) {
    activeFilesUnsubscribe();
    activeFilesUnsubscribe = null;
  }

  const q = query(
    collection(db, 'spaces', spaceId, 'files'),
    orderBy('createdAt', 'desc')
  );

  activeFilesUnsubscribe = onSnapshot(q, (snapshot) => {
    const files = [];
    snapshot.forEach((d) => {
      files.push({ id: d.id, ...d.data() });
    });
    onFilesUpdate(files);
  }, (err) => {
    console.error('Files listener error:', err);
  });

  return activeFilesUnsubscribe;
}

/**
 * Upload a file to Cloudinary and record its metadata in Firestore
 */
export async function uploadSpaceFile(spaceId, userProfile, file, onProgress, maxFileSizeMB = 100) {
  if (!userProfile) throw new Error('Must be signed in to upload files.');

  // 1. Upload to Cloudinary with real progress tracking
  const result = await uploadToCloudinary(file, onProgress, maxFileSizeMB);

  // 2. Save metadata to Firestore
  const category = getFileCategory(file);
  const fileMeta = {
    spaceId: spaceId,
    name: result.originalFilename || file.name,
    size: result.bytes || file.size,
    type: file.type || 'application/octet-stream',
    extension: (file.name.split('.').pop() || '').toLowerCase(),
    category: category,
    cloudinaryUrl: result.url,
    publicId: result.publicId,
    resourceType: result.resourceType,
    uploadedBy: userProfile.uid,
    uploaderName: userProfile.displayName || 'Member',
    uploaderPhoto: userProfile.photoURL || '',
    createdAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, 'spaces', spaceId, 'files'), fileMeta);
  showToast(`File "${file.name}" uploaded successfully.`, 'success');
  return { id: docRef.id, ...fileMeta };
}

/**
 * Delete a file record from Firestore (uploader or admin)
 */
export async function deleteSpaceFile(spaceId, fileId) {
  try {
    await deleteDoc(doc(db, 'spaces', spaceId, 'files', fileId));
    showToast('File record removed from Space.', 'info');
  } catch (err) {
    console.error('Delete file error:', err);
    showToast('Could not delete file', 'error');
  }
}
