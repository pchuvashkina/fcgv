import { api } from './api.js';
import { state, emit, on } from './store.js';
import { $, $$, html, render, openDlg, closeDlg, toast, showError, busy, registerActions } from './ui.js';

const dlg = $('#authDlg');

function setTab(tab) {
  $$('[data-auth-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.authTab === tab));
  $('#loginForm').hidden = tab !== 'login';
  $('#registerForm').hidden = tab !== 'register';
  $('#authTitle').textContent = tab === 'login' ? 'С возвращением' : 'Создать аккаунт';
  $$('.form-error', dlg).forEach((e) => showError(e, ''));
}

export function openAuth(tab = 'login') {
  setTab(tab);
  openDlg(dlg);
  setTimeout(() => $('form:not([hidden]) input', dlg)?.focus(), 60);
}

export function requireLogin(message) {
  if (state.user) return true;
  if (message) toast(message);
  openAuth('login');
  return false;
}

export async function loadUser() {
  try { state.user = (await api.get('/auth/me')).user; } catch { state.user = null; }
  emit('user', state.user);
}

function renderSlot() {
  const slot = $('#userSlot');
  const u = state.user;
  if (!u) {
    render(slot, html`<button class="btn btn--sm" type="button" data-action="open-auth">Войти</button>`);
    return;
  }
  render(slot, html`
    <button class="user-btn" type="button" id="userBtn" aria-haspopup="menu" aria-expanded="false" data-action="toggle-user">
      <span class="avatar">${u.name.trim().charAt(0).toUpperCase()}</span>
      <span class="user-btn__name">${u.name.split(' ')[0]}</span>
    </button>
    <div class="user-pop" id="userPop" role="menu" hidden>
      <button type="button" role="menuitem" data-action="open-account">Личный кабинет</button>
      ${u.role === 'admin' ? html`<button type="button" role="menuitem" data-action="open-admin">Админ-панель</button>` : ''}
      <button type="button" role="menuitem" data-action="logout">Выйти</button>
    </div>`);
}

function closePop() {
  const pop = $('#userPop');
  if (pop && !pop.hidden) { pop.hidden = true; $('#userBtn')?.setAttribute('aria-expanded', 'false'); }
}

async function submit(form, path, fields) {
  const err = $('.form-error', form);
  const btn = $('button[type=submit]', form);
  showError(err, '');
  const body = Object.fromEntries(fields.map((f) => [f, form.elements[f].value]));
  busy(btn, true, 'Подождите…');
  try {
    const { user } = await api.post(path, body);
    state.user = user;
    form.reset();
    closeDlg(dlg);
    emit('user', user);
    toast(user.role === 'admin' ? 'Вы вошли как администратор' : `Добро пожаловать, ${user.name.split(' ')[0]}!`, 'success');
  } catch (e) {
    showError(err, e.message);
  } finally {
    busy(btn, false);
  }
}

export function initAuth() {
  $$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.authTab)));
  $('#loginForm').addEventListener('submit', (e) => { e.preventDefault(); submit(e.target, '/auth/login', ['email', 'password']); });
  $('#registerForm').addEventListener('submit', (e) => { e.preventDefault(); submit(e.target, '/auth/register', ['name', 'email', 'phone', 'password']); });

  registerActions({
    'open-auth': () => openAuth('login'),
    'toggle-user': (el) => {
      const pop = $('#userPop');
      pop.hidden = !pop.hidden;
      el.setAttribute('aria-expanded', String(!pop.hidden));
    },
    logout: async () => {
      closePop();
      try { await api.post('/auth/logout'); } catch { /* всё равно выходим локально */ }
      state.user = null;
      emit('user', null);
      toast('Вы вышли из аккаунта');
    },
  });

  document.addEventListener('click', (e) => { if (!e.target.closest('#userSlot')) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  on('user', renderSlot);
}
