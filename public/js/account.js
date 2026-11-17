import { api } from './api.js';
import { state, on } from './store.js';
import {
  $, $$, html, render, money, fmtDate, fmtStamp, deliverLabel,
  ORDER_STATUS, RES_STATUS, PAYMENT, ZONE, openDlg, closeDlg, toast, registerActions,
} from './ui.js';

let tab = 'orders';
const dlg = () => $('#accountDlg');
const box = () => $('#accountBox');

export function openAccount(t = 'orders') {
  if (!state.user) return;
  tab = t;
  shell();
  openDlg(dlg());
  load();
}

function shell() {
  const u = state.user;
  const tabs = [['orders', 'Заказы'], ['reservations', 'Бронирования'], ['profile', 'Профиль']];
  render(box(), html`
    <div class="panel__head">
      <div><p class="eyebrow">Личный кабинет</p><h2 id="accTitle">Здравствуйте, ${u.name.split(' ')[0]}!</h2></div>
      <button class="dlg__close" type="button" data-close aria-label="Закрыть">×</button>
    </div>
    <div class="seg seg--wide" role="tablist">
      ${tabs.map(([id, label]) => html`<button type="button" role="tab" class="seg__btn ${id === tab ? 'is-on' : ''}" data-action="acc-tab" data-tab="${id}">${label}</button>`)}
    </div>
    <div class="panel__body" id="accBody"><p class="empty">Загрузка…</p></div>`);
}

async function load() {
  const body = $('#accBody');
  if (!body) return;
  try {
    if (tab === 'orders') {
      const { orders } = await api.get('/orders/my');
      render(body, orders.length ? html`<div class="cards">${orders.map(orderCard)}</div>` : empty('Вы ещё ничего не заказывали', 'Выбрать блюда', 'goto-menu-close'));
    } else if (tab === 'reservations') {
      const { reservations } = await api.get('/reservations/my');
      const zones = await tableZones();
      render(body, reservations.length ? html`<div class="cards">${reservations.map((r) => resCard(r, zones))}</div>` : empty('Броней пока нет', 'Забронировать столик', 'goto-booking-close'));
    } else {
      const u = state.user;
      render(body, html`
        <dl class="profile">
          <div><dt>Имя</dt><dd>${u.name}</dd></div>
          <div><dt>Email</dt><dd>${u.email}</dd></div>
          <div><dt>Телефон</dt><dd>${u.phone || '—'}</dd></div>
          <div><dt>Роль</dt><dd><span class="pill ${u.role === 'admin' ? 'pill--cooking' : 'pill--new'}">${u.role === 'admin' ? 'Администратор' : 'Клиент'}</span></dd></div>
        </dl>
        <button class="btn btn--ghost-dark" type="button" data-action="logout-close">Выйти из аккаунта</button>`);
    }
  } catch (e) {
    render(body, html`<p class="empty">${e.message}</p>`);
  }
}

let zoneCache = null;
async function tableZones() {
  if (!zoneCache) zoneCache = new Map((await api.get('/reservations/tables')).tables.map((t) => [t.id, t.zone]));
  return zoneCache;
}

const empty = (text, label, action) => html`<div class="empty-state"><svg viewBox="0 0 64 64" width="84" height="84" aria-hidden="true"><use href="#lemon"/></svg><p>${text}</p><button class="btn" type="button" data-action="${action}">${label}</button></div>`;

function orderCard(o) {
  return html`
    <article class="ocard">
      <header>
        <b>Заказ №${o.id}</b>
        <span class="pill pill--${o.status}">${ORDER_STATUS[o.status]}</span>
        <time>${fmtStamp(o.createdAt)}</time>
      </header>
      <ul class="olines">${o.items.map((i) => html`<li><span>${i.qty} × ${i.name}</span><b>${money(i.priceCents * i.qty)}</b></li>`)}</ul>
      <footer>
        <span>${deliverLabel(o.deliverAt)} · ${o.address}<br><small>${PAYMENT[o.payment]}${o.deliveryFeeCents ? ` · доставка ${money(o.deliveryFeeCents)}` : ' · доставка бесплатно'}</small></span>
        <strong>${money(o.totalCents)}</strong>
      </footer>
      ${o.status === 'new' ? html`<button class="btn btn--sm btn--ghost-dark" type="button" data-action="cancel-order" data-id="${o.id}">Отменить заказ</button>` : ''}
    </article>`;
}

function resCard(r, zones) {
  const canCancel = r.status !== 'cancelled';
  return html`
    <article class="ocard">
      <header>
        <b>Столик №${r.tableId}</b>
        <span class="pill pill--${r.status}">${RES_STATUS[r.status]}</span>
        <time>${ZONE[zones.get(r.tableId)] || ''}</time>
      </header>
      <footer>
        <span><b>${fmtDate(r.date)}, ${r.time}</b> · ${r.guests} ${r.guests === 1 ? 'гость' : 'гостя/гостей'}<br><small>${r.name}, ${r.phone}${r.comment ? ` · ${r.comment}` : ''}</small></span>
      </footer>
      ${canCancel ? html`<button class="btn btn--sm btn--ghost-dark" type="button" data-action="cancel-res" data-id="${r.id}">Отменить бронь</button>` : ''}
    </article>`;
}

export function initAccount() {
  registerActions({
    'open-account': () => { closeDlg($('#cartDlg')); openAccount('orders'); },
    'acc-tab': (el) => {
      tab = el.dataset.tab;
      $$('[data-action="acc-tab"]', box()).forEach((b) => b.classList.toggle('is-on', b === el));
      load();
    },
    'cancel-order': async (el) => {
      if (!confirm('Отменить этот заказ?')) return;
      try { await api.post(`/orders/${el.dataset.id}/cancel`); toast('Заказ отменён'); load(); } catch (e) { toast(e.message, 'error'); }
    },
    'cancel-res': async (el) => {
      if (!confirm('Отменить бронь?')) return;
      try { await api.post(`/reservations/${el.dataset.id}/cancel`); toast('Бронь отменена'); load(); } catch (e) { toast(e.message, 'error'); }
    },
    'goto-menu-close': () => { closeDlg(dlg()); location.hash = '#menu'; },
    'goto-booking-close': () => { closeDlg(dlg()); location.hash = '#booking'; },
    'logout-close': () => { closeDlg(dlg()); document.querySelector('[data-action="logout"]')?.click(); },
  });
  on('reservations', () => { if (dlg().open && tab === 'reservations') load(); });
  on('user', (u) => { if (!u) { zoneCache = null; if (dlg().open) closeDlg(dlg()); } });
}
