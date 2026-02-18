import {
  validateFileName,
  validateEmail,
  validatePassword,
  validateUsername,
  validateMatch,
  validateRequired,
} from '@webdav-easyaccess/shared/validation';

describe('validation utilities', () => {
  describe('validateFileName', () => {
    it('should return error key for empty name', () => {
      expect(validateFileName('')).toBe('validation.fileNameRequired');
      expect(validateFileName('  ')).toBe('validation.fileNameRequired');
    });

    it('should return error key for invalid characters', () => {
      expect(validateFileName('test/file')).toBe('validation.fileNameInvalidChars');
      expect(validateFileName('test*file')).toBe('validation.fileNameInvalidChars');
    });

    it('should return error key for reserved names', () => {
      expect(validateFileName('CON')).toBe('validation.fileNameReserved');
      expect(validateFileName('aux')).toBe('validation.fileNameReserved');
    });

    it('should return error key for trailing spaces or dots', () => {
      expect(validateFileName('test ')).toBe('validation.fileNameNoTrailing');
      expect(validateFileName('test.')).toBe('validation.fileNameNoTrailing');
    });

    it('should return error key for long names', () => {
      const longName = 'a'.repeat(256);
      expect(validateFileName(longName)).toBe('validation.fileNameTooLong');
    });

    it('should return null for valid names', () => {
      expect(validateFileName('valid-file.txt')).toBeNull();
      expect(validateFileName('한글파일명.docx')).toBeNull();
    });
  });

  describe('validateEmail', () => {
    it('should validate email format', () => {
      expect(validateEmail('test@example.com')).toBeNull();
      expect(validateEmail('invalid-email')).toBe('validation.emailInvalid');
      expect(validateEmail('')).toBe('validation.emailRequired');
    });
  });

  describe('validatePassword', () => {
    it('should validate password length', () => {
      expect(validatePassword('123456')).toBeNull();
      expect(validatePassword('123')).toEqual({ key: 'validation.passwordMinLength', minLength: 6 });
      expect(validatePassword('123', { minLength: 2 })).toBeNull();
    });
  });

  describe('validateUsername', () => {
    it('should validate username rules', () => {
      expect(validateUsername('user123')).toBeNull();
      expect(validateUsername('us')).toBe('validation.usernameMinLength');
      expect(validateUsername('admin')).toBe('validation.usernameReserved');
      expect(validateUsername('user@name')).toBe('validation.usernameInvalidChars');
    });
  });

  describe('validateRequired', () => {
    it('should validate required fields', () => {
      expect(validateRequired('content')).toBeNull();
      expect(validateRequired('')).toEqual({ key: 'validation.required', fieldName: undefined });
      expect(validateRequired('', '사용자명')).toEqual({ key: 'validation.required', fieldName: '사용자명' });
    });
  });

  describe('validateMatch', () => {
    it('should return key with fieldName when values do not match', () => {
      expect(validateMatch('a', 'b')).toEqual({ key: 'validation.match', fieldName: undefined });
      expect(validateMatch('a', 'b', '비밀번호')).toEqual({ key: 'validation.match', fieldName: '비밀번호' });
    });
    it('should return null when values match', () => {
      expect(validateMatch('a', 'a')).toBeNull();
    });
  });
});
