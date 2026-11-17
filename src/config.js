'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Мини-загрузчик .env (без внешних зависимостей)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const isProd = process.env.NODE_ENV === 'production';

/** Секрет для подписи JWT: из окружения либо генерируется один раз и хранится в data/.jwt_secret */
function loadJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (isProd) throw new Error('В production необходимо задать JWT_SECRET (минимум 32 символа).');
  const file = path.join(DATA_DIR, '.jwt_secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const DEFAULT_ADMIN_PASSWORD = 'Admin#Thalassa2026';

module.exports = {
  isProd,
  ROOT,
  DATA_DIR,
  port: Number(process.env.PORT) || 3001,
  jwtSecret: loadJwtSecret(),
  tokenTtl: '2h',
  cookieMaxAgeMs: 2 * 60 * 60 * 1000,
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@thalassa.gr').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_PASSWORD,
  tz: process.env.CAFE_TZ || 'Europe/Athens',
  bcryptRounds: 12,
  categories: [
    { id: 'salads', title: 'Салаты' },
    { id: 'starters', title: 'Закуски' },
    { id: 'drinks', title: 'Напитки' },
    { id: 'mains', title: 'Основные блюда' },
    { id: 'desserts', title: 'Десерты' },
  ],
  cafe: {
    openMin: 10 * 60,          // 10:00
    closeMin: 23 * 60,         // 23:00
    lastBookingMin: 21 * 60,   // последний старт брони 21:00
    bookingStepMin: 30,
    bookingDurationMin: 120,   // бронь держит стол 2 часа
    bookingMaxDaysAhead: 60,
    deliveryFromMin: 11 * 60,
    deliveryToMin: 22 * 60,
    deliveryFeeCents: 350,
    freeDeliveryFromCents: 4000,
    minOrderCents: 1500,
  },
};
