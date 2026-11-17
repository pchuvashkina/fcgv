import { api } from './api.js';
import { state, on, emit, cafeMinutesNow } from './store.js';
import {
  $, $$, html, render, raw, esc, fmtMin, addDays, fmtDate, ZONE,
  toast, showError, busy, registerActions,
} from './ui.js';
import { requireLogin } from './auth.js';
import { pulse } from './anim.js';

let tables = [];
let selected = null; // id столика
let loading = false;

const el = {
  map: () => $('#floorMap'),
  date: () => $('#bkDate'),
  time: () => $('#bkTime'),
  guests: () => $('#bkGuests'),
  chosen: () => $('#chosenTable'),
};

const guests = () => Number(el.guests().value);

/* ---------- Поля формы ---------- */
function fillGuests() {
  el.guests().innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === 2 ? 'selected' : ''}>${i + 1}</option>`).join('');
}

function fillTimes() {
  const c = state.config;
  const today = c.now.date === el.date().value;
  let start = c.openMin;
  if (today) start = Math.max(start, Math.ceil(cafeMinutesNow() / c.bookingStepMin) * c.bookingStepMin);
  const prev = el.time().value;
  const opts = [];
  for (let m = start; m <= c.lastBookingMin; m += c.bookingStepMin) opts.push(`<option value="${fmtMin(m)}">${fmtMin(m)}</option>`);
  el.time().innerHTML = opts.length ? opts.join('') : '<option value="">нет свободных слотов</option>';
  if (opts.length) {
    const keep = [...el.time().options].find((o) => o.value === prev);
    el.time().value = keep ? prev : (opts.includes(`<option value="19:00">19:00</option>`) ? '19:00' : el.time().options[0].value);
  }
}

/* ---------- Схема зала (SVG) ---------- */
const NS_DEFS = `
  <defs>
    <pattern id="tilePat" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M14 2L26 14 14 26 2 14z" fill="none" stroke="#2E5AA7" stroke-opacity=".13" stroke-width="1.4"/></pattern>
    <pattern id="plank" width="40" height="24" patternUnits="userSpaceOnUse"><rect width="40" height="24" fill="#86C5FF" fill-opacity=".22"/><path d="M0 23.5H40" stroke="#2E5AA7" stroke-opacity=".16"/><path d="M20 0V24" stroke="#2E5AA7" stroke-opacity=".08"/></pattern>
    <clipPath id="seaClip"><rect x="884" y="34" width="92" height="552" rx="22"/></clipPath>
  </defs>`;

const waveRows = Array.from({ length: 13 }, (_, i) => {
  const y = 62 + i * 44;
  return `<path class="sea__wave" style="animation-delay:-${(i % 5) * 0.7}s" d="M-60 ${y}${'q15 -10 30 0t30 0'.repeat(8)}"/>`;
}).join('');

const DECOR = `
  <rect class="floor__hall" x="20" y="30" width="470" height="560" rx="26"/>
  <rect x="20" y="30" width="470" height="560" rx="26" fill="url(#tilePat)"/>
  <rect class="floor__bar" x="62" y="40" width="386" height="24" rx="9"/>
  <text class="floor__lbl" x="255" y="57">БАР</text>
  <text class="floor__zone" x="255" y="92">ЗАЛ</text>
  <path class="floor__door" d="M205 590h100"/>
  <text class="floor__lbl floor__lbl--s" x="255" y="580">ВХОД</text>

  <rect class="floor__veranda" x="510" y="30" width="370" height="560" rx="26"/>
  <rect x="510" y="30" width="370" height="560" rx="26" fill="url(#plank)"/>
  <text class="floor__zone" x="695" y="64">ВЕРАНДА</text>

  <g clip-path="url(#seaClip)"><rect class="sea" x="884" y="34" width="92" height="552"/>${waveRows}</g>
  <circle class="floor__sun" cx="930" cy="92" r="22"/>
  <text class="floor__sea" transform="translate(938 340) rotate(90)">ЭГЕЙСКОЕ  МОРЕ</text>

  <g class="floor__tree"><circle cx="856" cy="560" r="16"/><circle cx="851" cy="556" r="3.2"/><circle cx="860" cy="563" r="3.2"/><circle cx="858" cy="553" r="3"/></g>
  <g class="floor__tree"><circle cx="535" cy="560" r="16"/><circle cx="530" cy="556" r="3.2"/><circle cx="540" cy="563" r="3.2"/><circle cx="538" cy="553" r="3"/></g>`;

function chairs(t) {
  const out = [];
  if (t.shape === 'round') {
    const R = t.w + 12;
    for (let i = 0; i < t.seats; i++) {
      const a = (Math.PI * 2 * i) / t.seats - Math.PI / 2;
      out.push(`<circle class="chair" cx="${(t.x + Math.cos(a) * R).toFixed(1)}" cy="${(t.y + Math.sin(a) * R).toFixed(1)}" r="7.5"/>`);
    }
  } else if (t.seats > 2) {
    const per = t.seats / 2;
    for (let k = 0; k < per; k++) {
      const cx = t.x - t.w / 2 + (t.w * (k + 0.5)) / per;
      out.push(`<circle class="chair" cx="${cx.toFixed(1)}" cy="${t.y - t.h / 2 - 12}" r="7.5"/>`);
      out.push(`<circle class="chair" cx="${cx.toFixed(1)}" cy="${t.y + t.h / 2 + 12}" r="7.5"/>`);
    }
  } else {
    out.push(`<circle class="chair" cx="${t.x - t.w / 2 - 12}" cy="${t.y}" r="7.5"/><circle class="chair" cx="${t.x + t.w / 2 + 12}" cy="${t.y}" r="7.5"/>`);
  }
  return out.join('');
}

function tableSvg(t) {
  const small = t.seats < guests();
  const cls = ['tbl', t.booked ? 'is-busy' : '', small && !t.booked ? 'is-small' : '', selected === t.id ? 'is-sel' : ''].join(' ');
  const top = t.shape === 'round'
    ? `<circle class="tbl__top" cx="${t.x}" cy="${t.y}" r="${t.w}"/>`
    : `<rect class="tbl__top" x="${t.x - t.w / 2}" y="${t.y - t.h / 2}" width="${t.w}" height="${t.h}" rx="14"/>`;
  const state_ = t.booked ? 'занят' : small ? 'мало мест' : selected === t.id ? 'выбран' : 'свободен';
  return `<g class="${cls}" data-id="${t.id}" tabindex="0" role="button" aria-pressed="${selected === t.id}"
      aria-label="Столик ${t.id}, ${t.seats} мест, ${ZONE[t.zone]}, ${state_}">
      <g class="tbl__in" style="transform-origin:${t.x}px ${t.y}px">
        ${chairs(t)}${top}
        <text class="tbl__num" x="${t.x}" y="${t.y + 6}">${t.id}</text>
      </g>
    </g>`;
}

function renderMap() {
  render(el.map(), raw(`<svg viewBox="0 0 1000 620" class="floor" role="group" aria-label="План зала">${NS_DEFS}${DECOR}${tables.map(tableSvg).join('')}</svg>`));
}

function renderChosen() {
  const t = tables.find((x) => x.id === selected);
  const box = el.chosen();
  box.classList.toggle('is-set', !!t);
  render(box, t
    ? html`<b>Столик №${t.id}</b><span>${ZONE[t.zone]} · до ${t.seats} гостей</span><button type="button" class="link" data-action="bk-clear">сменить</button>`
    : html`Выберите свободный столик на схеме`);
}

/* ---------- Данные ---------- */
async function refresh() {
  const date = el.date().value;
  const time = el.time().value;
  if (loading) return;
  loading = true;
  try {
    const q = date && time ? `?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}` : '';
    tables = (await api.get(`/reservations/tables${q}`)).tables;
    const t = tables.find((x) => x.id === selected);
    if (t && (t.booked || t.seats < guests())) {
      toast(`Столик №${t.id} недоступен на выбранные параметры — выберите другой`);
      selected = null;
    }
    renderMap();
    renderChosen();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading = false;
  }
}

function select(id) {
  const t = tables.find((x) => x.id === id);
  if (!t) return;
  if (t.booked) { toast(`Столик №${id} уже занят на это время`); return; }
  if (t.seats < guests()) { toast(`За столиком №${id} — не более ${t.seats} гостей. Выберите другой или измените число гостей`); return; }
  selected = selected === id ? null : id;
  renderMap();
  renderChosen();
  if (selected) pulse(el.map().querySelector(`.tbl[data-id="${id}"] .tbl__in`));
}

/* ---------- Подсказка при наведении ---------- */
function initTip() {
  const map = el.map();
  const tip = $('#mapTip');
  const show = (g, x, y) => {
    const t = tables.find((q) => q.id === Number(g.dataset.id));
    if (!t) return;
    const st = t.booked ? 'занят' : t.seats < guests() ? 'мало мест' : 'свободен';
    tip.innerHTML = `<b>Столик №${esc(t.id)}</b> · ${esc(ZONE[t.zone])}<br>${esc(t.seats)} мест · ${st}`;
    tip.hidden = false;
    const host = tip.parentElement.getBoundingClientRect();
    tip.style.left = `${x - host.left + 14}px`;
    tip.style.top = `${y - host.top + 14}px`;
  };
  map.addEventListener('pointermove', (e) => {
    const g = e.target.closest('.tbl');
    if (g) show(g, e.clientX, e.clientY); else tip.hidden = true;
  });
  map.addEventListener('pointerleave', () => { tip.hidden = true; });
}

/* ---------- Отправка брони ---------- */
async function submit(e) {
  e.preventDefault();
  const err = $('#bkError');
  showError(err, '');
  if (!requireLogin('Войдите, чтобы забронировать столик')) return;
  if (!selected) { showError(err, 'Выберите столик на схеме зала'); return; }
  if (!el.time().value) { showError(err, 'На эту дату нет свободных слотов — выберите другой день'); return; }
  const btn = $('#bkSubmit');
  busy(btn, true, 'Отправляем…');
  try {
    const { reservation: r } = await api.post('/reservations', {
      tableId: selected,
      date: el.date().value,
      time: el.time().value,
      guests: guests(),
      name: $('#bkName').value,
      phone: $('#bkPhone').value,
      comment: $('#bkComment').value,
    });
    toast(`Бронь отправлена! Столик №${r.tableId}, ${fmtDate(r.date)} в ${r.time}`, 'success');
    selected = null;
    $('#bkComment').value = '';
    await refresh();
    emit('reservations');
  } catch (ex) {
    showError(err, ex.message);
    if (ex.status === 409) refresh();
  } finally {
    busy(btn, false);
  }
}

function prefill() {
  const u = state.user;
  if (!u) return;
  if (!$('#bkName').value) $('#bkName').value = u.name;
  if (!$('#bkPhone').value && u.phone) $('#bkPhone').value = u.phone;
}

export function initBooking() {
  const c = state.config;
  const d = el.date();
  d.min = c.now.date;
  d.max = addDays(c.now.date, c.bookingMaxDaysAhead);
  d.value = c.now.date;
  fillGuests();
  fillTimes();

  // Если на сегодня слотов не осталось — предлагаем завтра
  if (!el.time().value) { d.value = addDays(c.now.date, 1); fillTimes(); }

  d.addEventListener('change', () => { if (!d.value) d.value = c.now.date; fillTimes(); refresh(); });
  el.time().addEventListener('change', refresh);
  el.guests().addEventListener('change', () => { const t = tables.find((x) => x.id === selected); if (t && t.seats < guests()) selected = null; renderMap(); renderChosen(); });
  $('#bookingForm').addEventListener('submit', submit);
  el.map().addEventListener('click', (e) => { const g = e.target.closest('.tbl'); if (g) select(Number(g.dataset.id)); });
  el.map().addEventListener('keydown', (e) => {
    const g = e.target.closest('.tbl');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(Number(g.dataset.id)); }
  });
  registerActions({ 'bk-clear': () => { selected = null; renderMap(); renderChosen(); } });
  initTip();
  on('user', prefill);
  prefill();
  refresh();
}
