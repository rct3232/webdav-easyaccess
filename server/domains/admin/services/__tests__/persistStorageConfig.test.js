'use strict';

/**
 * Unit tests for persistStorageConfigToDb (PLAN D10 / docs/spec/server/tools/
 * blob-migration.md §4.4). Black-box: asserts observable DB writes (Settings.set
 * payloads — plaintext, secrets included), env-sourced skipping, and
 * resolver-cache invalidation. Settings and the shared resolver are mocked; the
 * registry helpers are the real implementations.
 */

jest.mock('../../../../models/Settings', () => ({
  set: jest.fn(),
}));
const Settings = require('../../../../models/Settings');

const mockResolver = {
  getEffectiveConfig: jest.fn(),
  invalidateCache: jest.fn(),
};
jest.mock('../../../../infrastructure/configResolver', () => ({
  getSharedResolver: () => mockResolver,
}));

const { persistStorageConfigToDb } = require('../migrationService');

beforeEach(() => {
  jest.clearAllMocks();
  mockResolver.getEffectiveConfig.mockResolvedValue({});
});

function setCallsForKey(key) {
  return Settings.set.mock.calls.filter(([k]) => k === key).map(([, v]) => v);
}

describe('persistStorageConfigToDb', () => {
  it('persists the full s3 mapping as plaintext (secrets included)', async () => {
    const result = await persistStorageConfigToDb({
      type: 's3',
      bucket: 'my-bucket',
      region: 'us-east-1',
      accessKey: 'ak123',
      secretKey: 'super-secret',
      endpoint: 'https://minio.local',
    });

    expect(result.persisted).toEqual([
      'WEA_FILE_STORAGE',
      'S3_BUCKET',
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'S3_ENDPOINT',
    ]);
    expect(result.skippedEnvSourced).toEqual([]);

    expect(setCallsForKey('WEA_FILE_STORAGE')).toEqual(['s3']);
    expect(setCallsForKey('S3_BUCKET')).toEqual(['my-bucket']);
    expect(setCallsForKey('AWS_REGION')).toEqual(['us-east-1']);
    expect(setCallsForKey('AWS_ACCESS_KEY_ID')).toEqual(['ak123']);
    expect(setCallsForKey('S3_ENDPOINT')).toEqual(['https://minio.local']);
    expect(setCallsForKey('AWS_SECRET_ACCESS_KEY')).toEqual(['super-secret']);

    expect(mockResolver.invalidateCache).toHaveBeenCalledWith(result.persisted);
  });

  it('persists the webdav mapping with the password as plaintext', async () => {
    const result = await persistStorageConfigToDb({
      type: 'webdav',
      url: 'https://dav.example.com',
      username: 'dav-user',
      password: 'dav-pass',
      authType: 'digest',
    });

    expect(result.persisted).toEqual([
      'WEA_FILE_STORAGE',
      'WEBDAV_URL',
      'WEBDAV_USERNAME',
      'WEBDAV_PASSWORD',
      'WEBDAV_AUTH_TYPE',
    ]);
    expect(setCallsForKey('WEA_FILE_STORAGE')).toEqual(['webdav']);
    expect(setCallsForKey('WEBDAV_URL')).toEqual(['https://dav.example.com']);
    expect(setCallsForKey('WEBDAV_USERNAME')).toEqual(['dav-user']);
    expect(setCallsForKey('WEBDAV_AUTH_TYPE')).toEqual(['digest']);
    expect(setCallsForKey('WEBDAV_PASSWORD')).toEqual(['dav-pass']);
  });

  it('skips env-sourced keys and reports them in skippedEnvSourced', async () => {
    mockResolver.getEffectiveConfig.mockResolvedValue({
      S3_BUCKET: { source: 'env' },
      AWS_REGION: { source: 'env' },
    });

    const result = await persistStorageConfigToDb({
      type: 's3',
      bucket: 'b',
      region: 'r',
      accessKey: 'ak',
      secretKey: 'sk',
    });

    expect(result.skippedEnvSourced).toEqual(['S3_BUCKET', 'AWS_REGION']);
    expect(result.persisted).toEqual([
      'WEA_FILE_STORAGE',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
    ]);
    expect(setCallsForKey('S3_BUCKET')).toEqual([]);
    expect(setCallsForKey('AWS_REGION')).toEqual([]);
    expect(setCallsForKey('AWS_SECRET_ACCESS_KEY')).toHaveLength(1);
    // Only the DB-sourced keys are invalidated from the cache.
    expect(mockResolver.invalidateCache).toHaveBeenCalledWith(result.persisted);
  });

  it('skips empty/missing mapped values entirely', async () => {
    const result = await persistStorageConfigToDb({
      type: 's3',
      bucket: 'b',
      region: 'r',
      accessKey: 'ak',
      secretKey: 'sk',
      endpoint: '', // empty -> skipped
    });

    expect(result.persisted).not.toContain('S3_ENDPOINT');
    expect(setCallsForKey('S3_ENDPOINT')).toEqual([]);
  });

  it('returns empty results and skips invalidateCache for an unknown dest type', async () => {
    const result = await persistStorageConfigToDb({ type: 'ftp', host: 'x' });
    expect(result).toEqual({ persisted: [], skippedEnvSourced: [] });
    expect(Settings.set).not.toHaveBeenCalled();
    expect(mockResolver.invalidateCache).not.toHaveBeenCalled();
  });

  it('does not invalidate the cache when nothing was persisted', async () => {
    const result = await persistStorageConfigToDb({});
    expect(result).toEqual({ persisted: [], skippedEnvSourced: [] });
    expect(Settings.set).not.toHaveBeenCalled();
    expect(mockResolver.invalidateCache).not.toHaveBeenCalled();
  });
});
