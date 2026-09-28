'use strict';

/**
 * Single source of truth for the E2E `client/build` bootstrap, shared by
 * `e2e/helpers/setupScratch.ts` (hermetic suites) and
 * `scripts/e2e-serve-client.js` (platform webServer).
 *
 * - Freshness, not existence: a stale pre-feature build silently serves the
 *   old UI (wave-2 lesson — collections selectors missing while the build
 *   predated the feature sources), so rebuild when any client source/public/
 *   shared file is newer than the built index.
 * - `DISABLE_ESLINT_PLUGIN`: CRA's bundled eslint-webpack-plugin pins
 *   `resolvePluginsRelativeTo` to `react-scripts/config`, which under the
 *   npm-workspaces hoisted layout fails to register `eslint-plugin-react-hooks`
 *   — every inline `eslint-disable react-hooks/exhaustive-deps` would abort the
 *   production build with "Definition for rule ... was not found". The repo's
 *   lint authority is the root flat `eslint.config.js` (CI gates); the build
 *   only needs to emit assets.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function newestSourceMtime(dir) {
  let newest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'build' || entry.name === 'coverage')
        continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          const ms = fs.statSync(full).mtimeMs;
          if (ms > newest) newest = ms;
        } catch {
          /* ignore unreadable entries */
        }
      }
    }
  }
  return newest;
}

/**
 * @param {string} rootDir repo root (contains `client/` and `shared/`)
 * @param {string} [logPrefix] console prefix for the rebuild notice
 */
function ensureClientBuild(rootDir, logPrefix = '[ensureClientBuild]') {
  const buildIndex = path.join(rootDir, 'client', 'build', 'index.html');
  const builtAt = fs.existsSync(buildIndex) ? fs.statSync(buildIndex).mtimeMs : 0;
  const sourcesNewer = [
    path.join(rootDir, 'client', 'src'),
    path.join(rootDir, 'client', 'public'),
    path.join(rootDir, 'shared'),
  ].some((src) => newestSourceMtime(src) > builtAt);
  if (!sourcesNewer) return;
  console.log(`${logPrefix} client sources newer than client/build — rebuilding client...`);
  const result = spawnSync('npm', ['run', 'build', '--workspace', 'client'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, DISABLE_ESLINT_PLUGIN: 'true' },
  });
  if (result.status !== 0 || !fs.existsSync(buildIndex)) {
    throw new Error('client build did not produce client/build/index.html');
  }
}

module.exports = { ensureClientBuild, newestSourceMtime };
