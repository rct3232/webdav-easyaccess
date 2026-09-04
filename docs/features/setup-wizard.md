# First-Run Setup Wizard

This document is the **Source-of-Truth** for the first-run setup wizard feature. It describes
the product-level behavior, gating semantics, the two-layer configuration model, the setup
completeness rules, the admin-password semantics, the restart contract, the security posture,
and the production JWT relaxation.

Detailed implementation contracts live in:

- `docs/spec/server/routes/setup.md` — `GET /api/setup/status`, `POST /api/setup/test`, `POST /api/setup/apply`.
- `docs/spec/client/pages/Setup.md` — the `/setup` page and `client/src/services/setupService.js`.
- `docs/SETUP.md` — operator environment-variable reference.

---

## Overview

When the app boots with incomplete configuration (e.g. a fresh install with no `.env`), it
enters **setup mode** and serves a first-run **setup wizard UI** at `/setup`. The operator
configures the metadata backend, file-storage backend and credentials, the admin account,
the JWT secret, and optional SMTP/CORS/port settings through the browser. The wizard persists
the result by **merging into the app's dotenv file** (`.env`), then instructs a server restart.
After restart the app is fully configured and the wizard is no longer reachable.

While setup mode is active the HTTP server **binds to `127.0.0.1` only** (see
[Network exposure (loopback-only binding)](#network-exposure-loopback-only-binding)), so the
wizard is reachable only from the host itself or through an SSH tunnel. Operators who cannot
use a browser on/next to the host complete the same first-run configuration with the **CLI
setup tool** (`server/scripts/setup.js`, feature spec `docs/features/setup-cli.md`).

Key properties:

- **Persistence target:** non-T0 settings are upserted into the connected metadata DB
  `settings` table (`POST /api/setup/apply`); **T0 keys (the DB connection) are never written by
  the wizard** — they are `.env`-owned (decisions **D5/D6/D7**, Phase B). The metadata backend
  is the default SQLite unless the remote DB keys (`WEA_DB_*`) are declared in `.env` — see
  `docs/SETUP.md`.
- **Restart handling:** a "Restart required" screen only (decision **D2**). No self re-exec;
  the operator restarts the process.
- **Scope:** the wizard serves **non-T0 only** — file storage, email, server/CORS, and the
  admin password (decision **D7**, Phase B). The metadata-backend step (sqlite/PostgreSQL radio)
  is removed; PostgreSQL connectivity is boot-verified (D6) and monitored by the backend-health
  card.
- **Admin account:** username is fixed to `admin` (matches `ensureDefaultAdmin`); the wizard
  sets the **password** and `JWT_SECRET` only (decision **D6**).

### Flow

```mermaid
flowchart LR
    A["Boot with no .env"] --> B["Setup mode (loopback-only bind, server stays up)"]
    B --> C["Login redirects to /setup"]
    C --> D["Wizard steps 1–5"]
    D --> E["POST /api/setup/apply"]
    E --> F["Merge-write .env (0600)"]
    F --> G["Restart required screen"]
    G --> H["Operator restarts server"]
    H --> I["Fully configured; all-interface bind; /setup unreachable"]
```

- A fresh boot with no configuration file previously **crashed** after listen: the
  `setImmediate` composition calls `getComposition()` → `resolveS3Config()` which throws on
  missing `S3_*` keys (`server/infrastructure/adapters/blobstore/index.js:7-13`, called from
  `server/index.js:164-172`). The boot guard wraps that block in try/catch and logs a warning
  instead (see Restart contract and setup-mode behavior below).

---

## Gating semantics: `setup_complete` is derived, not stored

There is **no boolean flag file**. `setup_complete` is **derived** from the currently
effective (resolved) configuration, computed by the setup-status validator
(`server/infrastructure/setupStatus.js`, new). The validator returns:

```jsonc
{
  "setup_complete": false,
  "missing": ["S3_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  "current": {
    "WEA_FILE_STORAGE": "s3",
    "PORT": "5001",
    "JWT_SECRET": "****",
    "WEBDAV_URL": "",
    "EMAIL_HOST": "",
  },
}
```

- `current` carries safe values for prefill; secrets are masked (`"****"`) when set and
  absent when unset.
- The validator is pure `process.env` inspection — no DB, no blob-store imports. It
  re-implements the required-key lists (`S3_*`, `WEBDAV_*`, and the remote-DB `WEA_DB_*`
  credential set) locally and must not
  import `resolveS3Config`/`resolvePgConfig` to avoid a require cycle with `utils/auth`.

Desired consequences:

| Scenario                                                 | Effective config | `setup_complete` | Wizard                       |
| -------------------------------------------------------- | ---------------- | ---------------- | ---------------------------- |
| Fresh machine, no `.env`                                 | incomplete       | `false`          | shown                        |
| Container deployment with env injected (no file written) | complete         | `true`           | skipped                      |
| Dev repo with full `.env`                                | complete         | `true`           | never shown, flows untouched |

Container-style boots and dev installs therefore never touch the wizard and never create or
modify a `.env` file.

---

## Two-layer configuration model

1. **Boot layer → `.env`:** `apply` writes the payload's startup-critical **T0 subset** —
   `JWT_SECRET` (always; no other key is generated) — into the _resolved active env file_
   (the same path the loader used — `server/index.js:10-18`; `DOTENV_CONFIG_PATH` or
   `<root>/.env`). A restart is required for these boot-frozen values to take effect. The
   metadata connection (the remote `WEA_DB_*` block / `WEA_SQLITE_PATH`) is `.env`-owned
   and **never written by apply**.
2. **Runtime layer → DB `settings`:** `apply` upserts every **non-T0** wizard value (file
   storage, email, server/CORS, `JWT_EXPIRES_IN`) into the connected metadata DB `settings`
   table (row key = raw env var name, D11). Secret values are stored as **plaintext strings**
   — there is no field-level encryption and no key to keep or generate. Per-request runtime
   flags such as `registration_enabled` stay where they are, backed by the same dual-backend
   key/value store (`server/store/settingsStore.js:41-127`; DDL
   `settings(key, value, updated_at)` at
   `server/store/postgresql/ddl/001_initial_normalized_schema.sql:31-35`).

The two layers are independent: the wizard/CLI write both the `.env` T0 subset and the
DB `settings` rows, while the existing admin settings routes never write `.env`.

---

## Setup completeness rules

`setup_complete = metadata AND file AND jwt resolvable`:

| Block      | Env keys                                 | Rule                                                                                                                                                                                                      |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metadata` | remote DB block / SQLite (default) | SQLite is always resolvable when no remote DB keys are set; setting any of `WEA_DB_HOST`/`WEA_DB_DATABASE`/`WEA_DB_USER`/`WEA_DB_PASSWORD` selects the PostgreSQL backend and all four are required (reuse `resolvePgConfig` semantics, `server/store/storage.js:32-47`) |
| `file`     | `WEA_FILE_STORAGE` (default `s3`)        | `s3` requires the 4 `S3_*`/`AWS_*` keys (reuse `resolveS3Config` semantics, `server/infrastructure/adapters/blobstore/index.js:7-13`); `webdav` requires `WEBDAV_URL`/`WEBDAV_USERNAME`/`WEBDAV_PASSWORD` |
| `jwt`      | `JWT_SECRET`                             | non-default required **only when** `NODE_ENV=production` (the `auth.js` require-time prod throw is relaxed to a warning in setup mode — D7, below)                                                        |

A production boot with a default `JWT_SECRET` is incomplete by definition, so the wizard is
reachable exactly in the case it exists for.

---

## Admin-password semantics (D6)

The wizard sets the admin **password** (username fixed to `admin`) plus `JWT_SECRET`; it does
not create or rename users. Apply never writes an `ADMIN_DEFAULT_PASSWORD` value and never
chooses a metadata backend — the DB connection is `.env`-owned, so a `metadata` block with
`backend: 'postgresql'` is rejected (`400`, D7). The metadata backend is whatever the boot used
(sqlite default or the `.env`-declared PostgreSQL):

- `admin` already exists in the connected metadata store from the setup-mode boot
  (`ensureDefaultAdmin`, `server/store/bootstrap.js:8-29`). Apply updates that existing
  account's password directly via the user store (a single store call, after the `.env`
  write), so there is **no restart dependency for the credential** on either backend. If the
  `admin` row is unexpectedly absent the apply logs a warning and continues (the default or
  `ADMIN_DEFAULT_PASSWORD`-configured credential then applies on the next boot).

---

## Restart contract

Env-derived configuration is **frozen at require time** — module-const captures such as
`JWT_SECRET`/`JWT_EXPIRES_IN` (`server/utils/auth.js:6-7`), plus refresh TTLs, rate limits,
and thumbnail secrets. A restart is therefore mandatory after any wizard write:

- `apply` responds `200 { "restart_required": true }`.
- The wizard shows a "Restart required" screen; there is no self re-exec (D2).
- The boot guard in `server/index.js` (the `setImmediate` composition at
  `server/index.js:164-172`) is wrapped in try/catch; when `!setup_complete` the server logs a
  warning ("running in setup mode — file operations disabled") and stays up instead of crashing.

---

## Security

The unauthenticated `apply`/`test` surface exists **only while setup is incomplete** AND only
while the server listens on the **loopback interface** — a setup-incomplete server is never
reachable from a remote client, so the "fresh install claimed by whoever reaches it first"
class does not apply to network-published instances (the wizard is reachable only by the
operator on the host or via an SSH tunnel). Mitigations in scope:

- **Loopback-only binding:** while `setup_complete === false` the HTTP listener binds to
  `127.0.0.1` only, unconditionally (no opt-out env var). See [Network exposure
  (loopback-only binding)](#network-exposure-loopback-only-binding).
- **Auto-403 gate:** once `setup_complete` is true, `POST /api/setup/test` and
  `POST /api/setup/apply` return `403` with error code `setup.complete`. The gate flips
  automatically from the derived completeness state.
- **Allowlisted keys only:** the env writer upserts only the wizard's writable keys; unknown
  keys are rejected. It preserves existing unknown keys on merge (not a replace).
- **Format validation:** values are format-validated; no shell/file-path input is accepted.
- **File permissions:** the written `.env` is `0600`.
- **No body logging:** `requestLogger` already never logs request bodies or the Authorization
  header (`server/middleware/requestLogger.js:4-5`) — wizard-transmitted secrets are logged
  nowhere (T4 confirms only).
- **Backup:** the writer creates `<envPath>.bak-<ts>` on apply to protect against a
  misconfigured dev-machine `.env`.
- **CLI alternative:** remote/headless operators configure first-run via the CLI setup tool
  (`docs/features/setup-cli.md`), which shares the exact same apply core as the wizard.

While in setup mode the setup-mode API guard blocks **file-domain and admin-write routes**
(`503` `setup.incomplete`) and keeps open: setup routes, auth-login, public settings, and
health.

---

## Network exposure (loopback-only binding)

While the app is in setup mode (`setup_complete === false`) the HTTP listener is bound to
`127.0.0.1` only. This is a **hard rule, not a configuration option**:

- No env var or request can make a setup-incomplete server listen on a non-loopback interface.
- The intended setup paths are therefore: (1) a browser on the host, (2) a browser anywhere
  with an SSH tunnel (`ssh -L 5001:127.0.0.1:5001 host`), or (3) the **CLI setup tool**
  (`server/scripts/setup.js`) for headless/remote-first operators — see
  `docs/features/setup-cli.md`.
- A fully **env-only** first run is equivalent to option (3): pre-populate every key the
  completeness rules require (see §Setup completeness rules and `docs/SETUP.md`) in `.env` and
  boot — `setup_complete` is derived, so the app starts fully configured on the first boot and
  binds all interfaces immediately (no wizard, no setup window).
- The bind host is selected at `listen()` time from the boot-derived `setup_complete` state
  (`server/index.js`). A restart is the only transition: setup-incomplete boots are
  loopback-only; once `.env` makes the config complete, the next boot binds all interfaces
  (current default) so a reverse proxy can reach it. A containerized deployment that injects a
  full env set never enters setup mode at all.
- While setup mode is active, `/setup`, `/api/setup/*`, and `POST /api/auth/login` are
  reachable **only on the loopback interface**; remote clients see connection refused or a
  timeout — there is no HTTP surface to attack.

---

## Production JWT relaxation (D7) and setup-mode production behavior

**Problem.** `server/utils/auth.js:10-12` throws at module load when
`NODE_ENV=production && JWT_SECRET === DEFAULT_JWT_SECRET`. All routes require `utils/auth`,
so a fresh prod install (no `.env`) crashed **before** `listen()` — the wizard was unreachable
exactly in the case it exists for.

**Fix.** `server/utils/auth.js` replaces the unconditional throw with:

```js
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  const { setup_complete } = computeSetupStatus(process.env);
  if (setup_complete) {
    throw new Error('JWT_SECRET must be set in production'); // defense-in-depth; unreachable per completeness rules
  }
  console.warn(
    '[setup-mode] NODE_ENV=production with default JWT_SECRET — booting in setup mode; the wizard must set JWT_SECRET before restart'
  );
}
```

No other `auth.js` change: `JWT_SECRET`/`JWT_EXPIRES_IN` remain frozen at require-time
(restart contract unchanged). The production throw is retained when setup is complete
(defense-in-depth; unreachable in practice).

**Behavior change to document:** a production install that is otherwise fully configured but
missing `JWT_SECRET` now boots into **setup mode** (warning, not crash) and shows only the
JWT step of the wizard, instead of failing loudly. File-domain and admin-write routes stay
blocked by the setup-mode guard until `apply` writes `JWT_SECRET`.

**Security note for setup-mode production:** while in setup mode under `NODE_ENV=production`,
auth-login stays open (guard rule) and tokens would be signed with the default secret. Existing
mitigations apply: the setup-mode guard blocks file-domain + admin-write routes, the server is
reachable only on the loopback interface (see [Network exposure
(loopback-only binding)](#network-exposure-loopback-only-binding)), and `apply` is required to
set a real `JWT_SECRET` before restart — after which setup is complete and the production throw
path is effectively re-armed.

---

## Setup-mode API guard

A middleware (`server/domains/setup/routes.js` or `server/middleware/`) enforces, per request,
the derived `setup_complete` state:

- `!setup_complete`: file-domain and admin-write routes return `503 { errorCode: 'setup.incomplete' }`
  (new code added to `shared/serverMessageCodes.js`).
- `!setup_complete`: setup routes, auth-login, public settings, and health stay open.
- `setup_complete`: setup `test`/`apply` are gated with `403 { errorCode: 'setup.complete' }`
  (auto-403 gate); the rest of the API is normal.

**Jest-harness exemption.** The jest route-test harness boots a configured app (composition
overridden per suite via `composition.__setCompositionForTests`) without setting any file/admin
config keys, so the derived `setup_complete` is false there and the guard would block every
guarded route. Jest workers set `JEST_WORKER_ID`, which the guard treats as "test harness" and
passes through (no-op). Real boots — dev, production, and the e2e scratch server spawned by
Playwright on `:5003` — never carry `JEST_WORKER_ID`, so the setup-mode blocking remains fully
active for genuine first-run boots.

---

## API surface summary

| Endpoint                   | Public | When available                                                                     |
| -------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `GET /api/setup/status`    | yes    | always (reports derived state)                                                     |
| `POST /api/setup/test`     | yes    | while `!setup_complete`; `403 setup.complete` otherwise                            |
| `POST /api/setup/apply`    | yes    | while `!setup_complete`; `403 setup.complete` otherwise                            |
| `GET /api/settings/public` | yes    | extended with `setup_complete: boolean` (zero extra round-trip for the login page) |

While `!setup_complete` the whole `/api/setup/*` + login surface is reachable **only on the
loopback interface** (see [Network exposure](#network-exposure-loopback-only-binding)); the
same apply logic is available off-host only through the CLI setup tool
(`docs/features/setup-cli.md`).

Full request/response contracts: `docs/spec/server/routes/setup.md`.

---

## Client behavior summary

- Route `/setup` is public, outside `MainLayout`, alongside `/login`/`/register`
  (`client/src/App.js:69-105`). While setup mode is active the route (and its API) is
  reachable only from the host loopback — an SSH-tunneled or on-host browser only.
- The login page already fetches public settings on mount
  (`client/src/pages/Login/hooks/useLoginForm.js:26-43`); when `setup_complete === false` it
  redirects to `/setup`.
- Revisiting `/setup` after setup is complete redirects to `/login` (post-setup lockout).
- Full page/service spec: `docs/spec/client/pages/Setup.md`.

---

## Connection-test error handling

Connection-test failures surface a concise translated primary message plus an optional short
technical detail — never a raw driver dump.

- Failure response shape: `{ ok: false, errorCode, message, reason? }`. `errorCode` is a stable
  i18n key (primary text), `message` is a short English fallback, and `reason` is an optional
  technical detail trimmed to ~200 chars (e.g. `ECONNREFUSED 127.0.0.1:5432` or `AccessDenied`).
- The client renders the primary message from the `errorCode` translation; `reason` (when
  present) is shown only as a secondary muted detail line.
- PostgreSQL/S3 probe failures are classified into stable codes (unreachable, auth, missing
  database/bucket); anything unclassified falls back to a generic code with the raw driver code
  kept in `reason` only. WebDAV keeps its existing codes; the generic `{{reason}}` template is
  interpolated client-side.
- Full taxonomy: `docs/spec/server/routes/setup.md` (§2.4); client behavior:
  `docs/spec/client/pages/Setup.md` (§3.3).

---

## Testing anchors

Representative observable behaviors to cover (full inventory in the server/client route specs
and the E2E setup-wizard plan):

- Fresh boot (no env file) stays up; `/api/health` is 200; file-domain routes return
  `503 setup.incomplete`; the post-listen crash is gone.
- A setup-incomplete server listens on `127.0.0.1` only (`ss`/`netstat`); a fully configured
  boot listens on all interfaces; no env flag changes the setup-mode bind.
- The CLI setup tool (`server/scripts/setup.js`) performs the same apply as the wizard and
  flips `setup_complete` to true on a throwaway sqlite DB; it refuses to run when setup is
  already complete.
- Fresh production boot (`NODE_ENV=production`, no env) reaches `/api/setup/status` instead of
  crashing; a complete-but-JWT-missing production install boots into setup mode with a warning.
- `apply` writes the expected `.env` lines (`0600`); a restart makes them effective;
  `apply`/`test` return `403 setup.complete` once complete; `/setup` redirects to `/login`.
- Pre-configured install (full `.env`): `/setup` never shown, login flow byte-identical.
- Container-style boot (env injected, no `.env` file): `setup_complete` true, wizard skipped,
  `.env` never created.
