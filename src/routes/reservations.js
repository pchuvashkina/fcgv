'use strict';
const express = require('express');
const cfg = require('../config');
const db = require('../db');
const v = require('../validate');
const { HttpError, cafeNow, addDays, fmtMin, parseHM, isRealDate, wrap, ts } = require('../utils');
const { requireAuth } = require('../auth');

const router = express.Router();
const C = cfg.cafe;

/** Столики, занятые на пересекающемся интервале (бронь держит стол bookingDurationMin минут) */
async function bookedTableIds(date, startMin, run = db.query, lock = '') {
  const rows = await run(`SELECT DISTINCT table_id FROM reservations ${lock}
                          WHERE date = @date AND status IN ('pending','confirmed')
                            AND start_min > @from AND start_min < @to`,
  { date, from: startMin - C.bookingDurationMin, to: startMin + C.bookingDurationMin });
  return rows.map((r) => r.table_id);
}

function validateSlot(dateStr, timeStr) {
  if (!isRealDate(dateStr)) throw new HttpError(400, 'Выберите дату');
  const start = parseHM(timeStr);
  if (start === null) throw new HttpError(400, 'Выберите время');
  if (start < C.openMin || start > C.lastBookingMin || (start - C.openMin) % C.bookingStepMin !== 0) {
    throw new HttpError(400, 'Бронь возможна с 10:00 до 21:00 с шагом 30 минут');
  }
  const now = cafeNow();
  if (dateStr < now.date) throw new HttpError(400, 'Эта дата уже прошла');
  if (dateStr > addDays(now.date, C.bookingMaxDaysAhead)) throw new HttpError(400, `Бронь доступна на ${C.bookingMaxDaysAhead} дней вперёд`);
  if (dateStr === now.date && start < now.minutes) throw new HttpError(400, 'Это время уже прошло');
  return start;
}

const toRes = (r) => ({
  id: r.id, tableId: r.table_id, date: r.date, time: fmtMin(r.start_min), guests: r.guests,
  name: r.name, phone: r.phone, comment: r.comment, status: r.status, createdAt: ts(r.created_at),
});

/** Схема зала + статус столиков на выбранные дату/время */
router.get('/tables', wrap(async (req, res) => {
  const rows = await db.query('SELECT * FROM tables_cafe ORDER BY id');
  let booked = new Set();
  const { date, time } = req.query;
  if (date && time) {
    try { booked = new Set(await bookedTableIds(String(date), validateSlot(String(date), String(time)))); } catch { /* невалидный слот — просто без занятости */ }
  }
  res.json({
    tables: rows.map((t) => ({ id: t.id, zone: t.zone, seats: t.seats, shape: t.shape, x: t.x, y: t.y, w: t.w, h: t.h, booked: booked.has(t.id) })),
  });
}));

router.post('/', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const tableId = v.int(b.tableId, 'Столик', 1, 1000);
  const guests = v.int(b.guests, 'Гостей', 1, 12);
  const name = v.text(b.name, 'Имя', { min: 2, max: 60 });
  const phone = v.phone(b.phone);
  const comment = v.text(b.comment, 'Комментарий', { max: 300, optional: true });
  const start = validateSlot(String(b.date), String(b.time));

  const table = await db.one('SELECT * FROM tables_cafe WHERE id = @id', { id: tableId });
  if (!table) throw new HttpError(404, 'Такого столика нет');
  if (guests > table.seats) throw new HttpError(400, `За столиком №${table.id} — не более ${table.seats} гостей`);

  const now = cafeNow();
  const { c: active } = await db.one("SELECT COUNT(*) AS c FROM reservations WHERE user_id = @uid AND status != 'cancelled' AND date >= @date", { uid: req.user.id, date: now.date });
  if (active >= 5) throw new HttpError(400, 'У вас уже 5 активных броней — отмените лишние в личном кабинете');

  // Проверка и вставка в одной транзакции; UPDLOCK+HOLDLOCK блокирует диапазон строк,
  // поэтому два одновременных запроса не смогут занять один и тот же столик
  const reservation = await db.transaction(async (tx) => {
    const taken = await bookedTableIds(b.date, start, tx.query, 'WITH (UPDLOCK, HOLDLOCK)');
    if (taken.includes(tableId)) throw new HttpError(409, 'Этот столик уже занят на выбранное время');
    const [row] = await tx.query(
      `INSERT INTO reservations (user_id, table_id, date, start_min, guests, name, phone, comment)
       OUTPUT INSERTED.*
       VALUES (@uid, @tableId, @date, @start, @guests, @name, @phone, @comment)`,
      { uid: req.user.id, tableId, date: b.date, start, guests, name, phone, comment });
    return row;
  });

  res.status(201).json({ reservation: toRes(reservation) });
}));

router.get('/my', requireAuth, wrap(async (req, res) => {
  const rows = await db.query('SELECT TOP 50 * FROM reservations WHERE user_id = @uid ORDER BY date DESC, start_min DESC', { uid: req.user.id });
  res.json({ reservations: rows.map(toRes) });
}));

router.post('/:id/cancel', requireAuth, wrap(async (req, res) => {
  const id = v.int(req.params.id, 'Бронь', 1, 1e9);
  const done = await db.query("UPDATE reservations SET status='cancelled' OUTPUT INSERTED.id WHERE id = @id AND user_id = @uid AND status != 'cancelled'", { id, uid: req.user.id });
  if (!done.length) throw new HttpError(404, 'Бронь не найдена');
  res.json({ ok: true });
}));

module.exports = router;
module.exports.toRes = toRes;
