# PLAN — External Exposure Hardening: Setup / Migration

Status: NOT STARTED (awaiting start command).
Branch: `feature/setup-migration-exposure-hardening` (base: `dev`).
Docs language: English (repo-wide convention).

## 1. Objective

Close the external-exposure windows around the setup and migration surfaces of a
network-published instance:

- **Setup (WS1 + WS2-cli + WS3):** a fresh (`setup_complete === false`) server must NEVER
  listen on a non-loopback interface, so `/setup` and its unauthenticated write endpoints
  cannot be reached from outside at all. Operators who cannot use a browser on/next to the
  host complete first-run configuration with a new **CLI setup tool** (no remote-wizard
  token gate — dropped by user decision).
- **Migration (WS4):** regular users must not be pushed onto the operator `/migration` page;
  they see a generic public `/maintenance` screen. Public endpoints leak no operational
  metadata (job id/type/timing).
- **Docs (WS3):** operator/reverse-proxy guidance documents all of the above.

Future (out of scope, recorded): splitting admin/operator surfaces into a separate build/app.

## 2. Scope

In scope:

1. Setup-mode loopback-only binding (no opt-out) — WS1.
2. CLI first-run setup tool (shared apply core extracted from the setup routes) — WS2-cli.
3. Operator/ops docs: three setup paths, no-browser path, reverse-proxy hardening — WS3.
4. Migration UX split: public `/maintenance` vs admin `/migration`; minimal public status;
   503 body cleanup — WS4.
5. Docs-first updates for every affected doc, unit tests, lint/format, server tests, e2e core
   green, merge to `dev`.

Out of scope (explicitly NOT part of this work):

- `WEA_SETUP_TOKEN` setup-token gate (cancelled by user; WS1 loopback + CLI replace it).
- Separate admin/operator SPA or app split — recorded as future work only.
- Migration-related admin _authorization_ changes (already token + DB-admin enforced).
- Any change to the `admin`/`admin` default-credential bootstrap itself.

## 3. Key Components (current state, evidence)

- SPA fallback serves `index.html` for every non-`/api` GET — `server/index.js:205-214`
  (WS1 makes setup-mode unreachable at the listener instead).
- `app.listen(port)` with no host → all interfaces — `server/index.js:356-360`;
  `bootStatus.setup_complete` computed in the same boot scope — `server/index.js:249`.
- Setup domain is a single routes module with inline logic:
  `server/domains/setup/routes.js` — validation (`validateApplyPayload`), env building
  (`buildEnvEntries`), T0/DB partition (`partitionEntries`), secret mask handling, admin
  password update (`updateAdminPassword`), DB settings write (`writeSettings`), master-key
  lifecycle. Route tests: `server/domains/setup/__tests__/setup.test.js`.
- Setup status is derived, not stored: `server/infrastructure/setupStatus.js`
  (`computeSetupStatus`); status endpoint `GET /api/setup/status` public.
- Config source resolution / registry: `server/infrastructure/configRegistry.js`
  (`isT0`, `isSecret`, `getDefault`, `TIER`), `configResolver.js`, `envFileWriter.js`
  (`writeEnv`), `envPath.js` (`resolveEnvPath`).
- Migration gate: `server/infrastructure/migrationGate.js`; public
  `GET /api/migration/status` returns full gate status — `server/domains/admin/routes/migrationStatus.js:26-28`;
  503 body carries `params: { type, jobId }` — `server/index.js:128-134`.
- Client: routes in `client/src/App.js:68-108` (`/setup`, `/migration` public);
  `client/src/pages/Migration/MigrationGuard.js` force-redirects all (except `/login`) to
  `/migration` while active; `MigrationPage.js` polls public status and admin job endpoint.
- No app `Dockerfile` in repo (only `docker-compose.e2e.yml` for MinIO/WebDAV e2e
  dependencies); server has no prompt library — CLI will use Node `readline`/flags only.

## 4. Workstreams and Tasks

> Docs-first (Task 1) precedes all code. Tasks in the same workstream are sequential; the
> three workstreams are independent of each other after Task 1.

### Workstream 1 — Docs-first + Ops guide (WS3)

**Task 1 — Docs updates (WS3 + pre-docs for WS1/WS2-cli/WS4).**

