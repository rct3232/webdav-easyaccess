/**
 * Server thumbnail utility tests: pure-logic paths only.
 * Tests getThumbnailHash, sign/verify token, cache set/get/eviction,
 * getCachedThumbnail, and ensureThumbnail with cache hit.
 *
 * @see docs/spec/server/utils/thumbnail.md
 */
jest.mock('sharp', () => jest.fn().mockImplementation(() => ({
  metadata: jest.fn().mockResolvedValue({ hasAlpha: false }),
  rotate: jest.fn().mockReturnThis(),
  resize: jest.fn().mockReturnThis(),
  jpeg: jest.fn().mockReturnThis(),
  png: jest.fn().mockReturnThis(),
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-thumbnail')),
})));

jest.mock('../webdav', () => ({
  getFileContents: jest.fn(),
  isImageFile: jest.fn(),
  isVideoFile: jest.fn(),
}));

const { default: sharp } = require('sharp');
const { getFileContents, isImageFile, isVideoFile } = require('../webdav');
const {
  getThumbnailHash,
  signThumbnailToken,
  verifyThumbnailToken,
  getThumbnailFromCache,
  thumbnailCache,
  ensureThumbnail,
} = require('../thumbnail');

const MAX_CACHE_SIZE = 1000;

describe('thumbnail utilities', () => {
  beforeEach(() => {
    thumbnailCache.clear();
    jest.restoreAllMocks();
  });

  describe('getThumbnailHash', () => {
    it('returns a deterministic hash for the same path', () => {
      const hash1 = getThumbnailHash('/images/photo.jpg');
      const hash2 = getThumbnailHash('/images/photo.jpg');
      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('string');
      expect(hash1.length).toBe(32);
    });

    it('returns different hashes for different paths', () => {
      const hash1 = getThumbnailHash('/images/photo.jpg');
      const hash2 = getThumbnailHash('/images/other.png');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('signThumbnailToken / verifyThumbnailToken', () => {
    it('signed token verifies against correct hash', () => {
      const path = '/images/photo.jpg';
      const hash = getThumbnailHash(path);
      const token = signThumbnailToken(path);
      expect(typeof token).toBe('string');
      expect(verifyThumbnailToken(token, hash)).toBe(true);
    });

    it('returns false for wrong hash', () => {
      const path = '/images/photo.jpg';
      const token = signThumbnailToken(path);
      expect(verifyThumbnailToken(token, 'wrong-hash')).toBe(false);
    });

    it('returns false for null/undefined/non-string tokens', () => {
      const hash = getThumbnailHash('/images/photo.jpg');
      expect(verifyThumbnailToken(null, hash)).toBe(false);
      expect(verifyThumbnailToken(undefined, hash)).toBe(false);
      expect(verifyThumbnailToken(123, hash)).toBe(false);
    });

    it('returns false for tampered token', () => {
      const path = '/images/photo.jpg';
      const hash = getThumbnailHash(path);
      const token = signThumbnailToken(path);
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(verifyThumbnailToken(tampered, hash)).toBe(false);
    });
  });

  describe('thumbnailCache set/get/eviction', () => {
    it('getThumbnailFromCache returns null for missing key', () => {
      expect(getThumbnailFromCache('/missing.jpg')).toBeNull();
    });

    it('stores and retrieves a cache entry with correct structure', () => {
      const buf = Buffer.from('data');
      thumbnailCache.set('/img.jpg', { buffer: buf, mimeType: 'image/jpeg', extension: 'jpg' });
      const cached = getThumbnailFromCache('/img.jpg');
      expect(cached).not.toBeNull();
      expect(cached.buffer).toBe(buf);
      expect(cached.extension).toBe('jpg');
      expect(cached.mimeType).toBe('image/jpeg');
    });

    it('stores png entries with correct mime type', () => {
      const buf = Buffer.from('data');
      thumbnailCache.set('/img.png', { buffer: buf, mimeType: 'image/png', extension: 'png' });
      const cached = getThumbnailFromCache('/img.png');
      expect(cached.mimeType).toBe('image/png');
      expect(cached.extension).toBe('png');
    });

    it('cache Map is shared module-level instance', () => {
      thumbnailCache.set('/shared.jpg', { buffer: Buffer.from('x'), mimeType: 'image/jpeg', extension: 'jpg' });
      expect(thumbnailCache.has('/shared.jpg')).toBe(true);
      expect(getThumbnailFromCache('/shared.jpg')).not.toBeNull();
    });

    it('cache handles MAX_CACHE_SIZE entries without error', () => {
      for (let i = 0; i < MAX_CACHE_SIZE + 1; i++) {
        thumbnailCache.set(
          `/img${i}.jpg`,
          { buffer: Buffer.from(String(i)), mimeType: 'image/jpeg', extension: 'jpg' }
        );
      }
      expect(thumbnailCache.size).toBe(MAX_CACHE_SIZE + 1);
      expect(getThumbnailFromCache('/img0.jpg')).not.toBeNull();
      expect(getThumbnailFromCache(`/img${MAX_CACHE_SIZE}.jpg`)).not.toBeNull();
    });
  });

  describe('ensureThumbnail with cache hit', () => {
    it('returns thumbnail URL without calling getFileContents when cached', async () => {
      const path = '/cached.jpg';
      thumbnailCache.set(path, { buffer: Buffer.from('cached-data'), mimeType: 'image/jpeg', extension: 'jpg' });

      getFileContents.mockResolvedValue(Buffer.from('should-not-be-called'));
      isImageFile.mockReturnValue(true);

      const result = await ensureThumbnail(path);

      expect(result).not.toBeNull();
      expect(result).toContain('/api/thumbnails/');
      expect(result).toContain('.jpg?token=');
      expect(getFileContents).not.toHaveBeenCalled();
    });
  });
});
