# Config Sync Tool Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role       | Operator CLI that detects drift between `.env` values and the metadata DB `settings` rows for every non-T0 config-registry key, reports it (alert mode, exit 1 on drift / key-lost), and optionally reconciles the DB rows to mirror `.env` (`--apply --yes`). Feature spec: `docs/features/config-sync.md`. |
| Depends on | config registry (`server/infrastructure/configRegistry.js`), `settingsStore.listRows()` (`server/store/settingsStore.js`), `Settings` model, secret crypto (`server/utils/configEncryption.js`), env path resolution (`server/infrastructure/envPath.js`), store bootstrap (`server/store/bootstrap.js` — `initMetadataSchema` only), PG pre-check list (`server/infrastructure/setupStatus.js` — `PG_REQUIRED_KEYS`) |
| Files      | `server/scripts/configSync.js` (CLI entry; exported `main(argv, deps)` with injected `output = { log, error, warn }` — the `setup.js` convention)                                                                                                                                                                          |
| Test files | `server/scripts/__tests__/configSync.test.js` (hermetic temp-dir `.env` + sqlite, in-process `main()`, `setupCli.test.js` pattern); `server/store/__tests__/settingsStore.test.js` (`listRows` coverage)                                                                                                                          |

---

## 2. Purpose

Make the D1 shadow-copy conditions observable and fixable without touching the running app:

- **detect** — compare env vs DB per non-T0 registry key and classify the result;
- **alert** — exit 1 on any `differs` (drift) or `key-lost` (encrypted rows unreadable) finding, so the report can gate CI/cron/pre-restart checks;
- **reconcile** — `--apply --yes` upserts DB rows for every env-set non-T0 key to mirror `.env` (secrets re-encrypted under `encrypt_secret_key`).

The tool never writes `.env`, never touches T0 keys, and never deletes rows.

---

## 3. Store addition: `settingsStore.listRows()`

| Item       | Description                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location   | `server/store/settingsStore.js`, exported `listRows`; model passthrough `Settings.listRows()` in `server/models/Settings.js`                                                            |
| Signature  | `listRows() => Promise<{ key: string, value: <raw>, updated_at: <Date|string> }[]>`                                                                                                    |
| Semantics  | Dual-backend (`postgresql`/`sqlite`) branching mirroring `readSettings` (same `mapDatabaseError` wrapping, `No database backend configured` fallback). Selects `key, value, updated_at` — **value left raw** (pg jsonb driver parsing applies; encrypted payloads are NOT unwrapped — callers handle JSON). Row order is backend-native (unsorted); callers index by key. |

`get` / `set` / `getAll` are unchanged. `set` remains the single write path (transactional upsert, `updated_at = NOW()`/`CURRENT_TIMESTAMP`).

---

## 4. CLI contract

Executable: `server/scripts/configSync.js`.

```
node server/scripts/configSync.js [--check] [--json]       drift report (read-only; default mode)
node server/scripts/configSync.js --apply --yes [--json]   reconcile DB rows to mirror .env
node server/scripts/configSync.js --help                   print the reference and exit 0
```

