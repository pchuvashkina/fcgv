import { api } from './api.js';
import { state, on, emit, cafeMinutesNow } from './store.js';
import {
  $, html, render, money, fmtMin, addDays, deliverLabel, PAYMENT,
  openDlg, closeDlg, toast, showError, busy, registerActions,
} from './ui.js';
import { imgUrl } from './images.js';
import { openAuth } from './auth.js';

const KEY = 'thalassa_cart_v1';
const MAX_QTY = 20;
let items = []; // [{ id, qty }]
let view = 'cart'; // cart | checkout | done
let lastOrder = null;
let day = 'today';

const dlg = () => $('#cartDlg');
const box = () => $('#cartBox');

function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(a)) items = a.filter((x) => Number.isInteger(x.id) && Number.isInteger(x.qty) && x.qty > 0 && x.qty <= MAX_QTY);
  } catch { items = []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* приватный режим */ }
  emit('cart');
}

export function add(id, qty = 1) {
  const row = items.find((i) => i.id === id);
  if (row) row.qty = Math.min(MAX_QTY, row.qty + qty);
  else items.push({ id, qty: Math.min(MAX_QTY, qty) });
  save();
}
function setQty(id, qty) {
  if (qty <= 0) items = items.filter((i) => i.id !== id);
  else { const row = items.find((i) => i.id === id); if (row) row.qty = Math.min(MAX_QTY, qty); }
  save();
}
const clear = () => { items = []; save(); };

/** Позиции корзины с актуальными данными из меню (блюда, которых больше нет, отбрасываются) */
function lines() {
  return items
    .map((i) => ({ item: state.menu.items.find((m) => m.id === i.id), qty: i.qty }))
    .filter((l) => l.item);
}
function totals() {
  const ls = lines();
  const sub = ls.reduce((s, l) => s + l.item.priceCents * l.qty, 0);
  const c = state.config;
  const fee = !ls.length || !c ? 0 : (sub >= c.freeDeliveryFromCents ? 0 : c.deliveryFeeCents);
  return { sub, fee, total: sub + fee, count: ls.reduce((s, l) => s + l.qty, 0) };
}

function updateBadge() {
  const { count } = totals();
  const b = $('#cartBadge');
  b.textContent = count;
  b.hidden = count === 0;
}

/* ---------- Отрисовка ---------- */
function head(title) {
  return html`<div class="drawer__head"><h2 id="cartTitle">${title}</h2><button class="dlg__close" type="button" data-close aria-label="Закрыть">×</button></div>`;
}

function renderCart() {
  const ls = lines();
  const t = totals();
  const c = state.config;
  if (!ls.length) {
    render(box(), html`${head('Ваш заказ')}
      <div class="drawer__body drawer__empty">
        <svg viewBox="0 0 64 64" width="96" height="96" aria-hidden="true"><use href="#lemon"/></svg>
        <p>Корзина пока пуста</p>
        <button class="btn" type="button" data-action="goto-menu">Выбрать блюда</button>
      </div>`);
    return;
  }
  const toFree = c ? Math.max(0, c.freeDeliveryFromCents - t.sub) : 0;
  render(box(), html`${head('Ваш заказ')}
    <div class="drawer__body">
      <ul class="clines">
        ${ls.map(({ item, qty }) => html`
          <li class="cline">
            <img src="${imgUrl(item.image, 200)}" alt="" loading="lazy">
            <div class="cline__info"><b>${item.name}</b><span>${money(item.priceCents)}</span></div>
            <div class="qty" role="group" aria-label="Количество">
              <button type="button" data-action="qty" data-id="${item.id}" data-d="-1" aria-label="Меньше">−</button>
              <output>${qty}</output>
              <button type="button" data-action="qty" data-id="${item.id}" data-d="1" aria-label="Больше" ${qty >= MAX_QTY ? 'disabled' : ''}>+</button>
            </div>
            <button class="cline__rm" type="button" data-action="rm" data-id="${item.id}" aria-label="Удалить ${item.name}">×</button>
          </li>`)}
      </ul>
      ${c && toFree > 0 ? html`<p class="drawer__hint">Добавьте ещё на <b>${money(toFree)}</b> — и доставка будет бесплатной</p>` : html`<p class="drawer__hint drawer__hint--ok">Доставка бесплатная 🍋</p>`}
    </div>
    <div class="drawer__foot">
      <dl class="sums">
        <div><dt>Блюда</dt><dd>${money(t.sub)}</dd></div>
        <div><dt>Доставка</dt><dd>${t.fee ? money(t.fee) : 'бесплатно'}</dd></div>
        <div class="sums__total"><dt>Итого</dt><dd>${money(t.total)}</dd></div>
      </dl>
      <button class="btn btn--block btn--lg" type="button" data-action="to-checkout">Оформить доставку</button>
    </div>`);
}

