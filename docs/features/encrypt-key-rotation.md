# Encrypt Key Rotation (`encrypt_secret_key`)

Source-of-Truth for the **`encrypt_secret_key` rotation CLI** (`server/scripts/rotateEncryptKey.js`),
the operator tool for rotating the T0 master key that AES-256-GCM-encrypts every DB-stored secret.
Implementation contract: `docs/spec/server/tools/encrypt-key-rotation.md`; operator usage:
`docs/SETUP.md`. Background: the secret-encryption and key-lifecycle design in
`docs/features/config-source-resolution.md` (§"Secret encryption") and
`docs/spec/server/utils/configEncryption.md`.

---

## Purpose

DB secrets are stored as ciphertext under the T0 master key `encrypt_secret_key`
(`.env`-owned). Changing that key does not by itself re-encrypt the rows: every encrypted
`settings` row must be decrypted with the **old** key and re-encrypted with the **new** key, or the
ciphertext is unreadable. This tool performs that rotation offline (no running app required) with a
**default dry-run** so an operator can verify the old key can still read every secret before any
write happens, and an explicit **apply** path that performs the rotation atomically with respect to
key material (DB-first, `.env` last).

The tool reads and rewrites **only** encrypted `settings` rows (via the app's own `Settings`
store) and writes **only** `encrypt_secret_key` to `.env` (via the app's atomic env writer, with
backup). Plaintext rows, including legacy plaintext secret rows, are never rewritten.

---

## Key sources

- **Old key** = the value of `encrypt_secret_key` in `process.env` **after** the tool loads the app's
  `.env` (`resolveEnvPath`, `DOTENV_CONFIG_PATH`-aware). This is the key the existing ciphertext was
  written under.
- **New key** = one of:
  - `--new-key=<passphrase>` — an explicit passphrase the operator chooses (free-length, matching the
    existing `encrypt_secret_key` format); or
  - `--generate` — a fresh 64-hex key produced by `generateKey()` (`server/utils/configEncryption.js`).
  - The two are **mutually exclusive**; exactly one is **required** for `--apply` and optional for
    dry-run.

If `encrypt_secret_key` is **absent** from the environment after the `.env` load, the tool refuses to
run (exit 1) with a clear key-lost message and performs no reads or writes. It never guesses, never
skips, and never writes a new key on top of a lost old one — a rotation with a lost source key would
silently destroy the ciphertext.

---

## Candidate set

The rotation universe is **every `settings` row whose stored value is an encrypted payload**
(`{ enc: 'aes-256-gcm', iv, tag, data }`, detected with `isEncryptedPayload` after JSON-parsing the
raw value). Registry membership is irrelevant to candidacy: encrypted rows are rotated whether or not
their key is a registry secret, because the encrypted-payload shape — not the key — is the criterion.
A plaintext row is never a candidate.

A plaintext row whose key **is** a registry secret (`isSecret(key)`) is reported as
`legacy-plaintext` (informational only). These predate the encryption-at-write model; the tool does
**not** rewrite them by default and has no flag to do so — rotating them would change the storage
format of a value the operator did not ask to touch.

---

## Workflow: dry-run → apply

### Dry-run (the default mode)

Run with **no flags**, with `--dry-run`, or with `--dry-run` plus an optional new key. The dry-run is
read-only (zero writes):

1. Load `.env`, resolve the old key; refuse (exit 1) if absent.
2. Boot the metadata store (schema only, no default-admin seeding).
3. For each candidate (encrypted) row, attempt to **decrypt under the old key**:
   - success → reported `ok`;
   - failure → reported `failed <reason>` (a wrong key or a tampered/corrupted GCM payload).
4. If a new key was supplied (`--new-key` / `--generate`), each `ok` row is additionally verified to
   round-trip (encrypt + decrypt) under that key, so the report line reflects a key that would work.
   A generated dry-run key is discarded and never printed.
5. Print per-key lines plus a summary: `candidates`, `ok`, `failed`, `legacy-plaintext`, and
   `non-secret-encrypted` (informational sub-count of candidates whose key is not a registry secret).

Exit code: **1** if **any** candidate failed to decrypt; otherwise **0**. **Zero candidates** is not an
error — it exits 0 with a note that nothing needs rotating.

A dry-run with `--generate` proves the end-to-end path without changing anything; a dry-run with no new
key only proves the old key can read the data.

### Apply (`--apply --yes`)

`--apply` requires `--yes` (otherwise a usage error, exit 2) and exactly one of `--new-key` /
`--generate`. The apply sequence is **DB-first, `.env` last**:

1. **Decrypt-verify all, first:** every candidate is decrypted with the old key **before any write**.
   Any failure aborts the run (exit 1) with **zero writes** — no row is touched and `.env` is
   unchanged.
2. **Re-encrypt and write every row:** each plaintext is re-encrypted under the new key and written
   through the same path the app uses (`Settings.set(key, JSON.stringify(encryptSecret(plaintext,
   newKey)))`). Rows are written in list order.
