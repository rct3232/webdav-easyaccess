# Config Sync (`.env` ↔ DB settings)

Source-of-Truth for the **config sync/alert CLI** (`server/scripts/configSync.js`), the
operator tool for the two-layer configuration model defined in
`docs/features/config-source-resolution.md`. Implementation contract:
`docs/spec/server/tools/config-sync.md`; operator usage: `docs/SETUP.md`.

---

## Purpose

Under the `.env`-first model (D1), a value present in `.env` **always wins**; a DB `settings`
row under an env-set key is a shadow copy that can go stale the moment an operator edits
`.env`. Conversely, encrypted DB rows become unreadable if `encrypt_secret_key` is lost or
rotated out from under them. This tool makes both conditions visible and fixable without
touching the running app:

- **detect** — compare every non-T0 config-registry key that is set in `.env` (or holds a DB
  row) against the metadata DB `settings` rows and report the result;
- **alert** — exit non-zero (1) when drift or a key-loss condition is found, so the report
  can gate CI/CD, cron jobs, or a pre-restart check;
- **reconcile** — optionally mirror `.env` into the DB (`--apply --yes`) so the shadow
  copies stop being stale.

The tool reads and writes **only** the metadata DB `settings` table (via the app's own
`Settings` store) and only **reads** `.env`. It never writes `.env`.

---

## Scope: non-T0 registry keys only

The comparison universe is every entry of the config registry
(`server/infrastructure/configRegistry.js`) with `tier !== T0` (45 keys: T1 + T2). T0 keys
(`WEA_PG_*`, `WEA_SQLITE_PATH`, `WEA_STORAGE_BACKEND`, `JWT_SECRET`,
`encrypt_secret_key`, `NODE_ENV`, `DOTENV_CONFIG_PATH`, …) are `.env`-owned by design and are
**excluded from the report and from every write** — including `JWT_SECRET` and
`encrypt_secret_key`.

Keys set in neither `.env` nor the DB are default-governed and are **silent** (not
reported).

---

## Report classification (`--check`, the default mode)

For every non-T0 registry key:

| Status       | Condition                                                                  | Severity                                   |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------ |
| `differs`    | key set in `.env`, DB row exists, canonical values differ                  | **DRIFT — exit 1**                         |
| `shadowed`   | key set in `.env`, DB row exists, values equal                             | informational (env wins; the DB copy is current) |
| `env-only`   | key set in `.env`, no DB row                                               | informational                               |
| `db-only`    | key not set in `.env`, DB row exists                                       | informational (normal per D1)              |
| `key-lost`   | DB row holds an encrypted payload but `encrypt_secret_key` is absent or decryption fails (auth error / unsupported algorithm) | **ALERT — exit 1** |

Value comparison rules:

- **Plaintext keys:** the raw DB value string is compared to the env string.
- **Secret keys:** the DB payload is decrypted with the env `encrypt_secret_key`
  (AES-256-GCM) and compared to the env plaintext. An encrypted row that cannot be
  decrypted is classified `key-lost` whether or not the key is also set in `.env` — the DB
  copy is unrecoverable under the current key.
- **Masking:** secret values are never shown. Secret keys are reported as
  `**** <key>` in human output and as `"secret": true` in JSON output (no `value` field is
  ever emitted). `key-lost` rows list affected keys only.

The `updated_at` column of the `settings` table (see
`docs/features/config-source-resolution.md`, "DB storage design") is surfaced per DB-backed
finding as `db_updated_at` (ISO 8601) so an operator can see when the shadow copy was last
written.

Output:

- **Human (default):** grouped lines (`DRIFT:` / `ALERTS:` / `INFORMATIONAL:`) each carrying
  status, key, `(secret: ****)` for secret keys, and `db_updated_at=<ISO>` for DB-backed
  findings, followed by `summary: drift: N, alerts: N, informational: N` and an
  `exit code:` line.
- **`--json`:** a single JSON document:
  `{ findings: [{ key, status, secret, dbUpdatedAt }], summary: { drift, alerts, shadowed,
  envOnly, dbOnly, total }, exitCode }`.

---

## Reconcile (`--apply --yes`)

`--apply` without `--yes` is a usage error (exit 2). With both:

1. **Pre-check (all-or-nothing):** if any env-set target key is a secret and
   `encrypt_secret_key` is absent, the run aborts (exit 1) **before any write** with a clear
   error.
2. **Writes:** for every non-T0 registry key set in `.env`, the DB row is upserted to mirror
   the env value through the same write path the admin config route uses
   (`PUT /api/admin/config`, `server/domains/admin/routes/config.js`):
   - plaintext → `Settings.set(key, String(envValue))`;
   - secret → `Settings.set(key, JSON.stringify(encryptSecret(envValue, encrypt_secret_key)))`.
   A row whose current value already equals the env value (secrets compared after
   decryption) is reported `unchanged` and not rewritten; all others are reported
   `updated`.
3. **Post-apply recheck:** the check runs again in-process and is reported; a successful
   reconcile yields zero `differs` and exit 0 (pre-existing `key-lost` alerts on
   db-only rows still force exit 1).

---

## Exit codes

| Code | Meaning                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- |
| `0`  | no drift and no key-lost alerts (`--check`), or `--apply` completed with a clean post-apply check |
| `1`  | drift (`differs`) or key-loss (`key-lost`) found; or apply aborted (missing
   `encrypt_secret_key`) or a write failed; or the post-apply recheck still reports drift/alerts |
| `2`  | usage error: unknown flag, or `--apply` without `--yes`                                   |

---

## Safety

- **T0 is never written** — the write set is constructed from the registry with T0
  filtered out; there is no flag to override this.
- **No deletes** — reconcile upserts only; rows for keys absent from `.env` are left
  untouched (they remain the effective value per D1).
- **`--yes` required** for any write; the read-only report is the default mode.
- **Secrets masked** in all output; decryption happens in-process only for comparison and
  never for display.
- The tool boots the metadata store schema-only (`initMetadataSchema`, no default-admin
  seeding) and closes the connection on exit; it does not start the HTTP server and does
  not affect a running app (a running server with a T2 cache sees the reconciled rows on
  its next read after cache invalidation/restart, as with any other `settings` write).

---

## Testing anchors

Observable behaviors covered by `server/scripts/__tests__/configSync.test.js` (hermetic
temp-dir `.env` + sqlite, `setupCli.test.js` pattern):

- fresh env, no DB rows → exit 0, T0 keys excluded from the report;
- env set + equal DB row → `shadowed`, exit 0 (secrets compared via decryption);
- env set + differing plaintext DB row → `differs`, exit 1, `db_updated_at` shown, no
  plaintext echoed;
- differing secret → `differs`, exit 1, output masked (`****`), no plaintext echoed;
- encrypted rows without a usable `encrypt_secret_key` → `key-lost`, exit 1 (env-set and
  db-only variants), values never shown;
- `--json` shape: stable `key`/`status`/`secret`/`dbUpdatedAt` fields + `summary` +
  `exitCode`;
- `--apply` without `--yes` → exit 2, nothing written;
- `--apply --yes` → rows mirrored (plaintext updated, secret re-encrypted and
  decryptable under the key), T0 keys absent from the DB, post-apply recheck clean, exit 0;
- `--apply --yes` with a secret target but no `encrypt_secret_key` → exit 1, DB unchanged.

`settingsStore.listRows()` coverage lives in
`server/store/__tests__/settingsStore.test.js`.
