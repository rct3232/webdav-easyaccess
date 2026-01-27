/**
 * Error message handling utilities
 * Provides common functions for extracting error messages
 * Note: For displaying messages, use useMessage hook instead
 */

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
  404: ERROR_TYPES.FILE_NOT_FOUND,
  500: ERROR_TYPES.FILE_NOT_FOUND, // 500도 파일/경로 미존재로 처리
  403: ERROR_TYPES.PERMISSION_DENIED,
  401: ERROR_TYPES.PERMISSION_DENIED,
  409: ERROR_TYPES.DUPLICATE_FILE,
};

// 에러 타입별 메시지 맵
const ERROR_MESSAGES = {
  [ERROR_TYPES.FILE_NOT_FOUND]: '파일 또는 경로가 존재하지 않습니다.',
  [ERROR_TYPES.PERMISSION_DENIED]: '접근 권한이 없습니다.',
  [ERROR_TYPES.NETWORK_ERROR]: '네트워크 오류가 발생했습니다.',
  [ERROR_TYPES.DUPLICATE_FILE]: '같은 이름의 파일이 이미 존재합니다.',
  [ERROR_TYPES.INVALID_PATH]: '잘못된 경로입니다.',
  [ERROR_TYPES.UNKNOWN]: '오류가 발생했습니다.',
};

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
  if (message.includes('permission') || message.includes('권한')) {
    return ERROR_TYPES.PERMISSION_DENIED;
  }
  if (message.includes('not found') || message.includes('존재하지')) {
    return ERROR_TYPES.FILE_NOT_FOUND;
  }
  if (message.includes('invalid') || message.includes('잘못된')) {
    return ERROR_TYPES.INVALID_PATH;
  }
  if (message.includes('already exists') || message.includes('이미 존재')) {
    return ERROR_TYPES.DUPLICATE_FILE;
  }
  
  return ERROR_TYPES.UNKNOWN;
};

/**
 * Get error message by error type
 * @param {string} errorType - Error type
 * @returns {string} Error message
 */
export const getErrorMessageByType = (errorType) => {
  return ERROR_MESSAGES[errorType] || ERROR_MESSAGES[ERROR_TYPES.UNKNOWN];
};

/**
 * Extract error message from error object
 * @param {Error} error - Error object
 * @param {string} defaultMsg - Default message if error message cannot be extracted
 * @returns {string} Error message
 */
export const getErrorMessage = (error, defaultMsg = '오류가 발생했습니다') => {
  if (!error) return defaultMsg;
  
  // 에러 타입 판별
  const errorType = determineErrorType(error);
  
  // 에러 타입별 메시지 반환
  if (errorType !== ERROR_TYPES.UNKNOWN) {
    return getErrorMessageByType(errorType);
  }
  
  // 기존 로직 (서버에서 제공한 에러 메시지 우선)
  if (error.response?.data?.error) {
    return error.response.data.error;
  }
  
  if (error.message) {
    return error.message;
  }
  
  return defaultMsg;
};