| Flag      | Description                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--check` | Report mode. Read-only. This is the **default** when no mode flag is given.                                                                       |
| `--json`  | Emit one machine-readable JSON document instead of human-readable lines.                                                                          |
| `--apply` | Write mode. Requires `--yes` (otherwise usage error, exit 2).                                                                                      |
| `--yes`   | Confirms `--apply` writes.                                                                                                                        |

Flags are parsed by the hand-rolled `--flag` / `--flag=value` parser (`BOOLEAN_FLAGS` set,
`UsageError` → exit 2), matching `server/scripts/setup.js`. Any unknown flag or non-flag
argument is a usage error (exit 2) and boots nothing.

### 4.1 Entry flow

1. `--help` → print usage, exit 0 (no store boot, no env load).
2. Parse flags (usage errors exit 2 before any side effect).
3. `loadDotenv()` — the CLI resolves the same `DOTENV_CONFIG_PATH`-aware path as
   `server/index.js` (`resolveEnvPath`, `SERVER_ROOT = path.join(__dirname, '..')`) and loads
   it with `override: false`, so real process env still wins over the file.
4. Boot the metadata store: PG required-key pre-check (`PG_REQUIRED_KEYS`), then
   `initMetadataSchema()` only — **not** `initMetadataStore()` (no default-admin seeding).
5. Run the mode (`runCheck` / `runApply`); the `require.main === module` guard closes the
   pool/sqlite handle and exits with the returned code.

### 4.2 Report mode (`--check` / default)

- Universe: every config-registry entry with `tier !== T0` (T0 excluded — `.env`-owned by
  design, including `JWT_SECRET` / `encrypt_secret_key`).
- Classification (exact contract in `docs/features/config-sync.md`):

| Status       | Condition                                                                                       | Exit effect            |
| ------------ | ------------------------------------------------------------------------------------------------- | ---------------------- |
| `differs`    | env-set + DB row + canonical values differ (secrets compared after decrypting the DB payload)      | drift → exit 1         |
| `shadowed`   | env-set + DB row + values equal                                                                    | informational          |
| `env-only`   | env-set + no DB row                                                                                | informational          |
| `db-only`    | not env-set + DB row (a decryptable encrypted row)                                                 | informational          |
| `key-lost`   | DB row holds an encrypted payload but `encrypt_secret_key` is absent or decryption fails           | alert → exit 1         |
| (silent)     | set in neither env nor DB                                                                          | no finding             |

- Finding shape: `{ key, status, secret, dbUpdatedAt }` — `dbUpdatedAt` is the row's
  `updated_at` normalized to ISO 8601 (pg `Date` → `toISOString()`; sqlite
  `'YYYY-MM-DD HH:MM:SS'` UTC string → parsed as UTC), `null` for env-only findings.
- Summary: `{ drift, alerts, shadowed, envOnly, dbOnly, total }`; exit code = 1 iff
  `drift + alerts > 0`, else 0.
- Human output groups findings under `DRIFT:` / `ALERTS:` / `INFORMATIONAL:` (empty groups
  omitted), each line `  <status padded to 10> <key>[ (secret: ****)][ db_updated_at=<ISO>]`,
  then `summary: drift: N, alerts: N, informational: N` and `exit code: N`.
- JSON output: `JSON.stringify({ findings, summary, exitCode }, null, 2)` as a single log
  entry.
- Masking: secret keys render `(secret: ****)`; no env or DB secret value is ever emitted in
  any output channel; `key-lost` findings expose the key name only.

### 4.3 Apply mode (`--apply --yes`)

1. **Pre-check:** compute targets = registry entries with `tier !== T0` and an env value
   present and non-empty. If any target is secret and `encrypt_secret_key` is absent →
   abort with a clear error, exit 1, **no writes**.
2. **Write loop (registry order):** for each target, compare the env value to the current
   DB row (secrets compared after decryption; an undecryptable/missing row counts as
   different). Equal → report `unchanged`, skip the write. Otherwise upsert through the
   same path as `PUT /api/admin/config` (`server/domains/admin/routes/config.js`):
   - plaintext → `Settings.set(key, String(envValue))`
   - secret → `Settings.set(key, JSON.stringify(encryptSecret(envValue, masterKey)))`
   and report `updated`. A write failure aborts the run (exit 1); rows written before the
   failure keep their new values (no transaction across the whole loop — the check is
   idempotent, so re-running `--apply --yes` finishes the reconcile).
3. **Post-apply recheck:** `buildReport()` runs in-process and is rendered under a
   `post-apply check:` header (human mode; the JSON document is emitted after the
   `{ writes }` document). The returned exit code is the recheck's: 0 on clean, 1 if drift
   or `key-lost` remains.

---

## 5. Exit codes

| Code | Meaning                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | `--check` clean (no `differs`, no `key-lost`), or `--apply --yes` completed with a clean post-apply recheck.                                                                                          |
| `1`  | drift or key-lost found; apply aborted (missing `encrypt_secret_key` for a secret target) or a write failed; post-apply recheck not clean; store boot failure.                                               |
| `2`  | usage error: unknown flag, non-flag argument, `--apply` without `--yes`.                                                                                                                                 |

---

## 6. Verification scenarios

- [ ] fresh env, no DB rows → exit 0; T0 keys (`JWT_SECRET`, `encrypt_secret_key`) absent from the report
- [ ] env set + equal DB row → `shadowed`, exit 0 (secret variant compared via decryption, masked)
- [ ] env set + differing plaintext DB row → `differs`, exit 1, `db_updated_at` (ISO) shown, no plaintext echoed
- [ ] env set + differing encrypted DB row → `differs`, exit 1, output masked (`****`), neither ciphertext plaintext visible
- [ ] encrypted DB row + absent `encrypt_secret_key` → `key-lost`, exit 1 (both env-set and db-only variants), values never shown
- [ ] key set in neither env nor DB → no finding (silent)
- [ ] `--json` → single JSON document with stable `findings[] { key, status, secret, dbUpdatedAt }`, `summary { drift, alerts, shadowed, envOnly, dbOnly, total }`, `exitCode`
- [ ] `--apply` without `--yes` → exit 2, nothing written, store not booted
- [ ] `--apply --yes` → env-set keys mirrored (plaintext rewritten, secret re-encrypted and decryptable under `encrypt_secret_key`), equal rows reported `unchanged` (not rewritten), T0 keys never written, post-apply recheck reports zero `differs`, exit 0
- [ ] `--apply --yes` with a secret target and no `encrypt_secret_key` → exit 1, DB unchanged
- [ ] unknown flag → exit 2 with usage
- [ ] `listRows()` → `[]` on an empty table; rows carry `key`, raw `value` (plaintext string / encrypted payload JSON string, unwrapped by no one), parseable `updated_at`
- [ ] smoke: `DOTENV_CONFIG_PATH=<scratch> node server/scripts/configSync.js --check` boots the sqlite schema and prints the report without the repo `.env`
