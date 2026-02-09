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
    it('should return error for empty name', () => {
      expect(validateFileName('')).toBe('이름을 입력하세요');
      expect(validateFileName('  ')).toBe('이름을 입력하세요');
    });

    it('should return error for invalid characters', () => {
      expect(validateFileName('test/file')).toBe('파일명에 사용할 수 없는 문자가 포함되어 있습니다');
      expect(validateFileName('test*file')).toBe('파일명에 사용할 수 없는 문자가 포함되어 있습니다');
    });

    it('should return error for reserved names', () => {
      expect(validateFileName('CON')).toBe('예약된 이름은 사용할 수 없습니다');
      expect(validateFileName('aux')).toBe('예약된 이름은 사용할 수 없습니다');
    });

    it('should return error for trailing spaces or dots', () => {
      expect(validateFileName('test ')).toBe('이름은 공백이나 점으로 끝날 수 없습니다');
      expect(validateFileName('test.')).toBe('이름은 공백이나 점으로 끝날 수 없습니다');
    });

    it('should return error for long names', () => {
      const longName = 'a'.repeat(256);
      expect(validateFileName(longName)).toBe('이름은 255자를 초과할 수 없습니다');
    });

    it('should return null for valid names', () => {
      expect(validateFileName('valid-file.txt')).toBeNull();
      expect(validateFileName('한글파일명.docx')).toBeNull();
    });
  });

  describe('validateEmail', () => {
    it('should validate email format', () => {
      expect(validateEmail('test@example.com')).toBeNull();
      expect(validateEmail('invalid-email')).toBe('올바른 이메일 형식이 아닙니다');
      expect(validateEmail('')).toBe('이메일을 입력하세요');
    });
  });

  describe('validatePassword', () => {
    it('should validate password length', () => {
      expect(validatePassword('123456')).toBeNull();
      expect(validatePassword('123')).toBe('비밀번호는 최소 6자 이상이어야 합니다');
      expect(validatePassword('123', { minLength: 2 })).toBeNull();
    });
  });

  describe('validateUsername', () => {
    it('should validate username rules', () => {
      expect(validateUsername('user123')).toBeNull();
      expect(validateUsername('us')).toBe('사용자명은 최소 3자 이상이어야 합니다');
      expect(validateUsername('admin')).toBe('예약된 사용자명은 사용할 수 없습니다');
      expect(validateUsername('user@name')).toBe('사용자명은 영문, 숫자, 언더스코어(_), 하이픈(-)만 사용할 수 있습니다');
    });
  });

  describe('validateRequired', () => {
    it('should validate required fields', () => {
      expect(validateRequired('content')).toBeNull();
      expect(validateRequired('')).toBe('필드를 입력하세요');
      expect(validateRequired('', '사용자명')).toBe('사용자명를 입력하세요');
    });
  });
});
