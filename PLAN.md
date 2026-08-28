# PLAN — First-Run Setup Wizard (setup UI + env-var configuration)

Branch: `feature/first-run-setup-wizard` (base: `dev`)
Status: PLANNED — implementation not started. Docs (T1) are the gate before any code.

## 1. Objective

When the app boots with incomplete configuration (e.g. a fresh install with no `.env`),
show a first-run **setup wizard UI** that lets the operator configure environment variables
(metadata backend, blob backend + credentials, admin account, JWT secret, optional SMTP/CORS/port)
through the browser. The wizard persists the result by **merging into the app's dotenv file**,
then instructs a server restart. After restart the app is fully configured and the wizard is
no longer reachable.

## 2. Confirmed Decisions (user-approved)

| # | Decision | Choice |
|---|--------|--------|
| D1 | Persistence target for boot config | **`.env` merge-write** (no new deps; all existing `process.env` read sites unchanged) |
| D2 | Restart handling | **"Restart required" screen only** (no self re-exec; operator restarts the process) |
| D3 | Wizard scope includes metadata backend | **Yes** — sqlite (default) + PostgreSQL (with connection test) |
| D4 | E2E client strategy | Scratch server serves `client/build` statically (same-origin `/api`); no second CRA dev server |
| D5 | E2E gating | Setup spec included in default `test:e2e:s3` / `test:e2e:webdav` runs (P0), dedicated Playwright projects |
| D6 | Admin account in wizard | Username fixed to `admin` (matches `ensureDefaultAdmin`); wizard sets **password** + `JWT_SECRET` only |
| D7 | Production + default `JWT_SECRET` boot | **Relax the `auth.js` require-time throw to a warning in setup mode** so a fresh prod install reaches the wizard; the prod throw is retained when setup is complete (defense-in-depth; unreachable in practice per §5.1). Detailed work in §5.2.1 |

## 3. Evidence Summary (verified file:line)

### 3.1 Config loading & boot
- Env load: `server/index.js:10-18` — `envPath = DOTENV_CONFIG_PATH ? path.resolve(__dirname, DOTENV_CONFIG_PATH) : path.join(__dirname, '../.env')`; if file missing → warn + bare `dotenv.config()` (reads `<cwd>/.env`, normally nonexistent); `override: false` (real process env always wins).
- No central config module; ~35 direct `process.env` read sites, documented as a 30-variable reference table (`docs/SETUP.md:43-74`).
- Fresh boot (no config) today: metadata falls back to sqlite (`server/store/storage.js:11-15`), `data/` auto-created, default admin `admin`/`admin` created (`server/store/bootstrap.js:8-29`), server listens — then **crashes**: `setImmediate` → `getComposition()` → `resolveS3Config()` throws on missing `S3_*` (`server/infrastructure/adapters/blobstore/index.js:8-13`, no try/catch at `server/index.js:164-172`, no global uncaught handler).
- Values frozen at require-time (module consts): `JWT_SECRET`/`JWT_EXPIRES_IN` (`server/utils/auth.js:6-7`), refresh TTL, rate limits, thumbnail secrets — therefore a restart is mandatory after config changes.
- `NODE_ENV=production` + default `JWT_SECRET` → hard throw at route require (`server/utils/auth.js:10-12`).

### 3.2 Existing settings infrastructure (reuse, do not reinvent)
- DB key/value store: `settings(key, value, updated_at)` — DDL `server/store/postgresql/ddl/001_initial_normalized_schema.sql:31-35`; dual-backend store `server/store/settingsStore.js:41-127`; currently only `registration_enabled` (`server/domains/admin/routes/settings.js:39-44`).
- Unauthenticated public endpoint pattern: `GET /api/settings/public` (`server/domains/admin/routes/settings.js:13-21`), consumed by login page (`client/src/pages/Login/hooks/useLoginForm.js:26-43`).
- Connection-probe pattern: `GET /api/webdav/test` (`server/infrastructure/webdavTest.js`); S3/WebDAV dest-config validation already shaped for payloads: `buildDestBlobStore` (`server/infrastructure/adapters/blobstore/config.js:234-241`).
- PG config resolution + missing-key errors: `resolvePgConfig` (`server/store/storage.js:33-47`).
- Error codes: `shared/serverMessageCodes.js` (imported at `server/index.js:8`).
- Default admin bootstrap: `server/store/bootstrap.js:8-29` (skips if `WEA_DISABLE_DEFAULT_ADMIN=true` or `admin` exists; password from `ADMIN_DEFAULT_PASSWORD` else `admin`).

