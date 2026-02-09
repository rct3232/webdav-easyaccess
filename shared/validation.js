/**
 * Validation utilities for forms.
 * Shared by server and client.
 */

function validateFileName(name) {
  if (!name || !name.trim()) {
    return '이름을 입력하세요';
  }

  // eslint-disable-next-line no-control-regex
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (invalidChars.test(name)) {
    return '파일명에 사용할 수 없는 문자가 포함되어 있습니다';
  }

  const reservedNames = [
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ];
  const upperName = name.toUpperCase().trim();
  if (reservedNames.includes(upperName)) {
    return '예약된 이름은 사용할 수 없습니다';
  }

  if (name.endsWith(' ') || name.endsWith('.')) {
    return '이름은 공백이나 점으로 끝날 수 없습니다';
  }

  if (name.length > 255) {
    return '이름은 255자를 초과할 수 없습니다';
  }

  return null;
}

function validateEmail(email) {
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
}

function validatePassword(password, options = {}) {
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
}

function validateUsername(username) {
  if (!username || !username.trim()) {
    return '사용자명을 입력하세요';
  }

  const trimmed = username.trim();

  if (trimmed.length < 3) {
    return '사용자명은 최소 3자 이상이어야 합니다';
  }

  if (trimmed.length > 50) {
    return '사용자명은 50자를 초과할 수 없습니다';
  }

  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(trimmed)) {
    return '사용자명은 영문, 숫자, 언더스코어(_), 하이픈(-)만 사용할 수 있습니다';
  }

  const reservedNames = ['admin', 'root', 'system', 'user', 'users', 'api', 'wea', '.wea'];
  if (reservedNames.includes(trimmed.toLowerCase())) {
    return '예약된 사용자명은 사용할 수 없습니다';
  }

  return null;
}

function validateMatch(value1, value2, fieldName = '값') {
  if (value1 !== value2) {
    return `${fieldName}가 일치하지 않습니다`;
  }
  return null;
}

function validateRequired(value, fieldName = '필드') {
  if (value === null || value === undefined || value === '') {
    return `${fieldName}를 입력하세요`;
  }
  if (typeof value === 'string' && !value.trim()) {
    return `${fieldName}를 입력하세요`;
  }
  return null;
}

module.exports = {
  validateFileName,
  validateEmail,
  validatePassword,
  validateUsername,
  validateMatch,
  validateRequired,
};
