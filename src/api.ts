export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  const response = await fetch('/api' + path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const message = response.status === 401 ? 'Сессия завершена. Войдите снова.'
      : response.status === 403 ? 'Недостаточно прав для этой операции.'
      : response.status === 400 || response.status === 409 ? 'Проверьте поля. Возможно, такой идентификатор уже существует.'
      : 'Сервер недоступен или не смог выполнить запрос. Повторите попытку.';
    throw new ApiError(response.status, message);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
