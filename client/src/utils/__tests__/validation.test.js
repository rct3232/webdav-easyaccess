/**
 * Shared validation tests: example-based + fast-check property-based.
 * @see docs/shared-contracts.md
 * @see docs/TESTING_STRATEGY.md
 */
import * as fc from 'fast-check';
import {
  validateFileName,
  validateEmail,
  validatePassword,
  validateUsername,
  validateMatch,
  validateRequired,
} from '@webdav-easyaccess/shared/validation';

describe('validateFileName', () => {
  describe('example-based', () => {
    it('returns null for valid file names', () => {
      expect(validateFileName('valid.txt')).toBeNull();
      expect(validateFileName('document')).toBeNull();
      expect(validateFileName('my-file_123')).toBeNull();
      expect(validateFileName('a')).toBeNull();
    });

    it('returns fileNameRequired for empty or whitespace', () => {
      expect(validateFileName('')).toBe('validation.fileNameRequired');
      expect(validateFileName('   ')).toBe('validation.fileNameRequired');
      expect(validateFileName(null)).toBe('validation.fileNameRequired');
    });

    it('returns fileNameInvalidChars for forbidden characters', () => {
      expect(validateFileName('file<name')).toBe('validation.fileNameInvalidChars');
      expect(validateFileName('file>name')).toBe('validation.fileNameInvalidChars');
      expect(validateFileName('file:name')).toBe('validation.fileNameInvalidChars');
      expect(validateFileName('file/name')).toBe('validation.fileNameInvalidChars');
      expect(validateFileName('file\\name')).toBe('validation.fileNameInvalidChars');
      expect(validateFileName('file|name')).toBe('validation.fileNameInvalidChars');
      expect(validateFileName('file?name')).toBe('validation.fileNameInvalidChars');
      expect(validateFileName('file*name')).toBe('validation.fileNameInvalidChars');
      expect(validateFileName('file"name')).toBe('validation.fileNameInvalidChars');
    });

    it('returns fileNameReserved for reserved names', () => {
      expect(validateFileName('CON')).toBe('validation.fileNameReserved');
      expect(validateFileName('con')).toBe('validation.fileNameReserved');
      expect(validateFileName('PRN')).toBe('validation.fileNameReserved');
      expect(validateFileName('NUL')).toBe('validation.fileNameReserved');
      expect(validateFileName('COM1')).toBe('validation.fileNameReserved');
      expect(validateFileName('LPT9')).toBe('validation.fileNameReserved');
    });

    it('returns fileNameNoTrailing for trailing space or dot', () => {
      expect(validateFileName('name ')).toBe('validation.fileNameNoTrailing');
      expect(validateFileName('name.')).toBe('validation.fileNameNoTrailing');
    });

    it('returns fileNameTooLong for names longer than 255', () => {
      expect(validateFileName('a'.repeat(256))).toBe('validation.fileNameTooLong');
    });
  });

  describe('property-based (fast-check)', () => {
    const reserved = [
      'con', 'prn', 'aux', 'nul',
      'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
      'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
    ];
    const invalidCharsRe = /[<>:"/\\|?*\x00-\x1f]/;

    it('when result is null, name satisfies: trimmed 1-255, no invalid chars, no reserved, no trailing space/dot', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 300 }), (name) => {
          const result = validateFileName(name);
          if (result !== null) return true; // only check when valid
          const trimmed = name.trim();
          expect(trimmed.length).toBeGreaterThanOrEqual(1);
          expect(trimmed.length).toBeLessThanOrEqual(255);
          expect(invalidCharsRe.test(name)).toBe(false);
          expect(reserved.includes(trimmed.toLowerCase())).toBe(false);
          expect(name.endsWith(' ')).toBe(false);
          expect(name.endsWith('.')).toBe(false);
          return true;
        })
      );
    });

    it('valid names (1-255 chars, allowed chars only, no reserved, no trailing space/dot) return null', () => {
      const allowedChars = fc.char().filter(
        (c) => !invalidCharsRe.test(c) && c !== ' ' && c !== '.' && c.charCodeAt(0) >= 32
      );
      const validName = fc
        .stringOf(allowedChars, { minLength: 1, maxLength: 253 })
        .filter((s) => !reserved.includes(s.toLowerCase()));
      fc.assert(
        fc.property(validName, (name) => {
          expect(validateFileName(name)).toBeNull();
        })
      );
    });
  });
});

