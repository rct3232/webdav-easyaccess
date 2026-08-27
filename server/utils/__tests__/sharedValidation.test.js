/**
 * Unit tests for shared validation utilities.
 * Pure function testing — no mocks needed.
 * @see shared/validation.js
 */
const {
  validateFileName,
  validateEmail,
  validatePassword,
  validateUsername,
  validateMatch,
  validateRequired,
} = require('@webdav-easyaccess/shared/validation');

describe('shared validation', () => {
  describe('validateFileName', () => {
    it('returns null for valid filenames', () => {
      expect(validateFileName('document.txt')).toBeNull();
      expect(validateFileName('my-file_2024.pdf')).toBeNull();
      expect(validateFileName('file name with spaces.docx')).toBeNull();
    });

    it.each([
      ['', 'validation.fileNameRequired'],
      [null, 'validation.fileNameRequired'],
      [undefined, 'validation.fileNameRequired'],
      ['   ', 'validation.fileNameRequired'],
    ])('rejects empty/null input (%p) → %s', (input, expected) => {
      expect(validateFileName(input)).toBe(expected);
    });

    it.each([
      ['file<name>', 'validation.fileNameInvalidChars'],
      ['file>name', 'validation.fileNameInvalidChars'],
      ['file"name', 'validation.fileNameInvalidChars'],
      ['file: name', 'validation.fileNameInvalidChars'],
      ['file/name', 'validation.fileNameInvalidChars'],
      ['file\\name', 'validation.fileNameInvalidChars'],
      ['file|name', 'validation.fileNameInvalidChars'],
      ['file?name', 'validation.fileNameInvalidChars'],
      ['file*name', 'validation.fileNameInvalidChars'],
    ])('rejects invalid characters in %p → %s', (input, expected) => {
      expect(validateFileName(input)).toBe(expected);
    });

    it.each([
      ['CON', 'validation.fileNameReserved'],
      ['prn', 'validation.fileNameReserved'],
      ['Aux', 'validation.fileNameReserved'],
      ['nul', 'validation.fileNameReserved'],
      ['com1', 'validation.fileNameReserved'],
      ['COM9', 'validation.fileNameReserved'],
      ['lpt5', 'validation.fileNameReserved'],
      ['LPT9', 'validation.fileNameReserved'],
    ])('rejects reserved name %p → %s', (input, expected) => {
      expect(validateFileName(input)).toBe(expected);
    });

    it.each([
      ['file ', 'validation.fileNameNoTrailing'],
      ['file.', 'validation.fileNameNoTrailing'],
    ])('rejects trailing space/dot in %p → %s', (input, expected) => {
      expect(validateFileName(input)).toBe(expected);
    });

    it('rejects names longer than 255 characters', () => {
      const longName = 'a'.repeat(256);
      expect(validateFileName(longName)).toBe('validation.fileNameTooLong');
    });

    it('accepts exactly 255 character names', () => {
      const exactName = 'a'.repeat(255);
      expect(validateFileName(exactName)).toBeNull();
    });
  });

  describe('validateEmail', () => {
    it('returns null for valid emails', () => {
      expect(validateEmail('user@example.com')).toBeNull();
      expect(validateEmail('test.user+tag@domain.co.uk')).toBeNull();
    });

    it.each([
      ['', 'validation.emailRequired'],
      [null, 'validation.emailRequired'],
      [undefined, 'validation.emailRequired'],
      ['   ', 'validation.emailRequired'],
    ])('rejects empty input (%p) → %s', (input, expected) => {
      expect(validateEmail(input)).toBe(expected);
    });

    it.each([
      ['userexample.com', 'validation.emailInvalid'],
      ['@example.com', 'validation.emailInvalid'],
      ['user@', 'validation.emailInvalid'],
      ['user @example.com', 'validation.emailInvalid'],
      ['user@example', 'validation.emailInvalid'],
    ])('rejects invalid email format %p → %s', (input, expected) => {
      expect(validateEmail(input)).toBe(expected);
    });

    it('rejects emails longer than 254 characters', () => {
      const longEmail = 'a'.repeat(243) + '@example.com';
      expect(validateEmail(longEmail)).toBe('validation.emailTooLong');
    });

    it('accepts exactly 254 character emails', () => {
      const exactEmail = 'a'.repeat(242) + '@example.com';
      expect(validateEmail(exactEmail)).toBeNull();
    });
  });

  describe('validatePassword', () => {
    it('returns null for valid passwords', () => {
      expect(validatePassword('password123')).toBeNull();
      expect(validatePassword('a'.repeat(128))).toBeNull();
    });

    it.each([
      [null, 'validation.passwordRequired'],
      [undefined, 'validation.passwordRequired'],
      ['', 'validation.passwordRequired'],
    ])('rejects missing password (%p) → %s', (input, expected) => {
      expect(validatePassword(input)).toBe(expected);
    });

    it.each([
      ['abc', 'validation.passwordMinLength'],
      ['', 'validation.passwordRequired'],
      ['12345', 'validation.passwordMinLength'],
    ])('rejects too short password %p → %s', (input, expected) => {
      const result = validatePassword(input);
      if (typeof result === 'object') {
        expect(result.key).toBe(expected);
      } else {
        expect(result).toBe(expected);
      }
    });

    it('rejects passwords longer than default max length', () => {
      const long = 'a'.repeat(129);
      const result = validatePassword(long);
      expect(result.key).toBe('validation.passwordMaxLength');
      expect(result.maxLength).toBe(128);
    });

    it('respects custom minLength option', () => {
      const result = validatePassword('ab', { minLength: 4 });
      expect(result.key).toBe('validation.passwordMinLength');
      expect(result.minLength).toBe(4);
    });

    it('respects custom maxLength option', () => {
      const result = validatePassword('a'.repeat(11), { maxLength: 10 });
      expect(result.key).toBe('validation.passwordMaxLength');
      expect(result.maxLength).toBe(10);
    });
  });

  describe('validateUsername', () => {
    it('returns null for valid usernames', () => {
      expect(validateUsername('johndoe')).toBeNull();
      expect(validateUsername('user-1')).toBeNull();
      expect(validateUsername('test_name')).toBeNull();
      expect(validateUsername('A1_b-c')).toBeNull();
    });

    it.each([
      ['', 'validation.usernameRequired'],
      [null, 'validation.usernameRequired'],
      [undefined, 'validation.usernameRequired'],
      ['   ', 'validation.usernameRequired'],
    ])('rejects empty input (%p) → %s', (input, expected) => {
      expect(validateUsername(input)).toBe(expected);
    });

    it.each([
      ['ab', 'validation.usernameMinLength'],
      ['a', 'validation.usernameMinLength'],
    ])('rejects too short username %p → %s', (input, expected) => {
      expect(validateUsername(input)).toBe(expected);
    });

    it.each([
      ['user name', 'validation.usernameInvalidChars'],
      ['user@name', 'validation.usernameInvalidChars'],
      ['user.name', 'validation.usernameInvalidChars'],
      ['user/name', 'validation.usernameInvalidChars'],
    ])('rejects invalid characters in %p → %s', (input, expected) => {
      expect(validateUsername(input)).toBe(expected);
    });

    it.each([
      ['admin', 'validation.usernameReserved'],
      ['Admin', 'validation.usernameReserved'],
      ['root', 'validation.usernameReserved'],
      ['SYSTEM', 'validation.usernameReserved'],
      ['api', 'validation.usernameReserved'],
    ])('rejects reserved username %p → %s', (input, expected) => {
      expect(validateUsername(input)).toBe(expected);
    });

    it('accepts exactly 3 character usernames', () => {
      expect(validateUsername('abc')).toBeNull();
    });

    it('accepts exactly 50 character usernames', () => {
      expect(validateUsername('a'.repeat(50))).toBeNull();
    });
  });

  describe('validateMatch', () => {
    it('returns null when values match', () => {
      expect(validateMatch('abc', 'abc', 'password')).toBeNull();
      expect(validateMatch(123, 123, 'code')).toBeNull();
      expect(validateMatch(null, null, 'field')).toBeNull();
    });

    it.each([
      ['abc', 'def', 'password'],
      ['hello', 'Hello', 'email'],
      [123, '123', 'code'],
    ])('returns error when values do not match (%p vs %p)', (val1, val2, field) => {
      const result = validateMatch(val1, val2, field);
      expect(result.key).toBe('validation.match');
      expect(result.fieldName).toBe(field);
    });
  });

  describe('validateRequired', () => {
    it('returns null for valid values', () => {
      expect(validateRequired('hello', 'name')).toBeNull();
      expect(validateRequired(0, 'count')).toBeNull();
      expect(validateRequired(false, 'flag')).toBeNull();
      expect(validateRequired({}, 'obj')).toBeNull();
    });

    it.each([
      [null, 'name'],
      [undefined, 'email'],
      ['', 'password'],
    ])('rejects empty value (%p) for field %s', (value, fieldName) => {
      const result = validateRequired(value, fieldName);
      expect(result.key).toBe('validation.required');
      expect(result.fieldName).toBe(fieldName);
    });

    it('rejects whitespace-only strings', () => {
      const result = validateRequired('   ', 'name');
      expect(result.key).toBe('validation.required');
      expect(result.fieldName).toBe('name');
    });
  });
});
