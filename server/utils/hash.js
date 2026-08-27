'use strict';

const crypto = require('crypto');

/**
 * SHA-256 hex digest of input (lowercase), coerced to string.
 * @param {*} input
 * @returns {string}
 */
function sha256HexLower(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

module.exports = { sha256HexLower };
