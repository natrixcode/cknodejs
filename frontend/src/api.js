import { describeError } from './errors.js';

// Перші пояснення валідації, щоб користувач бачив, яке поле виправити.
function validationDetails(result) {
  const issues = Array.isArray(result?.errors) ? result.errors : [];
  const text = issues
    .slice(0, 3)
    .map(issue => issue.message)
    .filter(Boolean)
    .join('; ');

  return text ? `${result.message}: ${text}` : null;
}

export async function api(path, options = {}) {
  const { method = 'GET', body, token, signal } = options;
  const headers = { Accept: 'application/json' };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      signal,
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Немає зв’язку із сервером. Перевір, чи запущений Docker.');
  }

  if (response.status === 204) return null;

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    let message = result?.message || 'Не вдалося виконати запит.';
    const explained = describeError(result?.message);

    if (response.status === 401) {
      message = token
        ? 'Сесію завершено. Увійди знову.'
        : 'Перевір логін і пароль.';
    } else if (explained) {
      message = explained;
    } else if (response.status === 400 && validationDetails(result)) {
      message = validationDetails(result);
    } else if (response.status === 409 && !result?.message?.startsWith('KMS_')) {
      message = 'Такий запис уже існує: перевір пошту, телефон або назву.';
    } else if (response.status === 403) {
      message = 'Цей обліковий запис не має доступу до цих даних.';
    } else if (response.status >= 500) {
      message = 'Сервер недоступний. Перевір контейнери server і db.';
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (result?.status !== 'success') {
    throw new Error('Неочікувана відповідь API. Перевір порт бекенду.');
  }

  return result.data;
}