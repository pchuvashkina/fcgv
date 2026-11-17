// Простое глобальное состояние и шина событий
export const state = {
  user: null,
  menu: { categories: [], items: [] },
  config: null,
  configAt: 0,
};

const bus = new EventTarget();
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

/** Текущее время кафе в минутах от полуночи (с поправкой на время, прошедшее с загрузки конфига) */
export function cafeMinutesNow() {
  if (!state.config) return 0;
  return state.config.now.minutes + Math.floor((Date.now() - state.configAt) / 60000);
}
