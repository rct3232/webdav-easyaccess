/**
 * Centralized API client with interceptors
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
import axios from 'axios';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';

// Create axios instance
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 300000, // 5 minutes for large file operations
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: Add auth token
apiClient.interceptors.request.use(
  (config) => {
    // Get token from sessionStorage
    const token = sessionStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor: Handle common errors and token refresh
apiClient.interceptors.response.use(
  (response) => {
    // Check for new token in response header and update it
    const newToken = response.headers['x-new-token'];
    if (newToken) {
      // Update token in sessionStorage
      sessionStorage.setItem('token', newToken);
      
      // Update axios default headers
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
      
      // Dispatch event for AuthContext to update its state
      window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: newToken } }));
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // 401 or 403: try refresh once if we have a refresh token, then retry or redirect
    if ((error.response?.status === 401 || error.response?.status === 403) && !originalRequest._retry) {
      const refreshToken = sessionStorage.getItem('refreshToken');
      if (refreshToken) {
        originalRequest._retry = true;
        try {
          // Use axios directly so this call does not go through apiClient interceptors
          const refreshRes = await axios.post('/api/auth/refresh', { refreshToken });
          const newToken = refreshRes.data?.token;
          if (newToken) {
            sessionStorage.setItem('token', newToken);
            apiClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: newToken } }));
            return apiClient(originalRequest);
          }
        } catch (refreshErr) {
          // Refresh failed; fall through to clear and redirect
        }
      }

      // No refresh token or refresh failed: clear and redirect to login
      // Exception: do NOT redirect when the failed request was login/register - let the page show the error
      const isAuthAttempt = typeof originalRequest?.url === 'string' &&
        (originalRequest.url.includes('/auth/login') || originalRequest.url.includes('/auth/register'));
      if (!isAuthAttempt) {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('refreshToken');
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    // Handle 409 Conflict
    if (error.response?.status === HTTP_STATUS.CONFLICT) {
      // Conflict errors are expected in some cases (e.g., file already exists)
      return Promise.reject(error);
    }

    // Handle network errors
    if (!error.response) {
      error.message = 'Network error. Please check your connection.';
      return Promise.reject(error);
    }

    // For other errors, preserve the original error
    return Promise.reject(error);
  }
);

/**
 * Retry a request with exponential backoff
 * @param {Function} requestFn - Function that returns a promise
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} Request promise
 */
async function retryRequest(requestFn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on 4xx errors (client errors)
      if (error.response?.status >= 400 && error.response?.status < 500) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Make a GET request with retry
 * @param {string} url - Request URL (relative to /api)
 * @param {Object} config - Axios config
 * @returns {Promise<Object>} Response promise
 * @example
 * const response = await get('/users');
 * const data = response.data;
 */
export function get(url, config = {}) {
  return retryRequest(() => apiClient.get(url, config));
}

/**
 * Make a POST request with retry
 * @param {string} url - Request URL (relative to /api)
 * @param {Object} data - Request data
 * @param {Object} config - Axios config
 * @returns {Promise<Object>} Response promise
 * @example
 * const response = await post('/users', { name: 'John' });
 */
export function post(url, data = {}, config = {}) {
  return retryRequest(() => apiClient.post(url, data, config));
}

/**
 * Make a PUT request with retry
 * @param {string} url - Request URL
 * @param {Object} data - Request data
 * @param {Object} config - Axios config
 * @returns {Promise} Response promise
 */
export function put(url, data = {}, config = {}) {
  return retryRequest(() => apiClient.put(url, data, config));
}

/**
 * Make a DELETE request with retry
 * @param {string} url - Request URL
 * @param {Object} config - Axios config
 * @returns {Promise} Response promise
 */
export function del(url, config = {}) {
  return retryRequest(() => apiClient.delete(url, config));
}

/**
 * Make a request with custom config (for file uploads, etc.)
 * @param {Object} config - Axios config
 * @returns {Promise} Response promise
 */
export function request(config) {
  return retryRequest(() => apiClient.request(config));
}

// Export the axios instance for advanced usage
export default apiClient;
