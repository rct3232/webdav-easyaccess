# configEncryption Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | AES-256-GCM encryption of DB-stored secrets (D6–D8). Encrypt at write time (wizard apply / admin config write); decrypt at read time only when the env var is absent (D1). No new dependencies — Node `crypto` only. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/configEncryption.js`
- **Test file:** `server/utils/__tests__/configEncryption.test.js`

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| `deriveKey` | `(passphrase) => Buffer` | SHA-256 of the passphrase → 32-byte key buffer (length 32). |
| `encryptSecret` | `(plaintext, passphrase) => { enc, iv, tag, data }` | AES-256-GCM encrypt; random 96-bit IV, 128-bit auth tag; `iv`/`tag`/`data` base64 strings; `enc` is `'aes-256-gcm'`. |
| `decryptSecret` | `(payload, passphrase) => string` | Authenticated decrypt → plaintext string. Throws on wrong key / tampered payload / unsupported `enc`. |
| `generateKey` | `() => string` | 64-char lowercase hex from 32 random bytes (recommended `encrypt_secret_key`). |
| `isEncryptedPayload` | `(value) => boolean` | True when `value` is a non-array object with string `enc`, `iv`, `tag`, `data` fields. |

### 2.3 Algorithm (D6)

- Cipher: `aes-256-gcm`; key = `crypto.createHash('sha256').update(passphrase).digest()` (32 bytes).
- Random 12-byte IV per encryption; 16-byte auth tag returned by the cipher.
- Payload shape stored in the `settings` row:

```js
{ enc: 'aes-256-gcm', iv: '<b64>', tag: '<b64>', data: '<b64>' }
```

### 2.4 Behavioral Rules

- `deriveKey` accepts any string passphrase (free-length or 32-byte hex); output is always 32 bytes.
- `encryptSecret` stringifies its `plaintext` input before encrypting.
- `decryptSecret` uses `setAuthTag` before finalizing; an authentication failure (wrong passphrase, corrupted data, truncated IV/tag) **throws**.
- `decryptSecret` throws `TypeError` for a non-payload input and `Error` for `enc !== 'aes-256-gcm'`.
- `isEncryptedPayload` is a shape check only — it does **not** validate base64 or attempt decryption.
- Callers (resolver / admin API) are responsible for the master-key policy: never decrypt when `encrypt_secret_key` is absent (return `undefined`); never decrypt when the env value is present (D1).

### 2.5 Dependencies

- Node `crypto` only.

## 3. Verification Scenarios

- [ ] Round-trip: `decryptSecret(encryptSecret(s, k), k) === s`.
- [ ] Wrong passphrase → throws (auth failure).
- [ ] `generateKey()` matches `/^[a-f0-9]{64}$/`.
- [ ] `enc`/`iv`/`tag`/`data` all base64 strings; `enc === 'aes-256-gcm'`.
- [ ] `isEncryptedPayload` true for the object shape, false for strings/arrays/null.
