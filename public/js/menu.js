import { api } from './api.js';
import { state, on, emit } from './store.js';
import { $, $$, html, render, money, registerActions, toast } from './ui.js';
import { imgUrl } from './images.js';
import { reveal, swapContent, flyToCart } from './anim.js';
import * as cart from './cart.js';

let active = null;

/** Загружает меню с сервера и сообщает подписчикам */
export async function loadMenu() {
  const data = await api.get('/menu');
  state.menu = data;
  emit('menu');
}

function tabsHtml() {
  return html`<span class="tabs__ink" aria-hidden="true"></span>${state.menu.categories.map((c) => html`
    <button type="button" role="tab" class="tabs__btn ${c.id === active ? 'is-on' : ''}" aria-selected="${c.id === active}" data-action="cat" data-cat="${c.id}">${c.title}</button>`)}`;
}

function dishHtml(m) {
  return html`
    <article class="dish" data-reveal>
      <div class="dish__img">
        <img src="${imgUrl(m.image, 700)}" alt="${m.name}" loading="lazy" decoding="async">
        <span class="dish__price">${money(m.priceCents)}</span>
      </div>
      <div class="dish__body">
        <h3>${m.name}</h3>
        <p>${m.description}</p>
        <button type="button" class="dish__add" data-action="add" data-id="${m.id}" aria-label="Добавить в корзину: ${m.name}">
          <span>В корзину</span>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    </article>`;
}

function gridHtml() {
  const items = state.menu.items.filter((m) => m.category === active);
  if (!items.length) return html`<p class="empty">В этой категории пока нет блюд.</p>`;
  return html`${items.map(dishHtml)}`;
}

function positionInk() {
  const tabs = $('#menuTabs');
  const btn = $('.tabs__btn.is-on', tabs);
  const ink = $('.tabs__ink', tabs);
  if (!btn || !ink) return;
  ink.style.width = `${btn.offsetWidth}px`;
  ink.style.transform = `translateX(${btn.offsetLeft}px)`;
}

function renderAll() {
  if (!state.menu.categories.length) {
    render($('#menuGrid'), html`<p class="empty">Не удалось загрузить меню. Обновите страницу.</p>`);
    return;
  }
  if (!active || !state.menu.categories.some((c) => c.id === active)) active = state.menu.categories[0].id;
  render($('#menuTabs'), tabsHtml());
  render($('#menuGrid'), gridHtml());
  reveal($('#menuGrid'));
  requestAnimationFrame(positionInk);
}

export function initMenu() {
  registerActions({
    cat: (el) => {
      if (el.dataset.cat === active) return;
      active = el.dataset.cat;
      $$('.tabs__btn', $('#menuTabs')).forEach((b) => {
        const on_ = b.dataset.cat === active;
        b.classList.toggle('is-on', on_);
        b.setAttribute('aria-selected', String(on_));
      });
      positionInk();
      swapContent($('#menuGrid'), () => { render($('#menuGrid'), gridHtml()); });
    },
    add: (el) => {
      const id = Number(el.dataset.id);
      const dish = state.menu.items.find((m) => m.id === id);
      cart.add(id);
      flyToCart(el.closest('.dish')?.querySelector('.dish__img') || el);
      toast(`«${dish ? dish.name : 'Блюдо'}» добавлено в корзину`, 'success');
    },
  });
  window.addEventListener('resize', positionInk);
  on('menu', renderAll);
  renderAll();
}
