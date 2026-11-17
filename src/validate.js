'use strict';
const { HttpError } = require('./utils');

const bad = (msg) => { throw new HttpError(400, msg); };

/** Строка: обрезка пробелов, удаление управляющих символов, проверка длины */
function text(v, label, { min = 1, max = 200, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    bad(`Поле «${label}» обязательно`);
  }
  if (typeof v !== 'string') bad(`Поле «${label}» заполнено неверно`);
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (!s && optional) return '';
  if (s.length < min) bad(`Поле «${label}»: минимум ${min} симв.`);
  if (s.length > max) bad(`Поле «${label}»: максимум ${max} симв.`);
  return s;
}

function email(v) {
  const s = text(v, 'Email', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) bad('Введите корректный email');
  return s;
}

function phone(v, optional = false) {
  const s = text(v, 'Телефон', { max: 25, optional });
  if (!s) return '';
  if (!/^\+?[0-9][0-9\s().-]{6,19}$/.test(s)) bad('Введите корректный телефон');
  return s;
}

function password(v) {
  if (typeof v !== 'string') bad('Введите пароль');
  if (v.length < 8) bad('Пароль: минимум 8 символов');
  if (Buffer.byteLength(v) > 72) bad('Пароль слишком длинный (не более 72 байт)');
  if (!/[A-Za-zА-Яа-яЁё]/.test(v) || !/\d/.test(v)) bad('Пароль должен содержать букву и цифру');
  return v;
}

function int(v, label, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad(`Поле «${label}»: число от ${min} до ${max}`);
  return n;
}

/** Изображение блюда: путь Unsplash вида photo-123-abc ИЛИ полная https-ссылка */
function image(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') bad('Фото указано неверно');
  const s = v.trim();
  if (/^photo-[0-9]+-[0-9a-f]+$/i.test(s)) return s;
  if (s.length <= 400 && /^https:\/\/[^\s"'<>]+$/.test(s)) return s;
  return bad('Фото: путь вида photo-123…-abc или ссылка https://…');
}

module.exports = { text, email, phone, password, int, image, bad };
