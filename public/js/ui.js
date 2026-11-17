// Общие помощники интерфейса: безопасные шаблоны, форматирование, диалоги, уведомления.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- Безопасные HTML-шаблоны: всё, что подставляется, экранируется ---------- */
class Raw { constructor(s) { this.s = s; } }
export const raw = (s) => new Raw(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
};
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += part(vals[i]); });
  return new Raw(out);
}
export const render = (el, content) => { el.innerHTML = part(content); };

/* ---------- Форматирование ---------- */
export const money = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
export const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
export const fmtDateLong = (iso) => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const fmtStamp = (stamp) => new Date(`${stamp.replace(' ', 'T')}Z`)
  .toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const deliverLabel = (v) => (v === 'asap' ? 'Как можно скорее' : `${fmtDate(v.slice(0, 10))}, ${v.slice(11)}`);

export const ORDER_STATUS = {
  new: 'Принят', cooking: 'Готовится', delivering: 'В пути', done: 'Доставлен', cancelled: 'Отменён',
};
export const RES_STATUS = { pending: 'Ожидает подтверждения', confirmed: 'Подтверждена', cancelled: 'Отменена' };
export const PAYMENT = { cash: 'Наличными курьеру', card_courier: 'Картой курьеру' };
export const ZONE = { hall: 'Зал', veranda: 'Веранда' };

export const stars = (n) => html`<span class="stars" role="img" aria-label="Оценка ${n} из 5">${[1, 2, 3, 4, 5].map((i) =>
  html`<svg viewBox="0 0 24 24" class="${i <= Math.round(n) ? 'on' : ''}"><use href="#star"/></svg>`)}</span>`;

/* ---------- Уведомления ---------- */
export function toast(message, type = 'info') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 400); }, type === 'error' ? 5200 : 3400);
}

export function showError(el, message) {
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; if (label) btn.textContent = label; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}

/* ---------- Диалоги (нативный <dialog>: фокус-ловушка и Esc из коробки) ---------- */
export function openDlg(dlg) {
  if (dlg.open) return;
  dlg.showModal();
  document.documentElement.classList.add('no-scroll');
}
export function closeDlg(dlg) {
  if (!dlg.open) return;
  dlg.classList.add('is-closing');
  setTimeout(() => { dlg.close(); dlg.classList.remove('is-closing'); }, 190);
}
export function initDialogs() {
  $$('dialog').forEach((d) => {
    d.addEventListener('close', () => {
      if (!$$('dialog[open]').length) document.documentElement.classList.remove('no-scroll');
    });
    d.addEventListener('click', (e) => { if (e.target === d) closeDlg(d); });
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-close]');
    const d = b && b.closest('dialog');
    if (d) closeDlg(d);
  });
}

/* ---------- Делегирование действий: <button data-action="имя"> ---------- */
const actions = {};
export const registerActions = (map) => Object.assign(actions, map);
export function initActions() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    const fn = el && actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
}
