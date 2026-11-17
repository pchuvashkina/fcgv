'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const cfg = require('../config');
const db = require('../db');
const v = require('../validate');
const { HttpError, wrap } = require('../utils');
const { signToken, setAuthCookie, clearAuthCookie, publicUser } = require('../auth');

const router = express.Router();

const limiter = (max, windowMin, message) => rateLimit({
  windowMs: windowMin * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, message)),
});
const loginLimiter = limiter(10, 15, 'Слишком много попыток входа. Попробуйте через 15 минут.');
const registerLimiter = limiter(10, 60, 'Слишком много регистраций с этого адреса. Попробуйте позже.');

// Хэш-«пустышка»: выравнивает время ответа, чтобы нельзя было узнать, существует ли email
const DUMMY_HASH = bcrypt.hashSync('dummy-password-1', cfg.bcryptRounds);

router.post('/register', registerLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const name = v.text(b.name, 'Имя', { min: 2, max: 60 });
  const email = v.email(b.email);
  const phone = v.phone(b.phone, true);
  const password = v.password(b.password);

  if (await db.one('SELECT 1 AS x FROM users WHERE email = @email', { email })) {
    throw new HttpError(409, 'Пользователь с таким email уже зарегистрирован');
  }
  const hash = bcrypt.hashSync(password, cfg.bcryptRounds);
  // Роль всегда «client»: поле role из запроса игнорируется полностью
  // INSERT и SELECT отдельными запросами (без OUTPUT — он не работает с таблицами, у которых есть триггеры)
  await db.query(
    "INSERT INTO users (name, email, phone, password_hash, role) VALUES (@name, @email, @phone, @hash, 'client')",
    { name, email, phone, hash });
  const user = await db.one('SELECT id, name, email, phone, role FROM users WHERE email = @email', { email });
  setAuthCookie(res, signToken(user));
  res.status(201).json({ user: publicUser(user) });
}));

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  if (typeof b.email !== 'string' || typeof b.password !== 'string') throw new HttpError(400, 'Введите email и пароль');
  const row = await db.one('SELECT * FROM users WHERE email = @email', { email: b.email.trim().toLowerCase() });
  const ok = bcrypt.compareSync(b.password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw new HttpError(401, 'Неверный email или пароль');
  setAuthCookie(res, signToken(row));
  res.json({ user: publicUser(row) });
}));

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

module.exports = router;
