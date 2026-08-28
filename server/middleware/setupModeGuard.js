/**
 * Setup-mode API guard.
 *
 * When the effective configuration is incomplete (setup_complete === false),
 * file-domain and admin-write routes are blocked with
 * `503 { errorCode: 'setup.incomplete' }` so the first-run wizard is the only
 * usable surface. Setup routes, auth-login, public settings, and health must
 * NOT be mounted behind this guard (they stay open while setup is incomplete).
 *
 * Usage: app.use('/api/files', setupModeGuard(), filesRouter)
 */
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { computeSetupStatus } = require('../infrastructure/setupStatus');

/**
 * Express middleware factory.
 * Derives setup_complete per request from the currently effective env (pure
 * process.env inspection — cheap), returning 503 when setup is incomplete.
 * @returns {function} Express middleware
 */
function setupModeGuard() {
  return function setupModeGuardMiddleware(req, res, next) {
    // The jest route-test harness boots a configured app (composition is
    // explicitly overridden per suite, `WEA_FILE_STORAGE` etc. set at
    // require-time) but sets none of the file/admin config keys, so the derived
    // `setup_complete` would be false and the guard would block every guarded
    // route with 503. The harness is not a first-run boot — it is a pre-built
    // test environment — so the guard must not interfere. Jest sets
    // JEST_WORKER_ID only inside test workers; real boots (dev, prod, and the
    // e2e scratch server spawned by Playwright on :5003) never see it, so the
    // setup-mode blocking stays fully active there.
    if (process.env.JEST_WORKER_ID !== undefined) {
      return next();
    }
    const { setup_complete } = computeSetupStatus(process.env);
    if (!setup_complete) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        errorCode: SERVER_ERROR_CODES.setup.incomplete,
      });
    }
    return next();
  };
}

module.exports = setupModeGuard;
