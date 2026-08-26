# PLAN: Cross-cutting defect testing (semantics-first)

## Objective

Eliminate the class of defects where **data, derived collections, and lifecycle
state** disagree (ACL/ownership/cache/storage semantics) by adding explicit
invariant tests across the test layers. This plan defines *which* tests to add
and *how*; it does not implement them.

The governing policy is documented in
[docs/TESTING_STRATEGY.md#cross-cutting-defect-classes--semantics-first-testing](docs/TESTING_STRATEGY.md#cross-cutting-defect-classes--semantics-first-testing)
(classes A–H, seven common principles).

## Scope

- **In scope:** test additions for defect classes A–H at store-unit, server
  route integration (Supertest), client unit, RTL/MSW, E2E, and S3+PG infra
  layers. Existing regression tests already added for the `__shared__` self-grant
  fix are the seed of class A/H coverage and should be extended, not duplicated.
- **Out of scope:** production code changes, refactors, and new E2E scenario
  inventory entries beyond the absence assertions below. Scenario IDs referenced
  here come from `docs/E2E_COVERAGE_PLAN.md`.

## Key Components

- Defect classes A–H (see TESTING_STRATEGY §1).
- Common principles 1–7 (see TESTING_STRATEGY §2).
- Layer ownership: Supertest = semantics/invariants (primary); store unit = SQL
  and closure correctness; client unit = client-side derivation + capability
  flags with realistic mocks; RTL/MSW = UI gating; E2E = user-visible absence
  smoke only; S3+PG infra = blob-level integrity.

## Success Criteria

- Server `npm run test:ci` and client `npm run test:ci` pass with the new suites.
- E2E P0 wave green (`npm run test:e2e`) and S3+PG spec green
  (`npm run test:e2e:s3`), including the new absence assertions.
- Every defect class A–H has at least one route-integration invariant test that
  fails when its invariant is broken and passes when the invariant holds.
- No new E2E scenario is added without a matching lower-layer invariant (E2E is
  never the primary guard).

---

## Task Dependency Graph

```
Phase 0 (docs, DONE on branch docs/cross-cutting-test-guide)
  └─ T1 store unit (ACL/closure SQL)
       ├─ T2 listing semantics (A/F/H)
       ├─ T3 ACL propagation + cache (B/F)
       ├─ T4 reference stability (C)
       ├─ T5 state transitions (E)
       └─ T6 security surfaces (G)
  T7 client unit (A/F) — independent, parallel to T1
       └─ T8 RTL/MSW UI gating (A/B) — after T7
  T2/T5 → T9 E2E absence assertions (A/C/E/H)
  T10 S3+PG infra (D) — independent
```

---

## T1 — Server store unit: ACL/closure SQL correctness

- **Objective:** Pin the SQL-level invariants that every higher layer depends on.
- **Files:** `server/domains/permissions/stores/__tests__/permissionStore.test.js`
- **Cases to add/extend:**
  - `getSharedPermissions`: excludes home root AND all descendants (depth ≥ 0);
    includes genuine directory + file grants; returns real `name`/`type`;
    no cross-table duplicates. (Base case exists from the self-grant fix.)
  - `removeOwnSubtreePermissions`: removes descendant self-grants (depth > 0),
    preserves home-root ADMIN (depth 0). (Exists; keep.)
  - `checkPermission`: depth-0 direct grant beats weaker inherited depth-N grant;
    file-specific grant beats inherited directory grant (V11 exists).
  - `revoke` → `checkPermission` false immediately and `getUserPermissions` does
    not contain the revoked row (cache invalidation at store level).
  - Grant upsert (read→write→admin) keeps a single row and preserves `admin`.
- **Inputs:** existing mock SQLite client; extend `resolveQuerySync` if a new
  store method needs a new query shape.
- **Expected outputs:** passing store suite; each case fails if the SQL invariant
  is regressed.
- **Verification:** `cd server && npm run test:ci`
- **Dependencies:** none (parallel with T7).

## T2 — Server route integration: listing semantics (A, F, H)

- **Objective:** `GET /api/permissions/shared`, `/file/list`, `/user/:userId`
  return exactly the right set with the right fields.
- **Files:** `server/domains/permissions/routes/__tests__/permissions.test.js`
- **Cases to add/extend:**
  - `GET /api/permissions/shared`: own subtree excluded, genuine folder + file
    grants included with real `name`/`type`, dedupe, admin → `[]`. (Base exists.)
  - Extend: after `revoke`, the node disappears from the response immediately (F).
  - `GET /api/permissions/file/list`: excludes grants on the user's own subtree.
  - `GET /api/permissions/user/:userId`: regression guard — still returns the
    **full** ACL (own home-root ADMIN included) so client `listDirectory` admin
    prefixes and admin "user permissions" view keep working.
- **Inputs:** `createTestDatabase`, `createAuthenticatedTestUser`,
  `createUserRootNode`, `fileNodeService`, `permissionStore` (existing helpers).
- **Expected outputs:** passing permissions route suite; exact-set assertions.
- **Verification:** `cd server && npm run test:ci`
- **Dependencies:** T1.

## T3 — Server route integration: ACL propagation + cache (B, F)

- **Objective:** grant/revoke change observable access immediately and at the
  correct level; file-vs-directory precedence holds.
- **Files:** `server/domains/permissions/routes/__tests__/permissions.test.js`,
  `server/domains/files/routes/__tests__/files.integration.test.js`
- **Cases to add:**
  - grant read → `GET /permissions/check` returns `hasRead:true, hasWrite:false`;
    grant write → `hasWrite:true`; grant admin → grant/revoke allowed.
  - revoke (plain and `includeDescendants=true`) → check + listing reflect
    removal immediately.
  - file-level grant overrides inherited directory grant on the same file.
  - Directory grant inheritance across depth (parent → child → grandchild) while
    the grantee's own subtree stays excluded from `__shared__`.
- **Inputs:** same helpers as T2.
- **Expected outputs:** passing suites; each mutation's effect asserted by
  subsequent read, not by shape.
- **Verification:** `cd server && npm run test:ci`
- **Dependencies:** T1.

## T4 — Server route integration: reference stability (C)

- **Objective:** nodeId references and the closure table survive move/rename/
  delete; permissions and recent entries follow.
- **Files:** `server/domains/files/routes/__tests__/files.integration.test.js`,
  `server/domains/recentFiles/routes/__tests__/recentFiles.test.js`
- **Cases to add:**
  - Move a granted folder → grantee still accesses it, ancestor chain rebuilt,
    `permissions_user_paths` rows intact (nodeId stable).
  - Move a folder the user owns into another user's home → it becomes that user's
    subtree and leaves the mover's `__shared__` listing.
  - Copy → original and copy are independent; both remain accessible; closure
    rows exist for both.
  - Delete a folder → descendant permission rows cascade-deleted; recent entries
    pointing into the deleted subtree are removed or reported stale.
- **Inputs:** real-DB route suite; `fileNodeService` move/copy/delete flows.
- **Expected outputs:** passing suites with post-operation access/closure
  assertions.
- **Verification:** `cd server && npm run test:ci`
- **Dependencies:** T1.

## T5 — Server route integration: state transitions (E)

- **Objective:** request/share-link/approval lifecycles are atomic and terminal
  states are enforced.
- **Files:** `server/domains/permissions/routes/__tests__/permissionRequests.test.js`,
  `server/domains/sharing/routes/__tests__/sharePublic.test.js`,
  `server/domains/sharing/routes/__tests__/shareLinks.test.js`
- **Cases to add:**
  - Request: pending → approve grants exactly the requested permission; reject
    grants nothing; cancel → later approve/reject returns 404/409.
  - Inbox/outbox never self-reference (no request from a user on their own
    folder); statuses reflect each transition.
  - Share link: create → download works; expired/`expiresInDays` elapsed →
    `/info` **and** `/download` return 410; deleted token → 404.
  - add-to-my-permissions grants exactly `read` (never write/admin) and the added
    node appears in `__shared__` only.
- **Inputs:** existing request/share route helpers.
- **Expected outputs:** passing suites; terminal-state assertions.
- **Verification:** `cd server && npm run test:ci`
- **Dependencies:** T1.

## T6 — Server route integration: security surfaces (G)

- **Objective:** expired/invalid tokens, scope traversal, reserved paths, and
  admin-only routes fail at the API.
- **Files:** `server/domains/sharing/routes/__tests__/sharePublic.test.js`,
  `server/domains/files/routes/__tests__/folders.test.js`,
  `server/domains/admin/routes/__tests__/admin.test.js`
- **Cases to add:**
  - Invalid/expired token blocks download, preview, and listing (not just `/info`).
  - Share token cannot list the shared node's parent/sibling tree (no scope
    traversal).
  - `/.wea` creation/listing/upload blocked for non-admin (`checkMetaPathAccess`).
  - Non-admin on every `/api/admin/*` route → 403 (route matrix).
  - User B cannot read user A's share-link list or permission rows (IDOR).
