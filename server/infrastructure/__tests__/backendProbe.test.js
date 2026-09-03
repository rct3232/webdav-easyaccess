'use strict';

/**
 * backendProbe public-API guard.
 *
 * Regression guard: the boot S3 probe (server/index.js) destructures
 * `probeS3` from backendProbe. probeS3 was omitted from module.exports, so
 * boot printed "S3 connection test: FAILED — probeS3 is not a function"
 * without ever testing connectivity. Keeping the export under test prevents
 * that from silently returning.
 */
const backendProbe = require('../backendProbe');

describe('backendProbe exports', () => {
  it('exposes probeS3 so the boot sequence can run a real S3 probe', () => {
    expect(typeof backendProbe.probeS3).toBe('function');
  });

  it('exposes runProbe and the classification helpers used by boot/admin-test', () => {
    expect(typeof backendProbe.runProbe).toBe('function');
    expect(typeof backendProbe.classifyToHealthCode).toBe('function');
    expect(typeof backendProbe.classifyS3BucketError).toBe('function');
    expect(typeof backendProbe.deriveReason).toBe('function');
  });
});
