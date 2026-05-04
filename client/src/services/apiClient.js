/**
 * Centralized API client (fetch-based)
 *
 * Responsibilities:
 * - Transport & parsing: delegated to `httpClient`
 * - Token injection and x-new-token application: delegated to `authTokenStore`
 * - 401 refresh + redirect policy and 403 redirect/back policy: delegated to
 *   `authNavigationPolicy`
 */

import { request as httpRequest } from './httpClient';
import {
  applyNewTokenFromHeaders,
  getAccessToken,
  removeTokens,
  refreshAccessToken,
} from './authTokenStore';
import {
  handle401RefreshFailure,
  handle403,
  is403RedirectableRequest,
  shouldSkipAuthNavigation,
} from './authNavigationPolicy';

function normalizePolicyUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  if (/^https?:\/\//.test(url)) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
  if (url.startsWith('/api/')) return url;
  return `/api/${url.replace(/^\/+/, '')}`;
}

function buildPolicyConfig(config) {
  return {
    ...config,
    url: normalizePolicyUrl(config?.url),
  };
}

async function performRequest(config) {
  const headers = new Headers(config.headers || {});
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  try {
    const result = await httpRequest({ ...config, headers });
    applyNewTokenFromHeaders(result.headers);
    return result;
  } catch (err) {
    applyNewTokenFromHeaders(err?.response?.headers);
    throw err;
  }
}

async function requestWithAuth(config) {
  const policyConfig = buildPolicyConfig(config);

  try {
    return await performRequest(config);
  } catch (err) {
    const status = err?.response?.status;

    if (status === 401) {
      if (config?._retry) {
        removeTokens();
        handle401RefreshFailure(policyConfig);
        throw err;
      }
      if (shouldSkipAuthNavigation(policyConfig)) throw err;

      try {
        await refreshAccessToken();
        // Retry once with the refreshed token. Any failure here is treated
        // as auth failure (same observable behavior as the previous monolith).
        return await performRequest({ ...config, _retry: true });
      } catch (refreshError) {
        removeTokens();
        handle401RefreshFailure(policyConfig);
        throw refreshError;
      }
    }

    if (status === 403) {
      if (shouldSkipAuthNavigation(policyConfig)) throw err;
      if (is403RedirectableRequest(policyConfig)) {
        handle403(policyConfig, err);
        return;
      }
      throw err;
    }

    throw err;
  }
}

/**
 * Make a GET request.
 */
export function get(url, config = {}) {
  return requestWithAuth({ ...config, method: 'GET', url });
}

/**
 * Make a POST request.
 */
export function post(url, data = {}, config = {}) {
  return requestWithAuth({ ...config, method: 'POST', url, data });
}

/**
 * Make a PUT request.
 */
export function put(url, data = {}, config = {}) {
  return requestWithAuth({ ...config, method: 'PUT', url, data });
}

/**
 * Make a DELETE request.
 */
export function del(url, config = {}) {
  return requestWithAuth({ ...config, method: 'DELETE', url });
}

/**
 * Make a request with custom config.
 */
export function request(config) {
  return requestWithAuth(config);
}

// Default export for advanced usage (get/post/put/del/request)
const apiClient = { get, post, put, del, request };
export default apiClient;
