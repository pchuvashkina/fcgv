'use strict';
const express = require('express');
const db = require('../db');
const v = require('../validate');
const { HttpError, wrap, ts } = require('../utils');
const { requireAuth } = require('../auth');

const router = express.Router();

const toReview = (r) => ({ id: r.id, author: r.author_name, rating: r.rating, text: r.text, createdAt: ts(r.created_at) });

router.get('/', wrap(async (_req, res) => {
  const rows = await db.query('SELECT TOP 100 * FROM reviews ORDER BY id DESC');
  const agg = await db.one('SELECT COUNT(*) AS c, AVG(CAST(rating AS FLOAT)) AS a FROM reviews');
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of await db.query('SELECT rating, COUNT(*) AS c FROM reviews GROUP BY rating')) dist[r.rating] = r.c;
  res.json({
    reviews: rows.map(toReview),
    stats: { count: agg.c, average: agg.a ? Math.round(agg.a * 10) / 10 : 0, distribution: dist },
  });
}));

router.post('/', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const rating = v.int(b.rating, 'Оценка', 1, 5);
  const text = v.text(b.text, 'Отзыв', { min: 10, max: 600 });
  const { c: recent } = await db.one('SELECT COUNT(*) AS c FROM reviews WHERE user_id = @uid AND created_at > DATEADD(day, -1, SYSUTCDATETIME())', { uid: req.user.id });
  if (recent >= 1) throw new HttpError(429, 'Спасибо! Новый отзыв можно оставить через сутки');
  const review = await db.one(
    'INSERT INTO reviews (user_id, author_name, rating, text) OUTPUT INSERTED.* VALUES (@uid, @author, @rating, @text)',
    { uid: req.user.id, author: req.user.name, rating, text });
  res.status(201).json({ review: toReview(review) });
}));

module.exports = router;
