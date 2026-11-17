// Анимации: GSAP + ScrollTrigger. Если GSAP не загрузился (или включён режим «уменьшить движение») —
// сайт полностью работает без анимаций: контент просто виден сразу.
import { $, $$ } from './ui.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
let on = false;
let ready = false; // до инициализации reveal() ничего не делает, чтобы блоки не помечались «показанными» раньше времени
let io = null;

export function initAnim() {
  if (!window.gsap || reduced) { finishCounters(); ready = true; reveal(document); return; }
  const { gsap } = window;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
  on = true;
  document.documentElement.classList.add('anim-ready');

  io = new IntersectionObserver(onReveal, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  ready = true;
  reveal(document);
  heroIntro();
  if (window.ScrollTrigger) parallax();
  counters();
  if (fine) { magnetic(); tilt(); }
}

/* ---------- Появление блоков при скролле ---------- */
export function reveal(root = document) {
  if (!ready) return;
  const els = $$('[data-reveal]:not([data-revealed])', root);
  if (!on) { els.forEach((el) => el.setAttribute('data-revealed', '')); return; }
  els.forEach((el) => {
    const kind = el.dataset.reveal;
    const from = kind === 'left' ? { x: -70, opacity: 0 }
      : kind === 'right' ? { x: 70, opacity: 0 }
        : kind === 'zoom' ? { scale: 0.7, rotation: -8, opacity: 0 }
          : { y: 46, opacity: 0 };
    window.gsap.set(el, from);
    io.observe(el);
  });
}

function onReveal(entries) {
  const vis = entries.filter((e) => e.isIntersecting).sort((a, b) =>
    (a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  vis.forEach((entry, i) => {
    const el = entry.target;
    io.unobserve(el);
    el.setAttribute('data-revealed', '');
    window.gsap.to(el, {
      x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
      duration: 0.95, delay: i * 0.09, ease: 'power3.out', clearProps: 'transform',
    });
  });
}


function heroIntro() {
  const { gsap } = window;
  const title = $('#heroTitle');
  if (title && !title.querySelector('.char')) {
    const text = title.textContent;
    title.textContent = '';
    [...text].forEach((ch) => {
      const s = document.createElement('span');
      s.className = 'char';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = ch;
      title.appendChild(s);
    });
  }
  const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
  tl.from('.site-header', { yPercent: -100, duration: 0.8 })
    .from('.hero__eyebrow', { y: 24, opacity: 0, duration: 0.8 }, '-=0.4')
    .from('.hero__title .char', { yPercent: 130, rotate: 10, opacity: 0, duration: 1.15, stagger: 0.07 }, '-=0.55')
    .from('.hero__lead', { y: 26, opacity: 0, duration: 0.9 }, '-=0.65')
    .from('.hero__cta .btn', { y: 26, opacity: 0, scale: 0.9, stagger: 0.12, duration: 0.8 }, '-=0.55')
    .from('.hero__facts li', { y: 22, opacity: 0, stagger: 0.1, duration: 0.7 }, '-=0.5')
    .from('.lemon', { y: -340, rotate: -70, opacity: 0, stagger: 0.16, duration: 1.5, ease: 'bounce.out' }, '-=1.3')
    .from('.hero__sun', { scale: 0.6, opacity: 0, duration: 1.8, ease: 'power2.out' }, 0.1);


  gsap.to('.hero__sun', { rotation: 360, duration: 120, repeat: -1, ease: 'none' });
  [['.lemon--1', 16, 9, 3.4], ['.lemon--2', -12, -8, 4.2], ['.lemon--3', 10, 12, 3.8]].forEach(([sel, x, r, d]) =>
    gsap.to(sel, { x, rotation: r, duration: d, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
}

/* ---------- Параллакс ---------- */
function parallax() {
  const { gsap } = window;
  const st = (trigger, extra = {}) => ({ trigger, start: 'top bottom', end: 'bottom top', scrub: true, ...extra });
  gsap.to('.hero__bg', { yPercent: 22, scale: 1.12, ease: 'none', scrollTrigger: st('.hero', { start: 'top top' }) });
  gsap.to('.hero__content', { yPercent: -14, opacity: 0.1, ease: 'none', scrollTrigger: st('.hero', { start: 'top top', end: 'bottom 30%' }) });
  gsap.to('.hero__sun', { yPercent: 40, ease: 'none', scrollTrigger: st('.hero', { start: 'top top' }) });
  ['.lemon--1', '.lemon--2', '.lemon--3'].forEach((s, i) =>
    gsap.to(s, { yPercent: 60 + i * 35, ease: 'none', scrollTrigger: st('.hero', { start: 'top top' }) }));
  $$('[data-parallax]').forEach((el) => {
    const speed = parseFloat(el.dataset.parallax) || 0.1;
    gsap.fromTo(el, { y: speed * 220 }, { y: speed * -220, ease: 'none', scrollTrigger: st(el) });
  });
  const band = $('[data-band]');
  if (band) gsap.fromTo(band, { yPercent: -14 }, { yPercent: 14, ease: 'none', scrollTrigger: st('.band') });
}

/* ---------- Счётчики ---------- */
function counters() {
  const { gsap } = window;
  const cio = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    cio.unobserve(e.target);
    const el = e.target;
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const o = { v: 0 };
    gsap.to(o, { v: target, duration: 1.8, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(o.v) + suffix; } });
  }), { threshold: 0.6 });
  $$('[data-count]').forEach((el) => cio.observe(el));
}
function finishCounters() {
  $$('[data-count]').forEach((el) => { el.textContent = el.dataset.count + (el.dataset.suffix || ''); });
}

/* ---------- Магнитные кнопки ---------- */
function magnetic() {
  const { gsap } = window;
  $$('.btn--magnetic').forEach((btn) => {
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      gsap.to(btn, { x: (e.clientX - r.left - r.width / 2) * 0.28, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.35, ease: 'power3.out' });
    });
    btn.addEventListener('pointerleave', () => gsap.to(btn, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)' }));
  });
}

/* ---------- Наклон карточек блюд при наведении ---------- */
function tilt() {
  const { gsap } = window;
  const grid = $('#menuGrid');
  if (!grid) return;
  let last = null;
  const reset = (c) => c && gsap.to(c, { rotationX: 0, rotationY: 0, duration: 0.6, ease: 'power3.out' });
  grid.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.dish');
    if (last && last !== card) reset(last);
    last = card;
    if (!card) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    gsap.to(card, { rotationY: px * 7, rotationX: -py * 7, transformPerspective: 900, duration: 0.4, ease: 'power2.out' });
  });
  grid.addEventListener('pointerleave', () => { reset(last); last = null; });
}

