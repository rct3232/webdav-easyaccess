# Config Sync (`.env` ↔ DB settings)

Source-of-Truth for the two-layer configuration drift surface of the model defined in
`docs/features/config-source-resolution.md`. Two operator-facing surfaces share one
algorithm core (`server/domains/admin/services/configSyncService.js`):

- the **config sync CLI** (`server/scripts/configSync.js`) — offline, reconciles the
  on-disk `.env` file (`docs/spec/server/tools/config-sync.md`); operator usage:
  `docs/SETUP.md`;
- the **admin web action** (System settings → "Sync environment → DB") — on a running
  server, reconciles the **running process environment** (`server/domains/admin/routes/config.js`).

Implementation contract: `docs/spec/server/routes/config.md` (web) and
`docs/spec/server/tools/config-sync.md` (CLI).

---

## Purpose

Under the `.env`-first model (D1), a value present in the environment **always wins**; a DB
`settings` row under an env-set key is a shadow copy that can go stale the moment an operator
changes the environment (`.env` file edit or a redeploy with new variables). The config-sync
surface makes that condition visible and fixable:

- **detect** — compare every non-T0 config-registry key that is set in the env (or holds a
  DB row) against the metadata DB `settings` rows and report the result;
- **alert** — report drift findings so they can gate CI/CD, cron jobs, a pre-restart check,
  or an admin preview dialog;
- **reconcile** — mirror the env into the DB so the shadow copies stop being stale.

Both surfaces read/write **only** the metadata DB `settings` table (via the app's own
`Settings` store) and never write `.env`. They differ only in the env source they reconcile
against (see "Surfaces and env source" below).

---

## Surfaces and env source

| Surface             | Where                                                                  | Env source reconciled against                                                            |
| ------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CLI                 | `server/scripts/configSync.js` (`--check` / `--apply --yes`)           | the `.env` file on disk, re-read at run time (`loadDotenv`, `override: false` — real injected env still wins) |
| Admin web action    | System settings → "Sync environment → DB" (`server/domains/admin/routes/config.js`) | the **running process environment** (`process.env`). The `.env` file on disk is never read; a key counts as env-set when the config resolver reports `source: 'env'` for it. |

Implication for the web surface: because `populateT1Env` copies DB-only T1 values into
`process.env` at boot, presence in `process.env` alone does **not** mean "operator-set env".
The resolver's `source: 'env'` classification is the authoritative env-set test, so
DB-backed T1 keys stay `source: 'db'` and are never treated as env targets. An operator
edit to `.env` after boot is not visible to the web action until the server restarts (with
the running app it is not active either) — use the CLI for on-disk `.env` reconciliation.
Pure environment-injected deployments (no `.env` file) sync their live `process.env`
values.

---

## Scope: non-T0 registry keys only

The comparison universe is every entry of the config registry
(`server/infrastructure/configRegistry.js`) with `tier !== T0` (45 keys: T1 + T2). T0 keys
(`WEA_DB_*`, `WEA_SQLITE_PATH`, `JWT_SECRET`, `NODE_ENV`,
`DOTENV_CONFIG_PATH`, …) are environment-owned by design
and are **excluded from the report and from every write** — including `JWT_SECRET`.

Keys set in neither the env source nor the DB are default-governed and are **silent** (not
reported).

---

## Report classification

For every non-T0 registry key:

| Status       | Condition                                                         | Severity                              |
| ------------ | ----------------------------------------------------------------- | ------------------------------------- |
| `differs`    | key set in env, DB row exists, stored values differ               | **DRIFT**                             |
| `shadowed`   | key set in env, DB row exists, stored values equal                | informational (env wins; the DB copy is current) |
| `env-only`   | key set in env, no DB row                                          | informational                         |
| `db-only`    | key not set in env, DB row exists                                  | informational (normal per D1)         |

There is no `key-lost` status: DB rows are plaintext and need no key to read, so nothing can
become unrecoverable. The severity column drives the CLI's exit code (see below); the web
report mirrors it as `report.exitCode` (1 when `drift > 0`).

Value comparison rules:

