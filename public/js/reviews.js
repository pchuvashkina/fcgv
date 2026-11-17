import { api } from './api.js';
import { state, on } from './store.js';
import { $, html, render, stars, toast, showError, busy, fmtDateLong } from './ui.js';
import { requireLogin } from './auth.js';
import { reveal } from './anim.js';

export async function loadReviews() {
  try {
    const data = await api.get('/reviews');
    draw(data);
  } catch (e) {
    render($('#reviewList'), html`<p class="empty">Не удалось загрузить отзывы.</p>`);
  }
}

function draw({ reviews, stats }) {
  const max = Math.max(1, ...Object.values(stats.distribution));
  render($('#ratingCard'), html`
    <div class="rating__big">${stats.count ? stats.average.toFixed(1).replace('.', ',') : '—'}</div>
    ${stars(stats.average)}
    <p class="rating__count">${stats.count} ${plural(stats.count, 'отзыв', 'отзыва', 'отзывов')}</p>
    <ul class="bars">
      ${[5, 4, 3, 2, 1].map((n) => html`
        <li><span>${n}</span><i style="--w:${Math.round((stats.distribution[n] / max) * 100)}%"></i><em>${stats.distribution[n]}</em></li>`)}
    </ul>`);

  render($('#reviewList'), reviews.length
    ? html`${reviews.map((r) => html`
        <article class="review card" data-reveal>
          <header>
            <span class="avatar avatar--lg">${r.author.trim().charAt(0).toUpperCase()}</span>
            <div><b>${r.author}</b><time>${fmtDateLong(r.createdAt.slice(0, 10))}</time></div>
            ${stars(r.rating)}
          </header>
          <p>${r.text}</p>
        </article>`)}`
    : html`<p class="empty">Пока нет отзывов — станьте первым!</p>`);
  reveal($('#reviewList'));
}

function plural(n, a, b, c) {
  const m10 = n % 10; const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return a;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return b;
  return c;
}

function hint() {
  $('#rvHint').textContent = state.user ? `Отзыв будет опубликован от имени «${state.user.name}»` : 'Чтобы оставить отзыв, нужно войти в аккаунт';
}

export function initReviews() {
  const form = $('#reviewForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#rvError');
    showError(err, '');
    if (!requireLogin('Войдите, чтобы оставить отзыв')) return;
    const rating = form.querySelector('input[name=rating]:checked');
    if (!rating) { showError(err, 'Поставьте оценку от 1 до 5 звёзд'); return; }
    const btn = $('button[type=submit]', form);
    busy(btn, true, 'Отправляем…');
    try {
      await api.post('/reviews', { rating: Number(rating.value), text: $('#rvText').value });
      form.reset();
      toast('Спасибо за отзыв!', 'success');
      await loadReviews();
    } catch (ex) {
      showError(err, ex.message);
    } finally {
      busy(btn, false);
    }
  });
  on('user', hint);
  hint();
}