- Objective: update all affected docs BEFORE any code edit.
- Files (verify each exists and update): `docs/features/setup-wizard.md` (Security section:
  replace deferred `WEA_SETUP_TOKEN` text with loopback-only + CLI; new "no browser" path),
  `docs/SETUP.md` (Security and Initial Admin Setup §5 + env reference: setup-mode loopback
  binding; three setup paths — local browser / SSH tunnel / CLI; headless no-browser
  env-only or CLI path; container note), `docs/features/migration-mode.md` + the
  `docs/spec/server/infrastructure/migrationGate.md` status contract (`public {active}`,
  admin-full; `/maintenance` for non-admins), any `docs/spec/client/pages/*` setup/migration
  page specs, `docs/features/client-ui.md` redirect chain if present, `.env.example` if it
  lists setup-related vars, `docs/IMPROVEMENT_PLAN.md` (future-work: admin-app split).
- New file: CLI setup tool spec `docs/features/setup-cli.md` (or under `docs/features/`)
  describing commands, flags, and the reuse of the wizard apply core.
- Expected output: all behavior contracts (WS1 bind rule, WS2-cli commands, WS4 public/admin
  status shapes) fixed in docs; the earlier e2e-relevant doc rows (`E2E_COVERAGE_PLAN.md`)
  annotated if a spec changes observable behavior.
- Verification: grep the doc set for stale `WEA_SETUP_TOKEN`/force-redirect claims; reviewer
  reads; no code touched.
- Dependencies: none.

### Workstream 2 — WS1: loopback-only setup-mode binding (server)

**Task 2 — Force loopback bind while setup is incomplete.**

- Objective: when `setup_complete === false`, `app.listen` binds `127.0.0.1` only
  (no opt-out). When complete, current behavior (all interfaces) is preserved so reverse
  proxies keep working.
- Inputs: `server/index.js:249` boot status + `server/index.js:356-360` listen site.
- Expected: `app.listen(port, bootStatus.setup_complete ? undefined : '127.0.0.1', cb)`
  (or explicit `process.env.HOST` when complete if later added — none today) plus a
  self-test/unit assertion that the chosen host is loopback in setup mode.
- Verification: server boots in setup mode → netstat/lsof shows `127.0.0.1`; complete
  (`.env` populated) → `0.0.0.0`; existing route tests green.
- Dependencies: Task 1 (behavior contract documented).

### Workstream 3 — WS2-cli: CLI first-run setup tool (server)

**Task 3 — Extract shared setup apply core from the setup routes.**

- Objective: move `validateApplyPayload`, `buildEnvEntries`, `partitionEntries`, secret-mask
  normalization, `writeSettings`/`updateAdminPassword` orchestration (the `POST /apply`
  handler body, minus HTTP bits) into a shared module the HTTP route AND the CLI both call,
  without behavior change.
- Inputs: `server/domains/setup/routes.js` (validation/apply/prefill blocks),
  `server/domains/setup/__tests__/setup.test.js` (existing contract tests).
- Expected: new `server/domains/setup/setupCore.js` (naming per repo conventions) exporting
  the pure validators/builders + `applySetup(payload)`; routes.js becomes a thin handler;
  existing setup route tests stay green (they assert the HTTP behavior unchanged).
- Verification: `npm run test --workspace server -- routes/setup` (or the setup test path)
  passes; no HTTP contract change.
- Dependencies: Task 1.

**Task 4 — CLI tool `server/scripts/setup.js`.**

- Objective: first-run configuration from the terminal on the host, mirroring the wizard:
  preflight status check (refuse when already complete), optional connection test (parity
  with `POST /api/setup/test` / `runProbe`), then apply (parity with `POST /api/setup/apply`:
  `.env` T0 write via `writeEnv`, admin password, DB settings upsert under the master key,
  `restart_required` guidance). Flags-driven non-interactive mode (+ optional `readline`
  interactive mode); `--help`. Boots the app store/resolver the same way
  `server/index.js` does (`initMetadataStore`/`Settings`/`createConfigResolver`/`loadAll`)
  so PG (env-owned) and sqlite (no-env) metadata both work.
- Inputs: Task 3 core; `server/index.js:240-266` store-boot sequence as reference;
  `server/scripts/migrateBlobs.js` as the CLI-style precedent.
- Expected: runnable `node server/scripts/setup.js`; exits non-zero on invalid input/refusal;
  prints clear next steps. Note in SETUP.md.
- Verification: unit/integration test covering flag parsing, validation refusals,
  already-complete refusal, and an apply that flips `computeSetupStatus` to complete on a
  throwaway sqlite DB.
- Dependencies: Task 3.

### Workstream 4 — WS4: migration surface split + exposure reduction

**Task 5 — Server: minimal public status, admin-full status, 503 cleanup.**

