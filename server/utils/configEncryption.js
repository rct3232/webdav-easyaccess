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

module.exports = {
  deriveKey,
  encryptSecret,
  decryptSecret,
  generateKey,
  isEncryptedPayload,
};
