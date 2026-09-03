# Encrypt Key Rotation Tool Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Operator CLI that rotates the T0 master key `encrypt_secret_key`: it re-encrypts every DB-stored encrypted `settings` row from the old key to a new key, with a default dry-run (decrypt-verify + counts, no writes) and an explicit apply path (DB-first, `.env` last). Feature spec: `docs/features/encrypt-key-rotation.md`. |
| Depends on | secret crypto (`server/utils/configEncryption.js` — `decryptSecret`, `encryptSecret`, `generateKey`, `isEncryptedPayload`), `settingsStore.listRows()` (`server/store/settingsStore.js`) + `Settings` model, config registry (`server/infrastructure/configRegistry.js` — `isSecret`), env path resolution (`server/infrastructure/envPath.js`), env writer (`server/infrastructure/envFileWriter.js` — `writeEnv`, returns the backup path), store bootstrap (`server/store/bootstrap.js` — `initMetadataSchema` only), PG pre-check list (`server/infrastructure/setupStatus.js` — `PG_REQUIRED_KEYS`) |
| Files      | `server/scripts/rotateEncryptKey.js` (CLI entry; exported `main(argv, deps)` with injected `output = { log, error, warn }` — the `configSync.js` / `setup.js` convention)                                                                                                                                                                  |
| Test files | `server/scripts/__tests__/rotateEncryptKey.test.js` (hermetic temp-dir `.env` + sqlite, in-process `main()`, `setupCli.test.js` / `configSync.test.js` pattern); `server/infrastructure/__tests__/envFileWriter.test.js` (`writeEnv` backup return value)                                                                                     |

---

## 2. Purpose

Rotate the AES-256-GCM master key under which DB secrets are stored, without data loss:

- **verify** — dry-run decrypts every encrypted row under the old key and reports per-key status and
  counts (read-only, the default mode);
- **rotate** — `--apply --yes` decrypts all rows, re-encrypts them under the new key, and only then
  persists the new key to `.env`;
- **guard** — refuse outright when the old key is absent (key-lost), and make a mid-apply failure
  recoverable from the `.env.bak-*` backup the writer creates.

---

## 3. Env writer contract: `writeEnv` returns the backup path

`server/infrastructure/envFileWriter.js` `writeEnv(envPath, entries, { backup = true })` is the existing
atomic writer (allowlist-validated, temp+rename, `chmod 0600`, upserts in place). It is unchanged in
behavior; it **now also returns** the backup path it created (`<envPath>.bak-<timestamp>`), or `null`
when no backup was made (`backup` is false, or the target file did not exist before the write). The
rotation tool reads this return value to report the recovery path. Existing callers
(`server/domains/setup/setupCore.js`) ignore the return value and are unaffected.

---

## 4. CLI contract

Executable: `server/scripts/rotateEncryptKey.js`.

```
node server/scripts/rotateEncryptKey.js [--dry-run] [--new-key=<passphrase>|--generate]   verify (read-only; default mode)
node server/scripts/rotateEncryptKey.js --apply --yes (--generate|--new-key=<passphrase>) re-encrypt all rows, then write the new key to .env
node server/scripts/rotateEncryptKey.js --help                                            print the reference and exit 0
```

