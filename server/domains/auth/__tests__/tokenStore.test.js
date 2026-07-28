/**
 * Token store unit tests.
 * Tests refresh token CRUD via CacheAdapter.
 */
const { createCacheAdapter } = require('../../../infrastructure/adapters/cache');
const tokenStore = require('../tokenStore');

jest.mock('../../../store/userStore', () => ({
  findById: jest.fn(),
}));

beforeEach(() => {
  tokenStore.setCacheAdapter(createCacheAdapter());
});

describe('tokenStore', () => {
  describe('generateRefreshTokenId', () => {
    it('returns 64-char hex string', () => {
      const id = tokenStore.generateRefreshTokenId();
      expect(typeof id).toBe('string');
      expect(id).toHaveLength(64);
      expect(id).toMatch(/^[a-f0-9]+$/);
    });

    it('generates unique IDs', () => {
      const id1 = tokenStore.generateRefreshTokenId();
      const id2 = tokenStore.generateRefreshTokenId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('addRefreshToken and validateRefreshToken', () => {
    it('round-trips token storage and validation', async () => {
      require('../../../store/userStore').findById.mockResolvedValue({
        id: 1,
        username: 'alice',
      });
      const tokenId = tokenStore.generateRefreshTokenId();
      tokenStore.addRefreshToken(tokenId, 1);

      const user = await tokenStore.validateRefreshToken(tokenId);
      expect(user).toMatchObject({ id: 1, username: 'alice' });
    });

    it('returns null for unknown token', async () => {
      const user = await tokenStore.validateRefreshToken('unknown-id');
      expect(user).toBeNull();
    });

    it('returns null for null or empty token', async () => {
      expect(await tokenStore.validateRefreshToken(null)).toBeNull();
      expect(await tokenStore.validateRefreshToken('')).toBeNull();
    });

    it('returns null and cleans up when user not found', async () => {
      require('../../../store/userStore').findById.mockResolvedValue(null);
      const tokenId = tokenStore.generateRefreshTokenId();
      tokenStore.addRefreshToken(tokenId, 999);

      const user = await tokenStore.validateRefreshToken(tokenId);
      expect(user).toBeNull();
    });
  });

  describe('deleteRefreshToken', () => {
    it('removes token', async () => {
      require('../../../store/userStore').findById.mockResolvedValue({ id: 1 });
      const tokenId = tokenStore.generateRefreshTokenId();
      tokenStore.addRefreshToken(tokenId, 1);
      tokenStore.deleteRefreshToken(tokenId);

      const user = await tokenStore.validateRefreshToken(tokenId);
      expect(user).toBeNull();
    });
  });

  describe('deleteAllRefreshTokensForUser', () => {
    it('removes all tokens for a user', async () => {
      require('../../../store/userStore').findById.mockResolvedValue({ id: 42 });
      const id1 = tokenStore.generateRefreshTokenId();
      const id2 = tokenStore.generateRefreshTokenId();
      tokenStore.addRefreshToken(id1, 42);
      tokenStore.addRefreshToken(id2, 42);
      tokenStore.addRefreshToken(tokenStore.generateRefreshTokenId(), 99);

      tokenStore.deleteAllRefreshTokensForUser(42);

      expect(await tokenStore.validateRefreshToken(id1)).toBeNull();
      expect(await tokenStore.validateRefreshToken(id2)).toBeNull();
    });

    it('does not remove tokens for other users', async () => {
      require('../../../store/userStore').findById.mockResolvedValue({ id: 99 });
      const otherTokenId = tokenStore.generateRefreshTokenId();
      tokenStore.addRefreshToken(otherTokenId, 99);

      tokenStore.deleteAllRefreshTokensForUser(42);

      const user = await tokenStore.validateRefreshToken(otherTokenId);
      expect(user).toMatchObject({ id: 99 });
    });
  });
});