- Objective: unauthenticated `GET /api/migration/status` returns `{ active }` only; the same
  endpoint (or a designated admin endpoint) returns the full `{ active, type, jobId,
startedAt }` only to a valid admin token; the migration-gate 503 body no longer carries
  `type`/`jobId` (verify nothing besides the admin client needs them).
- Inputs: `server/domains/admin/routes/migrationStatus.js`, `server/index.js:110-136`
  (gate + allow-list), `server/infrastructure/migrationGate.js`.
- Expected: public response shape `{ active }`; admin consumers (client `/migration` page,
  app-guard) get full data only via an admin-authenticated request.
- Verification: server tests asserting anonymous body is `{ active }`, admin body is full,
  503 params removed; existing e2e migration/admin-config specs adjusted where they assert
  the old shapes.
- Dependencies: Task 1.

**Task 6 — Client: `/maintenance` (public) vs `/migration` (admin); role-aware guard.**

- Objective: new public `MaintenancePage` (generic, no operational metadata) shown to
  non-admin/anonymous sessions while the gate is active; authenticated admins go to
  `/migration` as today. MigrationGuard decision becomes role-aware (needs the session
  user's `is_admin` at guard scope — verify where the session user lives relative to the
  guard in `client/src/App.js` and plumb accordingly). `/migration` page requires an admin
  session (its data calls already 401 otherwise) and reads full status/jobId through the
  admin-authenticated path added in Task 5.
- Inputs: `client/src/pages/Migration/MigrationGuard.js`, `MigrationPage.js`,
  `client/src/App.js`, auth/session hook + service, i18n files.
- Expected: during a migration an anonymous/normal user lands on a generic maintenance
  screen (no `/migration`), an admin lands on `/migration`; `/login` stays reachable so an
  expired admin can re-authenticate and reach `/migration`.
- Verification: client tests + e2e assertions updated (regular-user redirect → maintenance
  page; admin → `/migration`); mobile/desktop e2e migration scenarios stay green.
- Dependencies: Task 5.

### Workstream 5 — Verification + merge

**Task 7 — Full verification.**

- Objective: lint/format clean, server unit+integration tests, client tests, e2e core +
  migration/admin-config hermetic projects green in both backend modes where applicable.
- Inputs: repo scripts `npm run lint:ci`, `npm run format:check`, workspace `test:ci`
  (client/server), e2e commands per `package.json`.
- Dependencies: Tasks 2, 4, 6.

**Task 8 — Merge to `dev`.**

- Switch to `dev`, merge the feature branch after Task 7 is green, delete the branch.
  Never merge to `main` (CI/CD owner: user).
- Dependencies: Task 7.

## 5. Success criteria

- A server booted with no `.env` (or an incomplete one) is reachable only on `127.0.0.1`;
  no env flag or request can make `/api/setup/*` reachable on a non-loopback interface.
- A headless operator can complete first-run configuration on the host via the CLI
  (`setup.js`) or a full `.env`; the wizard remains available only from localhost / SSH
  tunnel.
- During an active migration, anonymous and regular users land on the generic
  `/maintenance` page; only an authenticated admin sees `/migration` progress. Public
  endpoints and 503 bodies expose no `type`/`jobId`/timing data.
- Docs (setup-wizard, SETUP.md, migration-mode, migrationGate spec, new setup-cli doc)
  describe the final contracts; no stale `WEA_SETUP_TOKEN` or force-redirect claims remain.
- Admin-app separation recorded as future work in the docs.
- lint/format clean; server/client tests + affected e2e green; merged to `dev`.

## 6. Progress log

- 2026-09-02: Scope decisions with user — dropped the `WEA_SETUP_TOKEN` remote-wizard gate
  entirely; setup-incomplete servers ALWAYS bind `127.0.0.1` (no opt-out) and a CLI setup
  tool covers the no-local-browser case. WS4 proceeds as recommended (public `/maintenance`
  - admin `/migration`, minimal public status); full admin/operator app split recorded as
    future work only. Branch created. This plan written.
- 2026-09-02: Task 1 (docs-first) done — `docs/features/setup-wizard.md` Security section
  rewritten (loopback-only + CLI; deferred `WEA_SETUP_TOKEN` text removed), new "Network
  exposure (loopback-only binding)" section, mermaid flow + API table + client summary +
  testing anchors updated; `docs/SETUP.md` §5 rewritten with the three setup paths, env-only
  first run, reverse-proxy hardening checklist, migration `/maintenance` note, §2 note box
  updated; `docs/features/migration-mode.md` role-aware lock UX (`/maintenance` vs
  `/migration`), API table public `{active}` / admin-full, 503-no-metadata, testing anchors,
  future-work note; `docs/spec/server/infrastructure/migrationGate.md` contract updated
  (auth-optional status, 503 body without params); `docs/ARCHITECTURE.md` wording; new
  `docs/features/setup-cli.md`. Next: parallel implementation — Task 2 (WS1 bind), Task 3
  (setup core extraction), Task 5 (WS4 server).