/* Слоты времени доставки */
function daySlots(d) {
  const c = state.config;
  let start = c.deliveryFromMin;
  if (d === 'today') start = Math.max(start, Math.ceil((cafeMinutesNow() + 30) / 30) * 30);
  const out = [];
  for (let m = start; m <= c.deliveryToMin; m += 30) out.push(m);
  return out;
}
const canAsap = () => { const m = cafeMinutesNow(); const c = state.config; return m >= c.deliveryFromMin && m <= c.deliveryToMin - 30; };

function timeOptions(d) {
  const opts = [];
  if (d === 'today' && canAsap()) opts.push(html`<option value="asap">Как можно скорее (45–60 мин)</option>`);
  daySlots(d).forEach((m) => opts.push(html`<option value="${fmtMin(m)}">${fmtMin(m)}</option>`));
  return html`${opts}`;
}

function renderCheckout() {
  const t = totals();
  const c = state.config;
  const todayHasSlots = daySlots('today').length > 0 || canAsap();
  if (day === 'today' && !todayHasSlots) day = 'tomorrow';
  const u = state.user;
  render(box(), html`
    <div class="drawer__head"><button class="back" type="button" data-action="back-cart" aria-label="Назад к корзине">←</button><h2 id="cartTitle">Оформление</h2><button class="dlg__close" type="button" data-close aria-label="Закрыть">×</button></div>
    <form class="drawer__body stack" id="checkoutForm" novalidate>
      ${u ? '' : html`<div class="callout">Чтобы оформить заказ, <button type="button" class="link" data-action="open-auth">войдите или зарегистрируйтесь</button> — корзина сохранится.</div>`}
      <label class="field"><span>Адрес доставки</span><input name="address" type="text" autocomplete="street-address" maxlength="200" placeholder="Улица, дом, квартира / вилла" required></label>
      <label class="field"><span>Телефон для курьера</span><input name="phone" type="tel" autocomplete="tel" maxlength="25" value="${u ? u.phone : ''}" placeholder="+30 …" required></label>
      <div class="field-row field-row--2">
        <label class="field"><span>День</span>
          <select name="day" id="coDay">
            <option value="today" ${day === 'today' ? 'selected' : ''} ${todayHasSlots ? '' : 'disabled'}>Сегодня</option>
            <option value="tomorrow" ${day === 'tomorrow' ? 'selected' : ''}>Завтра</option>
          </select></label>
        <label class="field"><span>Время</span><select name="time" id="coTime">${timeOptions(day)}</select></label>
      </div>
      ${!canAsap() && day === 'today' ? html`<p class="form-note">Сейчас доставка не работает — доступны слоты с ${fmtMin(c.deliveryFromMin)} до ${fmtMin(c.deliveryToMin)}.</p>` : ''}
      <fieldset class="field pay">
        <legend>Оплата</legend>
        <label class="radio"><input type="radio" name="payment" value="cash" checked><span>${PAYMENT.cash}</span></label>
        <label class="radio"><input type="radio" name="payment" value="card_courier"><span>${PAYMENT.card_courier}</span></label>
      </fieldset>
      <label class="field"><span>Комментарий курьеру</span><textarea name="comment" rows="2" maxlength="300" placeholder="Код домофона, этаж…"></textarea></label>
      <dl class="sums">
        <div><dt>Блюда (${t.count})</dt><dd>${money(t.sub)}</dd></div>
        <div><dt>Доставка</dt><dd>${t.fee ? money(t.fee) : 'бесплатно'}</dd></div>
        <div class="sums__total"><dt>Итого</dt><dd>${money(t.total)}</dd></div>
      </dl>
      <p class="form-error" id="coError" role="alert" hidden></p>
      <button class="btn btn--block btn--lg" type="submit">Подтвердить заказ · ${money(t.total)}</button>
    </form>`);
}