### 3.3 Client
- React 18 + CRA + MUI 7 + react-router 7; hook + pure-view pattern; i18n en/ko.
- Routes: `client/src/App.js:64-98` — `/login`, `/register` public (outside `MainLayout`); `/files/*`, `/mypage` behind `PrivateRoute` (`client/src/components/layout/PrivateRoute.js:6-18`).
- API transport is same-origin: `BASE_URL = '/api'` (`client/src/services/httpClient.js:7`) → static serving by the server (gated on `client/build` existence, **not** `NODE_ENV`; `server/index.js:56-59,110-117`) works on any port with no client env.
- No setup/onboarding code exists anywhere (verified by repo search).

### 3.4 Config format landscape (repo-wide)
- Native config formats in use: **`.env` (dotenv) + JSON API payloads + DB `settings` rows only**.
- No YAML/XML/TOML: zero direct dependencies (`js-yaml` only transitive via react-scripts), no config files, no parsers in app code. `docker-compose.e2e.yml` is tooling, not app config; coverage `clover.xml` files are write-only artifacts.
- `scripts/update-proxy.js` already regex-parses `.env` (`PORT=`) — `.env` is the established machine-editable config surface.

## 4. Config Storage Format — All-Cases Analysis

Requirement: store what the wizard collects so that (a) a restart makes it effective with
**zero changes** to the ~35 existing read sites, (b) real process env (containers) still
wins, (c) no new runtime dependency is added.

| Format | Storage | New deps | Restart semantics | Contract fit | Security | Verdict |
|--------|---------|----------|-------------------|--------------|----------|---------|
| **`.env`** | `<root>/.env` or `$DOTENV_CONFIG_PATH` | none (dotenv) | **Native** — `server/index.js:10-18` already loads it at boot; real env wins (`override:false`) | Canonical per `docs/SETUP.md`, `.env.example`, e2e (`.env.e2e*`), `update-proxy.js` | file perms (write `0600`); values visible in file | **ADOPT — boot config** |
| YAML (`.yaml`/`.yml`) | `config.yaml` | `js-yaml` (direct) | Needs new loader module + precedence rules vs env | Breaks the repo-wide `process.env`-only config convention (no central config module — §3.1) | same file exposure as .env | **REJECT** — new dep + parser + precedence for pure duplication of .env |
| XML | `config.xml` | `fast-xml-parser`/`xml2js` | new loader | XML exists in this codebase only as file-type classification (`shared/fileTypes.js:51`); no config ecosystem | same | **REJECT** |
| JSON file | `data/app.config.json` | none | new loader, bypasses dotenv | same break as YAML with more work (new write path, no operator familiarity) | same | **REJECT** (strictly worse than .env) |
| **DB `settings` table** | sqlite/PG rows | none | **Chicken-and-egg**: if user selects PG as metadata, the PG connection info cannot live in the DB it configures; boot-order rework + require-time-const problem to feed `process.env` | `settings` store is proven for *runtime flags* only (`registration_enabled`) | secrets plaintext in DB dump/backup | **REJECT for boot config; KEEP for runtime flags** (existing behavior, out of scope to change) |

**Resulting two-layer model**
1. **Boot layer (this feature) → `.env`**: wizard writes the *resolved active env file*
   (same path the loader used — see §5.2), restart required.
2. **Runtime layer (unchanged) → DB `settings`**: per-request flags such as
   `registration_enabled` remain where they are.

## 5. Design

