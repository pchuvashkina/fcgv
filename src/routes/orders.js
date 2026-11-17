'use strict';
const express = require('express');
const cfg = require('../config');
const db = require('../db');
const v = require('../validate');
const { HttpError, cafeNow, addDays, parseHM, wrap, ts } = require('../utils');
const { requireAuth } = require('../auth');

const router = express.Router();
const C = cfg.cafe;

/** Проверка времени доставки: «asap» или «YYYY-MM-DDTHH:MM» на сегодня/завтра */
function resolveDeliverAt(value) {
  const now = cafeNow();
  if (value === 'asap') {
    if (now.minutes < C.deliveryFromMin || now.minutes > C.deliveryToMin - 30) {
      throw new HttpError(400, 'Сейчас доставка не работает — выберите удобное время');
    }
    return 'asap';
  }
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(value));
  if (!m) throw new HttpError(400, 'Выберите время доставки');
  const [, date, hm] = m;
  const min = parseHM(hm);
  const tomorrow = addDays(now.date, 1);
  if (min === null || (date !== now.date && date !== tomorrow)) throw new HttpError(400, 'Доставка возможна на сегодня или завтра');
  if (min < C.deliveryFromMin || min > C.deliveryToMin) throw new HttpError(400, 'Доставляем ежедневно с 11:00 до 22:00');
  if (date === now.date && min < now.minutes + 30) throw new HttpError(400, 'Выберите время минимум через 30 минут');
  return `${date}T${hm}`;
}

const loadItems = async (orderIds) => {
  if (!orderIds.length) return new Map();
  const params = Object.fromEntries(orderIds.map((id, i) => [`o${i}`, id]));
  const rows = await db.query(`SELECT * FROM order_items WHERE order_id IN (${orderIds.map((_, i) => `@o${i}`).join(',')}) ORDER BY id`, params);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.order_id)) map.set(r.order_id, []);
    map.get(r.order_id).push({ name: r.name, priceCents: r.price_cents, qty: r.qty });
  }
  return map;
};

const toOrder = (o, items) => ({
  id: o.id, status: o.status, address: o.address, phone: o.phone, deliverAt: o.deliver_at,
  comment: o.comment, payment: o.payment, subtotalCents: o.subtotal_cents,
  deliveryFeeCents: o.delivery_fee_cents, totalCents: o.total_cents, createdAt: ts(o.created_at),
  items: items || [],
});

router.post('/', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const address = v.text(b.address, 'Адрес', { min: 8, max: 200 });
  const phone = v.phone(b.phone);
  const comment = v.text(b.comment, 'Комментарий', { max: 300, optional: true });
  if (!['cash', 'card_courier'].includes(b.payment)) throw new HttpError(400, 'Выберите способ оплаты');
  const deliverAt = resolveDeliverAt(b.deliverAt);

  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 40) throw new HttpError(400, 'Корзина пуста');
  const qtyById = new Map();
  for (const it of b.items) {
    const id = v.int(it && it.id, 'Блюдо', 1, 1e9);
    const qty = v.int(it && it.qty, 'Количество', 1, 20);
    qtyById.set(id, (qtyById.get(id) || 0) + qty);
  }

  const lines = [];
  let subtotal = 0;
  for (const [id, qty] of qtyById) {
    if (qty > 20) throw new HttpError(400, 'Не более 20 порций одного блюда');
    // Цены берём ТОЛЬКО из базы — клиентским значениям не доверяем
    const item = await db.one('SELECT * FROM menu_items WHERE id = @id AND available = 1', { id });
    if (!item) throw new HttpError(400, 'Одно из блюд больше недоступно — обновите корзину');
    lines.push({ item, qty });
    subtotal += item.price_cents * qty;
  }
  if (subtotal < C.minOrderCents) throw new HttpError(400, `Минимальная сумма заказа — ${(C.minOrderCents / 100).toFixed(2)} €`);
  const fee = subtotal >= C.freeDeliveryFromCents ? 0 : C.deliveryFeeCents;

  // Заказ и его позиции сохраняются в одной транзакции: либо всё, либо ничего
  const orderId = await db.transaction(async (tx) => {
    const [{ id }] = await tx.query(
      `INSERT INTO orders (user_id, address, phone, deliver_at, comment, payment, subtotal_cents, delivery_fee_cents, total_cents)
       OUTPUT INSERTED.id
       VALUES (@uid, @address, @phone, @deliverAt, @comment, @payment, @subtotal, @fee, @total)`,
      { uid: req.user.id, address, phone, deliverAt, comment, payment: b.payment, subtotal, fee, total: subtotal + fee });
    for (const { item, qty } of lines) {
      await tx.query(
        'INSERT INTO order_items (order_id, item_id, name, price_cents, qty) VALUES (@oid, @iid, @name, @price, @qty)',
        { oid: id, iid: item.id, name: item.name, price: item.price_cents, qty });
    }
    return id;
  });

  const order = await db.one('SELECT * FROM orders WHERE id = @id', { id: orderId });
  res.status(201).json({ order: toOrder(order, (await loadItems([orderId])).get(orderId)) });
}));

router.get('/my', requireAuth, wrap(async (req, res) => {
  const orders = await db.query('SELECT TOP 50 * FROM orders WHERE user_id = @uid ORDER BY id DESC', { uid: req.user.id });
  const items = await loadItems(orders.map((o) => o.id));
  res.json({ orders: orders.map((o) => toOrder(o, items.get(o.id))) });
}));

router.post('/:id/cancel', requireAuth, wrap(async (req, res) => {
  const id = v.int(req.params.id, 'Заказ', 1, 1e9);
  const done = await db.query("UPDATE orders SET status='cancelled' OUTPUT INSERTED.id WHERE id = @id AND user_id = @uid AND status = 'new'", { id, uid: req.user.id });
  if (!done.length) throw new HttpError(400, 'Заказ нельзя отменить: он уже принят в работу');
  res.json({ ok: true });
}));

module.exports = router;
module.exports.toOrder = toOrder;
module.exports.loadItems = loadItems;
