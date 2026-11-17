import { api } from './api.js';
import { state, on } from './store.js';
import {
  $, $$, html, render, raw, money, fmtDate, fmtStamp, deliverLabel, stars,
  ORDER_STATUS, RES_STATUS, PAYMENT, ZONE, openDlg, closeDlg, toast, showError, busy, registerActions,
} from './ui.js';
import { imgUrl } from './images.js';
import { loadMenu } from './menu.js';
import { loadReviews } from './reviews.js';

let tab = 'overview';
let orderFilter = '';
let resDate = '';
let categories = [];
let menuItems = [];

const dlg = () => $('#adminDlg');
const box = () => $('#adminBox');
const body = () => $('#admBody');

const TABS = [['overview', 'Обзор'], ['orders', 'Заказы'], ['reservations', 'Брони'], ['menu', 'Меню'], ['reviews', 'Отзывы']];

export function openAdmin() {
  if (!state.user || state.user.role !== 'admin') return;
  render(box(), html`
    <div class="panel__head">
      <div><p class="eyebrow">Панель управления</p><h2 id="admTitle">Thalassa · Администратор</h2></div>
      <button class="dlg__close" type="button" data-close aria-label="Закрыть">×</button>
    </div>
    <div class="seg seg--wide seg--scroll" role="tablist">
      ${TABS.map(([id, label]) => html`<button type="button" role="tab" class="seg__btn ${id === tab ? 'is-on' : ''}" data-action="adm-tab" data-tab="${id}">${label}</button>`)}
    </div>
    <div class="panel__body" id="admBody"></div>`);
  openDlg(dlg());
  load();
}

async function load() {
  const b = body();
  if (!b) return;
  render(b, html`<p class="empty">Загрузка…</p>`);
  try {
    if (tab === 'overview') await viewOverview(b);
    else if (tab === 'orders') await viewOrders(b);
    else if (tab === 'reservations') await viewReservations(b);
    else if (tab === 'menu') await viewMenu(b);
    else await viewReviews(b);
  } catch (e) {
    render(b, html`<p class="empty">${e.message}</p>`);
    if (e.status === 401 || e.status === 403) toast('Доступ запрещён', 'error');
  }
}

/* ---------- Обзор ---------- */
async function viewOverview(b) {
  const s = await api.get('/admin/stats');
  const cards = [
    ['Заказов сегодня', s.ordersToday], ['Новых заказов', s.newOrders], ['Выручка сегодня', money(s.revenueTodayCents)],
    ['Ближайших броней', s.upcomingReservations], ['Ждут подтверждения', s.pendingReservations], ['Клиентов', s.clients],
    ['Средний рейтинг', s.averageRating ? s.averageRating.toFixed(1).replace('.', ',') : '—'], ['Отзывов', s.reviews],
  ];
  render(b, html`<div class="kpis">${cards.map(([l, v]) => html`<div class="kpi"><span>${l}</span><b>${v}</b></div>`)}</div>
    <p class="form-note">Подсказка: новые заказы и брони появляются во вкладках «Заказы» и «Брони» — смените статус, и клиент увидит его в личном кабинете.</p>`);
}

/* ---------- Заказы ---------- */
async function viewOrders(b) {
  const { orders } = await api.get(`/admin/orders${orderFilter ? `?status=${orderFilter}` : ''}`);
  render(b, html`
    <div class="toolbar">
      <label class="field field--inline"><span>Статус</span>
        <select id="admOrderFilter"><option value="">Все</option>${Object.entries(ORDER_STATUS).map(([k, v]) => html`<option value="${k}" ${k === orderFilter ? 'selected' : ''}>${v}</option>`)}</select>
      </label>
      <span class="toolbar__count">${orders.length} шт.</span>
    </div>
    ${orders.length ? html`<div class="table-wrap"><table class="tbl-admin">
      <thead><tr><th>№</th><th>Клиент</th><th>Состав</th><th>Доставка</th><th>Сумма</th><th>Статус</th></tr></thead>
      <tbody>${orders.map((o) => html`<tr>
        <td><b>${o.id}</b><br><small>${fmtStamp(o.createdAt)}</small></td>
        <td>${o.customer}<br><small>${o.phone}</small></td>
        <td><ul class="mini">${o.items.map((i) => html`<li>${i.qty} × ${i.name}</li>`)}</ul>${o.comment ? html`<small>«${o.comment}»</small>` : ''}</td>
        <td>${deliverLabel(o.deliverAt)}<br><small>${o.address}</small></td>
        <td><b>${money(o.totalCents)}</b><br><small>${PAYMENT[o.payment]}</small></td>
        <td><select class="status-select status-select--${o.status}" data-order="${o.id}" aria-label="Статус заказа ${o.id}">
          ${Object.entries(ORDER_STATUS).map(([k, v]) => html`<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`)}</select></td>
      </tr>`)}</tbody></table></div>` : html`<p class="empty">Заказов нет.</p>`}`);
}

