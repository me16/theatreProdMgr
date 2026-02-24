import { signInWithEmailAndPassword } from 'firebase/auth';
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