- 2026-09-02: Implementation complete. (1) WS1: `server/infrastructure/listenConfig.js`
  `resolveListenHost` + index.js loopback bind while `!setup_complete` (log shows bind) + unit
  tests. (2) WS4 server: `migrationStatus.js` auth-optional status (anonymous `{active}` /
  admin full), index.js 503 body drops `params {type,jobId}`; migration.test.js extended.
  (3) WS2 core: `server/domains/setup/setupCore.js` (validators + `applySetup`), routes.js
  thin, setup tests 51 passed. (4) WS4 client: `MaintenancePage` + `/maintenance` route,
  role-aware `MigrationGuard` (admin → /migration, others → /maintenance), i18n en/ko,
  MigrationGuard tests rewritten; full client suite 1397 passed. (5) CLI:
  `server/scripts/setup.js` (interactive + flags + `--status` + `--check`, env/store boot
  parity, refusal when complete) + 13 hermetic tests passed; doc reconciled (exit codes, TTY
  secret-prompt exception, `--s3-secret-key` alias, `--check` backend source). (6) e2e fix:
  `e2e/migration.spec.ts` status polls now send the admin bearer header (4 sites; one token
  hoisted); no other spec affected.
- 2026-09-02: VERIFICATION GREEN. `lint:ci` clean (one React-version config notice),
  `format:check` clean. Server full suite `jest --ci` → 87 suites / 1658 passed / 5 skipped.
  Client full suite → 156 suites / 1397 passed. Targeted hermetic e2e
  (`migration-desktop` + `setup-wizard-desktop`, docker MinIO/WebDAV/PG up) → 12 passed.
  Full-wave e2e runs (core + later-waves, both backend modes) not executed locally — deferred
  to CI on merge. Next: Task 8 (merge to `dev`).
- 2026-09-02: E2E-MIG-009 added (`e2e/migration.spec.ts` after E2E-MIG-003; describe/header
  range → 001..009; inventory row + ownership flow range A–F in `docs/E2E_COVERAGE_PLAN.md`).
  Flow F role-aware gate hold: admin stays on `/migration`; regular user and anonymous visitor
  are routed to the new public `/maintenance` page (gate held via the Flow C tarpit dry-run
  pattern). Fresh `client/build` rebuilt before the run. Verified: targeted
  `--project=migration-desktop -g "E2E-MIG-009"` → 1 passed; full `migration-desktop` serial
  suite → 9 passed. Next: Task 8 (merge to `dev`).
- 2026-09-02: Maintenance page UX change (user): removed the "Operator sign in" button; an
  authenticated session now gets a plain "Log out" link (`maintenance` page uses `nav.logout`,
  `logout()` + `/login`), anonymous visitors get no action; i18n `maintenance.operatorSignIn`
  keys removed; docs `migration-mode.md` role-aware section updated. Client unit tests
  rewritten (4 cases) and green; E2E-MIG-009 assertions updated (regular-user → "Log out"
  link, anonymous → no action); fresh `client/build`; targeted e2e `E2E-MIG-009` → 1 passed.
  Next: Task 8 (merge to `dev`).
- 2026-09-02: Docs↔code consistency audit (sub-agent). All implementation claims MATCH. Doc
  drift fixed: migrationGate.md 503 body spec now `{ errorCode, messageCode, message }`
  (no retryAfter/params) in §2.5 row + §2.7 + migration-mode.md; routes/setup.md apply
  section rewritten to the real `setupCore.applySetup` flow (removes the pre-D7 PG
  direct-write/`ADMIN_DEFAULT_PASSWORD` steps; `.env` gets `JWT_SECRET` +
  auto-generated `encrypt_secret_key` only, metadata T0 keys never written);
  setup-wizard.md Admin-password semantics + Two-layer model corrected (no PG branch, no
  `ADMIN_DEFAULT_PASSWORD` by apply); SETUP.md §2 wizard note fixed (metadata connection
  env-owned, never wizard-written); client-ui.md routing list + setup-wizard/Setup page-spec
  `App.js:64-98` → `App.js:69-105` refs. Code note left open (non-behavioral):
  `envFileWriter` allowlist still lists metadata T0 keys even though apply never emits them.
  Next: Task 8 (merge to `dev`).
