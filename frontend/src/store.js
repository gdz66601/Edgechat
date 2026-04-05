import { reactive } from 'vue';
import api from './api.js';

const state = reactive({
  ready: false,
  token: localStorage.getItem('cfchat.token') || '',
  session: null
});

async function initialize() {
  if (state.ready) {
    return;
  }

  if (!state.token) {
    state.ready = true;
    return;
  }

  try {
    const payload = await api.session();
    state.session = payload.session;
  } catch {
    localStorage.removeItem('cfchat.token');
    state.token = '';
    state.session = null;
  } finally {
    state.ready = true;
  }
}

async function login(credentials) {
  const payload = await api.login(credentials);
  state.token = payload.token;
  state.session = payload.session;
  state.ready = true;
  localStorage.setItem('cfchat.token', payload.token);
}

async function logout() {
  try {
    if (state.token) {
      await api.logout();
    }
  } finally {
    localStorage.removeItem('cfchat.token');
    state.token = '';
    state.session = null;
  }
}

function setSession(session) {
  state.session = session;
}

export default {
  get ready() {
    return state.ready;
  },
  get token() {
    return state.token;
  },
  get session() {
    return state.session;
  },
  initialize,
  login,
  logout,
  setSession
};