| Flag              | Description                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--dry-run`       | Verify mode (decrypt-verify + counts, no writes). This is the **default** when no mode flag is given; the flag is accepted explicitly and is a no-op that forces verify mode. |
| `--new-key=<val>` | New key supplied by the operator (free-length passphrase). Mutually exclusive with `--generate`. Required for `--apply`, optional for dry-run.                                                               |
| `--generate`      | New key produced by `generateKey()` (64-hex). Mutually exclusive with `--new-key`. Required for `--apply`, optional for dry-run. The generated value is never printed.                                   |
| `--apply`         | Write mode. Requires `--yes` and exactly one of `--new-key` / `--generate` (otherwise usage error, exit 2). Mutually exclusive with `--dry-run`.                                                            |
| `--yes`           | Confirms `--apply` writes.                                                                                                                                                                                   |

Flags are parsed by a hand-rolled `--flag` / `--flag=value` parser (boolean set + value set,
`UsageError` → exit 2), matching `server/scripts/configSync.js`. `--new-key` requires a non-empty value.
Any unknown flag, `--dry-run` combined with `--apply`, `--new-key` combined with `--generate`, or a
non-flag argument is a usage error (exit 2) and boots nothing.

### 4.1 Entry flow

1. `--help` → print usage, exit 0 (no store boot, no env load).
2. Parse and validate flags (usage errors exit 2 before any side effect).
3. `loadDotenv()` — the CLI resolves the same `DOTENV_CONFIG_PATH`-aware path as `server/index.js`
   (`resolveEnvPath`, `SERVER_ROOT = path.join(__dirname, '..')`) and loads it with `override: false`,
   so real process env still wins over the file.
4. Resolve the **old key** = `process.env.encrypt_secret_key`; if absent/empty → refuse with the
   key-lost message, exit 1 (no store boot, no writes).
5. Boot the metadata store: PG required-key pre-check (`PG_REQUIRED_KEYS`), then `initMetadataSchema()`
   only — **not** `initMetadataStore()` (no default-admin seeding).
6. Read all rows (`Settings.listRows()`), classify candidates, run the mode; the
   `require.main === module` guard closes the pool/sqlite handle and exits with the returned code.

### 4.2 Dry-run (default / `--dry-run`)

- Candidates: every row whose raw value, JSON-parsed if parseable, satisfies `isEncryptedPayload`.
- Per candidate, decrypt under the old key:
  - success → `ok`;
  - `decryptSecret` throws (wrong key / tampered GCM tag / unsupported algorithm) → `failed <reason>`.
- If a new key was supplied (`--new-key` or `--generate`), each `ok` plaintext is additionally verified
  to round-trip (encrypt + decrypt) under the new key; a `--generate` dry-run key is produced, used for
  verification, and discarded.
- Legacy plaintext: any non-encrypted row whose key is `isSecret` is reported as `legacy-plaintext`.
- Summary line: `summary: candidates: N, ok: N, failed: N, legacy-plaintext: N, non-secret-encrypted: N`
  where `non-secret-encrypted` is the informational count of candidates whose key is **not** a registry
  secret (they are still rotated — encrypted-payload is the criterion).
- Exit code: **1** iff `failed > 0`; else **0**. **Zero candidates** → exit 0 with a
  `no encrypted settings rows found; nothing to rotate.` note (not an error).

### 4.3 Apply (`--apply --yes`)

Preconditions (usage errors, exit 2): `--yes` present; exactly one of `--new-key` / `--generate`.

New key resolution: `--generate` → `generateKey()`; `--new-key` → the operator value.

Sequence (DB-first, `.env` last):

1. **Decrypt-verify all, first:** decrypt every candidate with the old key before any write. On the
   first failure, abort with `apply aborted: <key> could not be decrypted under the old key
   (<reason>). No rows were written.`, exit 1 — zero writes, `.env` untouched.
2. **Re-encrypt and write:** for each candidate in list order,
   `Settings.set(key, JSON.stringify(encryptSecret(plaintext, newKey)))`. A write failure aborts
   (exit 1) with a note that the run is recoverable via the `.env.bak-*` backup (the `.env` key was not
   yet changed, so the old key remains valid for every row not yet re-written).
3. **Write the new key to `.env` last:**
   `writeEnv(resolveEnvPath(SERVER_ROOT), { encrypt_secret_key: newKey }, { backup: true })`. A failure
   here (after the DB is re-encrypted) aborts (exit 1) with an explicit CRITICAL note that the DB and
   `.env` now disagree and the operator must persist the new key or restore the backup.
4. **Report:** one `re-encrypted <key>` line per row; a completion line
   `apply complete: N row(s) re-encrypted under new key (new key: generated|provided).`; the backup
   line `.env backup: <path>` from the `writeEnv` return value (or a note that no backup was created
   because the file did not previously exist); and a closing note that a mid-sequence failure is
   recoverable by re-running with the previous key from the `.env.bak-*` file.

Zero candidates under `--apply` still performs the `.env` write (the operator explicitly requested a
new key) and reports `apply complete: 0 row(s) ...`.

---

## 5. Exit codes

| Code | Meaning                                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | dry-run with zero decrypt failures (including zero candidates), or `--apply --yes` completed (all rows re-encrypted and the new key written to `.env`).                                                                          |
| `1`  | dry-run with one or more decrypt failures; old key absent (key-lost refusal); apply aborted during decrypt-verify (a row could not be read under the old key); apply aborted during a row write or the final `.env` write; store boot failure. |
| `2`  | usage error: unknown flag, non-flag argument, `--apply` without `--yes`, `--apply` without exactly one of `--new-key`/`--generate`, `--new-key` and `--generate` both given, `--dry-run` with `--apply`, empty `--new-key`. |

---

## 6. Masking

- The old key is never printed.
- The new key is never printed: `--generate` reports `generated`, `--new-key` reports `provided`.
- `failed <reason>` carries only the crypto error message (no plaintext, no key).
- No candidate's plaintext is ever emitted in any output channel.

---

## 7. Verification scenarios

- [ ] zero encrypted rows → dry-run exit 0 with a "nothing to rotate" note
- [ ] seeded encrypted rows + correct old key in env → dry-run all `ok`, exit 0, no DB writes (rows byte-identical)
- [ ] wrong old key in env → dry-run `failed <reason>`, exit 1
- [ ] old key absent from env → key-lost refusal, exit 1, no DB read/write
- [ ] `--apply` without `--yes` → exit 2 usage error, nothing written, store not booted
- [ ] `--apply` with `--yes` but neither `--new-key` nor `--generate` → exit 2 usage error
- [ ] `--apply` with both `--new-key` and `--generate` → exit 2 usage error
- [ ] `--apply --yes --generate` → every row re-encrypts and `decryptSecret(newRow, newKeyFromEnvFile)` round-trips to the original plaintext; `.env` contains the new key (64-hex) at mode `0600`; a `.bak-*` file exists holding the old key; no key material printed
- [ ] `--apply --yes --new-key=<x>` → same, with the new key equal to `x`
- [ ] one tampered/corrupted payload among good rows → apply aborts exit 1, **all** rows byte-identical, `.env` unchanged
- [ ] a legacy plaintext secret row (e.g. `EMAIL_PASSWORD` as a plain string) → reported `legacy-plaintext`, untouched after apply
- [ ] a dry-run with `--generate` / `--new-key` → each `ok` row verified to round-trip under the new key; generated key never printed
- [x] `writeEnv` returns the created `.bak-*` path, or `null` when no backup was made
- [ ] smoke: `DOTENV_CONFIG_PATH=<scratch> node server/scripts/rotateEncryptKey.js --dry-run` boots the sqlite schema and prints the report without the repo `.env`
