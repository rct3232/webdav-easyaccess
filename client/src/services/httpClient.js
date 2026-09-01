/**
 * Transport adapter: performs HTTP requests to the client `/api/*` namespace,
 * parses responses into a stable shape, applies timeouts, and retries only on
 * network failures and 5xx responses.
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

function getAbortController(timeout, controller) {
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  return timeoutId;
}

/**
 * Parse fetch Response into { data, status, statusText, headers }.
 * Supports onDownloadProgress for streaming blob responses.
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
      for (;;) {
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
 * Build request body. FormData: pass through without Content-Type.
 * String: pass through. Object: JSON.stringify.
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

async function doRequestOnce(config) {
  const method = (config.method || 'GET').toUpperCase();
  const params = config.params;

  const inputUrl = config.url || '';
  const fullUrl =
    typeof inputUrl === 'string' && inputUrl.startsWith('http')
      ? appendParamsToUrl(inputUrl, params)
      : appendParamsToUrl(buildFullPath(inputUrl), params);

  const requestUrl = fullUrl.startsWith('http') ? fullUrl : getOrigin() + fullUrl;

  const headers = new Headers(config.headers || {});
  const hasContentType = headers.has('Content-Type');
  if (!hasContentType && config.data != null && !(config.data instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const body = buildBody(config.data, headers);

  const controller = new AbortController();
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  const timeoutId = getAbortController(timeout, controller);

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

    const response = await fetch(requestUrl, init);
    clearTimeout(timeoutId);

    const result = await parseResponse(response, {
      responseType: config.responseType,
      onDownloadProgress: config.onDownloadProgress,
    });

    if (response.status >= 400) {
      const err = new Error(`Request failed with status code ${response.status}`);
      err.response = result;
      err.config = config;
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

    // Preserve HTTP errors thrown above
    if (err.response) throw err;

    const networkError = new Error(err.message || 'Network Error');
    networkError.code = 'ERR_NETWORK';
    networkError.config = config;
    throw networkError;
  }
}

const RETRY_CONFIG = {
  retryDelay: 1000,
};

export function __setRetryConfigForTests(overrides) {
  Object.assign(RETRY_CONFIG, overrides);
}

/**
 * Execute request with transport-level retry.
 * Retries only on network failures and response status >= 500.
 */
export async function request(config) {
  const maxRetries = config.maxRetries ?? 3;
  const baseDelay = config.retryDelay ?? RETRY_CONFIG.retryDelay;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await doRequestOnce(config);
    } catch (error) {
      lastError = error;

      const status = error.response?.status;
      const isNetworkFailure = error.code === 'ERR_NETWORK';
      const isRetryable5xx = typeof status === 'number' && status >= 500;

      // Retry only network failures or 5xx. Never retry 4xx or timeout aborts.
      if (!isNetworkFailure && !isRetryable5xx) {
        throw error;
      }

      if (attempt === maxRetries) break;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
