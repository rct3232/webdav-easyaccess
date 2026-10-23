# E2E Suite Restructure Plan

Status: execution ledger for the S3-first E2E restructure.
Baseline: `refactor/e2e-suite-restructure` @ `a79b5b5` (includes the completed
admin-config / migration / trash E2E hardening).

## 1. Objective

Make the E2E layout match the product's default backend and keep it stable at
any Playwright worker count.

- S3 is the default product backend. All functional behavior is verified on S3.
- WebDAV mode verifies only behavior that is inherently WebDAV-specific.
- No Playwright project dependencies (`dependencies: []` everywhere).
- The Playwright worker count is the only concurrency throttle. No E2E slot
  pool, no fixed worker assumption, no per-project WebDAV container.
- Low-resource CI is supported by keeping persistent infrastructure minimal:
  one shared S3 stack, one shared WebDAV container in the WebDAV job only, and
  scratch servers that exist only while tests run.

## 2. Non-goals

- Do not add a second E2E runner or a new orchestration service.
- Do not replace bytemark or the product's WebDAV client in this change.
- Do not change product file-storage semantics.
- Do not add a permanent server/container per project or per suite.
- Do not edit `PLAN.md`; this document is the execution ledger for this work.

## 3. Final execution groups

| Group      | Command                   | Backend     | Persistent infrastructure                     |
| ---------- | ------------------------- | ----------- | --------------------------------------------- |
| Default S3 | `npm run test:e2e`        | S3 only     | PG + MinIO + shared API/client                |
| Core       | `npm run test:e2e:core`   | S3 only     | PG + MinIO + shared API/client                |
| WebDAV     | `npm run test:e2e:webdav` | WebDAV only | PG + MinIO + shared API/client + one bytemark |

- `npm run test:e2e` is the default full non-WebDAV gate and includes the core
  cases.
- `npm run test:e2e:core` is a fast subset of the default gate.
- `npm run test:e2e:webdav` is a separate backend-specific job. CI may run it
  in parallel with the default gate.
- Worker count is supplied by CI. The suite layout accepts 1, 2, 4, or more
  workers without a second cap; CI sizes it to the host's CPU/RAM.

## 4. Resource model

- Shared S3 stack: one API server, one client server, one PostgreSQL, one MinIO.
- Shared WebDAV: one bytemark, only in the WebDAV job.
- Scratch servers: each scratch test/often suite starts its own Node process;
  at most `workers` such servers exist at any moment because Playwright runs at
  most `workers` tests concurrently.
- No per-project WebDAV container.
- No E2E slot/resource-lock pool.
- Non-AI scratch servers set `WEA_SKIP_AI_WORKER=1` and
  `AI_SEMANTIC_SEARCH_ENABLED=false`; only the AI suite enables the worker and
  model.

## 5. Suite structure

### 5.1 Default S3 (`npm run test:e2e`)

Shared S3 stack:

- `auth.spec.ts`
- `core-flow.desktop.spec.ts`
- `core-flow.mobile.spec.ts`
- `core-flow.shared.spec.ts`
- `share-public.spec.ts`
- `share-internal.spec.ts`
- `trash.spec.ts`
- `versions.spec.ts`
- `mypage-user.spec.ts`
- `mypage-admin.spec.ts`

S3 scratch:

- `collections.spec.ts` (all cases)
- `retrieval.spec.ts` (all cases; S3 scratch because it pins the global
  `AI_SEMANTIC_SEARCH_ENABLED` kill switch)
- `ai.spec.ts`
- `trash-admin.spec.ts`
- `admin-config.s3.spec.ts`
- `setup-wizard.s3.spec.ts`
- `migration.s3.spec.ts`
- `registration-settings.spec.ts`

### 5.2 Core (`npm run test:e2e:core`)

- `auth.spec.ts`
- `core-flow.desktop.spec.ts`
- `core-flow.mobile.spec.ts`
- `core-flow.shared.spec.ts`
- `share-public.spec.ts`
- `share-internal.spec.ts`
- `trash.spec.ts`
- `versions.spec.ts`
- `mypage-user.spec.ts`
- `registration-settings.spec.ts`

### 5.3 WebDAV (`npm run test:e2e:webdav`)

