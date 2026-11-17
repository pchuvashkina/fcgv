'use strict';
const express = require('express');
const cfg = require('../config');
const db = require('../db');
const { cafeNow, wrap } = require('../utils');

const router = express.Router();

const toItem = (r) => ({
  id: r.id, category: r.category, name: r.name, description: r.description,
  priceCents: r.price_cents, image: r.image, available: !!r.available,
});

router.get('/menu', wrap(async (_req, res) => {
  const rows = await db.query('SELECT * FROM menu_items WHERE available = 1 ORDER BY sort, id');
  res.json({ categories: cfg.categories, items: rows.map(toItem) });
}));

/** Публичные параметры заведения (часы работы, условия доставки) */
router.get('/config', (_req, res) => {
  const c = cfg.cafe;
  res.json({
    openMin: c.openMin, closeMin: c.closeMin, lastBookingMin: c.lastBookingMin,
    bookingStepMin: c.bookingStepMin, bookingDurationMin: c.bookingDurationMin,
    bookingMaxDaysAhead: c.bookingMaxDaysAhead,
    deliveryFromMin: c.deliveryFromMin, deliveryToMin: c.deliveryToMin,
    deliveryFeeCents: c.deliveryFeeCents, freeDeliveryFromCents: c.freeDeliveryFromCents,
    minOrderCents: c.minOrderCents,
    now: cafeNow(), // { date, minutes } в часовом поясе кафе
  });
});

module.exports = router;
module.exports.toItem = toItem;
