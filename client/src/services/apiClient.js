/**
 * Centralized API client (fetch-based)
 * Provides common error handling, token injection, and retry logic
 *
 * @module services/apiClient
 * @example
 * import { get, post, put, del } from './apiClient';
 *
 * // GET request
 * const users = await get('/users');
 *
 * // POST request
 * const result = await post('/users', { name: 'John' });
 */
const BASE_URL = '/api';
const DEFAULT_TIMEOUT = 300000; // 5 minutes for large file operations

function buildFullPath(url) {
  const base = BASE_URL.replace(/\/+$/, '');
  const path = (url || '').replace(/^\/+/, '');
  return (base + '/' + path).replace(/\/+/g, '/');
}

function appendParamsToUrl(pathOrUrl, params) {
  if (!params || typeof params !== 'object') return pathOrUrl;
  const serialized = new URLSearchParams(params).toString();
  if (!serialized) return pathOrUrl;
  const sep = pathOrUrl.indexOf('?') === -1 ? '?' : '&';
  return pathOrUrl + sep + serialized;
}

function getOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
}

/**
 * Parse fetch Response into { data, status, statusText, headers }. Supports onDownloadProgress for streaming.
 */
async function parseResponse(response, config) {
  const contentType = response.headers.get('Content-Type') || '';
  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : null;

  let data;
  if (config.responseType === 'blob') {
    if (config.onDownloadProgress && response.body && total != null && total > 0) {
      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        config.onDownloadProgress({ loaded, total, progressEvent: { loaded, total } });
      }
      data = new Blob(chunks);
    } else {
      data = await response.blob();
    }
  } else {
    const text = await response.text();
    if (contentType.includes('application/json') && text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text;
    }
  }

  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

/**
 * Build request body. FormData: pass through without Content-Type. String: pass through. Object: JSON.stringify.
 */
function buildBody(data, headers) {
  if (data == null) return undefined;
  if (data instanceof FormData) {
    headers.delete('Content-Type');
    return data;
  }
  if (typeof data === 'string') return data;
  return JSON.stringify(data);
}

/**
 * Whether a 403 on this request should trigger history.back() or '/' redirect.
 * Only GET requests to /api/files/list or /api/admin/* qualify.
 *
 * @param {{ method?: string; url?: string }} config - Request config
 * @returns {boolean}
 */
function is403RedirectableRequest(config) {
  const method = (config?.method || 'GET').toUpperCase();
  const url = typeof config?.url === 'string' ? config.url : '';
  if (method !== 'GET') return false;
  return /files\/list|(\/|^)admin(\/|$)/.test(url);
}

/**
 * Core fetch request. Returns { data, status, statusText, headers } or throws with error.response, error.config.
 */
async function doRequest(config) {
  let path = buildFullPath(config.url);
  const method = (config.method || 'GET').toUpperCase();
  path = appendParamsToUrl(path, config.params);

  const fullUrl = path.startsWith('http') ? path : getOrigin() + path;
  const headers = new Headers(config.headers || {});
  if (!headers.has('Content-Type') && config.data != null && !(config.data instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const body = buildBody(config.data, headers);

  const controller = new AbortController();
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  if (config.signal) {
    config.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const init = {
      method,
      headers,
      signal: controller.signal,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
    };

    const response = await fetch(fullUrl, init);
    clearTimeout(timeoutId);

    const result = await parseResponse(response, {
      responseType: config.responseType,
      onDownloadProgress: config.onDownloadProgress,
    });

    // x-new-token: update sessionStorage and dispatch event
    const newToken = response.headers.get('x-new-token');
    if (newToken) {
      sessionStorage.setItem('token', newToken);
      window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: newToken } }));
    }

    if (response.status >= 400) {
      const err = new Error(`Request failed with status code ${response.status}`);
      err.response = result;
      err.config = config;
      err.code = undefined;
      throw err;
    }

    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const error = new Error(`timeout of ${timeout}ms exceeded`);
      error.code = 'ECONNABORTED';
      error.config = config;
      throw error;
    }
    if (err.response) throw err;
    const networkError = new Error(err.message || 'Network Error');
    networkError.code = 'ERR_NETWORK';
    networkError.config = config;
    throw networkError;
  }
}

/**
 * Handle 403 (Forbidden). Does not attempt token refresh.
 * - Excluded (login, register, share): no redirect, throws error.
 * - Redirectable (GET /api/files/list, GET /api/admin/*): history.back() or '/' redirect, then returns.
 * - Other: no redirect, throws error.
 *
 * @param {object} config - Request config
 * @param {Error} error - The 403 error
 * @returns {void}
 */
