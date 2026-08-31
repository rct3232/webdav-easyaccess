'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKey(passphrase) {
  return crypto.createHash('sha256').update(String(passphrase), 'utf8').digest();
}

function encryptSecret(plaintext, passphrase) {
  const key = deriveKey(passphrase);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: ALGORITHM,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptSecret(payload, passphrase) {
  if (!isEncryptedPayload(payload)) {
    throw new TypeError('Invalid encrypted payload');
  }
  if (payload.enc !== ALGORITHM) {
    throw new Error(`Unsupported encryption algorithm: ${payload.enc}`);
  }
  const key = deriveKey(passphrase);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]);
  return plain.toString('utf8');
}

function generateKey() {
  return crypto.randomBytes(32).toString('hex');
}

function isEncryptedPayload(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.enc === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.data === 'string'
  );
}

/**
 * True when any settings row holds an encrypted payload — the shape-only
 * detection used for the key-lost warning (never decrypts, so it cannot leak
 * plaintext). Accepts the `settingsStore.getAll()` object map, an array of
 * `{ value }` rows (wizard direct-read shape), or raw values.
 */
function hasEncryptedRows(rows) {
  const values = Array.isArray(rows)
    ? rows.map((row) => (row && typeof row === 'object' && 'value' in row ? row.value : row))
    : Object.values(rows || {});
  return values.some((raw) => {
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        return false;
      }
    }
    return isEncryptedPayload(raw);
  });
}

module.exports = {
  deriveKey,
  encryptSecret,
  decryptSecret,
  generateKey,
  isEncryptedPayload,
  hasEncryptedRows,
};
