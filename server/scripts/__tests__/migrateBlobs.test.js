'use strict';

// Backend selection is presence-based and normalized by the shared test-setup
// (server/test-setup.js): sqlite by default, PostgreSQL under test:ci:pg when
// all four WEA_DB_* identity keys are present.

const { buildDestBlobStore } = require('../../infrastructure/adapters/blobstore/config');
const { runMigrationCli } = require('../migrateBlobs');

const S3_FLAGS = [
  '--dest-s3-bucket=bucket-1',
  '--dest-s3-access-key=ak-1',
  '--dest-s3-secret-key=sk-1',
];
const WEBDAV_FLAGS = [
  '--dest-webdav-url=https://dav.example.com',
  '--dest-webdav-username=user-1',
  '--dest-webdav-password=pass-1',
];

const DEST_ENV_KEYS = [
  'DEST_WEBDAV_URL',
  'DEST_WEBDAV_USERNAME',
  'DEST_WEBDAV_PASSWORD',
  'DEST_WEBDAV_AUTH_TYPE',
  'DEST_WEBDAV_UPSTREAM_URL',
  'DEST_S3_BUCKET',
  'DEST_S3_ACCESS_KEY',
  'DEST_S3_SECRET_KEY',
  'DEST_S3_ENDPOINT',
  'DEST_S3_REGION',
];

const previousFileStorage = process.env.WEA_FILE_STORAGE;

function makeFakeService(overrides = {}) {
  const run =
    overrides.run ||
    jest.fn(async (opts) => {
      if (opts && opts.onProgress) opts.onProgress({ total: 0, done: 0, current: {} });
      return { copied: 0, skipped: 0, failed: 0, errors: [], dryRun: false };
    });
  return { run };
}

function makeOutput() {
  const lines = { log: [], error: [] };
  return {
    output: {
      log: (...args) => lines.log.push(args.join(' ')),
      error: (...args) => lines.error.push(args.join(' ')),
    },
    lines,
  };
}