- **Inputs:** existing suite helpers; admin route matrix loop.
- **Expected outputs:** passing suites; every negative case asserted as HTTP
  status + error code.
- **Verification:** `cd server && npm run test:ci`
- **Dependencies:** T1.

## T7 — Client unit: derivation & capability flags (A, F)

- **Objective:** client-side derivation uses real names/types, splits
  file/directory correctly, derives capability flags from the grant (not
  ownership), and honors cache invalidation.
- **Files:** `client/src/services/__tests__/explorerGateway.test.js`,
  `client/src/services/__tests__/folderTreeGateway.test.js`,
  `client/src/services/__tests__/permissionService.test.js`,
  `client/src/utils/__tests__/userUtils.test.js`,
  `client/src/components/folder-tree/hooks/__tests__/useFolderTreeController.test.js`
- **Cases to add/extend (base cases exist from the self-grant fix):**
  - `loadSharedEntries`: real `name`/`basename`, directory vs file split, no
    `node-<id>`/`file-<id>` placeholders, capability flags from `permission`.
  - `folderTreeGateway.getUserSharedFolderPermissions`: directory-only + real
    names; admin → `[]`.
  - `permissionService`: `getSharedPermissions` endpoint; grant/revoke
    invalidates cached `getUserPermissions`.
  - `userUtils.filterOutUserOwnFolders`: root-only safety net documented as such;
    **mocks always include `rootNodeId`** (never a user object missing fields
    production reads).
  - `useFolderTreeController`: shared tree renders real folder names.