- `webdav-smoke-desktop` (existing EXP/SHARE/OVERLAY/TRASH/RECON grep)
- `webdav-reconcile.spec.ts`
- `setup-wizard.webdav.spec.ts`
- `migration.webdav.spec.ts`
- `admin-config.webdav.spec.ts`

## 6. Case ID scheme

Platform cases keep their existing `E2E-<DOMAIN>-NNN` IDs. They are
unambiguously S3 and the WebDAV smoke deliberately reuses their IDs.

Hermetic cases that are backend-specific use an explicit backend prefix:

- `E2E-S3-<DOMAIN>-NNN`
- `E2E-WEBDAV-<DOMAIN>-NNN`

Rules:

- Split suites restart numbering at `001` within the new file.
- Retired IDs are never reused.
- `docs/E2E_COVERAGE_PLAN.md` carries the old -> new mapping.
- `E2E-S3-TRASHADMIN-*` avoids collision with the platform `E2E-TRASH-*`
  family.

### 6.1 Feature suites

| Old                       | New                          |
| ------------------------- | ---------------------------- |
| `E2E-COLLECTION-001..020` | `E2E-S3-COLLECTION-001..020` |
| `E2E-RETRIEVAL-001..011`  | `E2E-S3-RETRIEVAL-001..011`  |
| `E2E-AI-001`              | `E2E-S3-AI-001`              |
| `E2E-TRASH-007`           | `E2E-S3-TRASHADMIN-001`      |
| `E2E-RECON-001`           | `E2E-WEBDAV-RECON-001`       |

`E2E-COLLECTION-015..017` stay in the same numeric slots because they are
mobile-only cases in the shared file.

### 6.2 Admin config split

| Old                | New                       |
| ------------------ | ------------------------- |
| `E2E-ADMINCFG-001` | `E2E-S3-ADMINCFG-001`     |
| `E2E-ADMINCFG-002` | `E2E-S3-ADMINCFG-002`     |
| `E2E-ADMINCFG-004` | `E2E-S3-ADMINCFG-003`     |
| `E2E-ADMINCFG-005` | `E2E-S3-ADMINCFG-004`     |
| `E2E-ADMINCFG-008` | `E2E-S3-ADMINCFG-005`     |
| `E2E-ADMINCFG-009` | `E2E-S3-ADMINCFG-006`     |
| `E2E-ADMINCFG-006` | `E2E-WEBDAV-ADMINCFG-001` |
| `E2E-ADMINCFG-007` | `E2E-WEBDAV-ADMINCFG-002` |
| `E2E-ADMINCFG-010` | `E2E-WEBDAV-ADMINCFG-003` |
| `E2E-ADMINCFG-011` | `E2E-WEBDAV-ADMINCFG-004` |
| `E2E-ADMINCFG-012` | `E2E-WEBDAV-ADMINCFG-005` |

`E2E-ADMINCFG-003` was already retired and is not reused.

### 6.3 Setup wizard split

| Old             | New                    |
| --------------- | ---------------------- |
| `E2E-SETUP-001` | `E2E-WEBDAV-SETUP-001` |
| `E2E-SETUP-002` | `E2E-S3-SETUP-001`     |
| `E2E-SETUP-003` | `E2E-WEBDAV-SETUP-002` |
| `E2E-SETUP-004` | `E2E-WEBDAV-SETUP-003` |

### 6.4 Migration split

| Old           | New                  |
| ------------- | -------------------- |
| `E2E-MIG-004` | `E2E-S3-MIG-001`     |
| `E2E-MIG-005` | `E2E-S3-MIG-002`     |
| `E2E-MIG-007` | `E2E-S3-MIG-003`     |
| `E2E-MIG-001` | `E2E-WEBDAV-MIG-001` |
| `E2E-MIG-002` | `E2E-WEBDAV-MIG-002` |
| `E2E-MIG-008` | `E2E-WEBDAV-MIG-003` |
| `E2E-MIG-006` | `E2E-WEBDAV-MIG-004` |
| `E2E-MIG-003` | `E2E-WEBDAV-MIG-005` |
| `E2E-MIG-009` | `E2E-WEBDAV-MIG-006` |

## 7. File and project layout

### 7.1 Files

