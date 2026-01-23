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

// Response interceptor: Handle common errors
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Handle 401 Unauthorized - token expired or invalid
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      // Clear token and redirect to login
      sessionStorage.removeItem('token');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // Handle 403 Forbidden
    if (error.response?.status === 403) {
      // Error message is already in error.response.data.error
      return Promise.reject(error);
    }

    // Handle 409 Conflict
    if (error.response?.status === 409) {
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
