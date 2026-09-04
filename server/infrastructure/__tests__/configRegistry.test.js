'use strict';

const {
  TIER,
  CONFIG_ENTRIES,
  getEntries,
  getEntry,
  isT0,
  isTier,
  isSecret,
  getDefault,
} = require('../configRegistry');

describe('configRegistry', () => {
  it('exports frozen tiers and a frozen, frozen-entry catalog', () => {
    expect(Object.isFrozen(TIER)).toBe(true);
    expect(Object.isFrozen(CONFIG_ENTRIES)).toBe(true);
    expect(CONFIG_ENTRIES.length).toBeGreaterThan(0);
    for (const entry of CONFIG_ENTRIES) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it('getEntries returns the same frozen catalog', () => {
    expect(getEntries()).toBe(CONFIG_ENTRIES);
  });

  describe('classification spot-checks (PLAN §4)', () => {
    it.each([
      ['WEA_SQLITE_PATH', 'T0'],
      ['WEA_DB_HOST', 'T0'],
      ['WEA_DB_PASSWORD', 'T0'],
      ['WEA_DB_SSL', 'T0'],
      ['WEA_DB_QUERY_TIMEOUT_MS', 'T0'],
      ['NODE_ENV', 'T0'],
      ['JWT_SECRET', 'T0'],
    ])('%s is %s', (key, tier) => {
      expect(isTier(key, TIER[tier])).toBe(true);
    });

    it.each([
      ['PORT', 'T1'],
      ['WEA_FILE_STORAGE', 'T1'],
      ['AWS_SECRET_ACCESS_KEY', 'T1'],
      ['WEBDAV_PASSWORD', 'T1'],
      ['WEBDAV_AUTH_TYPE', 'T1'],
      ['THUMBNAIL_CONCURRENCY_LIMIT', 'T1'],
      ['FFMPEG_PATH', 'T1'],
      ['GC_INTERVAL_MS', 'T1'],
      ['ADMIN_DEFAULT_PASSWORD', 'T1'],
      ['EMAIL_HOST', 'T1'],
      ['EMAIL_PASSWORD', 'T1'],
    ])('%s is %s', (key, tier) => {
      expect(isTier(key, TIER[tier])).toBe(true);
    });

    it.each([
      ['registration_enabled', 'T2'],
      ['CORS_ORIGINS', 'T2'],
      ['GC_ORPHAN_TTL_DAYS', 'T2'],
      ['WEBDAV_UPSTREAM_URL', 'T2'],
      ['JWT_EXPIRES_IN', 'T2'],
      ['LOGIN_RATE_LIMIT_MAX', 'T2'],
      ['LOGIN_RATE_LIMIT_WINDOW_MS', 'T2'],
      ['MAX_THUMBNAIL_SIZE', 'T2'],
      ['THUMBNAIL_TOKEN_SECRET', 'T2'],
      ['THUMBNAIL_TOKEN_EXPIRY', 'T2'],
      ['FFMPEG_INIT_TIMEOUT_MS', 'T2'],
      ['WEA_PREVIEW_TICKET_TTL_MS', 'T2'],
      ['PERMISSION_CACHE_TTL_MS', 'T2'],
      ['USER_CACHE_TTL_MS', 'T2'],
      ['PERMISSIONS_EXISTENCE_INDEX_TTL_MS', 'T2'],
      ['PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE', 'T2'],
      ['PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY', 'T2'],
    ])('%s is %s', (key, tier) => {
      expect(isTier(key, TIER[tier])).toBe(true);
    });
  });

  describe('secret flag (D6/D8 + task list)', () => {
    it.each([
      'WEA_DB_PASSWORD',
      'JWT_SECRET',
      'AWS_SECRET_ACCESS_KEY',
      'WEBDAV_PASSWORD',
      'EMAIL_PASSWORD',
      'ADMIN_DEFAULT_PASSWORD',
    ])('%s is secret', (key) => {
      expect(isSecret(key)).toBe(true);
    });

    it.each([
      'WEA_SQLITE_PATH',
      'WEA_DB_HOST',
      'WEA_DB_QUERY_TIMEOUT_MS',
      'S3_BUCKET',
      'WEBDAV_URL',
      'WEBDAV_AUTH_TYPE',
      'EMAIL_HOST',
      'CORS_ORIGINS',
      'registration_enabled',
      'GC_ORPHAN_TTL_DAYS',
    ])('%s is not secret', (key) => {
      expect(isSecret(key)).toBe(false);
    });
  });

  describe('entry lookup', () => {
    it('returns the entry for a known key', () => {
      expect(getEntry('EMAIL_HOST')).toEqual({
        key: 'EMAIL_HOST',
        tier: TIER.T1,
        secret: false,
      });
    });

    it('returns undefined for an unknown key', () => {
      expect(getEntry('NOT_A_REAL_VAR')).toBeUndefined();
      expect(isSecret('NOT_A_REAL_VAR')).toBe(false);
      expect(isT0('NOT_A_REAL_VAR')).toBe(false);
      expect(isTier('NOT_A_REAL_VAR', TIER.T1)).toBe(false);
    });
  });

  describe('defaults', () => {
    it('exposes in-code defaults for the audited set', () => {
      expect(getDefault('PORT')).toBe(5001);
      expect(getDefault('WEA_FILE_STORAGE')).toBe('s3');
      expect(getDefault('WEA_DB_PORT')).toBe(5432);
      expect(getDefault('WEA_DB_SSL')).toBe(false);
      expect(getDefault('WEA_DB_MAX')).toBe(10);
      expect(getDefault('WEA_DB_IDLE_TIMEOUT_MS')).toBe(30000);
      expect(getDefault('WEA_DB_CONNECTION_TIMEOUT_MS')).toBe(10000);
      expect(getDefault('WEA_DB_QUERY_TIMEOUT_MS')).toBe(60000);
      expect(getDefault('MAX_THUMBNAIL_SIZE')).toBe(300);
      expect(getDefault('THUMBNAIL_CONCURRENCY_LIMIT')).toBe(10);
      expect(getDefault('GC_INTERVAL_MS')).toBe(0);
      expect(getDefault('EMAIL_SECURE')).toBe(false);
      expect(getDefault('EMAIL_PORT')).toBe(587);
      expect(getDefault('EMAIL_FROM_NAME')).toBe('WebDAV EasyAccess');
      expect(getDefault('CORS_ORIGINS')).toBe('');
      expect(getDefault('GC_ORPHAN_TTL_DAYS')).toBe(1);
      expect(getDefault('JWT_EXPIRES_IN')).toBe('30m');
      expect(getDefault('WEBDAV_AUTH_TYPE')).toBe('auto');
      expect(getDefault('ADMIN_DEFAULT_PASSWORD')).toBe('admin');
    });

    it('returns undefined for keys without a code default', () => {
      expect(getDefault('NODE_ENV')).toBeUndefined();
      expect(getDefault('WEA_SQLITE_PATH')).toBeUndefined();
      expect(getDefault('WEA_DB_HOST')).toBeUndefined();
      expect(getDefault('EMAIL_HOST')).toBeUndefined();
      expect(getDefault('WEBDAV_URL')).toBeUndefined();
      expect(getDefault('unknown-key')).toBeUndefined();
    });
  });

  it('preserves registration_enabled as T2, non-secret, no default', () => {
    const entry = getEntry('registration_enabled');
    expect(entry).toBeDefined();
    expect(entry.tier).toBe(TIER.T2);
    expect(entry.secret).toBe(false);
    expect(entry.default).toBeUndefined();
    expect(isT0('registration_enabled')).toBe(false);
  });

  it('contains every env var read under server/ (inventory check)', () => {
    const keys = CONFIG_ENTRIES.map((entry) => entry.key);
    for (const key of [
      'WEA_SQLITE_PATH',
      'WEA_DB_HOST',
      'WEA_DB_PORT',
      'WEA_DB_DATABASE',
      'WEA_DB_USER',
      'WEA_DB_PASSWORD',
      'WEA_DB_SSL',
      'WEA_DB_MAX',
      'WEA_DB_IDLE_TIMEOUT_MS',
      'WEA_DB_CONNECTION_TIMEOUT_MS',
      'WEA_DB_QUERY_TIMEOUT_MS',
      'NODE_ENV',
      'DOTENV_CONFIG_PATH',
      'JWT_SECRET',
      'PORT',
      'WEA_FILE_STORAGE',
      'S3_BUCKET',
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'S3_ENDPOINT',
      'WEBDAV_URL',
      'WEBDAV_USERNAME',
      'WEBDAV_PASSWORD',
      'WEBDAV_AUTH_TYPE',
      'LOGIN_RATE_LIMIT_MAX',
      'LOGIN_RATE_LIMIT_WINDOW_MS',
      'MAX_THUMBNAIL_SIZE',
      'THUMBNAIL_CONCURRENCY_LIMIT',
      'FFMPEG_PATH',
      'GC_INTERVAL_MS',
      'ADMIN_DEFAULT_PASSWORD',
      'EMAIL_HOST',
      'EMAIL_PORT',
      'EMAIL_USER',
      'EMAIL_PASSWORD',
      'EMAIL_SECURE',
      'EMAIL_FROM_NAME',
      'CORS_ORIGINS',
      'GC_ORPHAN_TTL_DAYS',
      'WEBDAV_UPSTREAM_URL',
      'JWT_EXPIRES_IN',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('orders T0 metadata first, then file storage, server/security, email, runtime', () => {
    const keys = CONFIG_ENTRIES.map((entry) => entry.key);
    const orderOf = (key) => keys.indexOf(key);

    expect(orderOf('WEA_SQLITE_PATH')).toBeLessThan(orderOf('WEA_FILE_STORAGE'));
    expect(orderOf('WEA_FILE_STORAGE')).toBeLessThan(orderOf('PORT'));
    expect(orderOf('PORT')).toBeLessThan(orderOf('EMAIL_HOST'));
    expect(orderOf('EMAIL_HOST')).toBeLessThan(orderOf('registration_enabled'));

    const t0 = CONFIG_ENTRIES.filter((entry) => entry.tier === TIER.T0);
    expect(t0[0].key).toBe('WEA_SQLITE_PATH');
    expect(t0[t0.length - 1].key).toBe('JWT_SECRET');
  });
});
