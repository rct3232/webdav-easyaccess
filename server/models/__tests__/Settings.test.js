/**
 * Settings model tests.
 * Verifies get, set, getAll, isRegistrationEnabled.
 */
const Settings = require('../Settings');
const { createTestDatabase } = require('../../test-utils');

describe('Settings model', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('get / set / getAll', () => {
    it('get returns null for unknown key', async () => {
      const val = await Settings.get('unknown_key_xyz');
      expect(val).toBeNull();
    });

    it('set and get round-trip value', async () => {
      await Settings.set('test_key', 'test_value');
      const val = await Settings.get('test_key');
      expect(val).toBe('test_value');
    });

    it('getAll returns object without updated_at', async () => {
      await Settings.set('another_key', 'another_value');
      const all = await Settings.getAll();
      expect(typeof all).toBe('object');
      expect(all).not.toHaveProperty('updated_at');
      expect(all.test_key).toBe('test_value');
      expect(all.another_key).toBe('another_value');
    });
  });

  describe('isRegistrationEnabled', () => {
    it('returns false when registration_enabled is "false"', async () => {
      await Settings.set('registration_enabled', 'false');
      const enabled = await Settings.isRegistrationEnabled();
      expect(enabled).toBe(false);
    });

    it('returns true when registration_enabled is "true"', async () => {
      await Settings.set('registration_enabled', 'true');
      const enabled = await Settings.isRegistrationEnabled();
      expect(enabled).toBe(true);
    });
  });
});
