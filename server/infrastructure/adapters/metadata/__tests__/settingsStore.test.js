/**
 * settingsStore tests.
 * Verifies get, set, getAll, isRegistrationEnabled. CRUD and error cases.
 */
const settingsStore = require('../../../../store/settingsStore');
const { createTestDatabase } = require('../../../../test-utils');

describe('settingsStore', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup?.();
  });

  describe('get', () => {
    it('returns null for unknown key', async () => {
      const val = await settingsStore.get('unknown_setting_xyz');
      expect(val).toBeNull();
    });
  });

  describe('set', () => {
    it('sets value and get returns it', async () => {
      await settingsStore.set('store_test_key', 'store_test_val');
      const val = await settingsStore.get('store_test_key');
      expect(val).toBe('store_test_val');
    });

    it('returns success object', async () => {
      const result = await settingsStore.set('success_key', 'value');
      expect(result).toEqual({ success: true });
    });
  });

  describe('getAll', () => {
    it('returns object without updated_at', async () => {
      const all = await settingsStore.getAll();
      expect(typeof all).toBe('object');
      expect(all).not.toHaveProperty('updated_at');
    });
  });

  describe('isRegistrationEnabled', () => {
    it('returns false when registration_enabled is "false"', async () => {
      await settingsStore.set('registration_enabled', 'false');
      const enabled = await settingsStore.isRegistrationEnabled();
      expect(enabled).toBe(false);
    });

    it('returns true when registration_enabled is "true"', async () => {
      await settingsStore.set('registration_enabled', 'true');
      const enabled = await settingsStore.isRegistrationEnabled();
      expect(enabled).toBe(true);
    });
  });
});