3. **Write the new key to `.env` last:** once every row is re-encrypted, `encrypt_secret_key` is
   upserted into `.env` via `envFileWriter.writeEnv(..., { backup: true })` — the atomic temp+rename
   writer that creates a `<envPath>.bak-<timestamp>` copy first and chmods the result `0600`.
4. **Report:** one `re-encrypted <key>` line per row, a completion line stating how many rows were
   re-encrypted and how the new key was supplied (`generated` / `provided`, never its value), and the
   `.env` backup path returned by `writeEnv`.

The ordering is what makes a mid-sequence failure recoverable: the new key is persisted to `.env` only
after the DB is fully re-encrypted, so the DB and the key never disagree on more than one write.

---

## Ordering guarantee (DB-first, `.env` last)

The single invariant the tool protects: **at the moment `.env` is updated, every DB secret is already
encrypted under the new key.** Consequences:

- A failure during step 2 (row re-encryption) happens **before** `.env` changes, so the old key in
  `.env` still matches every row — re-running with the old key completes the rotation.
- A failure in step 3 (`.env` write) leaves the DB re-encrypted under the new key while `.env` still
  holds the old key. The run aborts (exit 1) with an explicit note to either persist the new key to
  `.env` manually or restore the old key from the `.env.bak-*` backup and re-run (which decrypts the
  new-key rows only if the operator restores the matching key; the safe recovery is to write the new
  key the run printed the intent for, or re-run `--apply` with the known-good new key).

---

## Failure and recovery (`.env.bak-*`)

`writeEnv` snapshots `.env` to `<envPath>.bak-<timestamp>` immediately before the upsert, so the
**old key is always preserved in the latest backup** for the duration of a rotation. The completion
report prints the exact backup path. If a rotation must be undone, an operator restores that backup
over `.env` (reverting to the old key) and re-runs the rotation — the previously-written ciphertext
under the new key is the only state that requires re-deriving, and because the DB is the source of the
old ciphertext until the last `.env` write, a step-2 abort always leaves a fully consistent old-key
system. A step-3 abort is the one case where DB and `.env` diverge, and it is surfaced loudly (exit 1)
rather than silently.

---

## Key-lost refusal

When `encrypt_secret_key` is absent, the tool exits 1 immediately with a key-lost message and performs
no DB read or write. It points the operator at the `.env.bak-*` backups (created by `writeEnv`) as the
place to recover a previous key. This mirrors the key-lost handling in the config-sync tool
(`docs/features/config-sync.md`) and the wizard (`docs/features/setup-wizard.md`).

---

## Masking

Key material is never printed:

- the **old** key is used in-process only and is never echoed;
- on `--generate` the new key is **not printed at all**;
- on `--new-key=<passphrase>` the tool prints only the word `provided` — never the passphrase;
- `failed <reason>` lines carry the decryption/crypto error message only (a GCM auth failure or
  `Invalid encrypted payload`), which does not expose plaintext or key material.

---

## Safety

- **Read-only default:** no flags, or `--dry-run`, changes nothing; `--apply` is gated behind `--yes`.
- **All-or-nothing decrypt-verify:** apply decrypts every row before writing any, so a wrong old key or
  a single corrupted row aborts with zero writes.
- **T0 is `.env`-owned:** the only `.env` write is `encrypt_secret_key`; `writeEnv`'s allowlist
  rejects any other key before touching disk.
- **Backup on write:** `writeEnv(..., { backup: true })` guarantees a `.env.bak-*` copy of the old key.
- The tool boots the metadata store schema-only (`initMetadataSchema`, no default-admin seeding) and
  closes the pool/sqlite handle on exit; it does not start the HTTP server and does not affect a
  running app beyond the next read of the rotated secrets after a restart.

---

## Testing anchors

Observable behaviors covered by
`server/scripts/__tests__/rotateEncryptKey.test.js` (hermetic temp-dir `.env` + sqlite, in-process
`main()`, `setupCli.test.js` / `configSync.test.js` pattern):

- zero encrypted rows → dry-run exit 0 with a "nothing to rotate" note;
- seeded encrypted rows + correct old key → dry-run all `ok`, exit 0, rows byte-identical (no writes);
- wrong old key → dry-run `failed`, exit 1;
- old key absent → refuse, exit 1, no writes;
- `--apply` without `--yes` → exit 2 usage error, nothing written;
- `--apply --yes --generate` → every row re-encrypts and round-trips under the new key read back from
  the `.env` file; `.env` holds the new 64-hex key at mode `0600`; a `.bak-*` file exists holding the
  old key;
- `--apply --yes --new-key=<x>` → same, with the new key equal to `x`;
- one tampered/corrupted payload among good rows → apply aborts exit 1, **all** rows byte-identical,
  `.env` unchanged;
- a legacy plaintext secret row (e.g. `EMAIL_PASSWORD` stored as a plain string) → reported
  `legacy-plaintext`, untouched after apply.

`settingsStore.listRows()` coverage lives in
`server/store/__tests__/settingsStore.test.js`; the `writeEnv` backup return-value contract is covered
by `server/infrastructure/__tests__/envFileWriter.test.js`.
