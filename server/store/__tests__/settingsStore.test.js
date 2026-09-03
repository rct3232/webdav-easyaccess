/**
 * settingsStore tests.
 * Verifies get, set, getAll, isRegistrationEnabled. CRUD and error cases.
 */
const settingsStore = require('@server/store/settingsStore');
const { createTestDatabase, dbRun } = require('@server/test-utils');

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

  describe('listRows', () => {
    it('returns [] when the settings table is empty', async () => {
      await dbRun(`DELETE FROM settings`);
      const rows = await settingsStore.listRows();
      expect(rows).toEqual([]);
    });

    it('returns key, raw value and updated_at for each row', async () => {
      await dbRun(`DELETE FROM settings`);
      const payload = JSON.stringify({
        enc: 'aes-256-gcm',
        iv: 'aWY=',
        tag: 'dGFn',
        data: 'ZGF0YQ==',
      });
      await settingsStore.set('listrows_plain', 'plain-value');
      await settingsStore.set('listrows_secret', payload);

      const rows = await settingsStore.listRows();
      expect(rows).toHaveLength(2);

      const plain = rows.find((row) => row.key === 'listrows_plain');
      expect(plain).toBeTruthy();
      expect(plain.value).toBe('plain-value');
      expect(new Date(plain.updated_at).getTime()).not.toBeNaN();

      const secret = rows.find((row) => row.key === 'listrows_secret');
      expect(secret).toBeTruthy();
      // value is left raw (not unwrapped): the stored JSON payload string
      expect(secret.value).toBe(payload);
      expect(JSON.parse(secret.value)).toEqual({
        enc: 'aes-256-gcm',
        iv: 'aWY=',
        tag: 'dGFn',
        data: 'ZGF0YQ==',
      });
      expect(new Date(secret.updated_at).getTime()).not.toBeNaN();
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
