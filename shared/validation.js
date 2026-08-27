/**
 * Validation utilities for forms.
 * Shared by server and client.
 * Returns i18n keys (and optional params) for client; client should use t(key, params).
 */

function validateFileName(name) {
  if (!name || !name.trim()) {
    return 'validation.fileNameRequired';
  }

  // eslint-disable-next-line no-control-regex
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (invalidChars.test(name)) {
    return 'validation.fileNameInvalidChars';
  }

  const reservedNames = [
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ];
  const upperName = name.toUpperCase().trim();
  if (reservedNames.includes(upperName)) {
    return 'validation.fileNameReserved';
  }

  if (name.endsWith(' ') || name.endsWith('.')) {
    return 'validation.fileNameNoTrailing';
  }

  if (name.length > 255) {
    return 'validation.fileNameTooLong';
  }

  return null;
}

function validateEmail(email) {
  if (!email || !email.trim()) {
    return 'validation.emailRequired';
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'validation.emailInvalid';
  }

  if (email.length > 254) {
    return 'validation.emailTooLong';
  }

  return null;
}

function validatePassword(password, options = {}) {
  const { minLength = 6, maxLength = 128 } = options;

  if (!password) {
    return 'validation.passwordRequired';
  }

  if (password.length < minLength) {
    return { key: 'validation.passwordMinLength', minLength };
  }

  if (password.length > maxLength) {
    return { key: 'validation.passwordMaxLength', maxLength };
  }

  return null;
}

function validateUsername(username) {
  if (!username || !username.trim()) {
    return 'validation.usernameRequired';
  }

  const trimmed = username.trim();

  if (trimmed.length < 3) {
    return 'validation.usernameMinLength';
  }

  if (trimmed.length > 50) {
    return 'validation.usernameMaxLength';
  }

  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(trimmed)) {
    return 'validation.usernameInvalidChars';
  }

  const reservedNames = ['admin', 'root', 'system', 'user', 'users', 'api'];
  if (reservedNames.includes(trimmed.toLowerCase())) {
    return 'validation.usernameReserved';
  }

  return null;
}

function validateMatch(value1, value2, fieldName) {
  if (value1 !== value2) {
    return { key: 'validation.match', fieldName };
  }
  return null;
}

function validateRequired(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return { key: 'validation.required', fieldName };
  }
  if (typeof value === 'string' && !value.trim()) {
    return { key: 'validation.required', fieldName };
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
