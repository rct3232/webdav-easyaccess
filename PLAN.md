# PLAN.md

## Objective (current workstream — 2026-09-09)
Fix the stuck-state data-integrity defect **DEF-12/13** (a failed S3 overwrite and a crash
between TX1 and the blob write leave unrecoverable `pending_upload`/`orphaned_node` nodes, and
s3-source migration silently drops them at cutover) and, on the **same retention-category GC
foundation**, enable two additive retention features: **version history (DEF-11)** and a
**trash/recycle-bin (DEF-16)**. Goal: no rework between them.

> Prior workstreams (E2E wall-clock; 2026-09-08 doc-drift reconciliation + audit fixes) are
> complete — see `git log` and the `docs/IMPROVEMENT_PLAN.md` completion notes.

## Scope
- **In scope**: DEF-12/13 (R1 rollback, R2 scan/repair/startup, R3 GC foundation); DEF-16 trash
  (P1–P9); DEF-11 (S7); small WebDAV repair hardening D5a (`retry-delete` also deletes the remote
  blob) + D5d (`force-active` remote-existence check).
- **Out of scope (tracked separately)**: DEF-17 (WebDAV rename/move old-path orphan) and DEF-18
  (WebDAV remote↔DB reconciliation sweep) — see `docs/IMPROVEMENT_PLAN.md`.
- **Guardrail**: with default configs the GC must be **observably identical to today** (version
  TTL = 1 day; trash category disabled; pending-stale strictly additive).
- Docs-first per AGENTS.md §2.1. Never merge to `main`; feature → `dev` only after tests pass.

## Guiding decision — Option Y (confirmed 2026-09-09)
DEF-12/13's R3 builds the shared **retention-category GC foundation** (category-aware tiers +
keep-set seam + config + `purgeNodeSubtree` + live-upload registry). DEF-11 and DEF-16 then add one
category + one config (+ one tier for trash) each → zero rework. Rejected Option X (narrow R3 now,
restructure GC later = two GC designs, the first disposable).

## Key Components
- **Foundation (build once)**: F1 category-aware `gcService` (Tier 1/2/3); F2 keep-set seam
  `getKeptS3Keys()` = active ∪ trash ∪ version ∪ pending-live (replaces `getAllActiveS3Keys`);
  F3 live-upload registry (in-process `Set<nodeId>`); F4 config `TRASH_RETENTION_DAYS` /
  `GC_VERSION_TTL_DAYS` / `GC_PENDING_STALE_DAYS`; F5 `purgeNodeSubtree` (extracted WebDAV
  bottom-up + cascade); F6 new repo methods (both dialects + PG conformance).
- **Retention categories** (derived by query, NOT new status values): `active`, `trash`, `version`,
  `pending-live`, `garbage`, `untracked` (S3-only).
- **Slices**: S1/S2/S3 (DEF-12/13), P1–P9 (DEF-16), S7 (DEF-11).

## Success Criteria
1. **DEF-12/13**: failed S3 overwrite → file downloadable as the PREVIOUS version, no
   `pending_upload`; seeded stuck node → repair `auto` → active + old content + pending blob
   deleted; crash → startup reports stale `pending_upload` with 0 auto-mutations; GC never deletes
   a stuck node's last-good blob and cleans only stale pending.
2. **Trash**: trashed content hidden from all listings (folder, `__recent__`, `__shared__`) and
   not-found on direct access; restore round-trips (content hash) on both backends;
   permanent-delete/empty-trash physically remove (WebDAV paths + untrack S3 keys); trashed survives
   s3↔webdav migration both directions and is still trashed.
3. **Foundation**: default GC is observably identical to today; DEF-11 (raise
   `GC_VERSION_TTL_DAYS` + browse/restore) and DEF-16 P5+ add categories without touching the GC
   skeleton again.

## Task dependency graph
Foundation pieces F3/F5/F6 are built incrementally and shared across slices.

