import { api } from './api.js';
import { state, emit } from './store.js';
import { $, $$, initDialogs, initActions, money } from './ui.js';
import { SCENES, imgUrl } from './images.js';
import { initAnim } from './anim.js';
import { initAuth, loadUser } from './auth.js';
import { initMenu, loadMenu } from './menu.js';
import { initCart } from './cart.js';
import { initBooking } from './booking.js';
import { initReviews, loadReviews } from './reviews.js';
import { initAccount } from './account.js';
import { initAdmin } from './admin.js';

/* Фото сцен: <img data-img="hero" data-w="1800"> */
function setSceneImages() {
  $$('img[data-img]').forEach((img) => {
    const src = imgUrl(SCENES[img.dataset.img], Number(img.dataset.w) || 1200);
    if (src) img.src = src;
  });
}

// Если фото не загрузилось — прячем «битую» картинку, под ней остаётся градиентный фон
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.classList.add('img-failed');
}, true);

function initChrome() {
  const header = $('#siteHeader');
  const onScroll = () => header.classList.toggle('is-solid', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const burger = $('#burger');
  const nav = $('#nav');
  burger.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) { nav.classList.remove('is-open'); burger.setAttribute('aria-expanded', 'false'); }
  });
}

function fillConfigTexts() {
  const c = state.config;
  if (!c) return;
  $('#cfgFee').textContent = money(c.deliveryFeeCents);
  $('#cfgFree').textContent = money(c.freeDeliveryFromCents);
  $('#cfgMin').textContent = money(c.minOrderCents);
}

async function boot() {
  initDialogs();
  initActions();
  setSceneImages();
  initChrome();
  initAuth();
  initAccount();
  initAdmin();

  // Параллельно грузим всё, что нужно для первого экрана
  const [cfg, , , ] = await Promise.allSettled([
    api.get('/config'),
    loadUser(),
    loadMenu(),
    loadReviews(),
  ]);
  if (cfg.status === 'fulfilled') { state.config = cfg.value; state.configAt = Date.now(); }
  fillConfigTexts();

  initMenu();
  initCart();
  initReviews();
  if (state.config) initBooking();

  emit('user', state.user);
  initAnim();
}

boot();
