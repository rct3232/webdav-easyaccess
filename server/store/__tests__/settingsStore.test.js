const settingsStore = require('../settingsStore');
const { resetTestStore, teardownTestStore } = require('../../test-utils');

describe('settingsStore', () => {
  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  it('gets and sets settings', async () => {
    await settingsStore.set('test_key', 'test_value');
    const value = await settingsStore.get('test_key');
    expect(value).toBe('test_value');

    const all = await settingsStore.getAll();
    expect(all.test_key).toBe('test_value');
    expect(all.registration_enabled).toBe('false'); // Default
  });

  it('checks if registration is enabled', async () => {
    expect(await settingsStore.isRegistrationEnabled()).toBe(false);

    await settingsStore.set('registration_enabled', 'true');
    expect(await settingsStore.isRegistrationEnabled()).toBe(true);

    await settingsStore.set('registration_enabled', 'false');
    expect(await settingsStore.isRegistrationEnabled()).toBe(false);
  });

  it('resets to defaults if settings file is corrupted', async () => {
    const storage = require('../storage');
    const { SETTINGS_PATH } = require('../metaPaths');
    
    await settingsStore.set('registration_enabled', 'true');
    
    // Corrupt the file
    await storage.writeFile(SETTINGS_PATH, 'invalid json', { overwrite: true });
    
    const isEnabled = await settingsStore.isRegistrationEnabled();
    expect(isEnabled).toBe(false); // Reset to default false
    
    const all = await settingsStore.getAll();
    expect(all.registration_enabled).toBe('false');
  });
});