/* ---------- Брони ---------- */
async function viewReservations(b) {
  const { reservations } = await api.get(`/admin/reservations${resDate ? `?date=${resDate}` : ''}`);
  render(b, html`
    <div class="toolbar">
      <label class="field field--inline"><span>Дата</span><input type="date" id="admResDate" value="${resDate}"></label>
      ${resDate ? html`<button class="btn btn--sm btn--ghost-dark" type="button" data-action="adm-res-reset">Все даты</button>` : ''}
      <span class="toolbar__count">${reservations.length} шт.</span>
    </div>
    ${reservations.length ? html`<div class="table-wrap"><table class="tbl-admin">
      <thead><tr><th>Когда</th><th>Столик</th><th>Гость</th><th>Статус</th><th></th></tr></thead>
      <tbody>${reservations.map((r) => html`<tr>
        <td><b>${fmtDate(r.date)}, ${r.time}</b></td>
        <td>№${r.tableId}<br><small>${ZONE[r.zone]} · ${r.guests} гост.</small></td>
        <td>${r.name}<br><small>${r.phone} · ${r.email}</small>${r.comment ? html`<br><small>«${r.comment}»</small>` : ''}</td>
        <td><span class="pill pill--${r.status}">${RES_STATUS[r.status]}</span></td>
        <td class="actions">
          ${r.status !== 'confirmed' && r.status !== 'cancelled' ? html`<button class="btn btn--sm" type="button" data-action="adm-res" data-id="${r.id}" data-status="confirmed">Подтвердить</button>` : ''}
          ${r.status !== 'cancelled' ? html`<button class="btn btn--sm btn--ghost-dark" type="button" data-action="adm-res" data-id="${r.id}" data-status="cancelled">Отменить</button>` : ''}
        </td></tr>`)}</tbody></table></div>` : html`<p class="empty">Броней нет.</p>`}`);
}

/* ---------- Меню ---------- */
async function viewMenu(b) {
  const data = await api.get('/admin/menu');
  categories = data.categories;
  menuItems = data.items;
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.title]));
  render(b, html`
    <div class="toolbar"><button class="btn btn--sm" type="button" data-action="adm-item-new">+ Добавить блюдо</button><span class="toolbar__count">${menuItems.length} позиций</span></div>
    <div class="table-wrap"><table class="tbl-admin">
      <thead><tr><th></th><th>Блюдо</th><th>Категория</th><th>Цена</th><th>В меню</th><th></th></tr></thead>
      <tbody>${menuItems.map((m) => html`<tr class="${m.available ? '' : 'is-off'}">
        <td><img class="thumb" src="${imgUrl(m.image, 120)}" alt="" loading="lazy"></td>
        <td><b>${m.name}</b></td>
        <td>${catName[m.category] || m.category}</td>
        <td>${money(m.priceCents)}</td>
        <td><label class="switch"><input type="checkbox" data-avail="${m.id}" ${m.available ? 'checked' : ''} aria-label="Показывать в меню: ${m.name}"><i></i></label></td>
        <td class="actions">
          <button class="btn btn--sm btn--ghost-dark" type="button" data-action="adm-item-edit" data-id="${m.id}">Изменить</button>
          <button class="btn btn--sm btn--ghost-dark" type="button" data-action="adm-item-del" data-id="${m.id}">Удалить</button>
        </td></tr>`)}</tbody></table></div>`);
}

function itemForm(m) {
  const isNew = !m;
  const v = m || { category: categories[0].id, name: '', description: '', priceCents: 0, image: '', available: true };
  render($('#itemBox'), html`
    <button class="dlg__close" type="button" data-close aria-label="Закрыть">×</button>
    <h2 class="h3" id="itemTitle">${isNew ? 'Новое блюдо' : 'Редактирование блюда'}</h2>
    <form id="itemForm" class="stack" novalidate data-id="${m ? m.id : ''}">
      <label class="field"><span>Название</span><input name="name" maxlength="80" value="${v.name}" required></label>
      <label class="field"><span>Категория</span><select name="category">${categories.map((c) => html`<option value="${c.id}" ${c.id === v.category ? 'selected' : ''}>${c.title}</option>`)}</select></label>
      <label class="field"><span>Описание</span><textarea name="description" rows="3" maxlength="240" required>${v.description}</textarea></label>
      <label class="field"><span>Цена, €</span><input name="price" inputmode="decimal" value="${v.priceCents ? (v.priceCents / 100).toFixed(2) : ''}" placeholder="9.50" required></label>
      <label class="field"><span>Фото</span><input name="image" value="${v.image || ''}" placeholder="photo-1234567890-abcdef или https://…"><small>Путь вида photo-… с Unsplash или полная https-ссылка</small></label>
      <label class="check"><input type="checkbox" name="available" ${v.available ? 'checked' : ''}> Показывать в меню</label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn--block" type="submit">${isNew ? 'Добавить' : 'Сохранить'}</button>
    </form>`);
  openDlg($('#itemDlg'));
}

