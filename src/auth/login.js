import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase.js';
import { toast } from '../shared/toast.js';

export function initLogin() {
  const overlay = document.getElementById('login-overlay');
  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-password');
  const btn = document.getElementById('login-btn');
  const errorEl = document.getElementById('login-error');

  async function doLogin() {
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) {
      errorEl.textContent = 'Please enter email and password.';
      return;
    }
    btn.disabled = true;
    errorEl.textContent = '';
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // auth state listener in main.js handles the rest
    } catch (e) {
      errorEl.textContent = 'Login failed. Please check your credentials.';
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', doLogin);

  // P3: Error auto-dismiss
  let _errorTimer = null;
  function showLoginError(msg) {
    errorEl.textContent = msg;
    if (_errorTimer) clearTimeout(_errorTimer);
    _errorTimer = setTimeout(() => { errorEl.textContent = ''; }, 5000);
  }

  // P3: Clear error on input focus
  emailInput.addEventListener('focus', () => { errorEl.textContent = ''; });
  passInput.addEventListener('focus', () => { errorEl.textContent = ''; });

  // P3: Forgot password
  const forgotLink = document.getElementById('login-forgot-password');
  if (forgotLink) {
    forgotLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email) { showLoginError('Enter your email above, then click Forgot Password.'); return; }
      try { await sendPasswordResetEmail(auth, email); toast('Password reset email sent!', 'success'); }
      catch (err) { showLoginError('Could not send reset email. Check the address.'); }
    });
  }
  passInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
}

export function showLogin() {
  document.getElementById('login-overlay').style.display = 'flex';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
}

export function hideLogin() {
  document.getElementById('login-overlay').style.display = 'none';
}
