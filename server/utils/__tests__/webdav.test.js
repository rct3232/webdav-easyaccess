'use strict';

/**
 * WebDAV MKCOL reliability contract:
 *  - transient transport failures are retried (3 attempts total, 50ms + 150ms)
 *  - already-existing collections are idempotent (405/301/302/303, 409 + probe)
 *  - HTTP status failures are not retried
 */

jest.unstable_mockModule('webdav', () => ({
  createClient: jest.fn(),
}));

const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

const BASE_URL = 'http://dav.test';
const ORIGINAL_ENV = {
  WEBDAV_URL: process.env.WEBDAV_URL,
  WEBDAV_USERNAME: process.env.WEBDAV_USERNAME,
  WEBDAV_PASSWORD: process.env.WEBDAV_PASSWORD,
  WEBDAV_AUTH_TYPE: process.env.WEBDAV_AUTH_TYPE,
};

let createClient;
let webdav;
const client = {
  exists: jest.fn(),
  createDirectory: jest.fn(),
};

function transportError(message = 'socket hang up') {
  return Object.assign(new Error(message), { code: 'ECONNRESET' });
}

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

beforeAll(async () => {
  // The production module resolves the ESM `webdav` package via dynamic import;
  // Jest's ESM registry mock keeps the client factory deterministic.
  ({ createClient } = await import('webdav'));
  webdav = require('../webdav');
});

beforeEach(() => {
  process.env.WEBDAV_URL = BASE_URL;
  process.env.WEBDAV_USERNAME = 'user';
  process.env.WEBDAV_PASSWORD = 'pass';
  delete process.env.WEBDAV_AUTH_TYPE;

  client.exists.mockReset().mockResolvedValue(false);
  client.createDirectory.mockReset().mockResolvedValue(undefined);
  createClient.mockReset().mockReturnValue(client);
});

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('createDirectory transport retry', () => {
  it('retries a transient socket hang up and succeeds', async () => {
    client.createDirectory
      .mockRejectedValueOnce(transportError('socket hang up'))
      .mockResolvedValueOnce(undefined);

    await expect(webdav.ensureDirectoryExists('/newdir')).resolves.toEqual({ success: true });

    expect(client.createDirectory).toHaveBeenCalledTimes(2);
    expect(client.createDirectory).toHaveBeenNthCalledWith(1, '/newdir');
    expect(client.createDirectory).toHaveBeenNthCalledWith(2, '/newdir');
  });

  it('exhausts 3 attempts with the documented 50ms + 150ms backoff and surfaces createDirFailed', async () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    client.createDirectory.mockRejectedValue(transportError('read ECONNRESET'));

    try {
      const error = await webdav.createDirectory('/newdir').catch((err) => err);

      expect(client.createDirectory).toHaveBeenCalledTimes(3);
      expect(timeoutSpy.mock.calls.map(([, delay]) => delay)).toEqual([50, 150]);
      expect(error.errorCode).toBe(SERVER_ERROR_CODES.webdav.createDirFailed);
      expect(error.status).toBe(500);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it.each([405, 301, 302, 303])(
    'treats MKCOL %i as already existing without retrying',
    async (status) => {
      client.createDirectory.mockRejectedValue(httpError(status));

      await expect(webdav.createDirectory('/existing')).resolves.toEqual({ success: true });

      expect(client.createDirectory).toHaveBeenCalledTimes(1);
    }
  );

  it('treats a 409 as existing when the follow-up existence probe succeeds', async () => {
    client.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    client.createDirectory.mockRejectedValue(httpError(409));

    await expect(webdav.createDirectory('/existing')).resolves.toEqual({ success: true });

    expect(client.createDirectory).toHaveBeenCalledTimes(1);
    expect(client.exists).toHaveBeenCalledTimes(2);
  });

  it('surfaces createDirFailed for a 409 whose existence probe says missing', async () => {
    client.exists.mockResolvedValue(false);
    client.createDirectory.mockRejectedValue(httpError(409));

    const error = await webdav.createDirectory('/missing').catch((err) => err);

    expect(error.errorCode).toBe(SERVER_ERROR_CODES.webdav.createDirFailed);
    expect(error.status).toBe(409);
  });

  it('does not retry a non-transport HTTP 500', async () => {
    client.createDirectory.mockRejectedValue(httpError(500));

    const error = await webdav.createDirectory('/broken').catch((err) => err);

    expect(client.createDirectory).toHaveBeenCalledTimes(1);
    expect(error.errorCode).toBe(SERVER_ERROR_CODES.webdav.createDirFailed);
    expect(error.status).toBe(500);
  });
});
