/**
 * SessionStorage-backed token persistence and refresh.
 * Provides helpers for reading/writing tokens, applying `x-new-token`,
 * and performing the `/api/auth/refresh` call used for 401 recovery.
 */

const TOKEN_KEY = 'token';
const REFRESH_TOKEN_KEY = 'refreshToken';

function getOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
}

function getHeaderValue(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  const direct = headers[name];
  if (direct != null) return direct;

  const lowered = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lowered) return v;
  }
  return null;
}

export function getAccessToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getRefreshToken() {
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Keep failures defensive; callers rely on stored token availability.
  }
}

export function setRefreshToken(refreshToken) {
  try {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch {
    // Defensive; see setAccessToken.
  }
}

export function removeTokens() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function applyNewTokenFromHeaders(headers) {
  const newToken = getHeaderValue(headers, 'x-new-token');
  if (!newToken) return null;

  setAccessToken(newToken);
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: newToken } }));
  }
  return newToken;
}

/**
 * Refresh access token using the current refresh token.
 * On failure: removes tokens and throws.
 */
export async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    removeTokens();
    throw new Error('No refresh token available');
  }

  try {
    const refreshUrl = `${getOrigin()}/api/auth/refresh`;
    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    const json = await res.json();
    const newToken = json?.token;
    if (!newToken) {
      removeTokens();
      throw new Error('No token in refresh response');
    }

    setAccessToken(newToken);
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: newToken } }));
    }
    return newToken;
  } catch (err) {
    removeTokens();
    throw err;
  }
}