async function saveItem(form) {
  const err = $('.form-error', form);
  showError(err, '');
  const f = form.elements;
  const price = Math.round(parseFloat(String(f.price.value).replace(',', '.')) * 100);
  if (!Number.isFinite(price) || price < 50) { showError(err, 'Укажите цену, например 9.50'); return; }
  const payload = {
    name: f.name.value, category: f.category.value, description: f.description.value,
    priceCents: price, image: f.image.value.trim(), available: f.available.checked,
  };
  const btn = $('button[type=submit]', form);
  busy(btn, true, 'Сохраняем…');
  try {
    const id = form.dataset.id;
    if (id) await api.put(`/admin/menu/${id}`, payload); else await api.post('/admin/menu', payload);
    closeDlg($('#itemDlg'));
    toast('Меню обновлено', 'success');
    await Promise.all([load(), loadMenu()]);
  } catch (e) {
    showError(err, e.message);
    busy(btn, false);
  }
}

/* ---------- Отзывы ---------- */
async function viewReviews(b) {
  const { reviews } = await api.get('/reviews');
  render(b, reviews.length ? html`<div class="cards">${reviews.map((r) => html`
    <article class="ocard">
      <header><b>${r.author}</b>${stars(r.rating)}<time>${fmtStamp(r.createdAt)}</time></header>
      <p>${r.text}</p>
      <button class="btn btn--sm btn--ghost-dark" type="button" data-action="adm-review-del" data-id="${r.id}">Удалить отзыв</button>
    </article>`)}</div>` : html`<p class="empty">Отзывов нет.</p>`);
}

export function initAdmin() {
  registerActions({
    'open-admin': () => openAdmin(),
    'adm-tab': (el) => {
      tab = el.dataset.tab;
      $$('[data-action="adm-tab"]', box()).forEach((x) => x.classList.toggle('is-on', x === el));
      load();
    },
    'adm-res': async (el) => {
      try { await api.patch(`/admin/reservations/${el.dataset.id}`, { status: el.dataset.status }); toast('Статус брони обновлён', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
    },
    'adm-res-reset': () => { resDate = ''; load(); },
    'adm-item-new': () => itemForm(null),
    'adm-item-edit': (el) => itemForm(menuItems.find((m) => m.id === Number(el.dataset.id))),
    'adm-item-del': async (el) => {
      const m = menuItems.find((x) => x.id === Number(el.dataset.id));
      if (!confirm(`Удалить «${m ? m.name : 'блюдо'}» из меню?`)) return;
      try { await api.del(`/admin/menu/${el.dataset.id}`); toast('Блюдо удалено'); await Promise.all([load(), loadMenu()]); } catch (e) { toast(e.message, 'error'); }
    },
    'adm-review-del': async (el) => {
      if (!confirm('Удалить этот отзыв?')) return;
      try { await api.del(`/admin/reviews/${el.dataset.id}`); toast('Отзыв удалён'); await Promise.all([load(), loadReviews()]); } catch (e) { toast(e.message, 'error'); }
    },
  });

  // change-события внутри панели
  box().addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.id === 'admOrderFilter') { orderFilter = t.value; load(); }
      else if (t.id === 'admResDate') { resDate = t.value; load(); }
      else if (t.dataset.order) {
        await api.patch(`/admin/orders/${t.dataset.order}`, { status: t.value });
        t.className = `status-select status-select--${t.value}`;
        toast(`Заказ №${t.dataset.order}: ${ORDER_STATUS[t.value].toLowerCase()}`, 'success');
      } else if (t.dataset.avail) {
        const m = menuItems.find((x) => x.id === Number(t.dataset.avail));
        await api.put(`/admin/menu/${m.id}`, { ...m, available: t.checked });
        await Promise.all([load(), loadMenu()]);
      }
    } catch (ex) { toast(ex.message, 'error'); load(); }
  });

  $('#itemDlg').addEventListener('submit', (e) => { if (e.target.id === 'itemForm') { e.preventDefault(); saveItem(e.target); } });
  on('user', (u) => { if (!u || u.role !== 'admin') { if (dlg().open) closeDlg(dlg()); } });
}

export { raw };
