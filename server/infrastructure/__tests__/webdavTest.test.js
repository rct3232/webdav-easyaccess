'use strict';

/**
 * Health-probe WebDAV connection contract:
 *  - transient transport failures retry on both probe paths (max 2 × 3)
 *  - HTTP status responses are classified immediately and not retried
 *  - failures surface the existing i18n codes and mark backend health as fail
 */

jest.unstable_mockModule('webdav', () => ({
  createClient: jest.fn(),
}));

const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getBackendHealth } = require('../backendHealth');

const ORIGINAL_ENV = {
  WEBDAV_URL: process.env.WEBDAV_URL,
  WEBDAV_USERNAME: process.env.WEBDAV_USERNAME,
  WEBDAV_PASSWORD: process.env.WEBDAV_PASSWORD,
  WEBDAV_AUTH_TYPE: process.env.WEBDAV_AUTH_TYPE,
};

let createClient;
let webdavTest;
const client = {
  getDirectoryContents: jest.fn(),
};

function transportError(message = 'socket hang up') {
  return Object.assign(new Error(message), { code: 'ECONNRESET' });
}

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

beforeAll(async () => {
  ({ createClient } = await import('webdav'));
  webdavTest = require('../webdavTest');
});

beforeEach(() => {
  process.env.WEBDAV_URL = 'http://dav.test';
  process.env.WEBDAV_USERNAME = 'user';
  process.env.WEBDAV_PASSWORD = 'pass';
  delete process.env.WEBDAV_AUTH_TYPE;

  getBackendHealth().reset();
  client.getDirectoryContents.mockReset();
  createClient.mockReset().mockReturnValue(client);
});

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('testConnection transport retry', () => {
  it('retries socket hang up twice and succeeds on the third attempt', async () => {
    client.getDirectoryContents
      .mockRejectedValueOnce(transportError('socket hang up'))
      .mockRejectedValueOnce(transportError('ECONNRESET'))
      .mockResolvedValueOnce([{ basename: 'a' }, { basename: 'b' }]);

    const result = await webdavTest.testConnection();

    expect(client.getDirectoryContents).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      success: true,
      messageCode: SERVER_MESSAGE_CODES.api.webdavTestOk,
      itemCount: 2,
      testPath: '/',
    });
    expect(getBackendHealth().getHealth().webdav.status).toBe('ok');
  });

  it('fails with webdavTestFailed after three transient failures and marks health fail', async () => {
    client.getDirectoryContents.mockRejectedValue(transportError('socket hang up'));

    await expect(webdavTest.testConnection()).rejects.toMatchObject({
      errorCode: SERVER_ERROR_CODES.api.webdavTestFailed,
      status: 500,
    });

    expect(client.getDirectoryContents).toHaveBeenCalledTimes(3);
    expect(getBackendHealth().getHealth().webdav).toMatchObject({
      status: 'fail',
      code: 'unknown',
    });
  });

  it('probes both paths for a base URL with a path: max 6 attempts (2 × 3)', async () => {
    process.env.WEBDAV_URL = 'http://dav.test/remote.php/dav';
    client.getDirectoryContents.mockRejectedValue(transportError('socket hang up'));

    await expect(webdavTest.testConnection()).rejects.toMatchObject({
      errorCode: SERVER_ERROR_CODES.api.webdavTestFailed,
    });

    expect(client.getDirectoryContents).toHaveBeenCalledTimes(6);
    expect(client.getDirectoryContents.mock.calls.map(([path]) => path)).toEqual([
      '',
      '',
      '',
      '/',
      '/',
      '/',
    ]);
  });
});

describe('testConnection HTTP status classification', () => {
  it.each([
    [401, SERVER_ERROR_CODES.webdav.credentialsNotConfigured, 'auth'],
    [403, SERVER_ERROR_CODES.webdav.connectionRefused, 'unreachable'],
    [404, SERVER_ERROR_CODES.webdav.cannotConnect, 'unreachable'],
    [500, SERVER_ERROR_CODES.api.webdavTestFailed, 'unknown'],
  ])('maps HTTP %i to %s without retrying', async (status, errorCode, healthCode) => {
    client.getDirectoryContents.mockRejectedValue(httpError(status));

    await expect(webdavTest.testConnection()).rejects.toMatchObject({ errorCode, status });

    expect(client.getDirectoryContents).toHaveBeenCalledTimes(1);
    expect(getBackendHealth().getHealth().webdav).toMatchObject({
      status: 'fail',
      code: healthCode,
    });
  });
});