describe('runMigrationCli', () => {
  beforeEach(() => {
    for (const key of DEST_ENV_KEYS) delete process.env[key];
    process.env.WEA_FILE_STORAGE = 'webdav';
  });

  afterAll(() => {
    if (previousFileStorage === undefined) delete process.env.WEA_FILE_STORAGE;
    else process.env.WEA_FILE_STORAGE = previousFileStorage;
  });

  it('the removed --direction flag is rejected as an unknown flag', async () => {
    const { output, lines } = makeOutput();
    const service = makeFakeService();
    const code = await runMigrationCli(['--direction=webdav-to-s3', '--dry-run', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/Unknown flag: --direction/);
    expect(lines.error.join('\n')).toMatch(/Usage:/);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('unknown flag exits 2', async () => {
    const { output, lines } = makeOutput();
    const code = await runMigrationCli(['--dry-run', '--bogus'], {
      migrationService: makeFakeService(),
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/Unknown flag: --bogus/);
  });

  it('--dry-run calls run with mode dry-run and an s3 destConfig (webdav source), returns 0', async () => {
    const { output } = makeOutput();
    const service = makeFakeService();
    const code = await runMigrationCli(['--dry-run', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(0);
    expect(service.run).toHaveBeenCalledTimes(1);
    const args = service.run.mock.calls[0][0];
    expect(args.mode).toBe('dry-run');
    expect(args.force).toBe(false);
    expect(args.direction).toBeUndefined();
    expect(args.destConfig).toEqual({
      type: 's3',
      bucket: 'bucket-1',
      accessKey: 'ak-1',
      secretKey: 'sk-1',
    });
  });

  it('--apply without --yes exits 2 and does not call run', async () => {
    const { output, lines } = makeOutput();
    const service = makeFakeService();
    const code = await runMigrationCli(['--apply', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/--yes/);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('--apply --yes calls run with mode apply and returns 0', async () => {
    const { output } = makeOutput();
    const service = makeFakeService();
    const code = await runMigrationCli(['--apply', '--yes', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(0);
    expect(service.run).toHaveBeenCalledTimes(1);
    expect(service.run.mock.calls[0][0].mode).toBe('apply');
  });

  it('--check-env builds dest via buildDestBlobStore, logs summary, returns 0 without running', async () => {
    const { output, lines } = makeOutput();
    const service = makeFakeService();
    const buildSpy = jest.fn(buildDestBlobStore);
    const code = await runMigrationCli(['--check-env', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore: buildSpy,
      output,
    });
    expect(code).toBe(0);
    expect(buildSpy).toHaveBeenCalledWith({
      type: 's3',
      bucket: 'bucket-1',
      accessKey: 'ak-1',
      secretKey: 'sk-1',
    });
    expect(lines.log.join('\n')).toMatch(/destination/);
    expect(lines.log.join('\n')).toMatch(/s3 destination/);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('--check-env exits 1 when a required dest field is missing', async () => {
    const { output, lines } = makeOutput();
    const service = makeFakeService();
    const code = await runMigrationCli(['--check-env'], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(1);
    expect(lines.error.join('\n')).toMatch(
      /Missing required destination fields: bucket, accessKey, secretKey/
    );
    expect(service.run).not.toHaveBeenCalled();
  });

  it('dest config falls back to DEST_* env when flags are absent', async () => {
    process.env.DEST_S3_BUCKET = 'env-bucket';
    process.env.DEST_S3_ACCESS_KEY = 'env-ak';
    process.env.DEST_S3_SECRET_KEY = 'env-sk';
    process.env.DEST_S3_REGION = 'eu-west-1';
    const { output } = makeOutput();
    const service = makeFakeService();
    const code = await runMigrationCli(['--dry-run'], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(0);
    expect(service.run.mock.calls[0][0].destConfig).toEqual({
      type: 's3',
      bucket: 'env-bucket',
      accessKey: 'env-ak',
      secretKey: 'env-sk',
      region: 'eu-west-1',
    });
  });

  it('--dest-* flags take precedence over DEST_* env', async () => {
    process.env.DEST_S3_BUCKET = 'env-bucket';
    process.env.DEST_S3_ACCESS_KEY = 'env-ak';
    process.env.DEST_S3_SECRET_KEY = 'env-sk';
    const { output } = makeOutput();
    const service = makeFakeService();
    await runMigrationCli(['--dry-run', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    const args = service.run.mock.calls[0][0];
    expect(args.destConfig.type).toBe('s3');
    expect(args.destConfig.bucket).toBe('bucket-1');
    expect(args.destConfig.accessKey).toBe('ak-1');
    expect(args.destConfig.secretKey).toBe('sk-1');
  });

  it('destination type is derived from WEA_FILE_STORAGE', async () => {
    const { output } = makeOutput();
    const s3Service = makeFakeService();
    await runMigrationCli(['--dry-run', ...S3_FLAGS], {
      migrationService: s3Service,
      buildDestBlobStore,
      output,
    });
    expect(s3Service.run.mock.calls[0][0].destConfig.type).toBe('s3');
    expect(s3Service.run.mock.calls[0][0].direction).toBeUndefined();

    process.env.WEA_FILE_STORAGE = 's3';
    const webdavService = makeFakeService();
    await runMigrationCli(['--dry-run', ...WEBDAV_FLAGS], {
      migrationService: webdavService,
      buildDestBlobStore,
      output,
    });
    expect(webdavService.run.mock.calls[0][0].destConfig.type).toBe('webdav');
    expect(webdavService.run.mock.calls[0][0].direction).toBeUndefined();
    expect(webdavService.run.mock.calls[0][0].destConfig).toEqual({
      type: 'webdav',
      url: 'https://dav.example.com',
      username: 'user-1',
      password: 'pass-1',
    });
  });

  it('run() rejection exits 1 with the error logged', async () => {
    const { output, lines } = makeOutput();
    const service = makeFakeService({
      run: jest.fn(async () => {
        throw new Error('config invalid');
      }),
    });
    const code = await runMigrationCli(['--dry-run', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(1);
    expect(lines.error.join('\n')).toMatch(/config invalid/);
  });

  it('legacy --direction, --phase and --resume flags are rejected as unknown flags', async () => {
    const { output, lines } = makeOutput();
    const service = makeFakeService();
    const phaseCode = await runMigrationCli(['--phase=finalize', '--dry-run', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(phaseCode).toBe(2);
    expect(lines.error.join('\n')).toMatch(/Unknown flag: --phase/);

    const resumeCode = await runMigrationCli(['--resume', '--dry-run', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(resumeCode).toBe(2);
    expect(lines.error.join('\n')).toMatch(/Unknown flag: --resume/);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('onProgress logging does not throw and summary is logged on success', async () => {
    const run = jest.fn(async (opts) => {
      opts.onProgress({ total: 3, done: 3, current: { nodeId: 3, path: '/user/done.txt' } });
      return { copied: 3, skipped: 0, failed: 0, errors: [], dryRun: false };
    });
    const { output, lines } = makeOutput();
    const service = makeFakeService({ run });
    const code = await runMigrationCli(['--dry-run', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(0);
    const logText = lines.log.join('\n');
    expect(logText).toMatch(/\[progress\] 3\/3 ... \/user\/done\.txt/);
    expect(logText).toMatch(/summary: copied=3 skipped=0 failed=0/);
  });

  it('onProgress is rate-limited (every 100) and always fires at completion', async () => {
    const run = jest.fn(async (opts) => {
      for (let done = 1; done <= 1000; done += 1) {
        opts.onProgress({
          total: 1000,
          done,
          current: { nodeId: done, path: `/user/f${done}.txt` },
        });
      }
      return { copied: 1000, skipped: 0, failed: 0, errors: [], dryRun: false };
    });
    const { output, lines } = makeOutput();
    const service = makeFakeService({ run });
    const code = await runMigrationCli(['--dry-run', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(0);
    const progressLines = lines.log.filter((line) => line.startsWith('[progress]'));
    expect(progressLines).toHaveLength(10);
    expect(progressLines[0]).toMatch(/\[progress\] 100\/1000/);
    expect(progressLines[9]).toMatch(/\[progress\] 1000\/1000/);
  });

  it('per-node failures are reported but the exit code is still 0', async () => {
    const run = jest.fn(async () => ({
      copied: 1,
      skipped: 0,
      failed: 1,
      errors: [{ nodeId: 9, path: '/user/fail.txt', error: 'boom' }],
      dryRun: false,
    }));
    const { output, lines } = makeOutput();
    const service = makeFakeService({ run });
    const code = await runMigrationCli(['--dry-run', ...S3_FLAGS], {
      migrationService: service,
      buildDestBlobStore,
      output,
    });
    expect(code).toBe(0);
    expect(lines.log.join('\n')).toMatch(/summary: copied=1 skipped=0 failed=1/);
    expect(lines.error.join('\n')).toMatch(/nodeId=9 .*boom/);
  });
});
