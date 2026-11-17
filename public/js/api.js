// Тонкая обёртка над fetch. Токен JWT хранится в httpOnly-cookie (недоступна из JS),
// заголовок X-Requested-With — часть CSRF-защиты на сервере.
async function request(method, url, body) {
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'thalassa' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('Нет связи с сервером. Проверьте соединение.'), { status: 0 });
  }
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) {
    throw Object.assign(new Error((data && data.error) || 'Что-то пошло не так. Попробуйте ещё раз.'), { status: res.status });
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
  patch: (u, b = {}) => request('PATCH', u, b),
  del: (u) => request('DELETE', u),
};
