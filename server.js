'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const cfg = require('./src/config');
const db = require('./src/db');
const { authOptional, csrfGuard } = require('./src/auth');
const { HttpError } = require('./src/utils');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://cdnjs.cloudflare.com'],
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'style-src-attr': ["'unsafe-inline'"],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'https:'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': cfg.isProd ? [] : null,
    },
  },
}));

app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());

// API
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));
app.use('/api', authOptional, csrfGuard);
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/reservations', require('./src/routes/reservations'));
app.use('/api/reviews', require('./src/routes/reviews'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api', require('./src/routes/menu')); // /api/menu, /api/config
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Не найдено')));

// Статика
app.use(express.static(path.join(cfg.ROOT, 'public'), { maxAge: cfg.isProd ? '1h' : 0 }));

// Ошибки
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
  console.error(err);
  // вне production показываем причину прямо в ответе — так проще отлаживать
  res.status(500).json({ error: cfg.isProd ? 'Внутренняя ошибка сервера' : `Внутренняя ошибка сервера: ${err.message}` });
});

async function start() {
  try {
    await db.init(); // подключение к MS SQL, создание таблиц и стартовых данных
  } catch (err) {
    console.error('\n  ✖ Не удалось подключиться к MS SQL Server:', err.message);
    console.error(`    Проверьте, что сервер БД запущен и данные в .env верны (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME).\n`);
    process.exit(1);
  }

  const server = app.listen(cfg.port);
  server.once('listening', () => {
    console.log(`\n  🍋 Thalassa запущена: http://localhost:${cfg.port}\n`);
  });
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ✖ Порт ${cfg.port} уже занят — скорее всего, сервер уже запущен в другом окне терминала.`);
      console.error(`    Остановите его (Ctrl+C) или найдите процесс:  lsof -ti :${cfg.port} | xargs kill`);
      console.error('    Либо запустите на другом порту:  PORT=3002 node server.js\n');
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

start();
