/* =============================================================
   LinkRoom — Application Configuration
   Fill in YOUR Supabase publishable (anon) key before deploying.
   The service-role key MUST NEVER be exposed in frontend code.
   ============================================================= */

window.LINKROOM_CONFIG = {
  // --- Supabase ---
  supabase: {
    url: 'https://tfnkszxmojqnhrkejmye.supabase.co',
    // Replace with your project's PUBLISHABLE anon key.
    // Find it in: Supabase dashboard → Project Settings → API → "anon public"
    anonKey: 'YOUR_SUPABASE_ANON_KEY_HERE'
  },

  // --- Cloudinary (unsigned uploads only; NEVER expose API Secret) ---
  cloudinary: {
    cloudName:   'l5inkfvz',
    uploadPreset:'LinkRoom'
  },

  // --- Supabase Storage ---
  storage: {
    bucket: 'linkroom-files'
  },

  // --- App identity (for QR join URLs) ---
  app: {
    name: 'LinkRoom',
    // Replace with your deployed domain in production.
    url:  window.location.origin,
    // File upload limits
    maxFileSizeMb: 500,
    allowedTypes: ['image','video','audio','application','text']  // broad allow-list, refined per-room
  }
};