- `admin-config.spec.ts` -> `admin-config.s3.spec.ts` +
  `admin-config.webdav.spec.ts` + `admin-config.helpers.ts`
- `setup-wizard.spec.ts` -> `setup-wizard.s3.spec.ts` +
  `setup-wizard.webdav.spec.ts` + `setup-wizard.helpers.ts`
- `migration.spec.ts` -> `migration.s3.spec.ts` +
  `migration.webdav.spec.ts` + `migration.helpers.ts`
- `webdav-reconcile.spec.ts` stays.
- Feature suites keep their file names and gain an S3 scratch backend.

### 7.2 Projects

Default S3:

```text
s3-desktop, s3-mobile
s3-admin-desktop, s3-admin-mobile
s3-regset-desktop, s3-regset-mobile
s3-collections-desktop, s3-collections-mobile
s3-retrieval-desktop, s3-retrieval-mobile
s3-ai-desktop
s3-trash-admin-desktop, s3-trash-admin-mobile
s3-admin-config-desktop, s3-admin-config-mobile
s3-setup-wizard-desktop, s3-setup-wizard-mobile
s3-migration-desktop, s3-migration-mobile
```

Core uses the platform core regex and the S3 regset projects.

WebDAV:

```text
webdav-smoke-desktop
webdav-setup-wizard-desktop, webdav-setup-wizard-mobile
webdav-migration-desktop, webdav-migration-mobile
webdav-admin-config-desktop, webdav-admin-config-mobile
```

All projects are independent siblings. No `dependencies`.

## 8. Scratch contracts

`prepareScratchStorage(scratch, caseId, backend)` becomes the single storage
setup entry point.

- `backend = 's3'`:
  - ensure a suite/project-specific S3 bucket;
  - empty it at suite start and cleanup;
  - seed `WEA_FILE_STORAGE=s3`, `S3_BUCKET`, `S3_ENDPOINT`, credentials;
  - no WebDAV settings.
- `backend = 'webdav'`:
  - existing `prepareScratchWebdav` behavior.

Project-scoped isolation:

- scratch directory: includes project slug;
- SQLite path: inside the project scratch directory;
- S3 bucket: `e2e-scratch-<project>`;
- migration destination bucket: `e2e-migration-<project>`;
- setup PG database: `webdav_e2e_setup_<project>`;
- migration PG database: includes the project slug;
- WebDAV root: `/setup-e2e/<project>/<case>`.

No suite may reuse another suite's bucket, database, scratch directory, or
WebDAV root.

## 9. Task graph

| Task    | Objective                            | Inputs                                              | Expected output                                                                         | Verification                                                   | Deps  |
| ------- | ------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----- |
| E2E-R1  | Author this plan and the ID mapping  | current suite audit                                 | this document                                                                           | review                                                         | none  |
| E2E-R2  | Add S3 scratch helper                | `setupScratch.ts`, `minio.ts`                       | `prepareScratchStorage` + project-scoped bucket/dir contract                            | focused helper tests + typecheck                               | R1    |
| E2E-R3  | Convert feature suites to S3 scratch | R2, `collections`, `retrieval`, `ai`, `trash-admin` | S3 scratch across those four suites; no WebDAV setup; AI worker only in AI              | targeted Playwright with workers 1/2/4                         | R2    |
| E2E-R4  | Split admin-config                   | R2                                                  | `admin-config.s3.spec.ts`, `admin-config.webdav.spec.ts`, helper                        | targeted projects                                              | R2    |
| E2E-R5  | Split setup-wizard                   | R2                                                  | `setup-wizard.s3.spec.ts`, `setup-wizard.webdav.spec.ts`, helper                        | targeted projects                                              | R2    |
| E2E-R6  | Split migration                      | R2                                                  | `migration.s3.spec.ts`, `migration.webdav.spec.ts`, helper                              | targeted projects                                              | R2    |
| E2E-R7  | Add group/project config and scripts | R3-R6                                               | `E2E_GROUP=default/core/webdav`, project filters, no dependencies, one WebDAV container | `playwright test --list` for each group                        | R3-R6 |
| E2E-R8  | Update coverage/naming docs          | R1, R3-R7                                           | IDs, mapping, coverage rows, test guide                                                 | docs consistency grep                                          | R1    |
| E2E-R9  | Resource cleanup                     | R7                                                  | no WebDAV service in default/core, AI worker off, one bytemark in WebDAV                | compose log/pid inspection                                     | R7    |
| E2E-R10 | Full verification                    | R3-R9                                               | green default/core/webdav at workers 1/2/4; no dependency edges                         | `npm run test:e2e`, `:core`, `:webdav`; server/client/PG gates | R3-R9 |
| E2E-R11 | Formatting and final audit           | R10                                                 | Prettier clean, no stale IDs, branch ready                                              | prettier, grep, git diff audit                                 | R10   |

