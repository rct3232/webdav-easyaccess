# repository-contract Spec

## 1. Overview

| Item | Description |
| ---- | ----------- |
| Role | Standard shape for the metadata-layer repositories that replace the hand-written dialect branches inside `server/store/*Store.js` and domain stores. Full pattern: one interface per domain, two dialect implementations (sqlite / postgres), executor-injected. |
| Source of truth | `docs/spec/server/store/executor.md` (execution seam); this spec is authoritative for repository structure and test tiers. |

## 2. Implementation Spec

### 2.1 File Paths

- **Interface + factory:** `server/store/repositories/<Domain>Repository.js` (JSDoc `@typedef <Domain>Repository` plus `create<Domain>Repository(executor)`).
- **Implementations:** `server/store/repositories/sqlite/<Domain>Repository.sqlite.js`, `server/store/repositories/postgres/<Domain>Repository.postgres.js`.
- **Facades:** the existing store modules (`server/store/settingsStore.js`, `server/store/userStore.js`, domain stores …) become thin delegates: they obtain `storage.getExecutor()` and forward to the repository built from it. **Service/route call sites are not changed** — the store module path and exported method names are preserved.
- **Conformance tests (L2):** `server/store/repositories/__tests__/<domain>.conformance.test.js` — run against the active backend via `createTestDatabase()` (sqlite in the default CI leg; real PostgreSQL under the `WEA_TEST_PG_*` adapter leg).

### 2.2 Rules

1. **One interface per domain.** The factory (`create<Domain>Repository(executor)`) is the only construction point; both dialect implementations accept the same executor and implement the identical method set.
2. **Domain-shaped results.** Repositories return domain-shaped values (ids as numbers, ISO timestamps where the schema stores timestamps, booleans as booleans) — never raw driver result wrappers. Rows are mapped inside the implementations.
3. **No dialect branching at call sites.** Services/routes/stores never branch on `storage.getBackend()`; the dialect choice lives solely in which repository implementation was instantiated.
4. **Error mapping.** Implementations map driver errors via `mapDatabaseError`. Duplicate detection uses the **in-transaction pre-check** raising the documented domain error (e.g. 409 `errorHandler.usernameTaken` / `emailTaken`), matching the former adapters; `executor.isUniqueConflict(err)` is available for raw-driver classification at the executor boundary (before `mapDatabaseError`) and is exercised by the executor unit tests — pilot repositories rely on the pre-check, since `executor.transaction` already maps driver errors before repository code re-observes them.
5. **Facade compatibility.** Existing store modules keep their public function signatures; internally they delegate to the repository for the active backend. Existing suites must stay green without edits (except where the test itself asserted dialect internals, which are rewritten in the bulk L1 cleanup).
6. **Tier targets.** `L2` conformance suites run against real sqlite and real PostgreSQL (`WEA_TEST_PG_*` leg, serial); they assert behavior, not SQL text. `L1` functional suites (routes/services/models) run on sqlite only and are rewritten to observe through APIs after the domain's repository lands.

### 2.3 Pilot order

1. `SettingsRepository` (smallest seam; consumed by `configResolver`, admin config, configSync, setup).
2. `UserRepository` (absorbs the used half of `infrastructure/adapters/metadata`; the vestigial share-link half is dropped — `ShareLinkRepository` owns that domain).
3. `RecentFilesRepository`, `ShareLinkRepository`.
4. `FileNodeRepository`, then `PermissionRepository` / `PermissionRequestRepository` (largest dialect surfaces — contract tests written first, conversion split into steps).
5. Out of repository scope (kept as adapter-conformance targets, not repositories): `lockManager` (locking strategies), `schemaManager`/DDL pipeline, `metadataMigrationService` (cross-dialect tooling).

### 2.4 Verification Scenarios

- [ ] Every converted store module exports the same method set as before (facade parity)
- [ ] `configResolver` / admin config / configSync / setup suites green after the Settings conversion
- [ ] Settings L2 conformance passes on sqlite and (under the PG leg) on real PostgreSQL: get (present/absent), getAll, upsert insert/update, listRows shape + `updated_at`, string-value parity across jsonb (PG) and TEXT (sqlite)
- [ ] User L2 conformance passes on both backends: create (+duplicate → 409), find by id/username/email, update status/email/password
- [ ] No production file outside `server/store/repositories/` and `server/infrastructure/db/` contains `getBackend() === 'postgresql'` branching for converted domains