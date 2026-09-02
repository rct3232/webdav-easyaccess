'use strict';

const path = require('path');

/**
 * Resolves the dotenv file path the server actually loads.
 *
 * Replicates `server/index.js:10-12` exactly so that the env writer and the
 * loader can never drift apart. The caller passes its own __dirname so both
 * server/index.js (T5 refactor) and the writer resolve against the same base.
 *
 * @param {string} requireMainDir __dirname of the calling module (e.g. server/)
 * @returns {string} absolute path to the env file
 */
function resolveEnvPath(requireMainDir) {
  return process.env.DOTENV_CONFIG_PATH
    ? path.resolve(requireMainDir, process.env.DOTENV_CONFIG_PATH)
    : path.join(requireMainDir, '../.env');
}

module.exports = { resolveEnvPath };
