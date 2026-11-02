'use strict';

/**
 * E2E client dev-server wrapper (`npm run dev:e2e:client`): resolves this
 * checkout's E2E port band (scripts/lib/e2e-band.cjs) and starts the CRA dev
 * server with PORT=<band client> and REACT_APP_API_PORT=<band api>, so the
 * dev iteration path matches the band that `e2e-wait-healthy` /
 * `playwright.config.ts` use. Offset 0 (no generated band) reproduces the
 * historical fixed 3000/5002 contract. Explicit PORT/REACT_APP_API_PORT env
 * wins over the band.
 */

const { spawnSync } = require('node:child_process');
const { effectivePorts } = require('../lib/e2e-band.cjs');

const ports = effectivePorts(process.cwd());
const env = {
  ...process.env,
  BROWSER: process.env.BROWSER || 'none',
  PORT: process.env.PORT || String(ports.client),
  REACT_APP_API_PORT: process.env.REACT_APP_API_PORT || String(ports.api),
};

const result = spawnSync('npm', ['run', 'start', '--workspace', 'client'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});
process.exit(result.status === null ? 1 : result.status);