```
S1 (R1 overwrite rollback)      deps: F6(reactivateObjectMapRow)   ┐
S2 (R2 scan + repair + startup) deps: F3, F5, F6                   ├─ DONE 2026-09-09
S3 (R3 = GC foundation)         deps: F1, F2, F4, F6               ┘
   │
P1 (trash schema, folded 001)   done 2026-09-10                    ┐
   │                                                               │
WAVE 2 (design locked 2026-09-10, in flight):                      │
S7 (DEF-11 version history)     deps: S3 only — immediate          │
S7a (001 CHECK + history demotion + evictVersionsBeyondCap)        │
   + S7b (browse/restore svc/routes) + S7c (client properties tab) ┘
P2 (soft-delete + WebDAV MOVE)   deps: F5(purgeNodeSubtree extract) ┐
P4 (read-gating, SAME WAVE as P2)│                                  ├─ parallel
P3 (restore/purge/empty)         deps: F5, P2                      │
P5 (Tier 3 purge)                deps: S7(history landed) ∧ P2–P4  ┘
P6 (scheduling)                  deps: P5 (rides GC_INTERVAL_MS)
P7 (perm visibility)             deps: P3
P8 (migration proof)             deps: P2/P3
P9 (trash UI)                    deps: P3/P4/P7

Critical path: S7 → P5.  S7 · P2+P4 start immediately in parallel (disjoint
files); P3 after P2; P5 after S7+P2–P4; P7–P9 last. P2 and P4 MUST land in
the same wave (R4 risk: trashed rows visible to getChildren interim).
E2E cleanup must switch to permanent-delete when P2 lands (risk R1).
```

