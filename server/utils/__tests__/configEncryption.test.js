'use strict';

const {
  deriveKey,
  encryptSecret,
  decryptSecret,
  generateKey,
  isEncryptedPayload,
} = require('../configEncryption');

describe('configEncryption', () => {
  describe('deriveKey', () => {
    it('derives a 32-byte key from a passphrase', () => {
      const key = deriveKey('some-passphrase');
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('is deterministic and accepts hex-style passphrases', () => {
      expect(deriveKey('abc').toString('hex')).toBe(deriveKey('abc').toString('hex'));
      const hexPass = 'a'.repeat(64);
      expect(deriveKey(hexPass).length).toBe(32);
    });
  });

  describe('encryptSecret / decryptSecret round-trip', () => {
    it('round-trips a plaintext string', () => {
      const payload = encryptSecret('smtp-secret-value', 'master-key');
      expect(decryptSecret(payload, 'master-key')).toBe('smtp-secret-value');
    });

    it('round-trips an empty string and non-ASCII text', () => {
      expect(decryptSecret(encryptSecret('', 'k'), 'k')).toBe('');
      expect(decryptSecret(encryptSecret('pässwörd 🔐', 'k'), 'k')).toBe('pässwörd 🔐');
    });

    it('produces a random IV per encryption (distinct ciphertext)', () => {
      const a = encryptSecret('same', 'k');
      const b = encryptSecret('same', 'k');
      expect(a.iv).not.toBe(b.iv);
      expect(a.data).not.toBe(b.data);
    });

    it('fails authentication with the wrong passphrase', () => {
      const payload = encryptSecret('secret', 'right-key');
      expect(() => decryptSecret(payload, 'wrong-key')).toThrow();
    });

    it('fails authentication on a tampered payload', () => {
      const payload = encryptSecret('secret', 'k');
      const tampered = { ...payload, data: `${payload.data.slice(0, -2)}AA` };
      expect(() => decryptSecret(tampered, 'k')).toThrow();
    });

    it('returns the payload in the documented shape', () => {
      const payload = encryptSecret('v', 'k');
      expect(payload.enc).toBe('aes-256-gcm');
      expect(typeof payload.iv).toBe('string');
      expect(typeof payload.tag).toBe('string');
      expect(typeof payload.data).toBe('string');
      expect(payload.iv).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(payload.tag).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(payload.data).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('throws on invalid payloads and unsupported algorithms', () => {
      expect(() => decryptSecret('not-a-payload', 'k')).toThrow(TypeError);
      expect(() => decryptSecret(null, 'k')).toThrow(TypeError);
      expect(() => decryptSecret({ enc: 'aes-128-cbc', iv: 'x', tag: 'y', data: 'z' }, 'k')).toThrow(
        /Unsupported/
      );
    });
  });

  describe('generateKey', () => {
    it('returns 64 lowercase hex chars from 32 random bytes', () => {
      const key = generateKey();
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      expect(key).not.toBe(generateKey());
    });
  });

  describe('isEncryptedPayload', () => {
    it('recognizes the encrypted-payload object shape', () => {
      const payload = encryptSecret('v', 'k');
      expect(isEncryptedPayload(payload)).toBe(true);
    });

    it('rejects strings, arrays, null, and partial objects', () => {
      expect(isEncryptedPayload('{"enc":"aes-256-gcm"}')).toBe(false);
      expect(isEncryptedPayload(null)).toBe(false);
      expect(isEncryptedPayload(undefined)).toBe(false);
      expect(isEncryptedPayload([])).toBe(false);
      expect(isEncryptedPayload({ enc: 'aes-256-gcm', iv: 'x' })).toBe(false);
      expect(isEncryptedPayload({ enc: 'aes-256-gcm', iv: 'x', tag: 'y', data: 42 })).toBe(false);
    });
  });
});
