'use strict';
const cfg = require('./config');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Текущие дата и время в часовом поясе кафе: { date: 'YYYY-MM-DD', minutes } */
function cafeNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function parseHM(s) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Оборачивает async-обработчик Express 4, чтобы ошибки попадали в общий обработчик ошибок */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Date из БД → 'YYYY-MM-DD HH:MM:SS' (UTC) — формат, который ждёт фронтенд */
const ts = (d) => (d instanceof Date ? d.toISOString().slice(0, 19).replace('T', ' ') : d);

module.exports = { HttpError, cafeNow, addDays, fmtMin, parseHM, isRealDate, wrap, ts };
