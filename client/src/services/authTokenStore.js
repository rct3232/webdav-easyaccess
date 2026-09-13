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

// Single-flight guard: refresh rotates the refresh token (single-use), so two
// concurrent 401 recoveries must not both spend the same id — the loser would
// 401 and force a logout. Concurrent callers share the one in-flight attempt.
let refreshInFlight = null;

/**
 * Refresh access token using the current refresh token. The server ROTATES:
 * the response carries a fresh refresh token which replaces the stored one.
 * On failure: removes tokens and throws.
 */
export async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
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

      if (json.refreshToken) {
        setRefreshToken(json.refreshToken);
      }
      setAccessToken(newToken);
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: newToken } }));
      }
      return newToken;
    } catch (err) {
      removeTokens();
      throw err;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Best-effort server-side revocation of the current refresh token (DEF-22
 * logout). Fire-and-forget by contract: failures (offline, expired token)
 * must not block or fail the local session clear.
 */
export function revokeRefreshToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken || typeof fetch !== 'function') return;
  try {
    fetch(`${getOrigin()}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {
      /* best-effort — local session is cleared regardless */
    });
  } catch {
    /* defensive (jsdom transport gaps) */
  }
}