### Test-impact ledger (from the test analysis, 2026-09-10)
- **DEF-11 modify (~18)**: blobStorageService.test.js (prepareUpload/overwriteBlob/repeated pins
  → `history`; deleteBlob's orphaned pin EXCLUDED — direct orphanObject path), uploadService V5,
  fileNodesStore V14, conformance (getKeptS3Keys arm + explicit row statuses), failSafeService
  (seedOverwriteStuck comment, classification history-first, restore-previous search order,
  startup-report pin `['history','pending']`), gcService "historical parity" re-baseline.
  New: conformance for `evictVersionsBeyondCap` (cap eviction/0=unbounded no-op/active untouchable),
  `getVersionsByNode`, history-reactivate variant, keep-set history arm, Tier-1-blind-to-history;
  versionsService + versions route suites (browse strips internals/404-masquerade/WebDAV 409/stuck
  409; restore history→active·active→history·cache re-assert·NO new row·403/404/409 boundaries);
  GC Tier-1-never-touches-history + eviction-grace semantics; overwrite cap eviction (scheduler
  off); thumbnail eviction; configRegistry 4 spots; migration history-drop.
- **DEF-16 modify (~16)**: fileService deleteNode ×5 (pins → trash marking; WebDAV re-pin to ONE
  MOVE per subtree root, failure → orphaned_node), files.integration SCENARIO-5/7 + C4 (rows
  survive + deleted_at; C4 retitled "hidden at read"), admin GC lazy-delete chain re-pointed at
  purge, conformance keep-set trash arm. Unchanged guards: fileNodeService (hard), failSafe
  retry-delete, recentFiles hard case, batchOperationService.
- **Additions**: gated-read + new-method conformance (both legs), trash service/route suites,
  Tier 3 describe, class-A exact-set invariants per surface, configRegistry ×4 ×2 keys,
  validateFileName `.wea-` (unit+fast-check+route), `__trash__` pathUtils both sides, migration
  trash-survival both directions.
- **E2E**: `E2E-TRASH-001..011`, `E2E-PROPS-001/002` (properties versions tab), `E2E-SHARE-012`,
  notes updates to E2E-EXP-006/007, E2E-BULK-004, E2E-OVERLAY-010.
- **Mandatory companion changes**: (R1) e2e `flushPrivateWorkspaceCleanups` → permanent-delete
  endpoint when P2 lands; (risk 2) `reactivateObjectMapRow` guard widened `IN ('history','orphaned')`;
  (risk 3) repair restore-previous searches history FIRST; (risk 4) P2+P4 same wave.

## Background — the binary GC assumption being replaced
GC today keeps exactly the `active` object_map set and deletes the rest: Tier 1 = `object_map`
rows `status='orphaned' AND created_at < NOW()-GC_ORPHAN_TTL_DAYS` (default 1d) + their S3 blobs
(WebDAV skipped); Tier 2 (S3 only) = `listOrphanedKeys` (ListObjectsV2, LastModified<cutoff) minus
`getAllActiveS3Keys()`; `GC_INTERVAL_MS` default 0 (scheduler off); `WebdavBlobStore.listOrphanedKeys()`
returns `[]`. Every "keep old data" feature breaks this single assumption → the category model.

## DEF-12/13 failure-state map (verified 2026-09-08)
| stuck state | cause | rows | blob | today's coverage |
|---|---|---|---|---|
| S3 overwrite PUT/TX2 fail | `overwriteFile` has **no rollback** (`uploadService.js:102-121`) | node `pending_upload`; v_k `orphaned`, v_{k+1} `pending` | B_k present | listed but not downloadable; invisible to GC/failsafe/migration; Tier 1 deletes B_k (last-good) after TTL |
| crash between TX1 & blob write (DEF-13) | process death | node `pending_upload`, v1 `pending` | maybe | same — no scan/repair path exists |
| WebDAV overwrite/rename/move fail | non-atomic remote PUT | node `orphaned_node` | remote present/partial | failsafe reports + `retry-delete`(DB-only) / `force-active`(blind) |

Key gap: **no subsystem scans or repairs `pending_upload`**; s3-source migration enumerates
`active` only → silently drops stuck nodes at cutover.

## Retention categories (derived by query)
| category | definition | policy | config | owner |
|---|---|---|---|---|
| active | `object_map=active`, node live | keep | — | base |
| trash | `object_map=active`, node `deleted_at≠NULL` | keep → Tier 3 purge | `TRASH_RETENTION_DAYS` | DEF-16 P5 |
| version | `orphaned`, node live (prior overwrite versions) | keep → TTL | `GC_VERSION_TTL_DAYS` | DEF-11 |
| pending-live | `pending` on `pending_upload` node (+ last-good guard) | protect in live-set; clean when stale | `GC_PENDING_STALE_DAYS` | DEF-12/13 R3 |
| garbage | `orphaned` whose node is trashed/gone | Tier 1 | `GC_ORPHAN_TTL_DAYS` | existing |
| untracked (S3) | bucket key absent from keep-set union | Tier 2 | `GC_ORPHAN_TTL_DAYS` | existing (widened keep-set) |

## Slices

### DEF-12/13
- **S1 (R1)** S3 overwrite rollback: capture the pre-state active row id (`getActiveObject`) before
  TX1; on PUT/TX2 throw → `reactivateObjectMapRow(id)` + node→`active` + delete v_{k+1} pending row +
  blob + `upsertCache`. Best-effort (its own failure → R2/R3).
- **S2 (R2)** scan+repair: `pending_upload` scan; admin repair actions `complete`/`restore-previous`/
  `delete`/`auto` (`auto`: overwrite→restore-previous; new-file+blob→complete; new-file no-blob→delete);
  startup report (report-only, threshold-gated). **D5a** `retry-delete` also deletes the remote blob;
  **D5d** `force-active` adds a remote existence check.
- **S3 (R3)** GC foundation = F1/F2/F4/F6: status-aware Tier 1 with a **last-good guard** (an
  `orphaned` row is exempt while its node is `pending_upload` with no `active` row), pending-live
  cleanup, widened keep-set. **Closes DEF-12/13.**

### DEF-16 trash (Option A: `deleted_at`)
- **Model**: `file_nodes.deleted_at TIMESTAMPTZ NULL`, orthogonal to `sync_status`;
  `UNIQUE(parent_id,name)` + root unique → **partial over `deleted_at IS NULL`** (folded into
  `001_initial_normalized_schema.sql` — single-file tracked chain, user-approved 2026-09-10;
  checksum drift hard-fail retained). Zero physical I/O on trash/restore-in-place in BOTH
  backends (S3 key = stable UUID, stays `active` → in Tier-2 keep-set for free; WebDAV path stable
  since closure kept). Rejected: B (status pollutes migration/failsafe), C (move = closure churn +
  WebDAV copy), D (tombstone loses shares/perm via cascade, re-derives path).
- **P1** schema · **P2** soft-delete (`fileService.js:321-350` stops physical removal; mark subtree
  `deleted_at`) · **P3** restore (in-place default) + permanent-delete + empty-trash (collision: name
  suffix via `conflictResolver` / deepest live ancestor; purge = F5) · **P4** read-gating
  (`getChildren` + `__recent__` + `__shared__` + download/preview/zip/thumbnail/metadata/share-public/
  ancestors → trashed = not-found/hidden) · **P5** trash category + Tier 3 + retention (needs S3) ·
  **P6** purge scheduling (reuse `GC_INTERVAL_MS`) · **P7** permissions (visibility = deleters +
  admin; restore = move perm; permanent-delete = delete perm; empty-trash = admin) · **P8** migration
  proof (no code change under A; trashed survives both directions, still trashed; hermetic E2E) ·
  **P9** client UI (trash view, context menu, i18n; E2E containment policy).
- **P1–P4 are GC-independent** → parallel with S3.
- UI note: trashed content shows **exactly like no-permission** today (folder direct-access 404 →
  client redirects to root `useFileManager.js:158-160`; file download 404; preview 403) — no new
  error surface; only new UI is the trash listing itself.

### DEF-11 (S7)
- Raise `GC_VERSION_TTL_DAYS`; add browse/restore-version API + UI. No schema change
  (`version_number` already increments on every overwrite; prior versions are already orphaned+GC'd
  after 1 day today). Needs only S3. Independent of trash P5–P9.

## Locked decisions
- **DEF-12/13**: D1 restore-previous; D2 auto policy; D3 report-only startup; D4 GC status-aware;
  D5a+D5d in scope; D5b/D5c → DEF-17/DEF-18.
- **Trash (DEF-16)**: ① 30d retention, 0=off; ② global + permission-based visibility; ③ shares/perm
  survive + read-gated; ④ collision = suffix / deepest live ancestor; ⑤ restore=move perm,
  permanent-delete=delete perm, empty-trash=admin; ⑥ WebDAV included; ⑦ in-place restore default.
- **Gating surfaces**: `getChildren`, `__recent__` (`/api/recent-files`), `__shared__`
  (`/api/permissions/shared`), and all direct-access read paths → trashed = not-found.

### Version history (DEF-11/S7) — design locked 2026-09-10 (user decisions)
- **Managed-history model (user: "구버전은 미아가 아니라 관리되는 버전")**: new `object_map.status`
  value **`history`** (X안). `upsertObjectMap` demotes the previous active row to `history` (not
  `orphaned`). **Anti-goal 3 is formally superseded** by this decision; anti-goal 6's protection
  ends here by design (S7 evolves the version semantics).
- **Per-node cap**: `GC_VERSION_MAX_PER_NODE` (T2/dbOnly, default **10**, 0=unbounded). Overwrite
  TX1 evicts immediately: while `active+history > N`, the oldest `history` rows are demoted to
  `orphaned` (new repo method `evictVersionsBeyondCap(nodeId, cap)` inside TX1) — the cap holds even
  with the GC scheduler off.
- **TTL role**: `GC_VERSION_TTL_DAYS` (default 1 unchanged) = **eviction grace period**; clock stays
  `created_at` (upload time) — documented nuance: an old upload's evicted row is deleted at the
  first GC after eviction. Keep-set gains a `history` arm; `orphaned` now means "evicted version".
- **Restore = A안 (reactivate in place, zero I/O)**: TX { history row → `active` (guard widened to
  `status IN ('history','orphaned')`), current active row → `history`, node → `active`, cache
  re-asserted from `headBlob` metadata }; 409 when the target blob is gone (HEAD probe) or the node
  is stuck/`pending_upload`; current version is ALWAYS kept (history), deletion stays the repair
  channel's job. Restore adds NO version row.
- **Browse**: flat route style per `files.md` — `GET /api/files/versions?nodeId=` (+ restore
  `POST /api/files/versions/restore {nodeId, versionNumber}`); new repo method
  `getVersionsByNode` (active+history, `ORDER BY version_number DESC`, both dialects +
  conformance); responses strip `s3_key`/storage internals; size via `headBlob`.
- **Mode & permissions**: **S3 storage mode only** (WebDAV has no version rows — API 409, UI
  hidden). Browse = read perm (404-masquerade), restore = write perm + `requireTokenNotShare`;
  **no share-token access** to versions (past-content disclosure guard).
- **Old-version download**: attachment-only (`application/octet-stream`) — sidesteps the
  mime-changed-between-versions class.
- **Consistency**: filecache re-asserted from blob HEAD on restore (repair-`complete` precedent,
  content_hash stays null); thumbnail cache eviction added on restore (and overwrite — pre-existing
  latent gap); recent files node-stable (no change).
- **Migration**: version history does not survive s3↔webdav cutover (active row flips; history rows
  are dropped) — accepted + documented (DEF-18 class).
- **Foundation updates required**: S1 rollback guard + S2 repair `restore-previous` now read the
  last-good row from `history` (fallback `orphaned`); GC guarded category shrinks accordingly
  (stuck-node last-good is `history` → inherently safe; keep the orphaned-branch defensively);
  keep-set += history; new error/message codes + locales (en+ko); client: context-menu/action-sheet
  entry, versions dialog (pure view), controller hook, `client/src/services/fileService` functions.

### Trash (DEF-16 P2–P9) — design locked 2026-09-10 (P7–P9 per earlier recommendation)
- **P2 soft-delete**: slice point = `fileService.deleteNode` ONLY (`fileNodeService.deleteNode`
  stays hard-delete so failsafe repair + upload rollback bypass trash). Files AND directories.
  **Every-row `deleted_at` marking** over the subtree (single-row predicates for all gates; partial
  writes are idempotently re-runnable). Batch delete inherits trash. Response keeps subtree count.
  **WebDAV remote handling (MOVE design)**: trash = one remote MOVE per subtree root to the hidden
  path `/.wea-trash/<nodeId>` (new PUTs to the original path then cannot clobber trashed content);
  restore = MOVE back to the original (or suffixed) display path; purge = remote delete at the
  trash path. MOVE failure → `orphaned_node` marker (existing failsafe channel). S3 mode: no
  physical I/O (UUID keys).
- **P3 restore/purge/empty — OS-recycle-bin semantics (user-locked)**: restore puts the item back
  to its original location; **trashed ancestors are auto-restored** (Windows-style path
  recreation), trashed SIBLINGS stay in trash; name collision at the target → auto-suffix
  `name (2).ext`; trash listing shows original path + deleted_at; storage is freed only on
  permanent-delete/empty/retention-expiry. Purge (per node) = the same delete perm a hard-delete
  requires today — `checkFilePermission(node,'write')`, admin bypasses (owners and write-grantees
  can purge their own items; ACL review 2026-09-10); **Empty trash (bulk, all users) = admin-only**
  = physical
  delete in BOTH modes (WebDAV bottom-up at trash paths, S3 `deleteBlob` for every object_map row
  of the subtree — active + history + orphaned) + `deleteNodeTree` + ancestry cleanup; permission
  and share rows vanish via the existing FK cascade AT PURGE TIME (documented behavior change vs
  physical-delete-today).
- **P4 read-gating**: repo-SQL level (`WHERE deleted_at IS NULL`) for `getNode`, `getChildren`,
  `resolvePathSegment`, and the `__shared__` join (both dialects + conformance); gating covers the
  PLAN surfaces PLUS the five found in review: `resolvePath`, metadata, ancestors, folder stats,
  thumbnail route, share-public download, zip, conflict checks. Trashed = 404 everywhere (incl.
  for the deleter — visibility only via the trash listing). `getDescendantIds`/`getAncestorChain`
  stay unfiltered (restore/purge need the full subtree). Recent-files rows are kept and filtered at
  read.
- **P5 GC (simplified by the history model)**: Tier 1 unchanged (only `orphaned` = evicted rows are
  TTL-eligible; a trashed node's versions are `history` and survive the whole trash period — the
  old "versions die at 1d inside trash" concern is dissolved). New **Tier 3** inside `runGcCycle`
  after Tier 1: purge trashed nodes older than `TRASH_RETENTION_DAYS` (T2/dbOnly, default **30**,
  0=off), best-effort + additive report counts (`purgedNodes` etc.).
- **P6**: no new scheduler — Tier 3 rides `GC_INTERVAL_MS` (0=off default keeps the guardrail).
- **P7**: permission-based visibility, NO `deleted_by` column — visibility = trashed ∧ (write perm
  survives on the row) ∨ admin; restore checks write on the (live) parent (move-dest precedent);
  degenerate case (perm revoked while trashed → invisible to the ex-deleter) documented.
- **P8**: make the existing accidental inclusion of trashed nodes in both migration directions
  EXPLICIT + hermetic E2E (trashed survives, still trashed). WebDAV-source trashed nodes must be
  enumerated via their `/.wea-trash/` paths (blob-migration interaction).
- **P9**: trash view = `__trash__` virtual root (client `pathUtils.VIRTUAL_ROOTS` + server
  `sharedPathUtils` + FileManager dispatch) + new `GET /api/files/trash` listing route; main view
  keeps the "Delete" label (→ trash); "Delete permanently"/"Restore"/"Empty trash" live only in the
  trash view; i18n en+ko.
- **S2 interaction**: failsafe repair `delete` hard-deletes (bypasses trash); the startup scan
  reports trashed stuck nodes with a `trashed` flag; `cleanupAncestorsForDeletion` is skipped on
  trash and runs at purge (shares/perm survive trash — locked ③).
- **Reserved namespace (user-locked)**: `.wea-` name prefix is RESERVED via `validateFileName`
  (covers create/upload/folder/rename) — `/.wea-trash/<nodeId>` becomes permanently safe; the
  historical FsJSON `/.wea` namespace precedent makes this coherent. A pre-existing `.wea-*` node
  makes trash MOVE fail with a clear error (never clobber). SETUP.md's "`.wea` is a normal folder"
  wording updated docs-first.

## Anti-goals (do not build rework-prone)
1. No D5c WebDAV reconciliation sweep now (→ DEF-18, retention-aware).
2. No `sync_status='trashed'` (pollutes `migrationService.js:109-126` + the failsafe channel).
3. ~~No new `object_map.status` values~~ — **SUPERSEDED 2026-09-10 (user decision)**: DEF-11 adds
   the `history` status (managed prior versions); categories otherwise stay derived.
4. No inline keep-set queries in `gcService` (always through F2).
5. No new scheduler (reuse `GC_INTERVAL_MS`/`maintenanceScheduler.js`).
6. ~~R1 must not change `upsertObjectMap` version semantics~~ — protection ended by design when S7
   (DEF-11) landed its version model (history demotion + cap eviction), user-approved 2026-09-10.

## Docs-first (AGENTS.md §2.1) — specs to update before code
`uploadService.md` (§2.3 rollback, §2.5/§2.6/§2.7) · `fileService.md` (§4, §2.5) · `gcService.md` ·
`blobStorageService.md` · `core-service-layer.md` · `admin-infrastructure.md` · `routes/admin.md` ·
`configRegistry.md` · `store/fileNodesStore.md` · `migration-mode.md` · `permissions.md` · client
`fileService` spec. `docs/IMPROVEMENT_PLAN.md` (DEF-16/17/18 + retention note) already updated 2026-09-09.

## Workflow / verification
- Branch per slice (e.g. `fix/upload-overwrite-recovery`, `feature/trash`); docs-first; run
  `npm run test:ci` (client + server); for any repo/executor/store change also run the PG adapter
  leg `cd server && npm run test:ci:pg:adapters` (needs `docker compose -f docker-compose.e2e.yml
  up -d postgresql-e2e`). Merge to `dev` only after green; never to `main`.

## Recording
- 2026-09-09: analysis via sub-agents — DEF-12/13 failure-state map; contract/test surface; trash
  data-model (Option A) + retention-category GC; coordination → **Option Y** chosen. All 7 trash
  policy decisions + DEF-12/13 D1–D4 confirmed.
- 2026-09-09: `docs/IMPROVEMENT_PLAN.md` updated (DEF-16/17/18 registered + retention-GC note).
- 2026-09-09: PLAN.md rewritten to this workstream (prior E2E + doc-drift content removed; both closed).
- 2026-09-09: **S1 done** — R1 overwrite rollback + F6 `reactivateObjectMapRow`; docs-first spec
  updates (uploadService.md §2.2–2.7, fileNodesStore.md §2.4/§2.7 incl. version_number drift,
  core-service-layer.md, fileService.md); RCA_LOG Case B entry (TX-boundary error-message
  assertion). DEF-12 row + W-1 note updated; unrelated pre-existing `lint:ci` failure on dev
  registered as DEF-19.
- 2026-09-09: **S3 done** — retention-category GC foundation (F1/F2/F4/F6): category-aware Tier 1
  with last-good guard + stale pending-live cleanup, `getKeptS3Keys()` seam (active ∪ orphaned ∪
  pending-live; orphaned arm unfiltered so guarded B_k keys are Tier-2-safe), `GC_VERSION_TTL_DAYS`
  + `GC_PENDING_STALE_DAYS` (T2/dbOnly, defaults 1 and 3, 0=off). Spec docs docs-first
  (gcService.md, fileNodesStore.md, configRegistry.md, config-source-resolution.md,
  admin-infrastructure.md, core-service-layer.md); 2 Case B RCA entries (guarded-shape fixtures,
  version_number collisions). DEF-12/DEF-13 rows updated. Keep-set integration decision recorded:
  orphaned arm must include stuck-node keys or Tier 2 defeats the guard.
- 2026-09-09: **Item 4 done (S2 ∥ P1 in worktrees)** — S2 closed DEF-12/13 completely (scan/
  repair gated S3-mode-only after review found WebDAV healthy files are pending_upload for life;
  D5a/D5d landed); P1 landed the trash schema. Both merged to dev; final gate server 1849 /
  client 1421 / PG leg 207 / core e2e (s3) 121 pass. Merge-loss incident (new files dropped by
  `git add -u`) restored + RCA recorded. Remaining in the workstream: S7 (DEF-11), P2–P9 (DEF-16),
  DEF-19 (lint), DEF-17/18 (separate).

## Next (updated 2026-09-10)
- [x] Item 1: `docs/IMPROVEMENT_PLAN.md` registration (DEF-16/17/18 + retention-GC note).
- [x] Item 2: **S1 (R1 rollback)** — done 2026-09-09 via `fix/upload-overwrite-recovery` (merged
  to dev): F6 `reactivateObjectMapRow` (sqlite+pg+conformance) + `overwriteFile` pre-state capture
  and best-effort rollback; specs updated docs-first; RCA Case B logged; verified server 1783 /
  client 1421 / PG leg 203 / core e2e (s3) 121 pass. Pre-existing dev `lint:ci` failure registered
  as DEF-19 (unrelated).
- [x] Item 3: **S3 (R3 GC foundation)** — done 2026-09-09 via `fix/gc-retention-foundation`
  (merged to dev): F1 category-aware Tier 1 (garbage/version/guarded + pending-live cleanup),
  F2 `getKeptS3Keys()` (active ∪ orphaned ∪ pending-live), F4 `GC_VERSION_TTL_DAYS`(=1) /
  `GC_PENDING_STALE_DAYS`(=3, 0=off), F6 3 repo methods (both dialects + conformance). Guardrail
  verified: defaults outcome-identical except the two intended deviations (guard keeps last-good,
  stale-pending cleanup additive). Verified server 1802 / client 1421 / PG leg 206. No GC e2e
  exists (none to run). **Decision to confirm**: `GC_PENDING_STALE_DAYS` default 3 (PLAN had none).
- [x] Item 4: **S2 (R2 scan/repair/startup + D5a/D5d)** — done 2026-09-09 via
  `fix/upload-scan-repair` (merged to dev): failSafeService extended with
  `scanPendingUploadNodes` (file nodes only, **S3 mode only** — WebDAV-mode file nodes
  intentionally stay `pending_upload` for their whole lifetime (`fileService.md` §4), so an
  ungated scan would flag every healthy WebDAV file and `auto` could delete one; repair is
  refused 409 in WebDAV mode), `repairPendingUploadNode` (`complete`/`restore-previous`/`delete`/
  `auto` per D1/D2), startup report `pendingUpload` section (report-only, threshold-gated
  logging), cleanup report gains additive `pendingUploadNodes`; D5a `retry-delete` deletes the
  remote WebDAV subtree bottom-up best-effort; D5d `force-active` refuses (409
  `repairSyncRemoteMissing`) when the remote is absent. New store method `getObjectMapByNode`
  (sqlite+pg+facade+typedef+conformance); new codes `repairSyncRemoteMissing`/
  `repairUploadInvalidAction`/`repairUploadNotPending`/`repairUploadBlobMissing`;
  `server/jest.config.js` maps `@webdav-easyaccess/shared` to the checkout's own `shared/`
  (symlinked-node_modules worktree need). Verified server test:ci 98 suites / 1837 pass / 5 skip;
  PG adapter leg 207 pass; 4 Case B RCA entries logged. **DEF-12 + DEF-13 → DONE.**
- [x] Item 4b: **P1 (trash schema)** — done 2026-09-09 on `feature/trash` (schema slice only):
  `ddl/002_trash_soft_delete.sql` (`deleted_at` + partial unique indexes over `deleted_at IS NULL`
  for `(parent_id,name)` and the root variant); sqlite application moved to tracked
  `applyPendingMigrations('sqlite')` (boot + migration target) since dropping a table-level UNIQUE
  on sqlite requires a table rebuild (transpiler emits it); `schemaManager` sqlite path applies
  each file in one transaction (PG parity). Docs-first spec updates: fileNodesStore.md §2.1-2.2,
  storage.md §2.5, schemaManager.md, sqliteSchemaInit.md, metadataMigrationService.md,
  ARCHITECTURE.md, IMPROVEMENT_PLAN.md. Post-merge gate on dev: server 99 suites / 1849 pass,
  PG leg 207, core e2e (s3) 121 pass / 3 skip. **Incident**: the slice's two NEW files were
  dropped by a tracked-only `git add -u` stage (worktree removal then deleted them) — restored
  with a rebuilt schema test suite + RCA entry (`5a60718`); new files must always be staged
  explicitly.
- 2026-09-09: **Docs-audit remediation done** (14 items, A–F): stale/contradicting spec docs
  synced to implemented DEF-12/13 state (fileService.md §4 recovery, core-service-layer.md
  uploadService row, admin.md tier1 shape, gcService.md §3.2/§5); route/contract/guide/env docs
  refreshed (api.md, ARCHITECTURE.md, composition.md, TEST_GIT_GUIDE.md pointers-over-numbers,
  SETUP.md + .env.example dbOnly GC keys); locale keys added (4 new + 2 backfilled, en+ko);
  prettier drift fixed on 6 in-range files; PG-leg registration of `trashSoftDeleteSchema`
  (sqlite-only describes gated via `WEA_TEST_PG_HOST`). Verified: server test:ci 99 suites /
  1849 pass / 5 skip (coverage All files 72.35/63.17/76.65/73.46), client test:ci 157 suites /
  1421 pass; PG leg intentionally not run here (orchestrator runs it after the pattern change).
- 2026-09-10: **Schema big-bang (user-approved)** — `ddl/002_trash_soft_delete.sql` folded into
  `001_initial_normalized_schema.sql` (single-file tracked chain; `deleted_at` + the partial unique
  indexes over `deleted_at IS NULL` now live in 001; 002 deleted). The transpiler reverts to plain
  type conversion + BEGIN/COMMIT stripping + partial-index passthrough; the "existing pre-002
  sqlite DB migrated via real boot" test scenario removed. Rationale: single-user deployment — the
  real PostgreSQL DB is cut over by a MANUAL one-shot SQL script (orchestrator-provided, with the
  recomputed 001 checksum) instead of an incremental DDL file. The standard tracked-migration
  mechanism (`applyPendingMigrations` + `_schema_migrations` ledger + checksum drift hard-fail) is
  kept; only the file chain becomes a single file. Consequence: existing sqlite dev DBs are not
  in-place migrated — they are deleted and re-created/re-migrated at next boot.
- 2026-09-10: **DEF-11 + DEF-16 design locked** (user decision session) — DEF-11: managed-history
  model with new `object_map.status='history'` (X안; anti-goal 3 superseded), per-node cap
  `GC_VERSION_MAX_PER_NODE`=10 with overwrite-TX1 immediate eviction to `orphaned`, TTL stays as
  eviction grace, restore = A안 reactivate-in-place (zero I/O), browse API flat nodeId+versionNumber
  (no s3_key exposure, no share-token access), old-version download attachment-only, S3 storage
  mode only, migration drops history (accepted). DEF-16: P2 slice point fileService.deleteNode +
  every-row marking + WebDAV remote MOVE to `/.wea-trash/<nodeId>`; P3 = OS-recycle-bin semantics
  (auto-restore trashed ancestors, suffix collisions, purge = full physical delete + FK-cascade
  revoke documented); P4 repo-SQL gating + 5 extra surfaces; P5 Tier 3 (TRASH_RETENTION_DAYS=30,
  Tier 1 unchanged — history survives inside trash); P7 permission-based visibility (no
  deleted_by); P9 `__trash__` virtual root; `.wea-` prefix RESERVED in validateFileName (user
  approved) — SETUP.md "normal folder" wording to update docs-first. Design-decision research was
  sub-agent-verified (file:line evidence); all open decisions closed in three Q&A rounds.
- [x] Item 4b: **P1 (trash schema)** — done 2026-09-10 (folded into 001, big-bang; see Recording).
- [x] Item 5: **DEF-11 + DEF-16 design + test analysis locked** — designs in Locked decisions
  (2026-09-10); test-impact ledger in the dependency-graph section; UI/UX decisions locked
  (properties-dialog tabs "정보|버전" between title and gradient header, icon-only
  download/restore/restore/purge buttons, fixed close button, no trash-row subtitle, bottom-pinned
  sidebar trash entry with lid-open/red-flash animation on delete, admin-only Empty-trash icon in
  controls bar, permanent-delete = delete perm per ACL review).
- [x] Item 7 (DONE): **Wave 2+3 implementation** — S7 merged (44a3451), P2+P4 merged (7330b8d),
  wave-3 server + UI merged (0a4ec2d, 7916a17). All wave-2/3 slices landed; see Item 6.

### UI/UX — locked 2026-09-10 (user decisions, wave 3)
- **Versions UI** lives in the EXISTING FilePropertiesDialog as tabs `정보 | 버전` inserted
  between the title bar and the gradient thumbnail header (no standalone dialog, no new menu
  entry — reached via Properties). Version rows: number + created_at + HEAD size + "현재" badge +
  expired marker; download/restore are ICON-ONLY buttons (Tooltip + aria-label, no text); the
  close button is the existing fixed bottom action bar across tabs. WebDAV mode renders no
  Versions tab. E2E via E2E-PROPS-001/002.
- **Trash view**: `__trash__` virtual root mechanism unchanged; row subtitle (original path +
  deleted date) DROPPED (space + in-trash navigation makes it redundant — trash listing is
  hierarchical: root level = topmost trashed items, trashed folders are navigable via
  GET /api/files/trash?parentId=). Sidebar entry is NOT a FolderTree section — a **bottom-pinned
  row** under the tree lines: `{휴지통 아이콘} 휴지통` → /files/__trash__.
- **Delete feedback**: main-view confirm copy UNCHANGED; on trash completion the pinned trash
  icon animates (lid open→close) and flashes default→error→default (two-part SVG + CSS keyframes).
- **Actions**: per-item Restore/Permanent-delete icon buttons also in the properties dialog action
  bar for trashed items (next to fixed close, error accent for purge); Empty-trash is an
  ADMIN-only ICON button in the controls (sort/view-mode) row; restore/purge gates per the ACL
  review (purge = delete perm, empty = admin). Main-view "Delete" label unchanged.