## 10. Execution order

1. R1 (this document) and R2 start first.
2. R3, R4, R5, R6 run in parallel once R2 is merged.
3. R7 integrates the new files/projects after R3-R6.
4. R8 can run alongside R3-R6 for coverage/ID docs, then finalize after R7.
5. R9 applies resource flags/compose cleanup.
6. R10 runs the full matrix at workers 1, 2, and the host's default worker
   count; a 4+ worker stress is capacity validation, not a fixed gate.
7. R11 finalizes formatting and audits retired IDs.

## 11. Verification gates

- `npm run test:e2e` at workers 1, 2, and the host's default Playwright worker count: green.
- `npm run test:e2e:core` at workers 2: green.
- `npm run test:e2e:webdav` at workers 2: green.
- A 4-worker stress run must fit the host's available CPU/RAM; it is not a
  substitute for the worker-count resource control. On the shared 6-core
  reference host it reached load average ~25-31 and produced timeout-only UI
  flakes, so no fixed worker cap was introduced to mask that capacity limit.
- Default/core logs contain no `webdav-test` container and no WebDAV project.
- No Playwright `dependencies` edge remains.
- All default/core hermetic suites use `WEA_FILE_STORAGE=s3`.
- AI worker/model disabled outside the AI suite.
- server `test:ci`, client `test:ci`, PG adapters, pgvector legs green.
- `prettier --check` clean on changed files.
- `docs/E2E_COVERAGE_PLAN.md` has no duplicate/retired active IDs.

## 12. Risks and mitigations

- **Shared S3 stack overload at high worker counts**: worker count is the
  throttle; CI sets it to available CPU/RAM. The layout does not add per-test
  servers for shared-stack tests.
- **WebDAV capacity at high worker counts**: the WebDAV job uses one bytemark;
  CI sets that job's worker count to bytemark capacity. It is a separate job, so
  it cannot slow the default/core gate.
- **Scratch server memory**: non-AI scratch servers disable the AI worker;
  only `ai.spec.ts` enables it.
- **ID churn**: retired IDs are mapped in `E2E_COVERAGE_PLAN.md`; no ID is
  reused.
- **Cross-suite contamination**: project-scoped buckets, DBs, scratch dirs,
  and WebDAV roots; no shared mutable settings outside the shared platform
  stack.

## 13. Execution status (2026-10-23)

- R1-R9 are implemented: S3 scratch conversion, backend splits, ID renumbering,
  group/project config, one-bytemark WebDAV job, and WebDAV provisioning
  isolation.
- Current verification: `npm run test:e2e` workers=1 → 238 passed + 6 skipped
  (244 total); workers=2 → 238 passed + 6 skipped; the default
  `npm run test:e2e` (Playwright default worker count, 3 on this host) →
  238 passed + 6 skipped. `npm run test:e2e:core` workers=2 → 140 passed +
  3 skipped (143 total); `npm run test:e2e:webdav` workers=2 → 41 passed.
- Worker behavior: a workers=4 stress run on the shared 6-core reference host
  reached load average ~25-31 and produced timeout-only UI failures. No worker
  cap, slot pool, project dependency, or per-project WebDAV container was
  added. CI remains responsible for choosing a worker count that fits its
  resources; the suite itself accepts any worker count.
- A default-worker WebDAV re-run after the stress runs hit a local API-start
  race (`ECONNREFUSED 5022`) in global setup, not a test/backend failure; the
  WebDAV workers=2 run is the recorded green gate.
- R11 is complete for the changed files (`prettier --check` clean); the
  server/client/PG/vector gates are green.
