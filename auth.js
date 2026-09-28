/* =============================================================
   LinkRoom — Auth page logic (index.html)
   Handles: email/password sign-in + sign-up + Google OAuth.
   Redirects to app.html on success.
   ============================================================= */

window.AuthPage = (function () {
  'use strict';

  let mode = 'signin'; // or 'signup'

  function init() {
    // Apply saved theme
    const saved = Utils.ls.get('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);

    // Year footer
    const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();

    // If already signed in & has profile, go straight to app
    LR.getSession().then(({ data: { session } }) => {
      if (session) {
        // Check profile, if exists go to app
        LR.getCurrentProfile().then(prof => {
          if (prof && prof.full_name && prof.username) {
            window.location.replace('app.html');
          }
        });
      }
    }).catch(() => {});

    const form     = document.getElementById('authForm');
    const submit   = document.getElementById('authSubmit');
    const switchA  = document.getElementById('switchMode');
    const google   = document.getElementById('googleBtn');
    const nameF    = document.getElementById('nameField');
    const userF    = document.getElementById('usernameField');
    const titleEl  = document.getElementById('authTitle');
    const subEl    = document.getElementById('authSubtitle');
    const switchP  = document.getElementById('authSwitch');
    const toggle   = document.getElementById('themeToggle');

    if (toggle) toggle.addEventListener('click', () => {
      const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      Utils.ls.set('theme', t);
    });

    if (switchA) switchA.addEventListener('click', (e) => {
      e.preventDefault();
      mode = mode === 'signin' ? 'signup' : 'signin';
      updateUI();
    });

    if (google) google.addEventListener('click', async () => {
      try {
        await LR.signInWithGoogle();
      } catch (e) {
        UI.err('Google sign-in failed. Make sure Google OAuth is enabled in your Supabase dashboard.');
        console.error(e);
      }
    });

    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!Utils.validEmail(email)) return UI.err('Please enter a valid email address.');
      if (password.length < 6) return UI.err('Password must be at least 6 characters.');

      submit.disabled = true; submit.textContent = 'Please wait…';

      try {
        if (mode === 'signin') {
          const { error } = await LR.signInWithEmail(email, password);
          if (error) throw new Error(mapAuthError(error.message));
          UI.ok('Welcome back!');
          setTimeout(() => window.location.replace('app.html'), 600);
        } else {
          const fullName = document.getElementById('fullName').value.trim();
          const username = document.getElementById('username').value.trim();
          if (!fullName) throw new Error('Please enter your full name.');
          if (!Utils.validUsername(username)) throw new Error('Username must be 3-24 chars, letters/numbers/underscores only.');

          const { data, error } = await LR.signUpWithEmail(email, password, { full_name: fullName, username });
          if (error) throw new Error(mapAuthError(error.message));

          if (data?.session) {
            UI.ok('Account created! Redirecting…');
            setTimeout(() => window.location.replace('app.html'), 600);
          } else {
            UI.ok('Check your email to confirm your account, then sign in.');
            mode = 'signin';
            updateUI();
            submit.disabled = false;
            submit.textContent = 'Sign in';
          }
        }
      } catch (err) {
        UI.err(err.message || 'Something went wrong.');
        submit.disabled = false;
        submit.textContent = mode === 'signin' ? 'Sign in' : 'Sign up';
      }
    });

    function updateUI() {
      const isSignup = mode === 'signup';
      nameF.hidden  = !isSignup;
      userF.hidden  = !isSignup;
      titleEl.textContent = isSignup ? 'Create your account' : 'Welcome back';
      subEl.textContent   = isSignup ? 'Sign up to join LinkRoom' : 'Sign in to continue to LinkRoom';
      submit.textContent  = isSignup ? 'Sign up' : 'Sign in';
      switchP.innerHTML = isSignup
        ? 'Already have an account? <a href="#" id="switchMode">Sign in</a>'
        : 'Don\'t have an account? <a href="#" id="switchMode">Sign up</a>';
      document.getElementById('switchMode').addEventListener('click', (e) => {
        e.preventDefault();
        mode = mode === 'signin' ? 'signup' : 'signin';
        updateUI();
      });
    }
  }

  function mapAuthError(msg) {
    const s = (msg || '').toLowerCase();
    if (s.includes('invalid login')) return 'Email or password is incorrect.';
    if (s.includes('email not confirmed')) return 'Please confirm your email before signing in.';
    if (s.includes('already registered') || s.includes('user already')) return 'An account already exists with this email.';
    if (s.includes('rate limit')) return 'Too many attempts. Please wait a minute and try again.';
    if (s.includes('password')) return 'Password does not meet requirements.';
    if (s.includes('weak password')) return 'Please choose a stronger password.';
    return msg;
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init };
})();
