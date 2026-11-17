'use strict';
const jwt = require('jsonwebtoken');
const cfg = require('./config');
const db = require('./db');
const { HttpError } = require('./utils');

const COOKIE = 'thalassa_token';

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });

function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, cfg.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: cfg.tokenTtl,
    issuer: 'thalassa',
  });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,                 // недоступна из JS → защита от кражи токена через XSS
    sameSite: 'strict',             // защита от CSRF
    secure: cfg.isProd,             // только HTTPS в production
    maxAge: cfg.cookieMaxAgeMs,
    path: '/',
  });
}

const clearAuthCookie = (res) => res.clearCookie(COOKIE, { path: '/' });

function readToken(req) {
  if (req.cookies && req.cookies[COOKIE]) return req.cookies[COOKIE];
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Определяет пользователя (если есть валидный токен). Роль берётся из БД, а не из токена. */
async function authOptional(req, _res, next) {
  req.user = null;
  const token = readToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'], issuer: 'thalassa' });
      req.user = (await db.one('SELECT id, name, email, phone, role FROM users WHERE id = @id', { id: Number(payload.sub) })) || null;
    } catch {
      /* просроченный или поддельный токен (или БД недоступна) → гость */
    }
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Войдите в аккаунт, чтобы продолжить'));
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Требуется вход'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Доступ только для администратора'));
  next();
}

/** Простая CSRF-защита: изменяющие запросы обязаны нести кастомный заголовок (кросс-сайт форма его поставить не может) */
function csrfGuard(req, _res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('x-requested-with') !== 'thalassa') {
    return next(new HttpError(403, 'Запрос отклонён'));
  }
  next();
}

module.exports = { signToken, setAuthCookie, clearAuthCookie, authOptional, requireAuth, requireAdmin, csrfGuard, publicUser };