### 5.1 Setup completeness (the "is first-run over?" signal)
No boolean flag file. `setup_complete` is **derived** from the currently effective
(resolved) configuration, computed by a new validator:

- `metadata`: `WEA_STORAGE_BACKEND` (default `sqlite`) — sqlite always resolvable;
  postgresql requires the 5 `WEA_PG_*` keys (reuse `resolvePgConfig` semantics).
- `file`: `WEA_FILE_STORAGE` (default `s3`) — s3 requires the 4 `S3_*`/`AWS_*` keys
  (reuse `resolveS3Config` semantics); webdav requires `WEBDAV_URL/USERNAME/PASSWORD`.
- `jwt`: `JWT_SECRET` non-default required **only when** `NODE_ENV=production` (the `auth.js` require-time prod throw is relaxed to a warning in setup mode — D7, detailed in §5.2.1).
- `setup_complete = all above resolvable`.

Consequences (desired):
- Fresh machine, no `.env` → `false` → wizard shown.
- Container deployment with env injected → `true` → wizard skipped (file never written).
- Dev repo with full `.env` → `true` → existing flows untouched.

### 5.2 Server components (new files unless noted)
| Component | File | Notes |
|-----------|------|-------|
| Env-path resolution helper | `server/infrastructure/envPath.js` (new) | Extracts the `server/index.js:10-12` logic into one function used by **both** loader and writer (no drift). |
| Setup status validator | `server/infrastructure/setupStatus.js` (new) | Returns `{ setup_complete, missing: string[], current: {…masked} }` per §5.1. Masking: secrets rendered as `"****"` when set, absent when unset. |
| Env writer | `server/infrastructure/envFileWriter.js` (new) | Merge-write to the resolved envPath: parse existing file (dotenv format), keep unknown keys, upsert allowlisted keys, atomic (temp + `rename`), `chmod 0600`. Allowlist = the wizard's writable keys only. |
| Setup routes | `server/domains/setup/routes.js` (new), mounted `/api/setup` in `server/index.js` | See §5.3. |
| Boot guard | `server/index.js:164-172`, `server/utils/auth.js:10-12` (edit) | Wrap post-listen composition `setImmediate` in try/catch; when `!setup_complete`, log warn "running in setup mode — file operations disabled" instead of crashing. Also relax the production JWT require-time throw (`auth.js:10-12`) to a warning in setup mode so a fresh prod install reaches the wizard (D7 — detailed work in §5.2.1). |
| Setup-mode API guard | middleware in `server/domains/setup/routes.js` or `server/middleware/` (new) | When `!setup_complete`: file-domain + admin-write routes return `503 { errorCode: 'setup.incomplete' }` (new code in `shared/serverMessageCodes.js`); setup, auth-login, public settings, health routes stay open. |

### 5.2.1 JWT production-throw relaxation (D7) — detailed work

**Problem.** `server/utils/auth.js:10-12` throws at module load when
`NODE_ENV=production && JWT_SECRET === DEFAULT_JWT_SECRET`. All routes require
`utils/auth`, so a fresh prod install (no `.env`) crashes **before** `listen()`
— the wizard is unreachable exactly in the case it exists for.

**Rationale.** §5.1 defines `jwt` completeness as "`JWT_SECRET` non-default
required only when `NODE_ENV=production`". Therefore
`JWT_SECRET === DEFAULT && NODE_ENV=production` ⇒ `setup_complete === false` by
definition — the throw can only ever fire on an incomplete setup. Keeping it as a
hard error is pointless for first-run and hostile to fresh prod installs.