- **Every key — secret or not — is compared by plaintext string equality**: the raw DB value
  string is compared to the env string. This is exact because all write paths store secret
  values as plaintext (see `docs/features/config-source-resolution.md`, "Secret storage and
  masking").
- **Masking:** secret values are never shown. Secret keys are reported as
  `**** <key>` in human output and as `"secret": true` in JSON output (no `value` field is
  ever emitted).

The `updated_at` column of the `settings` table (see
`docs/features/config-source-resolution.md`, "DB storage design") is surfaced per DB-backed
finding as `db_updated_at` (ISO 8601) so an operator can see when the shadow copy was last
written.

Output:

- **Human (CLI default):** grouped lines (`DRIFT:` / `INFORMATIONAL:`) each
  carrying status, key, `(secret: ****)` for secret keys, and `db_updated_at=<ISO>` for
  DB-backed findings, followed by `summary: drift: N, informational: N` and an
  `exit code:` line.
- **`--json` (CLI):** a single JSON document:
  `{ findings: [{ key, status, secret, dbUpdatedAt }], summary: { drift, shadowed,
  envOnly, dbOnly, total }, exitCode }`.
- **Web report (`GET /api/admin/config/sync-report`):** the same `findings` / `summary` /
  `exitCode` JSON as the CLI `--json`, returned by the API.

---

## Reconcile

CLI: `--apply --yes` (`--apply` without `--yes` is a usage error, exit 2). Web:
`POST /api/admin/config/sync-from-env`. In both:

1. **Writes:** for every non-T0 registry key set in the env source, the DB row is upserted
   to mirror the env value through the same write path the admin config route uses
   (`PUT /api/admin/config`, `server/domains/admin/routes/config.js`):
   `Settings.set(key, String(envValue))` — plaintext for every key, secret values included.
   A row whose current value already equals the env value is reported `unchanged` and not
   rewritten; all others are reported `updated`.
2. **Post-apply recheck:** the check runs again in-process and is reported (CLI: rendered
   as `post-apply check:`; web: returned as `report` in the response). A successful
   reconcile yields zero `differs`. The web route additionally invalidates the resolver T2
   cache for the written keys so the running server observes them immediately.

---

## Admin web action (System settings → "Sync environment → DB")

The same algorithm is exposed on the running server for admins (no SSH / no CLI required):

- `GET /api/admin/config/sync-report` — read-only preview (drift classification identical
  to the CLI `--check`), consumed by the preview dialog.
- `POST /api/admin/config/sync-from-env` — reconcile (write semantics identical to the CLI
  `--apply --yes`), guarded by the "must not write T0 / must not delete rows" rules above.

The web surface reconciles against the **running process environment**, classified through
the config resolver (`source: 'env'`), not against the `.env` file (see "Surfaces and env
source"). Both routes sit behind `authenticateToken` + admin and share the algorithm core
`server/domains/admin/services/configSyncService.js`. Full request/response contract:
`docs/spec/server/routes/config.md`.

---

## Exit codes (CLI only)

| Code | Meaning                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- |
| `0`  | no drift (`--check`), or `--apply` completed with a clean post-apply check               |
| `1`  | drift (`differs`) found; or a write failed; or the post-apply recheck still reports drift |
| `2`  | usage error: unknown flag, or `--apply` without `--yes`                                   |

---

## Safety

- **T0 is never written** — the write set is constructed from the registry with T0
  filtered out; no surface or flag can override this.
- **No deletes** — reconcile upserts only; rows for keys absent from the env source are
  left untouched (they remain the effective value per D1).
- **CLI only: `--yes` required** for any write; the read-only report is the default mode.
- **Secrets masked** in all output; secret values are only ever compared in-process and
  never displayed.
- The CLI boots the metadata store schema-only (`initMetadataSchema`, no default-admin
  seeding) and closes the connection on exit; it does not start the HTTP server. The web
  action runs inside the running server against its live store and invalidates the T2
  resolver cache for the keys it writes.

---

## Testing anchors

Observable behaviors covered by `server/scripts/__tests__/configSync.test.js` (hermetic
temp-dir `.env` + sqlite, `setupCli.test.js` pattern):

- fresh env, no DB rows → exit 0, T0 keys excluded from the report;
- env set + equal DB row → `shadowed`, exit 0 (secret and plaintext keys compared as
  plaintext strings);
- env set + differing plaintext DB row → `differs`, exit 1, `db_updated_at` shown, no
  plaintext echoed;
- differing secret → `differs`, exit 1, output masked (`****`), no plaintext echoed;
- `--json` shape: stable `key`/`status`/`secret`/`dbUpdatedAt` fields + `summary` +
  `exitCode`;
- `--apply` without `--yes` → exit 2, nothing written;
- `--apply --yes` → rows mirrored as plaintext (secret rows included), T0 keys absent from
  the DB, post-apply recheck clean, exit 0;
- no `key-lost`/alert status exists for any row state — a row is always readable because
  DB values are plaintext.

`settingsStore.listRows()` coverage lives in
`server/store/__tests__/settingsStore.test.js`.
