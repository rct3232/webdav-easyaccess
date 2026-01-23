/**
 * Validation utilities
 * Provides reusable validation functions for forms
 */

/**
 * Validate folder/file name
 * @param {string} name - Name to validate
 * @returns {string|null} Error message or null if valid
 */
export const validateFileName = (name) => {
  if (!name || !name.trim()) {
    return '이름을 입력하세요';
  }
  
  // Check for invalid characters
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (invalidChars.test(name)) {
    return '파일명에 사용할 수 없는 문자가 포함되어 있습니다';
  }
  
  // Check for reserved names (Windows)
  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  const upperName = name.toUpperCase().trim();
  if (reservedNames.includes(upperName)) {
    return '예약된 이름은 사용할 수 없습니다';
  }
  
  // Check for trailing spaces or dots
  if (name.endsWith(' ') || name.endsWith('.')) {
    return '이름은 공백이나 점으로 끝날 수 없습니다';
  }
  
  // Check length
  if (name.length > 255) {
    return '이름은 255자를 초과할 수 없습니다';
  }
  
  return null;
};

/**
 * Validate folder path
 * @param {string} path - Path to validate
 * @returns {string|null} Error message or null if valid
 */
export const validatePath = (path) => {
  if (!path || typeof path !== 'string') {
    return '경로를 입력하세요';
  }
  
  // Check for invalid characters
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(path)) {
    return '경로에 사용할 수 없는 문자가 포함되어 있습니다';
  }
  
  // Check for relative path components
  if (path.includes('../') || path.includes('..\\')) {
    return '상대 경로는 사용할 수 없습니다';
  }
  
  return null;
};

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {string|null} Error message or null if valid
 */
export const validateEmail = (email) => {
  if (!email || !email.trim()) {
    return '이메일을 입력하세요';
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return '올바른 이메일 형식이 아닙니다';
  }
  
  if (email.length > 254) {
    return '이메일 주소가 너무 깁니다';
  }
  
  return null;
};

/**
 * Validate password
 * @param {string} password - Password to validate
 * @param {Object} options - Validation options
 * @param {number} options.minLength - Minimum length (default: 6)
 * @param {number} options.maxLength - Maximum length (default: 128)
 * @returns {string|null} Error message or null if valid
 */
export const validatePassword = (password, options = {}) => {
  const { minLength = 6, maxLength = 128 } = options;
  
  if (!password) {
    return '비밀번호를 입력하세요';
  }
  
  if (password.length < minLength) {
    return `비밀번호는 최소 ${minLength}자 이상이어야 합니다`;
  }
  
  if (password.length > maxLength) {
    return `비밀번호는 ${maxLength}자를 초과할 수 없습니다`;
  }
  
  return null;
};

/**
 * Validate username
 * @param {string} username - Username to validate
 * @returns {string|null} Error message or null if valid
 */
export const validateUsername = (username) => {
  if (!username || !username.trim()) {
    return '사용자명을 입력하세요';
  }
  
  const trimmed = username.trim();
  
  // Check length
  if (trimmed.length < 3) {
    return '사용자명은 최소 3자 이상이어야 합니다';
  }
  
  if (trimmed.length > 50) {
    return '사용자명은 50자를 초과할 수 없습니다';
  }
  
  // Check for invalid characters (alphanumeric, underscore, hyphen only)
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(trimmed)) {
    return '사용자명은 영문, 숫자, 언더스코어(_), 하이픈(-)만 사용할 수 있습니다';
  }
  
  // Check for reserved names
  const reservedNames = ['admin', 'root', 'system', 'user', 'users', 'api', 'api', 'wea', '.wea'];
  if (reservedNames.includes(trimmed.toLowerCase())) {
    return '예약된 사용자명은 사용할 수 없습니다';
  }
  
  return null;
};

/**
 * Validate that two values match
 * @param {*} value1 - First value
 * @param {*} value2 - Second value
 * @param {string} fieldName - Field name for error message
 * @returns {string|null} Error message or null if valid
 */
export const validateMatch = (value1, value2, fieldName = '값') => {
  if (value1 !== value2) {
    return `${fieldName}가 일치하지 않습니다`;
  }
  return null;
};

/**
 * Validate required field
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {string|null} Error message or null if valid
 */
export const validateRequired = (value, fieldName = '필드') => {
  if (value === null || value === undefined || value === '') {
    return `${fieldName}를 입력하세요`;
  }
  if (typeof value === 'string' && !value.trim()) {
    return `${fieldName}를 입력하세요`;
  }
  return null;
};

/**
 * Validate number range
 * @param {number} value - Value to validate
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum value
 * @param {number} options.max - Maximum value
 * @param {string} fieldName - Field name for error message
 * @returns {string|null} Error message or null if valid
 */
export const validateNumberRange = (value, options = {}, fieldName = '값') => {
  const { min, max } = options;
  
  if (value === null || value === undefined || value === '') {
    return `${fieldName}를 입력하세요`;
  }
  
  const numValue = Number(value);
  if (isNaN(numValue)) {
    return `${fieldName}는 숫자여야 합니다`;
  }
  
  if (min !== undefined && numValue < min) {
    return `${fieldName}는 ${min} 이상이어야 합니다`;
  }
  
  if (max !== undefined && numValue > max) {
    return `${fieldName}는 ${max} 이하여야 합니다`;
  }
  
  return null;
};
