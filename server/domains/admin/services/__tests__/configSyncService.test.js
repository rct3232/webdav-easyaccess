'use strict';

/**
 * Shared config-sync core unit tests (server/domains/admin/services/configSyncService.js).
 * The algorithm core is exercised end-to-end through the CLI (configSync.test.js, real
 * sqlite + .env) and the admin route (config.test.js, mocked Settings). These tests pin
 * the service contract directly with a fake settings store and injected env source.
 */

const { buildConfigSyncReport, syncConfigSyncEnv } = require('../configSyncService');

const TS = new Date('2026-09-03T10:00:00.000Z');

function fakeSettings(rows = []) {
  const state = rows.map((row) => ({ ...row }));
  return {
    listRows: jest.fn(async () => state.map((row) => ({ ...row }))),
    set: jest.fn(async (key, value) => {
      const existing = state.find((row) => row.key === key);
      if (existing) existing.value = value;
      else state.push({ key, value, updated_at: TS });
    }),
  };
}

// envValueOf helpers
const fromMap = (map) => (key) => map.get(key);

describe('configSyncService.buildConfigSyncReport', () => {
  it('classifies env-only / shadowed / differs / db-only and drives exitCode', async () => {
    const settings = fakeSettings([
      { key: 'PORT', value: '5001', updated_at: TS }, // shadowed (env equal)
      { key: 'EMAIL_HOST', value: 'smtp.example.com', updated_at: TS }, // differs
      { key: 'AWS_REGION', value: 'eu-west-1', updated_at: TS }, // db-only
    ]);
    const env = new Map([
      ['PORT', '5001'],
      ['EMAIL_HOST', 'db-only-host.example.com'],
      ['CORS_ORIGINS', 'https://app.example.com'], // env-only (no row)
    ]);

    const report = await buildConfigSyncReport({
      settings,
      envValueOf: fromMap(env),
    });

    const byKey = new Map(report.findings.map((f) => [f.key, f]));
    expect(byKey.get('PORT').status).toBe('shadowed');
    expect(byKey.get('EMAIL_HOST').status).toBe('differs');
    expect(byKey.get('AWS_REGION').status).toBe('db-only');
    expect(byKey.get('CORS_ORIGINS').status).toBe('env-only');
    expect(byKey.get('CORS_ORIGINS').dbUpdatedAt).toBeNull();
    expect(report.summary).toEqual({
      drift: 1,
      shadowed: 1,
      envOnly: 1,
      dbOnly: 1,
      total: 4,
    });
    expect(report.exitCode).toBe(1);
  });

  it('classifies a secret row by plaintext comparison (differs / shadowed)', async () => {
    const settings = fakeSettings([
      { key: 'WEBDAV_PASSWORD', value: 'old-pass', updated_at: TS },
    ]);
    const env = new Map([['WEBDAV_PASSWORD', 'new-pass']]);

    const report = await buildConfigSyncReport({
      settings,
      envValueOf: fromMap(env),
    });

    const secret = report.findings.find((f) => f.key === 'WEBDAV_PASSWORD');
    expect(secret.status).toBe('differs');
    expect(secret.secret).toBe(true);
    expect(report.summary.drift).toBe(1);
    expect(report.exitCode).toBe(1);
  });

  it('classifies a db-only secret row as db-only (no env), exit 0', async () => {
    const settings = fakeSettings([
      { key: 'EMAIL_PASSWORD', value: 'stored-secret', updated_at: TS },
    ]);

    const report = await buildConfigSyncReport({
      settings,
      envValueOf: () => undefined,
    });

    expect(report.findings).toEqual([
      {
        key: 'EMAIL_PASSWORD',
        status: 'db-only',
        secret: true,
        dbUpdatedAt: '2026-09-03T10:00:00.000Z',
      },
    ]);
    expect(report.summary.alerts).toBeUndefined();
    expect(report.exitCode).toBe(0);
  });
});

describe('configSyncService.syncConfigSyncEnv', () => {
  it('upserts changed env-sourced keys, skips equal ones, and rechecks clean', async () => {
    const rows = [
      { key: 'PORT', value: '6001', updated_at: TS }, // drift -> updated
      { key: 'WEBDAV_URL', value: 'https://dav.example.com', updated_at: TS }, // equal -> unchanged
    ];
    const settings = fakeSettings(rows);
    const env = new Map([
      ['PORT', '5001'],
      ['WEBDAV_URL', 'https://dav.example.com'],
    ]);

    const result = await syncConfigSyncEnv({
      settings,
      envValueOf: fromMap(env),
    });

    expect(settings.set).toHaveBeenCalledTimes(1);
    expect(settings.set).toHaveBeenCalledWith('PORT', '5001');
    expect(result.writes).toHaveLength(2);
    expect(result.writes).toEqual(
      expect.arrayContaining([
        { key: 'PORT', secret: false, status: 'updated' },
        { key: 'WEBDAV_URL', secret: false, status: 'unchanged' },
      ])
    );
    expect(result.report.exitCode).toBe(0);
  });

  it('never writes T0 keys even when env-sourced', async () => {
    const settings = fakeSettings([]);
    const env = new Map([['JWT_SECRET', 'jwt-t0']]);

    const result = await syncConfigSyncEnv({
      settings,
      envValueOf: fromMap(env),
    });

    expect(settings.set).not.toHaveBeenCalled();
    expect(result.writes).toEqual([]);
  });

  it('writes an env-set secret into the DB as plaintext', async () => {
    const settings = fakeSettings([
      { key: 'WEBDAV_PASSWORD', value: 'old-pass', updated_at: TS },
    ]);
    const env = new Map([['WEBDAV_PASSWORD', 'new-pass']]);

    const result = await syncConfigSyncEnv({ settings, envValueOf: fromMap(env) });

    expect(settings.set).toHaveBeenCalledTimes(1);
    expect(settings.set).toHaveBeenCalledWith('WEBDAV_PASSWORD', 'new-pass');
    expect(result.writes[0].status).toBe('updated');
  });
});
