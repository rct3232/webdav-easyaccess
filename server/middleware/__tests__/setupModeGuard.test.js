/**
 * setupModeGuard middleware tests.
 * @see docs/spec/server/routes/setup.md §2.3
 */
const request = require('supertest');
const express = require('express');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const setupModeGuard = require('../setupModeGuard');

jest.mock('../../infrastructure/setupStatus', () => ({
  computeSetupStatus: jest.fn(),
}));
const { computeSetupStatus } = require('../../infrastructure/setupStatus');

describe('setupModeGuard', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.get('/probe', setupModeGuard(), (_req, res) => res.status(200).json({ ok: true }));
  });

  it('returns 503 with setup.incomplete when setup is incomplete', async () => {
    computeSetupStatus.mockReturnValue({ setup_complete: false });

    const res = await request(app).get('/probe');

    expect(res.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(res.body).toEqual({ errorCode: SERVER_ERROR_CODES.setup.incomplete });
  });

  it('calls next() so the route handler runs when setup is complete', async () => {
    computeSetupStatus.mockReturnValue({ setup_complete: true });

    const res = await request(app).get('/probe');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('derives setup_complete from process.env on each request', async () => {
    computeSetupStatus.mockReturnValue({ setup_complete: false });

    await request(app).get('/probe');

    expect(computeSetupStatus).toHaveBeenCalledWith(process.env);
  });

  it('is a factory returning a middleware function', () => {
    expect(typeof setupModeGuard).toBe('function');
    expect(typeof setupModeGuard()).toBe('function');
  });
});
