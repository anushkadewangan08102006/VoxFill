const state = {
  mode: 'signin',
  user: null,
};

const signinTab = document.getElementById('signinTab');
const signupTab = document.getElementById('signupTab');
const authForm = document.getElementById('authForm');
const nameField = document.getElementById('nameField');
const nameInput = document.getElementById('nameInput');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const submitBtn = document.getElementById('submitBtn');
const message = document.getElementById('message');
const downloadPanel = document.getElementById('downloadPanel');
const welcomeTitle = document.getElementById('welcomeTitle');
const sessionActions = document.getElementById('sessionActions');
const sessionText = document.getElementById('sessionText');
const signoutBtn = document.getElementById('signoutBtn');

function setMessage(text, type = '') {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function setMode(mode) {
  state.mode = mode;
  const isSignup = mode === 'signup';

  signinTab.classList.toggle('active', !isSignup);
  signupTab.classList.toggle('active', isSignup);
  signinTab.setAttribute('aria-selected', String(!isSignup));
  signupTab.setAttribute('aria-selected', String(isSignup));
  nameField.hidden = !isSignup;
  nameInput.required = isSignup;
  passwordInput.autocomplete = isSignup ? 'new-password' : 'current-password';
  submitBtn.textContent = isSignup ? 'Create account' : 'Sign in';
  setMessage('');
}

function renderSession() {
  const signedIn = Boolean(state.user);

  authForm.hidden = signedIn;
  sessionActions.hidden = !signedIn;
  downloadPanel.hidden = !signedIn;

  if (signedIn) {
    welcomeTitle.textContent = `Ready for ${state.user.name}`;
    sessionText.textContent = `Signed in as ${state.user.email}.`;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json();

  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

async function loadCurrentUser() {
  try {
    const payload = await requestJson('/api/me');
    state.user = payload.user;
  } catch (error) {
    state.user = null;
  }

  renderSession();
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitBtn.disabled = true;
  setMessage(state.mode === 'signup' ? 'Creating account...' : 'Signing in...');

  try {
    const payload = await requestJson(`/api/${state.mode}`, {
      method: 'POST',
      body: JSON.stringify({
        name: nameInput.value,
        email: emailInput.value,
        password: passwordInput.value,
      }),
    });

    state.user = payload.user;
    authForm.reset();
    renderSession();
    setMessage('You are signed in. Download is now available.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

signoutBtn.addEventListener('click', async () => {
  try {
    await requestJson('/api/signout', { method: 'POST' });
  } catch (error) {
    setMessage(error.message, 'error');
  }

  state.user = null;
  renderSession();
  setMessage('Signed out.');
});

signinTab.addEventListener('click', () => setMode('signin'));
signupTab.addEventListener('click', () => setMode('signup'));

setMode('signin');
loadCurrentUser();