/* ---------- Смена содержимого сетки меню ---------- */
export function swapContent(container, renderFn) {
  if (!on) { renderFn(); return; }
  window.gsap.to(container, {
    opacity: 0, y: 14, duration: 0.18, ease: 'power1.in',
    onComplete: () => { renderFn(); window.gsap.set(container, { opacity: 1, y: 0 }); reveal(container); },
  });
}

/* ---------- «Полёт» блюда в корзину ---------- */
export function flyToCart(fromEl) {
  const btn = $('#cartBtn');
  const bump = () => on && window.gsap.fromTo(btn, { scale: 1 }, { scale: 1.28, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out' });
  if (!on || !fromEl) { bump(); return; }
  const a = fromEl.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const dot = document.createElement('div');
  dot.className = 'fly';
  dot.style.left = `${a.left + a.width / 2 - 14}px`;
  dot.style.top = `${a.top + a.height / 2 - 14}px`;
  document.body.appendChild(dot);
  window.gsap.to(dot, {
    x: b.left + b.width / 2 - (a.left + a.width / 2),
    y: b.top + b.height / 2 - (a.top + a.height / 2),
    scale: 0.35, duration: 0.85, ease: 'power2.inOut',
    onComplete: () => { dot.remove(); bump(); },
  });
}

/* ---------- Подсветка выбранного столика ---------- */
export function pulse(el) {
  if (!on || !el) return;
  window.gsap.fromTo(el, { scale: 0.92 }, { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.45)', transformOrigin: '50% 50%' });
}