describe('validateEmail', () => {
  describe('example-based', () => {
    it('returns null for valid emails', () => {
      expect(validateEmail('user@example.com')).toBeNull();
      expect(validateEmail('a@b.co')).toBeNull();
    });

    it('returns emailRequired for empty or whitespace', () => {
      expect(validateEmail('')).toBe('validation.emailRequired');
      expect(validateEmail('   ')).toBe('validation.emailRequired');
    });

    it('returns emailInvalid for invalid format', () => {
      expect(validateEmail('no-at')).toBe('validation.emailInvalid');
      expect(validateEmail('@no-local.com')).toBe('validation.emailInvalid');
      expect(validateEmail('no-domain@')).toBe('validation.emailInvalid');
      expect(validateEmail('missing-tld@example')).toBe('validation.emailInvalid');
    });

    it('returns emailTooLong for length > 254', () => {
      expect(validateEmail('a@b.' + 'c'.repeat(251))).toBe('validation.emailTooLong');
    });
  });

  describe('property-based (fast-check)', () => {
    it('when result is null, email matches format and length <= 254', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).filter((s) => s.length <= 254),
          (email) => {
            expect(validateEmail(email)).toBeNull();
          }
        )
      );
    });
  });
});

describe('validatePassword', () => {
  it('returns null for valid password', () => {
    expect(validatePassword('password')).toBeNull();
    expect(validatePassword('123456')).toBeNull();
    expect(validatePassword('a'.repeat(128))).toBeNull();
  });

  it('returns passwordRequired for empty', () => {
    expect(validatePassword('')).toBe('validation.passwordRequired');
  });

  it('returns passwordMinLength when too short', () => {
    expect(validatePassword('12345')).toEqual({ key: 'validation.passwordMinLength', minLength: 6 });
  });

  it('respects custom minLength option', () => {
    expect(validatePassword('ab', { minLength: 8 })).toEqual({
      key: 'validation.passwordMinLength',
      minLength: 8,
    });
  });

  it('returns passwordMaxLength when too long', () => {
    expect(validatePassword('a'.repeat(129))).toEqual({
      key: 'validation.passwordMaxLength',
      maxLength: 128,
    });
  });

  it('respects custom maxLength option', () => {
    expect(validatePassword('a'.repeat(11), { maxLength: 10 })).toEqual({
      key: 'validation.passwordMaxLength',
      maxLength: 10,
    });
  });
});

describe('validateUsername', () => {
  it('returns null for valid usernames', () => {
    expect(validateUsername('alice')).toBeNull();
    expect(validateUsername('user_123')).toBeNull();
    expect(validateUsername('abc')).toBeNull();
  });

  it('returns usernameRequired for empty or whitespace', () => {
    expect(validateUsername('')).toBe('validation.usernameRequired');
    expect(validateUsername('   ')).toBe('validation.usernameRequired');
  });

  it('returns usernameMinLength when less than 3 chars', () => {
    expect(validateUsername('ab')).toBe('validation.usernameMinLength');
  });

  it('returns usernameMaxLength when more than 50 chars', () => {
    expect(validateUsername('a'.repeat(51))).toBe('validation.usernameMaxLength');
  });

  it('returns usernameInvalidChars for disallowed characters', () => {
    expect(validateUsername('user@name')).toBe('validation.usernameInvalidChars');
    expect(validateUsername('user name')).toBe('validation.usernameInvalidChars');
  });

  it('returns usernameReserved for reserved names', () => {
    expect(validateUsername('admin')).toBe('validation.usernameReserved');
    expect(validateUsername('root')).toBe('validation.usernameReserved');
  });
});

describe('validateMatch', () => {
  it('returns null when values match', () => {
    expect(validateMatch('a', 'a')).toBeNull();
    expect(validateMatch(1, 1)).toBeNull();
  });

  it('returns match error when values differ', () => {
    expect(validateMatch('a', 'b', 'password')).toEqual({
      key: 'validation.match',
      fieldName: 'password',
    });
  });
});

describe('validateRequired', () => {
  it('returns null for non-empty values', () => {
    expect(validateRequired('text', 'field')).toBeNull();
    expect(validateRequired(0, 'field')).toBeNull();
    expect(validateRequired(false, 'field')).toBeNull();
  });

  it('returns required error for empty values', () => {
    expect(validateRequired('', 'field')).toEqual({ key: 'validation.required', fieldName: 'field' });
    expect(validateRequired(null, 'field')).toEqual({
      key: 'validation.required',
      fieldName: 'field',
    });
    expect(validateRequired(undefined, 'field')).toEqual({
      key: 'validation.required',
      fieldName: 'field',
    });
    expect(validateRequired('   ', 'field')).toEqual({
      key: 'validation.required',
      fieldName: 'field',
    });
  });
});
