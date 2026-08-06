/**
 * Server thumbnail utility tests: pure-logic paths only.
 * Tests getThumbnailHash, sign/verify token, cache set/get/eviction,
 * getCachedThumbnail, ensureThumbnail with cache hit, and image generation
 * via blobStorageService.downloadBlob (nodeId-keyed).
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

jest.mock('@server/utils/webdav', () => ({
  isImageFile: jest.fn(),
  isVideoFile: jest.fn(),
}));

jest.mock('@server/service/composition', () => ({
  getComposition: jest.fn(),
}));

const { isImageFile, isVideoFile } = require('@server/utils/webdav');
const { getComposition } = require('@server/service/composition');
const { createCacheAdapter } = require('@server/infrastructure/adapters/cache');
const {
  getThumbnailHash,
  signThumbnailToken,
  verifyThumbnailToken,
  getThumbnailFromCache,
  ensureThumbnail,
  setCachedThumbnail,
  setCacheAdapter,
} = require('@server/domains/thumbnails/services/thumbnailService');

const MAX_CACHE_SIZE = 1000;

describe('thumbnail utilities', () => {
  beforeEach(() => {
    setCacheAdapter(createCacheAdapter());
    jest.restoreAllMocks();
    getComposition.mockReset();
  });

  describe('getThumbnailHash', () => {
    it('returns the md5 of String(nodeId) — deterministic for the same nodeId', () => {
      const hash1 = getThumbnailHash(5);
      const hash2 = getThumbnailHash(5);
      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('string');
      expect(hash1.length).toBe(32);
    });

    it('returns different hashes for different nodeIds', () => {
      const hash1 = getThumbnailHash(5);
      const hash2 = getThumbnailHash(6);
      expect(hash1).not.toBe(hash2);
    });

    it('hashes the numeric string form (nodeId 5 === "5")', () => {
      expect(getThumbnailHash(5)).toBe(getThumbnailHash('5'));
    });
  });

  describe('signThumbnailToken / verifyThumbnailToken', () => {
    it('signed token verifies against the nodeId-derived hash', () => {
      const nodeId = 5;
      const hash = getThumbnailHash(nodeId);
      const token = signThumbnailToken(nodeId);
      expect(typeof token).toBe('string');
      expect(verifyThumbnailToken(token, hash)).toBe(true);
    });

    it('returns false for wrong hash', () => {
      const nodeId = 5;
      const token = signThumbnailToken(nodeId);
      expect(verifyThumbnailToken(token, 'wrong-hash')).toBe(false);
    });

    it('returns false for null/undefined/non-string tokens', () => {
      const hash = getThumbnailHash(5);
      expect(verifyThumbnailToken(null, hash)).toBe(false);
      expect(verifyThumbnailToken(undefined, hash)).toBe(false);
      expect(verifyThumbnailToken(123, hash)).toBe(false);
    });

    it('returns false for tampered token', () => {
      const nodeId = 5;
      const hash = getThumbnailHash(nodeId);
      const token = signThumbnailToken(nodeId);
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(verifyThumbnailToken(tampered, hash)).toBe(false);
    });
  });

  describe('thumbnail cache set/get/eviction via public API', () => {
    it('getThumbnailFromCache returns null for missing key', () => {
      expect(getThumbnailFromCache(999)).toBeNull();
    });

    it('stores and retrieves a cache entry with correct structure', () => {
      const buf = Buffer.from('data');
      setCachedThumbnail(5, buf, 'jpg');
      const cached = getThumbnailFromCache(5);
      expect(cached).not.toBeNull();
      expect(cached.buffer).toBe(buf);
      expect(cached.extension).toBe('jpg');
      expect(cached.mimeType).toBe('image/jpeg');
    });

    it('stores png entries with correct mime type', () => {
      const buf = Buffer.from('data');
      setCachedThumbnail(6, buf, 'png');
      const cached = getThumbnailFromCache(6);
      expect(cached.mimeType).toBe('image/png');
      expect(cached.extension).toBe('png');
    });

    it('setCachedThumbnail evicts the oldest entry when cache reaches MAX_CACHE_SIZE', () => {
      for (let i = 0; i < MAX_CACHE_SIZE + 1; i++) {
        setCachedThumbnail(i, Buffer.from(String(i)), 'jpg');
      }
      expect(getThumbnailFromCache(0)).toBeNull();
      expect(getThumbnailFromCache(MAX_CACHE_SIZE)).not.toBeNull();
    });

    it('setCachedThumbnail stores {buffer, mimeType, extension}', () => {
      const buf = Buffer.from('data');
      setCachedThumbnail(8, buf, 'jpg');
      const cached = getThumbnailFromCache(8);
      expect(cached).not.toBeNull();
      expect(cached.buffer).toBe(buf);
      expect(cached.extension).toBe('jpg');
      expect(cached.mimeType).toBe('image/jpeg');
    });
  });

  describe('ensureThumbnail with cache hit', () => {
    it('returns a nodeId-keyed thumbnail URL without fetching blob when cached', async () => {
      const nodeId = 42;
      setCachedThumbnail(42, Buffer.from('cached-data'), 'jpg');

      const result = await ensureThumbnail(nodeId);

      expect(result).not.toBeNull();
      expect(result).toContain('/api/thumbnails/');
      expect(result).toContain(`/${getThumbnailHash(nodeId)}.jpg?token=`);
      expect(getComposition).not.toHaveBeenCalled();
    });
  });

  describe('ensureThumbnail with generation (nodeId → blobStorageService.downloadBlob)', () => {
    it('generates an image thumbnail from downloaded bytes and caches it', async () => {
      const nodeId = 7;
      const mockDownloadBlob = jest.fn().mockResolvedValue(Buffer.from('image-bytes'));
      const mockGetNode = jest.fn().mockResolvedValue({ id: nodeId, name: 'photo.png' });
      getComposition.mockReturnValue({
        fileNodeService: { getNode: mockGetNode },
        blobStorageService: { downloadBlob: mockDownloadBlob },
      });
      isImageFile.mockReturnValue(true);
      isVideoFile.mockReturnValue(false);

      const result = await ensureThumbnail(nodeId);

      expect(mockGetNode).toHaveBeenCalledWith(nodeId);
      expect(mockDownloadBlob).toHaveBeenCalledWith(nodeId);
      expect(isImageFile).toHaveBeenCalledWith('photo.png');
      expect(result).toContain(`/${getThumbnailHash(nodeId)}.`);
      expect(getThumbnailFromCache(nodeId)).not.toBeNull();
    });
  });
});