function handle403(config, error) {
  const isAuthAttempt =
    typeof config?.url === 'string' &&
    (config.url.includes('/auth/login') || config.url.includes('/auth/register'));
  const h = config?.headers;
  const isShareRequest = h && (h instanceof Headers ? h.get('X-Share-Token') : h['X-Share-Token']);
  const isSharePermissionCheck =
    typeof config?.url === 'string' &&
    config.url.includes('/share/') &&
    config.url.includes('/check-my-permission');

  if (isAuthAttempt || isShareRequest || isSharePermissionCheck) {
    throw error;
  }

  if (!is403RedirectableRequest(config)) {
    throw error;
  }

  if (typeof window !== 'undefined' && window.history?.length > 1) {
    window.history.back();
  } else if (typeof window !== 'undefined') {
    window.location.href = '/';
  } else {
    throw error;
  }
}

/**
 * Handle 401 (Unauthorized): attempt token refresh once, then retry the request.
 * On refresh success: stores new token, retries with it, returns result.
 * On refresh failure: removes tokens, redirects to /login (except login/register/share).
 * Excluded endpoints (login, register, share) return null without redirect.
 *
 * @param {object} config - Original request config
 * @returns {Promise<{data:*, status:number, statusText:string, headers:object}|null>} Retry result or null
 */
async function handleAuthError(config) {
  const isAuthAttempt =
    typeof config?.url === 'string' &&
    (config.url.includes('/auth/login') || config.url.includes('/auth/register'));
  const h = config?.headers;
  const isShareRequest = h && (h instanceof Headers ? h.get('X-Share-Token') : h['X-Share-Token']);
  const isSharePermissionCheck =
    typeof config?.url === 'string' &&
    config.url.includes('/share/') &&
    config.url.includes('/check-my-permission');

  if (isAuthAttempt || isShareRequest || isSharePermissionCheck) {
    return null;
  }

  const refreshToken = sessionStorage.getItem('refreshToken');
  if (!refreshToken) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('refreshToken');
    window.location.href = '/login';
    return null;
  }

  try {
    const refreshUrl = getOrigin() + BASE_URL + '/auth/refresh';
    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const json = await res.json();
    const newToken = json?.token;
    if (!newToken) throw new Error('No token in refresh response');
    sessionStorage.setItem('token', newToken);
    window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: newToken } }));

    const retryConfig = { ...config };
    retryConfig._retry = true;
    retryConfig.headers = new Headers(config.headers || {});
    retryConfig.headers.set('Authorization', `Bearer ${newToken}`);
    return doRequest(retryConfig);
  } catch {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('refreshToken');
    window.location.href = '/login';
    return null;
  }
}

/**
 * Execute request with retry and auth handling.
 */
async function requestWithRetry(config) {
  const maxRetries = config.maxRetries ?? 3;
  const baseDelay = 1000;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers = new Headers(config.headers || {});
      const token = sessionStorage.getItem('token');
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return await doRequest({ ...config, headers });
    } catch (error) {
      lastError = error;

      if (error.response?.status === 401) {
        if (!config._retry) {
          const retried = await handleAuthError(config);
          if (retried) return retried;
        }
        throw error;
      }

      if (error.response?.status === 403) {
        handle403(config, error);
        return;
      }

      if (error.response?.status >= 400 && error.response?.status < 500) {
        throw error;
      }

      if (attempt === maxRetries) break;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Make a GET request with retry
 */
export function get(url, config = {}) {
  return requestWithRetry({ ...config, method: 'GET', url });
}

/**
 * Make a POST request with retry
 */
export function post(url, data = {}, config = {}) {
  return requestWithRetry({ ...config, method: 'POST', url, data });
}

/**
 * Make a PUT request with retry
 */
export function put(url, data = {}, config = {}) {
  return requestWithRetry({ ...config, method: 'PUT', url, data });
}

/**
 * Make a DELETE request with retry
 */
export function del(url, config = {}) {
  return requestWithRetry({ ...config, method: 'DELETE', url });
}

/**
 * Make a request with custom config
 */
export function request(config) {
  return requestWithRetry(config);
}

// Default export for advanced usage (get/post/put/del/request)
const apiClient = { get, post, put, del, request };
export default apiClient;
