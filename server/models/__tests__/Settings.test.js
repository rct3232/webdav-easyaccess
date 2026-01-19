/**
 * Unit tests for Settings model (file-store)
 */

const Settings = require('../Settings');
const { setupTestStore, resetTestStore, teardownTestStore } = require('../../test-utils');

describe('Settings Model', () => {
  beforeAll(async () => {
    await setupTestStore();
  });

  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  it('should return null for missing key', async () => {
    const v = await Settings.get('does_not_exist');
    expect(v).toBeNull();
  });

  it('should set and get values', async () => {
    await Settings.set('registration_enabled', 'true');
    const v = await Settings.get('registration_enabled');
    expect(v).toBe('true');
  });

  it('should return all settings', async () => {
    await Settings.set('registration_enabled', 'false');
    await Settings.set('some_key', 'some_value');
    const all = await Settings.getAll();
    expect(all.registration_enabled).toBe('false');
    expect(all.some_key).toBe('some_value');
  });

  it('should compute isRegistrationEnabled correctly', async () => {
    await Settings.set('registration_enabled', 'false');
    expect(await Settings.isRegistrationEnabled()).toBe(false);
    await Settings.set('registration_enabled', 'true');
    expect(await Settings.isRegistrationEnabled()).toBe(true);
  });
});

