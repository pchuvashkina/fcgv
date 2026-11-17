'use strict';
const express = require('express');
const cfg = require('../config');
const db = require('../db');
const v = require('../validate');
const { HttpError, cafeNow, isRealDate, wrap } = require('../utils');
const { requireAdmin } = require('../auth');
const { toItem } = require('./menu');
const { toOrder, loadItems } = require('./orders');
const { toRes } = require('./reservations');

const router = express.Router();
router.use(requireAdmin); // ВСЕ маршруты ниже доступны только администратору

const ORDER_STATUSES = ['new', 'cooking', 'delivering', 'done', 'cancelled'];
const RES_STATUSES = ['pending', 'confirmed', 'cancelled'];
const idParam = (req) => v.int(req.params.id, 'ID', 1, 1e9);

router.get('/stats', wrap(async (_req, res) => {
  const now = cafeNow();
  const c = (text, params) => db.one(text, params);
  const [ordersToday, newOrders, revenue, upcoming, pending, clients, rating, reviews] = await Promise.all([
    c("SELECT COUNT(*) AS v FROM orders WHERE CAST(created_at AS DATE) = CAST(SYSUTCDATETIME() AS DATE)"),
    c("SELECT COUNT(*) AS v FROM orders WHERE status = 'new'"),
    c("SELECT COALESCE(SUM(total_cents),0) AS v FROM orders WHERE CAST(created_at AS DATE) = CAST(SYSUTCDATETIME() AS DATE) AND status != 'cancelled'"),
    c("SELECT COUNT(*) AS v FROM reservations WHERE date >= @date AND status != 'cancelled'", { date: now.date }),
    c("SELECT COUNT(*) AS v FROM reservations WHERE status = 'pending'"),
    c("SELECT COUNT(*) AS v FROM users WHERE role = 'client'"),
    c('SELECT COALESCE(AVG(CAST(rating AS FLOAT)),0) AS v FROM reviews'),
    c('SELECT COUNT(*) AS v FROM reviews'),
  ]);
  res.json({
    ordersToday: ordersToday.v,
    newOrders: newOrders.v,
    revenueTodayCents: revenue.v,
    upcomingReservations: upcoming.v,
    pendingReservations: pending.v,
    clients: clients.v,
    averageRating: Math.round(rating.v * 10) / 10,
    reviews: reviews.v,
  });
}));

/* ---------- Заказы ---------- */
router.get('/orders', wrap(async (req, res) => {
  const { status } = req.query;
  if (status && !ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Неизвестный статус');
  const rows = await db.query(`SELECT TOP 200 o.*, u.name AS user_name, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id
                               ${status ? 'WHERE o.status = @status' : ''} ORDER BY o.id DESC`, status ? { status } : {});
  const items = await loadItems(rows.map((r) => r.id));
  res.json({ orders: rows.map((o) => ({ ...toOrder(o, items.get(o.id)), customer: o.user_name, email: o.user_email })) });
}));

router.patch('/orders/:id', wrap(async (req, res) => {
  const status = (req.body || {}).status;
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Неизвестный статус');
  const done = await db.query('UPDATE orders SET status = @status OUTPUT INSERTED.id WHERE id = @id', { status, id: idParam(req) });
  if (!done.length) throw new HttpError(404, 'Заказ не найден');
  res.json({ ok: true });
}));

/* ---------- Бронирования ---------- */
router.get('/reservations', wrap(async (req, res) => {
  const { date } = req.query;
  if (date && !isRealDate(String(date))) throw new HttpError(400, 'Некорректная дата');
  const rows = await db.query(`SELECT TOP 300 r.*, u.email AS user_email FROM reservations r JOIN users u ON u.id = r.user_id
                               ${date ? 'WHERE r.date = @date' : ''} ORDER BY r.date DESC, r.start_min DESC`, date ? { date: String(date) } : {});
  const tables = new Map((await db.query('SELECT id, zone FROM tables_cafe')).map((t) => [t.id, t.zone]));
  res.json({ reservations: rows.map((r) => ({ ...toRes(r), email: r.user_email, zone: tables.get(r.table_id) })) });
}));

router.patch('/reservations/:id', wrap(async (req, res) => {
  const status = (req.body || {}).status;
  if (!RES_STATUSES.includes(status)) throw new HttpError(400, 'Неизвестный статус');
  const done = await db.query('UPDATE reservations SET status = @status OUTPUT INSERTED.id WHERE id = @id', { status, id: idParam(req) });
  if (!done.length) throw new HttpError(404, 'Бронь не найдена');
  res.json({ ok: true });
}));

/* ---------- Меню ---------- */
function parseMenuBody(b = {}) {
  const category = cfg.categories.find((c) => c.id === b.category);
  if (!category) throw new HttpError(400, 'Выберите категорию');
  return {
    category: category.id,
    name: v.text(b.name, 'Название', { min: 2, max: 80 }),
    description: v.text(b.description, 'Описание', { min: 5, max: 240 }),
    priceCents: v.int(b.priceCents, 'Цена (в центах)', 50, 100000),
    image: v.image(b.image),
    available: b.available === false || b.available === 0 ? 0 : 1,
  };
}

router.get('/menu', wrap(async (_req, res) => {
  res.json({ categories: cfg.categories, items: (await db.query('SELECT * FROM menu_items ORDER BY sort, id')).map(toItem) });
}));

router.post('/menu', wrap(async (req, res) => {
  const m = parseMenuBody(req.body);
  const item = await db.one(
    `INSERT INTO menu_items (category, name, description, price_cents, image, available, sort)
     OUTPUT INSERTED.*
     VALUES (@category, @name, @description, @priceCents, @image, @available,
             (SELECT COALESCE(MAX(sort),0)+1 FROM menu_items))`, m);
  res.status(201).json({ item: toItem(item) });
}));

router.put('/menu/:id', wrap(async (req, res) => {
  const m = parseMenuBody(req.body);
  const item = await db.one(
    `UPDATE menu_items SET category=@category, name=@name, description=@description, price_cents=@priceCents, image=@image, available=@available
     OUTPUT INSERTED.* WHERE id = @id`, { ...m, id: idParam(req) });
  if (!item) throw new HttpError(404, 'Блюдо не найдено');
  res.json({ item: toItem(item) });
}));

router.delete('/menu/:id', wrap(async (req, res) => {
  const done = await db.query('DELETE FROM menu_items OUTPUT DELETED.id WHERE id = @id', { id: idParam(req) });
  if (!done.length) throw new HttpError(404, 'Блюдо не найдено');
  res.json({ ok: true });
}));

/* ---------- Отзывы (модерация) ---------- */
router.delete('/reviews/:id', wrap(async (req, res) => {
  const done = await db.query('DELETE FROM reviews OUTPUT DELETED.id WHERE id = @id', { id: idParam(req) });
  if (!done.length) throw new HttpError(404, 'Отзыв не найден');
  res.json({ ok: true });
}));

module.exports = router;
