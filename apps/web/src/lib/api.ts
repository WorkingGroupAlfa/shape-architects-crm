const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const fallbackApiUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:4311/api'
  : 'https://shape-architects-crm-api.onrender.com/api';
const API_URL = (configuredApiUrl?.trim() || fallbackApiUrl).replace(/\/+$/, '');
const AUTH_TOKEN_KEY = 'shape_architects_auth_token';

export function getAuthToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY) ?? '';
}

export function setAuthToken(token: string) {
  if (!token) {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function authHeaders() {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(authHeaders())) {
    headers.set(key, value);
  }

  const response = await fetch(`${API_URL}${path}`, {
    headers,
    ...init
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload?.message) message = payload.message;
    } catch {
      // Ignore JSON parse errors and keep default message.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const api = {
  baseUrl: API_URL,
  authHeaders,
  getAuthToken,
  setAuthToken,
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' })
};