function renderDone() {
  const o = lastOrder;
  render(box(), html`${head('Заказ принят!')}
    <div class="drawer__body drawer__done">
      <svg viewBox="0 0 64 64" width="110" height="110" aria-hidden="true"><use href="#lemon"/></svg>
      <h3>Спасибо! Заказ №${o.id}</h3>
      <p>Доставим: <b>${deliverLabel(o.deliverAt)}</b><br>Адрес: ${o.address}</p>
      <ul class="clines clines--plain">
        ${o.items.map((i) => html`<li><span>${i.qty} × ${i.name}</span><b>${money(i.priceCents * i.qty)}</b></li>`)}
      </ul>
      <dl class="sums"><div><dt>Доставка</dt><dd>${o.deliveryFeeCents ? money(o.deliveryFeeCents) : 'бесплатно'}</dd></div><div class="sums__total"><dt>Итого (${PAYMENT[o.payment].toLowerCase()})</dt><dd>${money(o.totalCents)}</dd></div></dl>
      <button class="btn btn--block" type="button" data-action="open-account">Следить за статусом в кабинете</button>
    </div>`);
}

function draw() {
  updateBadge();
  if (!dlg().open && view !== 'cart') return;
  if (view === 'cart') renderCart();
  else if (view === 'checkout') renderCheckout();
  else renderDone();
}

function open(v = 'cart') {
  view = v;
  draw();
  openDlg(dlg());
}

async function submitOrder(form) {
  const err = $('#coError');
  showError(err, '');
  if (!state.user) { openAuth('login'); showError(err, 'Войдите в аккаунт, чтобы оформить заказ'); return; }
  const f = form.elements;
  const time = f.time.value;
  const dayDate = f.day.value === 'today' ? state.config.now.date : addDays(state.config.now.date, 1);
  const btn = $('button[type=submit]', form);
  busy(btn, true, 'Отправляем…');
  try {
    const { order } = await api.post('/orders', {
      items: lines().map((l) => ({ id: l.item.id, qty: l.qty })),
      address: f.address.value,
      phone: f.phone.value,
      deliverAt: time === 'asap' ? 'asap' : `${dayDate}T${time}`,
      payment: f.payment.value,
      comment: f.comment.value,
    });
    lastOrder = order;
    clear();
    view = 'done';
    draw();
    toast(`Заказ №${order.id} принят`, 'success');
  } catch (e) {
    showError(err, e.message);
    busy(btn, false);
  }
}

export function initCart() {
  load();
  $('#cartBtn').addEventListener('click', () => open('cart'));

  registerActions({
    qty: (el) => {
      const id = Number(el.dataset.id);
      const row = items.find((i) => i.id === id);
      if (row) setQty(id, row.qty + Number(el.dataset.d));
    },
    rm: (el) => setQty(Number(el.dataset.id), 0),
    'to-checkout': () => { view = 'checkout'; draw(); },
    'back-cart': () => { view = 'cart'; draw(); },
    'goto-menu': () => { closeDlg(dlg()); location.hash = '#menu'; },
    'open-cart': () => open('cart'),
  });

  box().addEventListener('submit', (e) => {
    if (e.target.id === 'checkoutForm') { e.preventDefault(); submitOrder(e.target); }
  });
  box().addEventListener('change', (e) => {
    if (e.target.id === 'coDay') {
      day = e.target.value;
      $('#coTime').innerHTML = timeOptions(day).s;
    }
  });

  on('cart', draw);
  on('menu', draw);
  on('user', () => { if (dlg().open && view !== 'done') draw(); });
  dlg().addEventListener('close', () => { if (view === 'done') view = 'cart'; });
  draw();
}

