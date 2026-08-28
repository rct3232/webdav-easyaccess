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

Key properties:

- **Persistence target:** `.env` merge-write (decision **D1**). No new dependencies; every
  existing `process.env` read site is unchanged (`server/index.js:10-18`).
- **Restart handling:** a "Restart required" screen only (decision **D2**). No self re-exec;
  the operator restarts the process.
- **Scope:** the wizard also configures the metadata backend (sqlite default + PostgreSQL with
  a connection test) (decision **D3**).
- **Admin account:** username is fixed to `admin` (matches `ensureDefaultAdmin`); the wizard
  sets the **password** and `JWT_SECRET` only (decision **D6**).
- **Production JWT:** the `auth.js` require-time production throw is relaxed to a warning in
  setup mode so a fresh prod install reaches the wizard (decision **D7**, detailed below).

### Flow

```mermaid
flowchart LR
    A["Boot with no .env"] --> B["Setup mode (server stays up)"]
    B --> C["Login redirects to /setup"]
    C --> D["Wizard steps 1–5"]
    D --> E["POST /api/setup/apply"]
    E --> F["Merge-write .env (0600)"]
    F --> G["Restart required screen"]
    G --> H["Operator restarts server"]
    H --> I["Fully configured; /setup unreachable"]
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
    "WEA_STORAGE_BACKEND": "sqlite",
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
  re-implements the required-key lists (`S3_*`, `WEA_PG_*`, `WEBDAV_*`) locally and must not
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

1. **Boot layer (this feature) → `.env`:** the wizard writes the _resolved active env file_
   (the same path the loader used — `server/index.js:10-18`; `DOTENV_CONFIG_PATH` or
   `<root>/.env`). A restart is required for the values to take effect.
2. **Runtime layer (unchanged) → DB `settings`:** per-request runtime flags such as
   `registration_enabled` remain where they are, backed by the dual-backend key/value store
   (`server/store/settingsStore.js:41-127`; DDL `settings(key, value, updated_at)` at
   `server/store/postgresql/ddl/001_initial_normalized_schema.sql:31-35`).

The two layers are independent: the wizard never writes DB `settings` rows, and the existing
admin settings routes never write `.env`.

---

## Setup completeness rules

`setup_complete = metadata AND file AND jwt resolvable`:

| Block      | Env keys                                 | Rule                                                                                                                                                                                                      |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metadata` | `WEA_STORAGE_BACKEND` (default `sqlite`) | sqlite is always resolvable; `postgresql` requires the 5 `WEA_PG_*` keys (reuse `resolvePgConfig` semantics, `server/store/storage.js:32-47`)                                                             |
| `file`     | `WEA_FILE_STORAGE` (default `s3`)        | `s3` requires the 4 `S3_*`/`AWS_*` keys (reuse `resolveS3Config` semantics, `server/infrastructure/adapters/blobstore/index.js:7-13`); `webdav` requires `WEBDAV_URL`/`WEBDAV_USERNAME`/`WEBDAV_PASSWORD` |
| `jwt`      | `JWT_SECRET`                             | non-default required **only when** `NODE_ENV=production` (the `auth.js` require-time prod throw is relaxed to a warning in setup mode — D7, below)                                                        |

A production boot with a default `JWT_SECRET` is incomplete by definition, so the wizard is
reachable exactly in the case it exists for.

---

## Admin-password semantics (D6)

The wizard sets the admin **password** (username fixed to `admin`) plus `JWT_SECRET`; it does
not create or rename users. The password effect depends on the chosen metadata backend:

- **`metadata.backend=postgresql`:** `apply` also writes `ADMIN_DEFAULT_PASSWORD=<chosen>` to
  `.env`. On restart, `ensureDefaultAdmin` creates the `admin` account in the fresh PG
  database with that password — the existing bootstrap path (`server/store/bootstrap.js:8-29`,
  password from `ADMIN_DEFAULT_PASSWORD` at `server/store/bootstrap.js:13`). No new mechanism.
- **`metadata.backend=sqlite`:** `admin` already exists in the sqlite store from first boot.
  `apply` updates its password directly via the existing user store (a single store call), so
  there is no restart dependency for the credential.

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

The unauthenticated `apply`/`test` surface exists **only while setup is incomplete** — a
self-hosted first-run exposure class (same as Pi-hole/Nextcloud installers). Mitigations in
scope:

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
- **Deferred hardening:** `WEA_SETUP_TOKEN` (token-gated setup endpoints) is explicit follow-up
  work, **not** part of v1.

While in setup mode the setup-mode API guard blocks **file-domain and admin-write routes**
(`503` `setup.incomplete`) and keeps open: setup routes, auth-login, public settings, and
health.

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
mitigations apply: the setup-mode guard blocks file-domain + admin-write routes, the
unauthenticated wizard surface is the documented first-run exposure class (see Security), and
`apply` is required to set a real `JWT_SECRET` before restart — after which setup is complete
and the production throw path is effectively re-armed.

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

Full request/response contracts: `docs/spec/server/routes/setup.md`.

---

## Client behavior summary

- Route `/setup` is public, outside `MainLayout`, alongside `/login`/`/register`
  (`client/src/App.js:64-98`).
- The login page already fetches public settings on mount
  (`client/src/pages/Login/hooks/useLoginForm.js:26-43`); when `setup_complete === false` it
  redirects to `/setup`.
- Revisiting `/setup` after setup is complete redirects to `/login` (post-setup lockout).
- Full page/service spec: `docs/spec/client/pages/Setup.md`.

---

## Testing anchors

Representative observable behaviors to cover (full inventory in the server/client route specs
and the E2E setup-wizard plan):

- Fresh boot (no env file) stays up; `/api/health` is 200; file-domain routes return
  `503 setup.incomplete`; the post-listen crash is gone.
- Fresh production boot (`NODE_ENV=production`, no env) reaches `/api/setup/status` instead of
  crashing; a complete-but-JWT-missing production install boots into setup mode with a warning.
- `apply` writes the expected `.env` lines (`0600`); a restart makes them effective;
  `apply`/`test` return `403 setup.complete` once complete; `/setup` redirects to `/login`.
- Pre-configured install (full `.env`): `/setup` never shown, login flow byte-identical.
- Container-style boot (env injected, no `.env` file): `setup_complete` true, wizard skipped,
  `.env` never created.