- **Inputs:** existing service-mock factories; add `getSharedPermissions` to
  `createPermissionServiceMock` (already done).
- **Expected outputs:** passing client unit suites.
- **Verification:** `cd client && CI=true npm run test:ci`
- **Dependencies:** none (parallel with T1).

## T8 — RTL/MSW: UI gating (A, B)

- **Objective:** UI affordances track granted capabilities, not ownership.
- **Files:** `client/src/components/dialogs/FolderPickerDialog/hooks/__tests__/useFolderPicker.test.js`,
  `client/src/components/file-manager/__tests__/FileManagerView.test.js`,
  share-dialog tests.
- **Cases to add:**
  - Read grant → FAB/create/upload affordances absent; write grant → present.
  - Revoke/reject → shared/recent-derived list updates (absence in list state).
  - Recent-files notifier triggers list refresh after a preview/open action.
- **Inputs:** MSW handlers must include `GET /api/permissions/shared` (already in
  `client/src/mocks/handlers.js`).
- **Expected outputs:** passing RTL suites with UI-state assertions.
- **Verification:** `cd client && CI=true npm run test:ci`
- **Dependencies:** T7.

## T9 — E2E: absence assertions (A, C, E, H)

- **Objective:** prove the user cannot *see* wrong content — the regression guard
  E2E is uniquely positioned for. Always inject the failure precondition.
- **Files:**
  - `e2e/core-flow.shared.spec.ts` — `E2E-EXP-004` regression: after the user
    creates own folders, the sidebar "Shared" tree and `/files/__shared__`
    contain none of them (`toHaveCount(0)`).
  - `e2e/share-internal.spec.ts` — `E2E-OVERLAY-004/005`: after approve, the
    granted target appears **and** the requester's own folders do not; after
    reject, the target is absent from `__shared__`.
  - `e2e/share-public.spec.ts` — `E2E-SHARE-005/006`: add-to-my-permissions adds
    exactly the shared node; own home stays un-polluted.
  - `e2e/mypage-admin.spec.ts` — `E2E-ADMIN-008`: after "권한정리", a user's
    shared list is empty/clean (no self-grant leftovers).
  - `e2e/explorer-advanced.desktop.spec.ts` — `E2E-OVERLAY-010`: stale recent
    entry is removed (absence after recovery).
- **Precondition injection:** create own folders via API (or prior UI step)
  *before* asserting shared emptiness, mirroring how the bug actually manifested.
- **Inputs:** existing E2E helpers (`loginAsUser`, `createFolderViaApi`,
  `resolveNodeId`, `data-file-node-id` / `folder-tree` locators).
- **Expected outputs:** P0 wave green with the new absence assertions.
- **Verification:** `npm run test:e2e` (P0) and `E2E_LATER_WAVES=1 npm run test:e2e`
  for later-wave specs.
- **Dependencies:** T2 (listing semantics) and T5 (transitions) for stable server
  behavior.

## T10 — S3+PG infra: storage consistency (D)

- **Objective:** DB nodes and blobs agree; GC and copy-on-write stay correct.
- **Files:** `e2e/s3-pg-integration.spec.ts`
- **Cases to add/extend (base exists: S3PG-004/005/008):
  - Copy shares one `s3_key`; overwriting the copy leaves the original content
    intact (regression guard for the `overwriteBlob` version fix).
  - Delete → blob becomes orphaned; GC run removes it; a blob still referenced by
    an active node is **not** removed.
  - Upload → blob exists; delete → blob gone (DB/blob agreement).
- **Inputs:** `e2e/helpers/pg.ts`, `e2e/helpers/minio.ts`, `.env.e2e` GC TTL
  override.
- **Expected outputs:** `test:e2e:s3` green (self-skips in webdav mode).
- **Verification:** `npm run test:e2e:s3`
- **Dependencies:** none (infra-bound).

---

## Execution Order

1. **Phase 0 (done):** `docs/TESTING_STRATEGY.md` section + this PLAN.md on
   branch `docs/cross-cutting-test-guide`.
2. **T1** then **T2–T6** (server route integration, can be parallelized after
   T1), and **T7** (client unit, parallel).
3. **T8** (RTL) after T7; **T9** (E2E) after T2/T5; **T10** independent.
4. Full verification per task: `npm run test:ci` in `server/` and `client/`,
   then E2E waves.
5. Merge workflow per AGENTS.md: feature branch → run full suites → merge to
   `dev`, never directly to `main`.

## Progress Log

- `docs/cross-cutting-test-guide`: TESTING_STRATEGY.md cross-cutting section and
  this PLAN.md authored. Implementation not started.
