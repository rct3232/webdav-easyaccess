'use strict';

const {
  createConfigResolver,
  getSharedResolver,
  setSharedResolver,
  populateT1Env,
} = require('../configResolver');

function createFakeStore(initial = {}) {
  const rows = new Map(Object.entries(initial));
  const calls = { get: [], getAll: 0 };
  return {
    calls,
    rows,
    async get(key) {
      calls.get.push(key);
      return rows.has(key) ? rows.get(key) : null;
    },
    async getAll() {
      calls.getAll += 1;
      return Object.fromEntries(rows);
    },
    set(key, value) {
      rows.set(key, value);
    },
  };
}

function makeResolver(store, env = {}, ttlMs) {
  return createConfigResolver({
    settingsStore: store,
    env,
    ...(ttlMs !== undefined ? { ttlMs } : {}),
  });
}

afterEach(() => {
  jest.useRealTimers();
});

describe('createConfigResolver', () => {
  it('throws when the settingsStore contract is not met', () => {
    expect(() => createConfigResolver({ settingsStore: {}, env: {} })).toThrow(TypeError);
    expect(() => createConfigResolver({ settingsStore: { get() {} }, env: {} })).toThrow(TypeError);
  });

  describe('getConfig precedence', () => {
    it('env wins over DB and performs no DB read', async () => {
      const store = createFakeStore({ EMAIL_HOST: 'db-host' });
      const resolver = makeResolver(store, { EMAIL_HOST: 'env-host' });
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('env-host');
      expect(store.calls.get).not.toContain('EMAIL_HOST');
    });

    it('falls back to the DB row when env is absent', async () => {
      const store = createFakeStore({ EMAIL_HOST: 'db-host' });
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('db-host');
    });

    it('falls back to the built-in default when neither env nor DB has the key', async () => {
      const store = createFakeStore({});
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('PORT')).resolves.toBe(5001);
      await expect(resolver.getConfig('CORS_ORIGINS')).resolves.toBe('');
    });

    it('returns undefined when no source has a value and there is no default', async () => {
      const store = createFakeStore({});
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBeUndefined();
    });

    it('returns undefined for an unknown key without touching the store', async () => {
      const store = createFakeStore({});
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('NOT_A_REAL_VAR')).resolves.toBeUndefined();
      expect(store.calls.get).toHaveLength(0);
    });

    it('treats an empty-string env value as unset', async () => {
      const store = createFakeStore({ EMAIL_HOST: 'db-host' });
      const resolver = makeResolver(store, { EMAIL_HOST: '' });
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('db-host');
    });
  });

  describe('T0 (env only)', () => {
    it('never reads the DB or applies a default for T0 keys', async () => {
      const store = createFakeStore({ WEA_DB_HOST: 'db-host', WEA_DB_PORT: 1111 });
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('WEA_DB_HOST')).resolves.toBeUndefined();
      await expect(resolver.getConfig('WEA_DB_PORT')).resolves.toBeUndefined();
      expect(store.calls.get).toHaveLength(0);
    });

    it('returns the env value for a T0 key when present', async () => {
      const store = createFakeStore({});
      const resolver = makeResolver(store, { WEA_DB_HOST: 'env-host' });
      await expect(resolver.getConfig('WEA_DB_HOST')).resolves.toBe('env-host');
    });
  });

  describe('secret handling', () => {
    it('returns a DB secret row as plaintext when env is absent', async () => {
      const store = createFakeStore({ EMAIL_PASSWORD: 'db-pass' });
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('EMAIL_PASSWORD')).resolves.toBe('db-pass');
    });

    it('never reads the DB when the env value is present', async () => {
      const store = createFakeStore({ EMAIL_PASSWORD: 'db-pass' });
      const resolver = makeResolver(store, { EMAIL_PASSWORD: 'env-pass' });
      await expect(resolver.getConfig('EMAIL_PASSWORD')).resolves.toBe('env-pass');
      expect(store.calls.get).not.toContain('EMAIL_PASSWORD');
    });

    it('returns undefined when no source has a value and there is no default', async () => {
      const store = createFakeStore({});
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('EMAIL_PASSWORD')).resolves.toBeUndefined();
    });
  });

  describe('registration_enabled', () => {
    it('passes through a JSON boolean from the DB', async () => {
      const store = createFakeStore({ registration_enabled: true });
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('registration_enabled')).resolves.toBe(true);
    });

    it('passes through false', async () => {
      const store = createFakeStore({ registration_enabled: false });
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('registration_enabled')).resolves.toBe(false);
    });

    it('returns undefined (no default) when not stored', async () => {
      const store = createFakeStore({});
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('registration_enabled')).resolves.toBeUndefined();
    });
  });

  describe('getEffectiveConfig', () => {
    it('reports value/source/tier/secret for every registry entry', async () => {
      const store = createFakeStore({ CORS_ORIGINS: 'https://a.example' });
      const resolver = makeResolver(store, { EMAIL_HOST: 'env-host' });

      const config = await resolver.getEffectiveConfig();

      expect(config.EMAIL_HOST).toEqual({
        value: 'env-host',
        source: 'env',
        tier: 'T1',
        secret: false,
      });
      expect(config.CORS_ORIGINS).toEqual({
        value: 'https://a.example',
        source: 'db',
        tier: 'T2',
        secret: false,
      });
      expect(config.PORT).toEqual({ value: 5001, source: 'default', tier: 'T1', secret: false });
      expect(config.WEA_DB_HOST).toEqual({
        value: undefined,
        source: 'env',
        tier: 'T0',
        secret: false,
      });
      expect(config.registration_enabled).toBeDefined();
    });

    it('masks secrets with **** while keeping the source truthful', async () => {
      const store = createFakeStore({ WEBDAV_PASSWORD: 'db-pass' });
      const resolver = makeResolver(store, {
        EMAIL_PASSWORD: 'env-pass',
      });

      const config = await resolver.getEffectiveConfig();

      expect(config.EMAIL_PASSWORD).toEqual({
        value: '****',
        source: 'env',
        tier: 'T1',
        secret: true,
      });
      expect(config.WEBDAV_PASSWORD).toEqual({
        value: '****',
        source: 'db',
        tier: 'T1',
        secret: true,
      });
    });

    it('does a single bulk getAll and seeds the per-key cache', async () => {
      const store = createFakeStore({ EMAIL_HOST: 'db-host' });
      const resolver = makeResolver(store, {});

      await resolver.getEffectiveConfig();
      expect(store.calls.getAll).toBe(1);

      store.set('EMAIL_HOST', 'changed');
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('db-host');
      expect(store.calls.get).toHaveLength(0);
    });
  });

  describe('invalidateCache', () => {
    it('reloads a single invalidated key', async () => {
      const store = createFakeStore({ EMAIL_HOST: 'first' });
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('first');

      store.set('EMAIL_HOST', 'second');
      resolver.invalidateCache('EMAIL_HOST');
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('second');
    });

    it('reloads a list of invalidated keys', async () => {
      const store = createFakeStore({ EMAIL_HOST: 'a', EMAIL_PORT: '111' });
      const resolver = makeResolver(store, {});
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('a');
      await expect(resolver.getConfig('EMAIL_PORT')).resolves.toBe('111');

      store.set('EMAIL_HOST', 'b');
      store.set('EMAIL_PORT', '222');
      resolver.invalidateCache(['EMAIL_HOST', 'EMAIL_PORT']);
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('b');
      await expect(resolver.getConfig('EMAIL_PORT')).resolves.toBe('222');
    });

    it('clears the whole cache when called with no arguments', async () => {
      const store = createFakeStore({ EMAIL_HOST: 'a', EMAIL_PORT: '111' });
      const resolver = makeResolver(store, {});
      await resolver.getEffectiveConfig();

      store.set('EMAIL_HOST', 'b');
      store.set('EMAIL_PORT', '222');
      resolver.invalidateCache();
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('b');
      await expect(resolver.getConfig('EMAIL_PORT')).resolves.toBe('222');
    });
  });

  describe('TTL cache backstop', () => {
    it('re-reads the store after the TTL elapses', async () => {
      jest.useFakeTimers();
      const store = createFakeStore({ EMAIL_HOST: 'first' });
      const resolver = makeResolver(store, {}, 5000);

      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('first');
      store.set('EMAIL_HOST', 'second');

      jest.advanceTimersByTime(5001);
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('second');
    });

    it('serves cached rows within the TTL', async () => {
      jest.useFakeTimers();
      const store = createFakeStore({ EMAIL_HOST: 'first' });
      const resolver = makeResolver(store, {}, 5000);

      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('first');
      store.set('EMAIL_HOST', 'second');

      jest.advanceTimersByTime(4999);
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('first');
    });
  });

  describe('loadAll', () => {
    it('primes the DB cache from a bulk read at boot', async () => {
      const store = createFakeStore({ EMAIL_HOST: 'db-host', registration_enabled: true });
      const resolver = makeResolver(store, {});

      await resolver.loadAll();
      expect(store.calls.getAll).toBe(1);

      store.set('EMAIL_HOST', 'changed');
      await expect(resolver.getConfig('EMAIL_HOST')).resolves.toBe('db-host');
      expect(store.calls.get).toHaveLength(0);
    });
  });

  describe('getConfigSync', () => {
    it('reads env, then cached DB row, then default — no DB reads', async () => {
      const store = createFakeStore({ EMAIL_HOST: 'db-host' });
      const resolver = makeResolver(store, { PORT: '9999' });
      await resolver.loadAll();

      expect(resolver.getConfigSync('PORT')).toBe('9999');
      expect(resolver.getConfigSync('EMAIL_HOST')).toBe('db-host');
      expect(resolver.getConfigSync('GC_ORPHAN_TTL_DAYS')).toBe(1);
      expect(resolver.getConfigSync('EMAIL_PASSWORD')).toBeUndefined();
      expect(store.calls.get).toHaveLength(0);
    });

    it('returns undefined for T0 keys when env is absent', () => {
      const resolver = makeResolver(createFakeStore({}), {});
      expect(resolver.getConfigSync('JWT_SECRET')).toBeUndefined();
      expect(resolver.getConfigSync('WEA_DB_PORT')).toBeUndefined();
    });

    it('returns a cached plaintext DB secret synchronously', async () => {
      const store = createFakeStore({ EMAIL_PASSWORD: 'smtp-password' });
      const resolver = makeResolver(store, {});
      await resolver.loadAll();

      expect(resolver.getConfigSync('EMAIL_PASSWORD')).toBe('smtp-password');
    });
  });

  describe('shared resolver accessor', () => {
    it('returns the instance installed by setSharedResolver', () => {
      const fake = { marker: true };
      setSharedResolver(fake);
      expect(getSharedResolver()).toBe(fake);
      setSharedResolver(null);
    });
  });

  describe('populateT1Env', () => {
    it('writes DB-sourced T1 values into the env, skipping T0 and T2', async () => {
      const store = createFakeStore({
        WEBDAV_URL: 'https://dav.example.com',
        WEBDAV_USERNAME: 'dav-user',
        EMAIL_HOST: 'smtp.example.com',
        CORS_ORIGINS: 'https://app.example.com',
      });
      const resolver = makeResolver(store, {});
      await resolver.loadAll();

      const env = {};
      const populated = populateT1Env(resolver, env);

      expect(env.WEBDAV_URL).toBe('https://dav.example.com');
      expect(env.WEBDAV_USERNAME).toBe('dav-user');
      expect(env.EMAIL_HOST).toBe('smtp.example.com'); // T1 — populated at boot
      expect(env.CORS_ORIGINS).toBeUndefined(); // T2 — must stay lazy
      expect(env.WEA_DB_HOST).toBeUndefined(); // T0 — env only
      expect(populated).toContain('WEBDAV_URL');
      expect(populated).toContain('EMAIL_HOST');
      expect(populated).not.toContain('CORS_ORIGINS');
      expect(populated).not.toContain('WEA_DB_HOST');
    });

    it('copies DB-sourced plaintext secrets into the env', async () => {
      const store = createFakeStore({ WEBDAV_PASSWORD: 'dav-secret' });
      const resolver = makeResolver(store, {});
      await resolver.loadAll();

      const env = {};
      populateT1Env(resolver, env);
      expect(env.WEBDAV_PASSWORD).toBe('dav-secret');
    });

    it('never overwrites a value already present in the env', async () => {
      const store = createFakeStore({ WEBDAV_URL: 'https://db.example.com' });
      const resolver = makeResolver(store, {});
      await resolver.loadAll();

      const env = { WEBDAV_URL: 'https://env.example.com' };
      const populated = populateT1Env(resolver, env);
      expect(env.WEBDAV_URL).toBe('https://env.example.com');
      expect(populated).not.toContain('WEBDAV_URL');
    });

    it('applies built-in defaults for T1 keys with no env or DB value', async () => {
      const resolver = makeResolver(createFakeStore({}), {});
      await resolver.loadAll();

      const env = {};
      populateT1Env(resolver, env);
      expect(env.WEA_FILE_STORAGE).toBe('s3');
      expect(env.PORT).toBe('5001');
      expect(env.S3_BUCKET).toBeUndefined(); // no default → stays unset
    });

    it('reports db-sourced T1 keys as source db (env copy is a boot mirror), keeping the UI editable', async () => {
      const store = createFakeStore({ WEBDAV_URL: 'https://dav.example.com', PORT: '6000' });
      const resolver = makeResolver(store, {});
      await resolver.loadAll();

      const env = {};
      populateT1Env(resolver, env); // copies DB values into env + marks dbSourced

      const effective = await resolver.getEffectiveConfig();
      expect(effective.WEBDAV_URL.source).toBe('db');
      expect(effective.WEBDAV_URL.value).toBe('https://dav.example.com');
      expect(effective.PORT.source).toBe('db');
      expect(effective.PORT.value).toBe('6000');
    });

    it('reads the DB value (not the stale env mirror) for a db-sourced key', async () => {
      const store = createFakeStore({ WEBDAV_URL: 'https://dav.example.com' });
      const resolver = makeResolver(store, {});
      await resolver.loadAll();

      const env = {};
      populateT1Env(resolver, env);
      expect(env.WEBDAV_URL).toBe('https://dav.example.com');

      // An admin write updates the DB; the resolver must prefer the DB row over
      // the boot env mirror.
      store.set('WEBDAV_URL', 'https://new.example.com');
      resolver.invalidateCache(['WEBDAV_URL']);
      await expect(resolver.getConfig('WEBDAV_URL')).resolves.toBe('https://new.example.com');
    });

    it('keeps a genuinely env-set T1 key as source env (operator value wins)', async () => {
      const store = createFakeStore({ WEBDAV_URL: 'https://db.example.com' });
      const resolver = makeResolver(store, { WEBDAV_URL: 'https://env.example.com' });
      await resolver.loadAll();

      const env = { WEBDAV_URL: 'https://env.example.com' };
      populateT1Env(resolver, env); // env already set → not populated, not dbSourced

      const effective = await resolver.getEffectiveConfig();
      expect(effective.WEBDAV_URL.source).toBe('env');
      expect(effective.WEBDAV_URL.value).toBe('https://env.example.com');
    });
  });
});
