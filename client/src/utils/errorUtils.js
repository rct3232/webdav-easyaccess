/**
 * Error message handling utilities
 * Provides common functions for extracting error messages
 * Note: For displaying messages, use useMessage hook instead
 */
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';

// 에러 타입 상수
export const ERROR_TYPES = {
  FILE_NOT_FOUND: 'file_not_found',
  PERMISSION_DENIED: 'permission_denied',
  NETWORK_ERROR: 'network_error',
  DUPLICATE_FILE: 'duplicate_file',
  INVALID_PATH: 'invalid_path',
  UNKNOWN: 'unknown',
};

// HTTP 상태 코드별 에러 타입 매핑
const STATUS_CODE_TO_ERROR_TYPE = {
  [HTTP_STATUS.NOT_FOUND]: ERROR_TYPES.FILE_NOT_FOUND,
  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: ERROR_TYPES.FILE_NOT_FOUND, // 500도 파일/경로 미존재로 처리
  [HTTP_STATUS.FORBIDDEN]: ERROR_TYPES.PERMISSION_DENIED,
  [HTTP_STATUS.UNAUTHORIZED]: ERROR_TYPES.PERMISSION_DENIED,
  [HTTP_STATUS.CONFLICT]: ERROR_TYPES.DUPLICATE_FILE,
};

// i18n keys for error messages (caller uses t(key))
export const ERROR_MESSAGE_KEYS = {
  [ERROR_TYPES.FILE_NOT_FOUND]: 'errors.fileNotFound',
  [ERROR_TYPES.PERMISSION_DENIED]: 'errors.permissionDenied',
  [ERROR_TYPES.NETWORK_ERROR]: 'errors.networkError',
  [ERROR_TYPES.DUPLICATE_FILE]: 'errors.duplicateFile',
  [ERROR_TYPES.INVALID_PATH]: 'errors.invalidPath',
  [ERROR_TYPES.UNKNOWN]: 'errors.unknown',
};

// Server error codes that share one friendly user message (connection-class failures:
// storage unreachable / auth / resource-missing). Keeps backend internals out of the UI.
// Matches only the exact codes below; unrelated errorCodes keep their own translation.
const CONNECTION_CLASS_ERROR_CODES = {
  'serverErrors.webdav.connectionRefused': 'files.storageUnavailable',
  'serverErrors.webdav.serverNotResponding': 'files.storageUnavailable',
  'serverErrors.webdav.cannotConnect': 'files.storageUnavailable',
  'serverErrors.webdav.allConnectionAttemptsFailed': 'files.storageUnavailable',
  'serverErrors.webdav.credentialsNotConfigured': 'files.storageUnavailable',
  'serverErrors.storage.postgresqlNotConfigured': 'files.storageUnavailable',
  'serverErrors.errorHandler.databaseUnavailable': 'files.maintenanceNotice',
};

/**
 * Map a server errorCode to its friendly i18n key when it is a connection-class failure.
 * @param {string} errorCode - Server error code
 * @returns {string|null} Friendly i18n key, or null when the code is not mapped
 */
export const getConnectionClassFriendlyKey = (errorCode) =>
  CONNECTION_CLASS_ERROR_CODES[errorCode] ?? null;

/**
 * Determine error type from error object
 * @param {Error} error - Error object
 * @returns {string} Error type
 */
export const determineErrorType = (error) => {
  if (!error) return ERROR_TYPES.UNKNOWN;
  
  // 네트워크 에러 확인
  if (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK' || 
      error.message?.includes('Network Error') || error.message?.includes('timeout')) {
    return ERROR_TYPES.NETWORK_ERROR;
  }
  
  // HTTP 상태 코드 기반 판별
  const status = error.response?.status;
  if (status && STATUS_CODE_TO_ERROR_TYPE[status]) {
    return STATUS_CODE_TO_ERROR_TYPE[status];
  }
  
  // 에러 메시지 기반 판별
  const message = (error.message || error.response?.data?.error || '').toLowerCase();
  if (message.includes('permission')) {
    return ERROR_TYPES.PERMISSION_DENIED;
  }
  if (message.includes('not found')) {
    return ERROR_TYPES.FILE_NOT_FOUND;
  }
  if (message.includes('invalid')) {
    return ERROR_TYPES.INVALID_PATH;
  }
  if (message.includes('already exists')) {
    return ERROR_TYPES.DUPLICATE_FILE;
  }
  
  return ERROR_TYPES.UNKNOWN;
};

/**
 * Get i18n key for error type (caller uses t(getErrorMessageByType(errorType)))
 * @param {string} errorType - Error type
 * @returns {string} i18n key
 */
export const getErrorMessageByType = (errorType) => {
  return ERROR_MESSAGE_KEYS[errorType] || ERROR_MESSAGE_KEYS[ERROR_TYPES.UNKNOWN];
};

/**
 * Extract error message from error object. Returns key for translation or raw server message.
 * When server sends errorCode, returns that key (no raw). Otherwise falls back to type inference or raw.
 * @param {Error} error - Error object
 * @param {string} defaultKey - Default i18n key (e.g. 'errors.unknown')
 * @returns {{ key: string, raw?: string }} key always set; raw set when server provided a message to show as-is
 */
export const getErrorMessage = (error, defaultKey = 'errors.unknown') => {
  if (!error) return { key: defaultKey };

  const data = error.response?.data;
  if (data?.errorCode) {
    return { key: getConnectionClassFriendlyKey(data.errorCode) || data.errorCode };
  }

  const errorType = determineErrorType(error);

  if (errorType !== ERROR_TYPES.UNKNOWN) {
    return { key: getErrorMessageByType(errorType) };
  }

  if (data?.error) {
    return { key: defaultKey, raw: data.error };
  }

  if (error.message) {
    return { key: defaultKey, raw: error.message };
  }

  return { key: defaultKey };
};

/**
 * Get display string for server error response (errorCode + params).
 * @param {Object} data - Response data with optional errorCode, params
 * @param {Function} t - i18n t function
 * @returns {string} Translated message or fallback
 */
export const getServerErrorDisplay = (data, t) => {
  if (!data) return t('errors.unknown');
  if (data.errorCode) {
    const key = getConnectionClassFriendlyKey(data.errorCode) || data.errorCode;
    const msg = t(key, data.params || {});
    return typeof msg === 'string' ? msg : t('errors.unknown');
  }
  if (data.error) return data.error;
  return t('errors.unknown');
};

/**
 * Get display string for server success message (messageCode + params).
 * @param {Object} data - Response data with optional messageCode, params
 * @param {Function} t - i18n t function
 * @returns {string} Translated message or fallback
 */
export const getServerMessageDisplay = (data, t) => {
  if (!data) return '';
  if (data.messageCode) {
    const msg = t(data.messageCode, data.params || {});
    return typeof msg === 'string' ? msg : '';
  }
  if (data.message) return data.message;
  return '';
};

/**
 * Show user-facing error message from an error object.
 * Prefers server errorCode when present; otherwise uses getErrorMessage (type or raw).
 * @param {Error} error - Error object
 * @param {Function} showErrorFn - Function to display the message (e.g. useMessage().showError)
 * @param {(key: string, params?: object) => string} t - i18n t function
 * @param {string} [defaultKey='errors.unknown'] - Default i18n key
 */
export const showErrorFromError = (error, showErrorFn, t, defaultKey = 'errors.unknown') => {
  const data = error?.response?.data;
  if (data?.errorCode) {
    showErrorFn(getServerErrorDisplay(data, t));
    return;
  }
  const { key, raw } = getErrorMessage(error, defaultKey);
  showErrorFn(raw != null ? raw : t(key));
};