**Work items (implemented in T5; consumes T2's validator):**
1. `server/infrastructure/setupStatus.js` (T2) must expose a **synchronous,
   dependency-free** `computeSetupStatus(env)` — pure `process.env` inspection,
   no DB / no blob-store imports. Re-implement the required-key lists
   (`S3_*`, `WEA_PG_*`, `WEBDAV_*`) locally; do **not** import
   `resolveS3Config`/`resolvePgConfig`, to avoid a require cycle with `utils/auth`.
2. `server/utils/auth.js` — replace the unconditional throw with:
   ```js
   if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
     const { setup_complete } = computeSetupStatus(process.env);
     if (setup_complete) {
       throw new Error('JWT_SECRET must be set in production'); // defense-in-depth; unreachable per §5.1
     }
     console.warn(
       '[setup-mode] NODE_ENV=production with default JWT_SECRET — booting in setup mode; the wizard must set JWT_SECRET before restart'
     );
   }
   ```
   No other `auth.js` change: `JWT_SECRET`/`JWT_EXPIRES_IN` remain frozen at
   require-time (restart contract unchanged — D2).
3. **Behavior change to document (T1 feature doc + §5.5):** a prod install that is
   otherwise fully configured but missing `JWT_SECRET` now boots into **setup
   mode** (warn, not crash) and shows only the JWT step of the wizard, instead of
   failing loudly. File-domain + admin-write routes stay blocked by the setup-mode
   guard until `apply` writes `JWT_SECRET`.
4. **Security note:** while in setup mode under `NODE_ENV=production`, auth-login
   stays open (guard rule) and tokens would be signed with the default secret.
   Existing mitigations apply: the setup-mode guard blocks file-domain +
   admin-write routes, the unauthenticated wizard surface is the documented
   first-run exposure class (§5.5), and `apply` is required to set a real
   `JWT_SECRET` before restart — after which setup is complete and the prod throw
   path is effectively re-armed.

### 5.3 API contract (spec: `docs/spec/server/routes/setup.md`)
`GET /api/setup/status` — public, always available.
```jsonc
// 200
{
  "setup_complete": false,
  "missing": ["S3_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  "current": {                    // safe values for prefill; secrets masked
    "WEA_STORAGE_BACKEND": "sqlite", "WEA_FILE_STORAGE": "s3",
    "PORT": "5001", "JWT_SECRET": "****",
    "WEBDAV_URL": "", "EMAIL_HOST": ""
  }
}
```
`POST /api/setup/test` — public, **403 `setup.complete` when already complete**.
```jsonc
// request (one of three shapes)
{ "target": "postgresql", "host": "…", "port": "5432", "database": "…", "user": "…", "password": "…", "ssl": false }
{ "target": "s3", "bucket": "…", "region": "…", "accessKeyId": "…", "secretAccessKey": "…", "endpoint": "" }
{ "target": "webdav", "url": "…", "username": "…", "password": "…" }
// 200 { "ok": true }   |   4xx { "ok": false, "errorCode": "…", "message": "…" }
```
`POST /api/setup/apply` — public, **403 when already complete**; body:
```jsonc
{
  "metadata": { "backend": "sqlite" } | { "backend": "postgresql", "host": "…", "port": "…", "database": "…", "user": "…", "password": "…", "ssl": false, "max": "10" },
  "file": { "backend": "s3", "bucket": "…", "region": "…", "accessKeyId": "…", "secretAccessKey": "…", "endpoint": "" }
        |  { "backend": "webdav", "url": "…", "username": "…", "password": "…", "authType": "auto" },
  "admin": { "password": "…" },            // username fixed: admin (D6)
  "jwt": { "secret": "…", "expiresIn": "30m" },
  "server": { "port": "5001", "corsOrigins": "" },
  "email": { "host": "", "port": "587", "user": "", "password": "", "secure": false, "fromName": "" } // all optional
}
```
Behavior:
1. Validate every block (reuse `resolvePgConfig`/`buildDestBlobStore`-level checks; reject unknown keys, 400 with per-field errors).
2. Write `.env` via envFileWriter: `WEA_STORAGE_BACKEND`, `WEA_PG_*` (if pg), `WEA_FILE_STORAGE`, `S3_*`/`AWS_*` or `WEBDAV_*`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `CORS_ORIGINS` (if set), `EMAIL_*` (if set).
3. Admin password effect (D6):
   - `metadata.backend=postgresql` → also write `ADMIN_DEFAULT_PASSWORD=<chosen>`; on restart `ensureDefaultAdmin` creates `admin` in the fresh PG DB with that password (existing bootstrap path, no new mechanism).
   - `metadata.backend=sqlite` → admin already exists in the sqlite store from first boot; apply updates its password directly via the existing user store (single store call), so no restart dependency for the credential.
4. Respond `200 { "restart_required": true }`.
Idempotency/safety: apply refuses (403) once `setup_complete` is true; concurrent apply = last-writer-wins (documented, single-operator assumption).

Also: extend `GET /api/settings/public` response with `setup_complete: boolean`
(existing unauthenticated endpoint the login page already fetches → zero extra round-trip;
route file `server/domains/admin/routes/settings.js:13-21`).

### 5.4 Client components
| Component | File | Notes |
|----------|------|-------|
| Service | `client/src/services/setupService.js` (new) | `getSetupStatus()`, `testSetup(target, payload)`, `applySetup(payload)` via existing `httpClient`/`apiClient`. |
| Route | `client/src/App.js` (edit) | Public path `/setup` next to `/login`/`/register` (outside `MainLayout`, standalone like Login). |
| Wizard | `client/src/pages/Setup/` (new): `SetupWizardView.js` (pure MUI view) + `hooks/useSetupWizard.js` | Hook+view pattern per `pages/Login`. Steps: ① Metadata (sqlite / postgresql + fields + "Test connection") → ② File storage (s3 / webdav + fields + "Test connection") → ③ Admin password + JWT secret (client-generated via `crypto.getRandomValues`, regenerate button) + optional expires-in → ④ Optional (port, CORS, SMTP) → ⑤ Apply → "Restart required" screen. |
| Login redirect | `client/src/pages/Login/hooks/useLoginForm.js` (edit) | Public settings already fetched on mount; if `setup_complete === false` → `navigate('/setup', { replace: true })`. |
| Post-setup lockout | `client/src/pages/Setup/` (in wizard hook) | On mount, if `setup_complete === true` → `Navigate` to `/login` (covers "user revisits /setup after restart"). |
| i18n | `client/src/locales/en.json`, `ko.json` (edit) | New top-level `setup.*` section; `serverErrors` entries for new codes (`setup.incomplete`, `setup.complete`). |
| MSW | `client/src/mocks/handlers.js` (edit) | Handlers for `/api/setup/*` + updated `/api/settings/public` shape. |

### 5.5 Security notes (document in feature doc)
- Unauthenticated `apply`/`test` exist **only while setup is incomplete** (self-hosted first-run
  exposure class, same as Pi-hole/Nextcloud installers). Mitigations in scope: 403 gate flips
  automatically on completeness; allowlisted keys only; no shell/file-path input; values
  format-validated. `WEA_SETUP_TOKEN` hardening = explicit follow-up, not v1.
- Written `.env` is `0600`; wizard-transmitted secrets are logged nowhere (`server/middleware/requestLogger.js:4-5`
  already never logs request bodies — T4 confirm-only).

## 6. Task Dependency Graph

Legend: `→` = depends on. Parallel tasks may run concurrently (dedicated sub-agents).
Every implementation task includes its unit tests in "Verification" (test framework:
server = jest via `npm run test:ci --workspace server`, client = `npm run test:ci --workspace client`).

- **T0 — Branch + PLAN.md** → done.
- **T1 — Docs batch (GATE; no code before this lands)**
  - Objective: all spec/feature docs updated per AGENTS.md §2.1.
  - Inputs: §2–§5 of this file.
  - Outputs:
    - NEW `docs/features/setup-wizard.md` (feature SoT: flow, gating, two-layer config model, security, restart contract, admin-password semantics per §5.3.3, prod JWT relaxation + setup-mode prod behavior per §5.2.1)
    - NEW `docs/spec/server/routes/setup.md` (status/test/apply from §5.3)
    - NEW `docs/spec/client/pages/Setup.md` (+ service spec section for `setupService`)
    - EDIT `docs/features/client-ui.md` Routing section (add `/setup`, public, redirect rules)
    - EDIT `docs/spec/server/routes/settings.md` (admin GET/PUT currently under-documented + `setup_complete` addition to `/api/settings/public`)
    - EDIT `docs/SETUP.md` (first-run flow: "no .env? the web setup wizard configures it"), `README.md` quickstart, `docs/api.md` endpoint tables, `docs/E2E_COVERAGE_PLAN.md` (ownership row + runtime assumption), `docs/TEST_GIT_GUIDE.md` (running setup project), `docs/TESTING_STRATEGY.md` (new projects), `.env.example` (comment note: wizard may write these keys)
  - Verification: docs review; every doc cross-references a real file path; `prettier --check` clean.
- **T2 — Server: setupStatus validator** (`server/infrastructure/setupStatus.js` + shared error codes) → T1
  - Verification: jest cases — fresh (no env) incomplete w/ exact missing list; full s3+sqlite complete; full pg+webdav complete; prod + default JWT → incomplete; partial `.env` prefill/masking correct.
- **T3 — Server: envPath helper + envFileWriter** → T1
  - Verification: jest — resolution parity with `index.js:10-12` (absolute, relative-to-`__dirname`, default); merge preserves unknown keys & comments-irrelevant lines; upsert replaces existing key in place; unknown-key write rejected; atomic (no partial file on throw); mode 0600.
- **T4 — Server: setup routes + `/api/settings/public` extension** → T2, T3
  - Verification: jest — status shape; apply happy path (sqlite+webdav / pg+s3) writes expected .env lines; apply 403 when complete; apply 400 on bad payload (per-field); test routes pass-through results; request logger does not leak apply body.
- **T5 — Server: boot guard + setup-mode API guard + mount + JWT prod-throw relaxation** (`server/index.js` edits, `server/utils/auth.js` edit per §5.2.1, middleware, `server/domains/setup/routes.js` mount) → T2
  - Verification: jest + manual boot — fresh boot (no env file) stays up, `/api/health` 200, file-domain route 503 `setup.incomplete`, post-listen crash gone; fresh prod boot (`NODE_ENV=production`, no env) reaches `/api/setup/status` instead of crashing; configured boot unchanged. Jest on `auth.js` (§5.2.1): prod + default `JWT_SECRET` + incomplete setup → module loads, warns, no throw; prod + non-default `JWT_SECRET` → unchanged; defense-in-depth throw branch retained when `setup_complete`.
- **T6 — Client: setupService + MSW handlers** → T1 (contract from §5.3/T4 spec)
  - Verification: jest service tests against MSW.
- **T7 — Client: /setup wizard (route, view, hook, i18n en/ko)** → T6
  - Verification: jest page tests with `createMemoryRouter` (per `docs/features/client-ui.md:228-231`): step navigation, connection-test states, apply success → restart screen, complete-state → redirect to /login, masked prefill rendering.
- **T8 — Client: login redirect on incomplete setup** → T7
  - Verification: jest — login page with `setup_complete:false` navigates to `/setup`; with `true` stays.
- **T9 — E2E: setup-wizard spec** (see §7) → T4, T5, T7, T8
  - Verification: `npx playwright test --project=setup-wizard-desktop` (and `-mobile`) green in both `E2E_BACKEND_MODE`.
- **T10 — Integration & regression** → all
  - Pre-task: add a `lint` script to `client/package.json` (currently missing → root `npm run lint` fails at the client step). Then `npm run test:ci --workspace server` && `npm run test:ci --workspace client` && `npm run lint`.
  - Full `npm run test:e2e:s3` then `npm run test:e2e:webdav` (existing 12 specs unaffected + new setup project).
  - Merge to `dev` (NEVER `main`), delete branch, per AGENTS.md §2.2.

Dependency sketch:
```
T1 ─┬─→ T2 ─┬─→ T4 ─┐
    │       └─→ T5 ─┼─→ T9 ─┐
    ├─→ T3 ────────→ T4      │   T10
    ├─→ T6 ─→ T7 ─→ T8 ─────┘───┘
    └─→ (docs only, no code)
Parallel blocks: {T2,T3,T6} → {T4,T5,T7} → {T8, T9-after-T4/T5/T7} → T10
```

## 7. E2E Plan (setup-wizard)

### 7.1 Why not the shared infrastructure
Shared webServer boots fully-configured (`.env.e2e`), globalSetup pre-seeds PG,
`fullyParallel` shares state, and Playwright webServer does not supervise mid-run restarts.
The setup spec must be **hermetic**: own ports, own env file, own scratch data, spec-owned
process lifecycle (restart is the thing under test).

### 7.2 Mechanism (rank-1: dedicated projects + spec-owned scratch instance)
`playwright.config.ts` — **additive only**, zero edits to the 4 wave regexes
(`setup-wizard` name does not appear in them, so mode projects never pick it up):
```ts
{ name: 'setup-wizard-desktop', testMatch: /setup-wizard\.spec\.ts$/,
  use: { browserName: 'chromium', viewport: { width: 1280, height: 720 },
         baseURL: 'http://localhost:5003' } },
{ name: 'setup-wizard-mobile',  testMatch: /setup-wizard\.spec\.ts$/,
  use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
         baseURL: 'http://localhost:5003' } },
```
(`baseURL` override keeps mode projects on :3000.)

`e2e/setup-wizard.spec.ts` (new) + `e2e/helpers/setupScratch.ts` (new):
- **Scratch lifecycle (per test case)**:
  1. `scratch = e2e-data/setup-wizard/<case>/` (global-setup wipes `e2e-data` at start `global-setup.ts:259-263`, teardown at end `global-teardown.ts:101` — free backstop).
  2. Ensure `client/build` exists (`npm run build --workspace client` if absent) — D4.
  3. Spawn server **boot 1**: `node server/index.js`, `cwd: scratch`,
     `env = { PORT: 5003, NODE_ENV: 'test',
              DOTENV_CONFIG_PATH: <scratch>/.env,          // does NOT exist yet → warn branch
              WEA_SQLITE_PATH: <scratch>/webdav.db }`      // isolation keys ONLY — never keys the wizard configures
     `cwd=scratch` makes the fallback bare `dotenv.config()` look in scratch, so a developer's
     root `.env` can never leak in. Poll `http://127.0.0.1:5003/api/health`.
  4. Drive wizard on `:5003` (UI served statically by the same process).
  5. Assert `<scratch>/.env` contents (exact keys/values).
  6. **Kill child → respawn same command (boot 2)** — `.env` now exists; health poll again.
  7. Login with the wizard-chosen admin; upload+download round-trip; visit `/setup` → redirected to `/login`.
  8. `afterEach` (finally): kill child unconditionally, remove scratch, drop scratch PG DB if used.
- **Case matrix**:
  | Case | Metadata | Blob | Gate | Notes |
  |------|----------|------|------|-------|
  | 1 | sqlite | webdav (bytemark `:8090`, MKCOL into `/setup-e2e/` subtree) | both modes | webdav container is always-up in e2e |
  | 2 | sqlite | s3 (MinIO `:9010`) | `s3` mode only (`test.skip` pattern per `s3-pg-integration.spec.ts:137-139`) | assert `S3_*` keys written |
  | 3 | **postgresql** (create scratch DB `webdav_e2e_setup` on the e2e PG via a **new** scratch-DB helper — existing `helpers/pg.ts` is a read-only query helper against the shared `webdav_e2e` DB; webdav blob) | both modes | after restart assert `_schema_migrations` + users (admin via `ADMIN_DEFAULT_PASSWORD`) in scratch DB; scratch sqlite holds only the boot-time default admin — the wizard's PG apply never seeds the wizard admin into sqlite | |
  | 4 (security) | complete-state gate | both modes | after a completed case: `POST /api/setup/apply` → 403; `/setup` → redirect; file APIs work | |
- `test.describe.configure({ mode: 'serial' })`; npm scripts already run `--workers=1`.
- New shared-server on :5002 and CRA client on :3000 still boot for the run (config-level
  webServer) — harmless; the setup projects simply don't use them.

### 7.3 Docs touched by T9
`docs/E2E_COVERAGE_PLAN.md` (ownership rows for cases 1–4, runtime assumption: scratch
instance on :5003, sqlite/PG-scratch isolation), `docs/TEST_GIT_GUIDE.md` (run commands:
`npx playwright test --project=setup-wizard-desktop`), `docs/TESTING_STRATEGY.md`.

## 8. Success Criteria (observable)
1. No `.env` + clean state: `npm run dev` → server stays up (no crash), browser lands on `/setup` (via login redirect), all three connection tests functional, apply → `<root>/.env` created `0600` with expected keys.
2. After manual restart: `/api/health` ok; login with wizard-chosen admin works; file upload/download works; `/setup` redirects to `/login`; `POST /api/setup/apply` now 403.
3. Pre-configured install (full `.env`): `/setup` never shown, login flow byte-identical, existing e2e suite passes unmodified.
4. Container-style boot (env injected, no `.env` file): `setup_complete` true, wizard skipped, `.env` never created.
5. `npm run test:ci` green in `server/` and `client/`; `npm run lint` green; `npm run test:e2e:s3` and `npm run test:e2e:webdav` green including `setup-wizard-*` projects.

## 9. Risks & Mitigations
| Risk | Mitigation |
|------|-----------|
| Unauthenticated apply surface | auto 403-on-complete gate; allowlist+format validation; 0600; documented in feature doc; token hardening deferred |
| e2e cross-contamination (shared PG/ports/`data/`) | hermetic scratch (own port 5003 — client pinned to 3000, 3001 unused; own sqlite path, own scratch PG DB, own .env) — §7.2 |
| Require-time frozen consts (JWT etc.) | design accepts restart (D2); apply response + restart screen make it explicit |
| Fresh prod install unreachable (JWT require-time throw at `auth.js:10-12`) | **RESOLVED (D7)** — throw relaxed to a warning in setup mode (§5.2.1, implemented in T5); setup-mode API guard keeps file/admin-write routes blocked; prod throw retained when setup complete (defense-in-depth). Behavior change: complete-but-JWT-missing prod install boots into setup mode (warn) instead of crashing |
| Root `.env` clobber on a dev machine | writer preserves unknown keys (merge, not replace); backup file `<envPath>.bak-<ts>` written on apply (T3) |
| Request logger leaking secrets | Already non-issue: `requestLogger` never logs request bodies; T4 confirm-only |
| e2e duration growth (+~2–4 min/mode) | serial within project, workers=1 unchanged; acceptable P0 cost (D5) |

## 10. Commit Conventions (for execution phase)
- `docs:` commit(s) for T1 (body: Why/What/Impact — non-trivial).
- Impl commits per task area: `feat: …` with Why/What/Impact body; lowercase imperative,
  matching `git log --oneline -20` style.
- Merge: feature → `dev` only, after all T10 gates; `main` untouched (CI/CD PR flow).

## 11. Progress Log
- 2026-08-28: T0 done — branch created from `dev` (0914896), this PLAN.md written. No implementation started.
- 2026-08-28: PLAN.md reviewed against codebase — corrected §3.1, §3.3, §4, §5.1, §5.2, §5.3, §5.5, §7.2, §9, §10; opened the production-boot decision (§9).
- 2026-08-28: D7 confirmed by user — production JWT throw relaxation detailed in §5.2.1 (implemented in T5); §9 risk row resolved, decisions table + §5.1/§5.2/T1 updated.
- 2026-08-28: T9 done — e2e setup-wizard spec green in both modes both projects (s3 4/4, webdav 3+1 skip). Case 3 wording corrected (empirical finding: boot-time sqlite seeds a default admin first; the intent-preserving assertion is that the wizard's PG apply never seeds the wizard admin into sqlite). Also fixed a real prefill bug in the wizard (EMAIL_PORT '' would break apply when SMTP unset).
  (Entries to be appended per completed task: task id, evidence of verification, commit hash.)
