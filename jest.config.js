/**
 * Root Jest entry point.
 *
 * A bare `npx jest` from the repository root previously bypassed
 * `server/jest.config.js`, so `server/test-setup.js` (the production-DB guard)
 * never ran. Delegating to the server config with `rootDir` pinned to `server/`
 * keeps a single source of truth and makes root invocations safe.
 * @type {import('jest').Config}
 */
const path = require('path');

const serverConfig = require('./server/jest.config.js');

module.exports = {
  ...serverConfig,
  rootDir: path.join(__dirname, 'server'),
};
