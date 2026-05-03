/**
 * Unit tests for shared constants.
 * Pure function testing — no mocks needed.
 * @see shared/constants.js
 */
const {
  PERMISSIONS,
  HTTP_STATUS,
  USER_STATUS,
  PERMISSION_REQUEST_STATUS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  TEXT_EXTENSIONS,
} = require('@webdav-easyaccess/shared/constants');

describe('shared constants', () => {
  describe('PERMISSIONS', () => {
    it('has expected permission levels', () => {
      expect(PERMISSIONS.READ).toBe('read');
      expect(PERMISSIONS.WRITE).toBe('write');
      expect(PERMISSIONS.ADMIN).toBe('admin');
    });

    it('has ALL containing all permission levels', () => {
      expect(PERMISSIONS.ALL).toEqual(['read', 'write', 'admin']);
    });

    describe('isValid', () => {
      it.each([
        ['read', true],
        ['write', true],
        ['admin', true],
      ])('returns true for valid permission %p', (input, expected) => {
        expect(PERMISSIONS.isValid(input)).toBe(expected);
      });

      it.each([
        ['owner', false],
        ['superuser', false],
        ['', false],
        [null, false],
        [undefined, false],
        [123, false],
      ])('returns false for invalid permission %p', (input, expected) => {
        expect(PERMISSIONS.isValid(input)).toBe(expected);
      });
    });
  });

  describe('HTTP_STATUS', () => {
    it.each([
      ['OK', 200],
      ['CREATED', 201],
      ['ACCEPTED', 202],
      ['NO_CONTENT', 204],
      ['BAD_REQUEST', 400],
      ['UNAUTHORIZED', 401],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
      ['CONFLICT', 409],
      ['GONE', 410],
      ['TOO_MANY_REQUESTS', 429],
      ['INTERNAL_SERVER_ERROR', 500],
      ['BAD_GATEWAY', 502],
      ['SERVICE_UNAVAILABLE', 503],
    ])('has %s = %d', (key, expected) => {
      expect(HTTP_STATUS[key]).toBe(expected);
    });
  });

  describe('USER_STATUS', () => {
    it('has expected user statuses', () => {
      expect(USER_STATUS.PENDING).toBe('pending');
      expect(USER_STATUS.APPROVED).toBe('approved');
      expect(USER_STATUS.REJECTED).toBe('rejected');
    });

    it('has ALL containing all user statuses', () => {
      expect(USER_STATUS.ALL).toEqual(['pending', 'approved', 'rejected']);
    });

    describe('isValid', () => {
      it.each([
        ['pending', true],
        ['approved', true],
        ['rejected', true],
      ])('returns true for valid status %p', (input, expected) => {
        expect(USER_STATUS.isValid(input)).toBe(expected);
      });

      it.each([
        ['active', false],
        ['suspended', false],
        ['', false],
        [null, false],
        [undefined, false],
        [123, false],
      ])('returns false for invalid status %p', (input, expected) => {
        expect(USER_STATUS.isValid(input)).toBe(expected);
      });
    });
  });

  describe('PERMISSION_REQUEST_STATUS', () => {
    it('has expected statuses including cancelled', () => {
      expect(PERMISSION_REQUEST_STATUS.PENDING).toBe('pending');
      expect(PERMISSION_REQUEST_STATUS.APPROVED).toBe('approved');
      expect(PERMISSION_REQUEST_STATUS.REJECTED).toBe('rejected');
      expect(PERMISSION_REQUEST_STATUS.CANCELLED).toBe('cancelled');
    });

    it('has ALL containing all statuses including cancelled', () => {
      expect(PERMISSION_REQUEST_STATUS.ALL).toEqual([
        'pending',
        'approved',
        'rejected',
        'cancelled',
      ]);
    });

    describe('isValid', () => {
      it.each([
        ['pending', true],
        ['approved', true],
        ['rejected', true],
        ['cancelled', true],
      ])('returns true for valid status %p', (input, expected) => {
        expect(PERMISSION_REQUEST_STATUS.isValid(input)).toBe(expected);
      });

      it.each([
        ['active', false],
        ['', false],
        [null, false],
        [undefined, false],
        [123, false],
      ])('returns false for invalid status %p', (input, expected) => {
        expect(PERMISSION_REQUEST_STATUS.isValid(input)).toBe(expected);
      });
    });
  });

  describe('IMAGE_EXTENSIONS', () => {
    it.each([
      'jpg',
      'jpeg',
      'png',
      'gif',
      'bmp',
      'webp',
      'svg',
    ])('includes %s', (ext) => {
      expect(IMAGE_EXTENSIONS).toContain(ext);
    });

    it('has expected length', () => {
      expect(IMAGE_EXTENSIONS.length).toBe(7);
    });
  });

  describe('VIDEO_EXTENSIONS', () => {
    it.each([
      'mp4',
      'webm',
      'ogg',
      'mov',
      'avi',
      'mkv',
    ])('includes %s', (ext) => {
      expect(VIDEO_EXTENSIONS).toContain(ext);
    });

    it('has expected length', () => {
      expect(VIDEO_EXTENSIONS.length).toBe(6);
    });
  });

  describe('AUDIO_EXTENSIONS', () => {
    it.each([
      'mp3',
      'wav',
      'ogg',
      'aac',
      'm4a',
      'flac',
    ])('includes %s', (ext) => {
      expect(AUDIO_EXTENSIONS).toContain(ext);
    });

    it('has expected length', () => {
      expect(AUDIO_EXTENSIONS.length).toBe(6);
    });
  });

  describe('TEXT_EXTENSIONS', () => {
    it.each([
      'txt',
      'md',
      'json',
      'xml',
      'csv',
      'log',
      'js',
      'jsx',
      'ts',
      'tsx',
      'css',
      'html',
      'py',
      'java',
      'c',
      'cpp',
      'h',
      'sh',
    ])('includes %s', (ext) => {
      expect(TEXT_EXTENSIONS).toContain(ext);
    });

    it('has expected length', () => {
      expect(TEXT_EXTENSIONS.length).toBe(18);
    });
  });
});
