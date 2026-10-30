# PLAN_EXECUTION.md — AI-Driven Storage: Execution Ledger (§9–§33)

> Historical execution ledger split from [PLAN.md](PLAN.md) on 2026-10-29.
> Current status, active tasks, and binding conventions live in [PLAN.md](PLAN.md).
> Section numbers are preserved verbatim: a bare `PLAN §N` citation for N ≥ 9
> refers to this file, while §6–§8 remain in `PLAN.md`.

## 9. P0 execution waves (execution ledger — overlay; §7 task rows/definitions unchanged)

> TDD per AGENTS §2.1 (docs → RED → GREEN → verify → merge). Status markers:
> `[todo]` → `[wip]` → `[done]`. Root ruling 2026-09-22: T0.2, T0.12, T0.7b, T0.11 are the
> dependency-free entry points. T0.1's remaining scope (boot completeness probe + failsafe
> row + repair backfill) depends on T0.2 (`admin_reports` DDL) and T0.8 (repair endpoint) →
> absorbed into Waves 1–2; its write-side is already implemented (content_hash DDL +
> commit-point population + tests verified in FileNodeRepository twins).

| Wave | Tasks (parallel)                                                                                                                                                              | Entry condition                         | RED-first test targets                                                                                                                                            | Status                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 0    | T0.2 ∥ T0.12 ∥ T0.7b (∥ T0.11 if capacity)                                                                                                                                    | none (roots)                            | T0.2: 3 conformance twins + dual-dialect §5 table-presence; T0.12: node:sqlite driver + BigInt PK binding; T0.7b: en/ko i18n key mirror + settings/flags exposure | `[done]` — T0.11 carried into Wave 2              |
| 1    | T0.3 ∥ T0.6 ∥ T0.7 ∥ T0.8 (+ T0.1 absorbed)                                                                                                                                   | T0.2 + T0.7b merged                     | T0.3: camelCase req / snake_case res + activity_score fallback sort; T0.8: NULL content_hash backfill idempotency                                                 | `[done]`                                          |
| 2    | T0.4 ∥ T0.5 ∥ T0.9 ∥ T0.11 (carried from Wave 0) + pre-tasks: register (c) (failsafe-row consolidation, small `chore/`) and register (f) (test-infra leak fix, small `test/`) | T0.3 API surface (client) / T0.2 (T0.9) | component+hook tests; T0.9 hash-first dup (NULL never forms a group), derived tags v1                                                                             | `[done]`                                          |
| 3    | T0.10 → P0 exit gate                                                                                                                                                          | T0.9 + T0.7 + T0.8 merged               | dashboard blocks per §4.16                                                                                                                                        | `[done]` — P0 exit gate now with the orchestrator |

- **Wave-2 execution (2026-09-22)**: pre-tasks register (c)/(f) landed on `ai-feature`
  first (`chore/register-c-probe-consolidation`, `test/register-f-test-infra-leak` — the
  env-restore fix + PG-leg sqlite guard); T0.4/T0.5/T0.9/T0.11 executed in parallel via
  isolated worktrees and merged in T0.9→T0.11→T0.4→T0.5 order (conflicts resolved:
  FileNodeRepository conformance dual-describe, locales key unions, gateway/mocks seam
  unions); orchestrator mounts `/api/search` + `/api/file-likes`; integration branch
  `feature/wave2-client-wiring` closed the three deferred host seams (provenance below).
  Full gates: server `test:ci` 126 suites / 2341 tests; client `test:ci` 172 suites /
  1667 tests; `test:ci:pg:adapters` 23 suites / 341 tests — all green (two single
  non-reproducible first-run flakes re-ran clean, RCA-logged).

- **Wave-3 provenance (2026-09-23)**: branch `feature/t10-storage-dashboard` (worktree wt-t10) — T0.10
  shipped docs→RED→GREEN. New domain `server/domains/dashboard/{routes,service}.js` (GET / = ONE
  dupFinder pass feeding duplicates + computed exact-dup suggestions [keep rule = smallest node id] +
  trash subtree summary via the NEW `FileNodeRepository.summarizeTrashedSubtree` twins; POST
  /suggestions/accept = owner-gated `fileService.deleteNode`, per-node classification, NO journal row —
  command-unit undo rides T3.3); register (d) capture landed in `collectionsStore` (every
  collection-subject commit carries subject_label); client `CollectionDashboard`/`SuggestionsChecklist`
  - `storage` registry entry + `getActions`/`getFileSuggestions`/`acceptFileSuggestions`
    repository/gateway/mocks seams + `useUndoToast.undoNow` + en/ko mirrors.
    **Orchestrator integration (index.js not edited by task branches):** after line 182 add
    `app.use('/api/dashboard', setupModeGuardInstance, require('./domains/dashboard/routes'));`.
    PG leg REQUIRED for the new repository surface (conformance block shipped; `test:ci:pg:adapters`
    not run here — no e2e container in the task env). Deferred by spec: `dismissFileSuggestion` +
    persisted suggestion ids (T3.3), storage-usage series seam (later task — block omitted), dup-finder
    dedicated-view deep link (the card scrolls to the suggestions block in P0).
    Gates (targeted): server 27 suites / 447 pass + locale-mirror 12; client 20 suites / 238 pass;
    eslint/prettier clean.

- **Wave-3 execution (2026-09-23, T0.10 docs step)**: branch `feature/t10-storage-dashboard` (worktree wt-t10).
  Register (d) DECIDED: journal member-op rows DO need `subject_label` — every collection-domain
  journaled mutator now captures the label at commit time (collection name;
  `store/collectionsStore.md` §2.1 capture table). New server surface: `/api/dashboard`
  (GET summary + POST suggestions/accept — `routes/dashboard.md`, computed P0 exact-dup
  suggestions, no journal writer until T3.3) + `FileNodeRepository.summarizeTrashedSubtree`
  (PG leg flagged) + client `CollectionDashboard`/`SuggestionsChecklist`/registry `storage`
  entry + `getActions`/`getFileSuggestions`/`acceptFileSuggestions` repository seams.
- **Wave-3 closure & P0 exit gate — PASSED 2026-09-23**: orchestrator mounted
  `/api/dashboard` (`server/index.js`, commit 3dbf34a). Boot coverage gaps
  (bootSequence.md §5 L93/L94/L98/L99) closed by owner-directive immediate processing
  (`test/boot-sequence-coverage`): child-process boot suite + Case-A fix — the [D6]
  backend pre-flight moved to boot entry so partial `WEA_DB_*` fails with
  `Initialization failed:` + exit(1) instead of a require-time stack trace; §5 fully ticked.
  P0 lifecycle E2E (`test/e2e-collections-lifecycle`): `E2E-COLLECTION-001..009`
  scratch-hermetic `collections-desktop` (:5013), 3 consecutive fully-green runs (35–37 s);
  the run surfaced 5 Case-A defects — nested item-inverse undo no-op, `listForUser` status
  default leak, `include=archived` semantics, tied-timestamp list order (`id DESC` tie-break),
  unreachable file-side Add-to-collection host entry — all fixed + RCA-logged (2026-09-23).
  Final gates: server `test:ci` 129 suites / 2370 tests; client `test:ci` 174 / 1700;
  `test:ci:pg:adapters` 23 / 344 — all green. **Degradation matrix** is structurally P1+
  (no AI surfaces exist in P0); its suite lands with T4.3 — **owner-confirmed ruling
  (2026-10-02, P0 closeout)**: the matrix stays with T4.3 (P1+), and the P0 lifecycle suite is
  COMPLETE — desktop `E2E-COLLECTION-001..014` plus the mobile leg `015..017`
  (`collections.mobile.spec.ts`, scratch `:5014`), run green in BOTH backend modes
  (s3 + webdav, 3 consecutive 17/17 each; closeout batch commit).
  `ai-feature` now carries the merged P0.
  (`ai-feature`→`dev` merge remains a single event after ALL §7 phases.)
- **P0 spec-purity pass (2026-10-02)** — branch `chore/p0-spec-decision-extract` (orchestrator,
  docs-only): decision process (dated rulings, WHY/rationale, rejected/retired narratives,
  register/task/wave provenance) was lifted from all 48 P0-created spec docs +
  `docs/features/collections-platform.md` into the new **AI_FEATURE_PLAN.md §12 ledger**;
  specs now state decided behavior only. Body amendments where specs
  revealed the plan stale: Path 1 (`leave` retired), publish gate (owner∪editor∪null),
  digest cursor/new-dot + Ruling B, dashboard accept un-journaled until T3.3, `__liked__` root
  rejected, digest-count approximations, LLM `dbOnly` env-ignored (SETUP.md synced; llmPresets
  measurement checklist relocated to `docs/SETUP.md` runbook section). Code-verified
  restatements: fileLikes items = one response, `cursor`/`limit` ignored, `node_id` asc,
  insert-only `created_at`; `setVisible` has no route caller. **Follow-up (same date, owner
  ruling: AGENTS.md §2.1.5 is standing policy — "spec/feature docs link spec docs only and
  describe implemented/decided state only"):** all AI_FEATURE_PLAN/PLAN links and every
  ruling/task/D-label provenance stripped repo-wide across docs/spec/**, docs/features/**,
  api.md, shared-contracts.md, SETUP.md, E2E_COVERAGE_PLAN.md — rules inlined as plain
  current-state text (~530 pointers; 6 restatements where a label anchored the only
  definition); bare design pointers re-anchored to the named feature doc
  (`docs/features/collections-platform.md`); dead `§5` design-owner fragments dropped
  (schema lives in the store specs themselves); migration-mode.md's own in-document
  D1–D14 registry kept (self-contained, no planning-doc link). Verification: plan-doc
  citations and P0 marker-grep zero across all docs/spec + docs/features + core docs;
  every named `file.md §X` target heading verified; content-loss audit over the 15
  highest-risk rewrites clean; prettier clean;
  no code/test files touched (docs-only → suites unaffected by design).
- **Wave-1 provenance (2026-09-22)**: branch `feature/t08-admin-reports-repair` — T0.8 + the
  T0.1 remainder landed: `admin_reports` store (`server/store/adminReportsStore.js`,
  AdminReportsRepository sqlite/postgres twins + conformance), `GET /api/admin/reports(/:id)`
  - the kind/action-dispatched `POST /api/admin/reports/:id/repair` (`content_hash` NULL-hash
    backfill (idempotent, `WHERE content_hash IS NULL`), `repair-sync`/`perm-delete`
    delegations to the §2.2.3 cores — mounted via the maintenance module router, no
    `index.js` edit), FileNodeRepository content-hash completeness surface
    (`countCacheRowsWithNullContentHash`/`listCacheRowsWithNullContentHash` keyset-paged/
    `setCacheContentHash` + conformance), and the boot completeness probe
    (`kind='failsafe'` row with the `contentHashCompleteness` section, warn log,
    `WEA_SKIP_ADMIN_REPORTS`-honoring) kicked fire-and-forget from
    `cleanupService.ensureHomeOwnerAdminForAllUsers`. Residuals flagged to the orchestrator:
    (a) merging the probe section INTO the `maintenanceScheduler.runStartupFailSafeRecovery`
    failsafe row (§3.2 wording) is deferred to the T0.6 owner — the probe emits its own
    `kind='failsafe'` row today; (b) upload/copy/restore commit points still persist NULL
    `content_hash` — write-side population exists only at the blob-migration commit points,
    and per §4.1 the upload-point population rides the ai_jobs enqueue task; the probe +
    backfill cover the gap until that lands.
- **Wave-1 execution (2026-09-22)**: T0.3/T0.6/T0.7/T0.8 executed in parallel via isolated
  worktrees and merged in T0.3→T0.6→T0.7→T0.8 order — `feature/t03-collections-crud`
  (6 commits), `feature/t06-usage-activity-rollup` (3), `feature/t07-actions-feed-undo` (5),
  `feature/t08-admin-reports-repair` (3). Orchestrator integration: the `/api/actions` mount
  and the `startUsageRollupScheduler` boot wiring in `server/index.js`; `USAGE_ACTION` enum
  added to `shared/constants.js` (consumed by `usageService`). Gates: server `test:ci`
  117 suites / 2229 tests, client `test:ci` 164 suites / 1494 tests, `test:ci:pg:adapters`
  22 suites / 314 tests — all green. Deferred follow-ups recorded in the register below.
- **Deferred follow-ups register (wave-1 deferrals, 2026-09-22)** — sub-work recorded here,
  not in `docs/IMPROVEMENT_PLAN.md`: (a) usage-event recording wiring DONE 2026-09-22 (wave 2) —
  like (T0.5), search_hit + list-entry-click (T0.11 `POST /search/click`), download/preview
  (T0.5 files-domain call sites); `open` and `GET /versions/download` deliberately not recorded; (b) upload/copy/restore `content_hash` write-side population rides the §4.1
  hook wiring in T1.3 (P1) — boot probe + backfill cover the gap meanwhile; (c) DONE 2026-09-22 (wave-2 pre-task):
  consolidated — startup row is now a single `kind='failsafe'` row whose payload merges the
  scan report and the section; (d) DONE 2026-09-23 (T0.10 docs step) — DECIDED YES: the feed renders member-op rows from
  `subject_label` verbatim, so every collection-domain journaled mutator captures the label
  at commit time (`store/collectionsStore.md` §2.1); (e) `is_tip` becomes per-subject server-side computation when
  T3.2 introduces cross-user writes (P3); (f) pre-existing test-infra leak —
  `migration.test.js` writes `data/webdav.db`, `createTestDatabase` cleanup can leave
  `WEA_SQLITE_PATH='undefined'` (stray `server/undefined` SQLite files) — DONE 2026-09-23
  (wave-2 pre-task `test/register-f-test-infra-leak` + leak source `sqliteDriverMigration.test.js`
  seam describe owning its env + test-setup per-worker default; full server+PG legs verified
  creating no `data/webdav.db`).
- **Wave-0 spec debt found during planning (2026-09-22, resolved in the T0.12 PR)**: §6/T0.12
  said the sqlite driver is confined to `db/sqliteExecutor.js`, but the real `sqlite3` npm
  sites are `store/storage.js`, `metadataMigrationService.js`, `sqliteSchemaInit.js`,
  `metadataPresence.js` — T0.12 updated `docs/spec/server/store/{storage,executor}.md`
  in its PR (docs-first).
- **Wave-0 provenance (2026-09-22)**: branches `feature/t02-full-schema-ddl` (4 commits),
  `refactor/t012-node-sqlite-driver` (3), `chore/t07b-tier-a-plumbing` (3) merged into
  `ai-feature`; two integration defects surfaced by the full gate were fixed and RCA-logged
  (see `docs/RCA_LOG.md` 2026-09-22 entries). Gates: server `test:ci` 108 suites / 2057 tests,
  client `test:ci` 159 suites / 1438 tests, `test:ci:pg:adapters` 20 suites / 291 tests — all green.
  Known-open: one non-reproducible gcService test flake under parallel CI load (RCA-logged).
- **Wave-2 client-wiring provenance (2026-09-23)**: branch `feature/wave2-client-wiring`
  (worktree wt-wire) closed the three orchestrator-deferred host seams: T0.11 results shell
  (shell-mounted `useSearchResults`, breadcrumb-row swap in the view, submit/row-open/exit
  wiring, logout chip clear), T0.5 like state (NEW `fileLikesRepository` + gateway
  `listDirectory` `liked` merge, optimistic `handleToggleLike`, notifier refresh,
  context-menu/action-sheet/properties callbacks), and T0.4/T0.5 member-row menu (shell-owned
  `MemberRowControls` instance on `onMemberAction('menu', row, anchorEl)` → exclude/publish/
  download/show-original/properties/like). Surfaced two Case-A integration defects (RCA
  2026-09-23): client `recordSearchClick` sent `{ nodeId }` against the server's `{ node_id }`;
  `MemberRowControls` crashed on the closed single instance. Gates (targeted union):
  client 45+ suites / 578 tests green incl. FileManager shell 33; eslint/prettier clean.
  Residuals: search-origin save-confirm dialog copy + server-side flatten (T1.5), explorer
  `Add to collection` host wiring + member bulk variant + for-nodes chips (T3.6), unpublish
  and the `/publish` endpoint itself (T3.2), dashboard blocks (T0.10).
- **Wave-2 T0.11 provenance (2026-09-22)**: branch `feature/t11-name-search`
  (worktree wt-t11) — server-wide name search P0: `server/domains/ai/`
  (searchService P0 name section + `sr1.` replay signature + fire-and-forget
  `search_hit` recording; routes POST `/` + POST `/click` = the §3.4
  list-entry-click recording point, `action='open'`), FileNodeRepository
  sqlite/postgres search surface (`searchNodesByName`/`sampleVisibleNodeIds`,
  ACL = own-root closure ∪ path grants ∪ point grants) + conformance block,
  `search` error domain + `SEARCH_NAME_LIMIT` registry entry, client
  results-mode tree (useSearchResults, SearchBarResultsMode,
  FloatingSearchBar §3, useExplorerSession §3 D1 passthrough,
  searchHighlight util, runSearch/recordSearchClick seams,
  recentQueriesStorage adapter) + en/ko locales mirror. 4 commits
  (`docs:`/`feat:`/`style:`/`feat:`). Targeted gates green: server
  domains/ai 28 + conformance 47 + neighbor suites; client 7 suites / 96
  tests; eslint/prettier clean. **Orchestrator integration (index.js is not
  edited by task branches)**: after line 180 add
  `app.use('/api/search', setupModeGuardInstance, require('./domains/ai/routes'));`.
  Page-shell composition (FileManager.js ↔ FileManagerView): render
  `SearchBarResultsMode` in place of the Breadcrumb row while
  `useSearchResults().mode === 'results'`, wire `onSubmitQuery` from
  `useExplorerSession` → `submitSearch`, typing → `setFilterText`, row open →
  `recordEntryClick(nodeId)`; `clearRecentQueries()` joins
  `useAuthSession.logout`. Search-origin server-side collection creation
  (flattening + confirm dialog copy) rides T1.5.

## 10. UI polish waves (P0→P1 bridge)

> Owner-adjudicated 2026-09-29 (briefing approved). Binding decisions: Path 1 — the viewer
> `Leave` becomes a REAL self-grant revocation (`DELETE /api/collections/:id/grants/me`,
> labels unified with the file-sharing receiver term: EN "Revoke permission" / KO "권한 반납";
> the §3.1/§4.7 "recipient-local hide" wording is amended docs-first, `hiddenIds` view-local
> hide removed); grid-parity cards with 2×2 recent-member previews (no name labels,
> icon→batched-thumbnail swap, revoked/shared_excluded excluded, `preview_items` from the
> already-resolved rows + one mime field); file-parity click semantics (single=select,
> double=open, mobile tap=open; card menu loses `open`); selection bar = fixed set by
> surface like files (active: Pin/Unpin/Archive; archive view: Restore/Delete — no
> Rename/Leave/Sharing); one context-aware sort button (private menu deleted, ephemeral
> state); member view modes with per-surface storage key (`collectionMemberViewMode`,
> default grid, file browse untouched); member publish ships its spec'd route
> (`PUT /:id/items/publish` — client seam URL corrected, owner `granted_role` visibility
> bug fixed); Likes as a Collections-section child row (`/files/__collections__/liked`,
> `GET /api/file-likes/items`, reuses the member machinery).

- P-1 Path-1 grants/me endpoint + label unification + spec amendments — S–M | `[done]`
- P-2 sort-button context awareness (C2) + E2E sort coverage — S–M | `[done]`
- P-3 shared tile/grid extraction, preview quadrant, click model, selection bar, toggle hiding (C1) — M+ | `[done]` 2026-09-29: branch `feature/polish-p3-card-grid` — docs+server(payload)+client(impl+tests) committed; FileGrid\*/FileGridItem anchors unchanged-green; full client 1753, server collections 91, e2e collections-desktop 10/10; awaits orchestrator full gates/E2E.
- P-4 member view modes + publish route + granted_role fix (C3) — L | `[done]` 2026-09-29: branch `feature/polish-p4-member-views` — docs step 4e9d321 + impl committed (server publish route, shared-renderer members swap, per-surface `collectionMemberViewMode`, publishItems PUT seam, owner publish-visibility fix, member bulk seams, synthetic-key selection reset). Client 1795/1795, server 2400/2400, e2e collections-desktop 12/12 (new 011/012); awaits orchestrator merge gate.
- P-5 Likes child-row + liked-items endpoint (C4) — L | `[done]` 2026-09-29: branch `feature/polish-p5-likes-view` — docs 9c41cf2 + server endpoint 0a76de0 (GET /file-likes/items: node_id asc, revoked/trashed classification, cursor 50/200) + client d60d406 (sidebar LikesNode, collections-liked route, likedItems member-parity surface, likedViewMode key, collection:null menu gates, optimistic unlike) + e2e 5e66f51/fix. Client 1818/1818, server 2407 pass, e2e collections-desktop 13/13 (new 013); no SQL added (PG conformance leg N/A); awaits orchestrator merge gate.

Order: P-1 ∥ P-2 → P-3 → P-4 → P-5 (P-5 server part may join P-4).

- **§10 closure (2026-09-29)**: all five merged into `ai-feature`. Final orchestrator gates:
  server `test:ci` 130 suites / 2407 tests, client `test:ci` 175 / 1818, PG conformance
  (fileLikes+collections scoped) 36, `collections-desktop` E2E **13/13** (ids 001–013).
  Discussion outcomes: (1) the members-cursor page-boundary gap was resolved by owner
  decision B (fetch-all + client slice — mechanism deleted, see the B decision record);
  (2) worktree E2E resource contention fixed root-cause (a-full): project-scoped containers
  (`container_name` removed) + per-checkout port bands with generated runtime env — verified
  by a busy-base-ports parallel simulation (13/13) and the main-checkout default-band run
  (13/13).

### Decision B — member/liked listing: fetch-all + client infinite slice (2026-09-29 owner ruling)

Owner decision (verbatim):

> "Member/liked listing returns the complete row set in ONE response (fileManager precedent:
> getChildren has no LIMIT, client useInfiniteScroll slices 50+50). Server cursor/next_cursor/limit
> and the load-more button are RETIRED. This also eliminates the members-cursor page-boundary
> defect class by deleting the mechanism."

Execution: `feature/polish-b-member-fetch-all` (docs → RED → GREEN → E2E). Binding consequences:

- `GET /:id/items` and `GET /api/file-likes/items` ship the FULL row set in one response; the
  retired `cursor`/`limit` query params are **IGNORED** (never an error) and `next_cursor` is
  absent from the wire shape. Client display paging: shared `useInfiniteScroll` (50+50) in the
  members host — server order preserved, no client re-sort.
- RETAINED (decision `routes/collections.md` GET /:id/items): the visit stamp
  (`collection_digest_cursors.last_visited_at` on read — one fetch per open fits it even better)
  and the digest counts via `since`.
- Wire helpers `encodeCursor`/`decodeCursor` and the `clampLimit`/limit caps are deleted
  (no other consumers — grep-verified at implementation time).

- **B member-fetch-all (2026-09-30)** — branch `feature/polish-b-member-fetch-all`: docs 341fe74 +
  server bb3f157 (`getItems`/`listLikedItems` full set, routes ignore retired params, wire helpers
  deleted) + client 326989d (repos drop cursor/limit; `useFileManager` one-fetch state;
  `CollectionsListView` hosts the shared `useInfiniteScroll` 50+50 slice + sentinel; load-more
  button + `memberLoadMore` i18n deleted). RED captured (2 server + 4 client failures) before
  GREEN. Gates: server `domains/collections` 108/108, `domains/{collections,admin}` 336 pass
  (3 pre-existing skips); client union 272 + pages/FileManager 44 pass; `collections-desktop` E2E
  **13/13 green** (no spec edits — fixtures <50 rows, no `member-load-more`/`next_cursor`
  assertions existed). No repository/SQL touched → PG conformance leg N/A. Awaits orchestrator
  merge gate.

## 11. Micro-polish wave (M-1..M-9)

> Owner-adjudicated 2026-09-30 (briefing). Nine display/menu/structure polish items on the
> `ai-feature` collections surfaces (base 5f65d03, includes P-1..P-5 + B + e2e isolation).
> Branch `feature/polish-11-micro`; three batches, each docs-first → RED → GREEN, committed
> atomically. Binding owner decisions recorded inline per item.

Batch A — display/content:

- M-1 member-count display REMOVED (card footer "N items" + tree-row secondary count;
  `fileManager.collectionsItemCount` dropped en+ko) — S | `[done]`
- M-4 card chips → TOP-LEFT MEDIA BADGES (binding 2026-09-30: badge SET = received
  `FolderSharedIcon` + autopin `PushPinIcon` real-button (click = existing `unpin` dispatch);
  the `Checkroom as SharedChipIcon` import is RETIRED (icon unified with the tree's
  `FolderShared`); the status `archived` Chip is DELETED entirely — archive membership is
  already view-scoped; testids `card-shared-chip-<id>`/`card-autopin-chip-<id>` MOVE onto the
  badges; shared tooltip reuses `nav.collectionsSharedChip`, autopin aria/tooltip reuse
  `collectionsAutoPin`) — M | `[done]`
- M-7 digest banner renders ONLY when `(digest?.added_since ?? 0) > 0 || (digest?.removed_since ?? 0) > 0`
  (a since-requested all-zero digest is noise) — S | `[done]`

Batch B — menu/visual:

- M-3 card-menu icons on ALL items (rename `Edit`, archive `Archive`, restore `Unarchive`,
  delete-permanent `DeleteForever`, revoke-permission `ExitToApp`, sharing `Share`,
  pin/unpin `PushPin` kept) — S | `[done]`
- M-5 like color token: theme palette gains `like:{main:'#FF3E55'}`; like-state icons move
  `color="error"` → `color="like"` (delete-red vs like-pink semantic split documented at the
  theme) — S | `[done]`
- M-6 binding (2026-09-30): AddToCollectionMenu long names — tail-truncate
  (`textOverflow:'ellipsis'`) replaced by `pixelMiddleTruncate` with a FIXED menu-width
  budget (seed dialog `maxWidth="md"` = 900px ⇒ per-tile text budget constant 190px,
  font metrics per CollectionsSection idiom) — S | `[done]`

Batch C — structure:

- M-2 binding (2026-09-30): pseudo-tiles on the collections GRID — Likes tile FIRST,
  Archive tile LAST (active list); ARCHIVE VIEW shows ONLY the Likes tile; LIKED surface
  shows NO tiles; tiles are excluded from selection/sort/cluster/card-menu logic AND from
  the empty-state gate (empty section still shows tiles). Tree: LikesNode moves to TOP
  (before active collection rows; Archive stays last). Verified routes: liked
  `/files/__collections__/liked`, archive `/files/__collections__/__archive__`
  (useFileManager urlView) — M | `[done]`
- M-8 member/liked sorting like files: `sortHidden` on members REMOVED; surface-aware
  FILES-style menu bound to new per-surface persisted `collectionMemberSortMode`
  (default `date_desc`); the FULL row set is sorted client-side BEFORE the
  `useInfiniteScroll` input (name → lowercase localeCompare parity; date → `created_at`
  = membership-ADDED date, wire `serializeItem.created_at`; rows lacking it (revoked →
  null) pin to END); liked surface shares the state; collections LIST surface keeps the
  P-2 5-server-option menu unchanged — M | `[done]`
- M-9 binding (2026-09-30, option (a)): breadcrumb title chips — Breadcrumb gains
  collections awareness: member route renders `Collections › <name>`, liked route
  `Collections › Likes` (home-chip replacement precedent of trash/recent). Collection name
  resolved from the existing useCollections fetched list matched by collectionId; while the
  list is not yet loaded the transient `Collections › …` segment renders (option (a) —
  never hides the trail) — M | `[done]`

Verification: targeted suites per batch; final gates = full client suite +
`collections-desktop` E2E (assertions updated: E2E-002 count assertion removed, E2E-004
status-chip assertion removed; new E2E-COLLECTION-014 tiles case).

- **11 execution log** — branch `feature/polish-11-micro`:
  - Batch A (M-1/M-4/M-7): `[done]` — docs commit 7772d34; RED captured (6 failures / 3 suites)
    before implementation. GREEN: targeted client suites `CollectionsListView|CollectionsSection|
GridCardPrimitives|FileGridItem` 89/89 + `FileManagerView|pages/FileManager` 82/82; locale
    mirror suite 12/12; eslint/prettier clean on touched files; E2E spec updated (002 count
    assertion dropped, 004 status-chip assertion dropped — 006 verified chip-free). Awaits
    orchestrator final gates.
  - Batch B (M-3/M-5/M-6): `[done]` — docs commit 2a919b2; RED captured (7 failures / 5 suites)
    before implementation. GREEN: targeted client suites
    `CollectionsListView|AddToCollectionMenu|FileContextMenu|MemberRowControls|AppTheme|
FileActionSheet|FilePropertiesDialog` 140/140. M-5 clarification: no pre-existing test
    asserted error-color on likes (verified by grep) — pink/`like`-token assertions ADDED instead
    (FileContextMenu + MemberRowControls) + `AppTheme` palette contract; `test-utils.jsx` theme
    mirrors the token (kept-in-sync comment). M-6 clarification: the `:248` tail-ellipsis is the
    seed-dialog sample-TILE name style (the only one in the file) — middle-truncated with the
    documented 190px budget. eslint/prettier clean on touched files. Awaits orchestrator gates.
  - Batch C (M-2/M-8/M-9): `[done]` — docs commit 77d3479; RED captured (3 test-side corrections
    after first run: file-key persistence-on-mount assertion relaxed to `not.toHaveBeenCalledWith`,
    tile-absence test needed `unmount()`, P-5 liked-surface test flipped to the M-8 contract — all
    Case B test errors, implementation unchanged) → GREEN:
    `useExplorerSession|CollectionsListView|FileManagerView` 126/126;
    `CollectionsSection|Breadcrumb|FileManagerControls|useFileManager|pages/FileManager` +
    anchors `GridCardPrimitives|FileGridItem|FolderTree*` all pass. Verified routes: liked
    `/files/__collections__/liked`, archive `/files/__collections__/__archive__`
    (`useFileManager.js` urlView). E2E: 011/013 sort-visibility flips + new case 014
    (tiles/navigation/breadcrumb). eslint/prettier clean on touched files. Awaits orchestrator
    full gates (client union + collections-desktop E2E).
  - **§11 final gates (this wave, awaiting orchestrator [done]):** full client suite **176
    suites / 1856 tests pass** (base 1818 + 38 new); server leg unchanged and verified green
    (`domains/collections` + locale mirror: 6 suites / 120 pass, no server source touched);
    `E2E_BACKEND_MODE=s3 collections-desktop` **14/14 green** (001–013 updated assertions +
    NEW 014 tiles/navigation/breadcrumb; wt-11 port band, own containers). Batch commits:
    A `7772d34`+`2dbfff5`, B `2a919b2`+`e822480`, C `77d3479`+`dc2eebb`. No repository/SQL/
    schema touched → PG conformance leg N/A.

- **§11 closure (2026-10-01)**: merged `feature/polish-11-micro` (batches A/B/C). Final
  orchestrator gates: server `test:ci` 130 suites / 2407, client 176 / 1856,
  `collections-desktop` E2E 14/14 (001–014) — all green. One follow-up test fix landed
  alongside (derivedTags month expectation → production-derived, TZ-safe; RCA 2026-10-01).
- **§11 follow-up 2 (2026-10-01, owner ruling):** ArchiveNode count badge removed (M-1
  purity — the sidebar shows no numeric counts): `archiveCount` state/prop/`Badge` and its
  second `mine,archived` fetch deleted from the tree path; parity specs updated.
- **§11 follow-up 3 (2026-10-01, owner decisions — F4 report follow-up):** the report-only
  inventory is recorded in the F4 entry of the follow-up batch below.
- **§11 follow-up 4 (2026-10-01, owner badge round):** card badges split by pin kind — auto-pin = PushPin+AutoAwesome
  composite (click unpin), user pin = plain PushPin (new `collectionsUserPin` key, click unpin, testid
  `card-userpin-chip-*`); received marker on cards switched to the generic `Share` glyph and the TREE's
  received icon swap was retired (plain Collections icon). Pending-color RESOLVED (owner,
  2026-10-02 closeout): the warning tone sits on the badge CARRIER (plate/inline wrapper) —
  `98ca99a` (tone moved off the pending glyphs), spec + tone-carrier pin `ebc0ba9`, corner
  badges inset to 8px `768790b`/`e483466`.
  member-state CHIPS become shared BADGE markers rendered in ALL three member views. Owner
  decisions (binding): `shared_excluded` → `VpnLock` icon (globe+padlock — "member file not
  delivered to collection viewers"); publish-pending → composite `Public` (globe) + 10-12px
  `Pending` glyph overlaid top-left, defined ONCE as a shared component (`MemberStateBadges.js`),
  inheriting currentColor. Testids `member-excluded-badge-<nodeId>` /
  `member-publish-pending-badge-<nodeId>` replace the `-chip-` ids everywhere (tests/E2E/specs);
  tooltips `fileManager.memberNotShared` / `fileManager.memberUnpublishedBadge`; the KO-orphan
  key `fileManager.sharedExcludedChip` (truncated KO value) DELETED en+ko after migration; the
  `MemberRowControls` in-menu `member-not-shared` chip STAYS (menu-internal detail, prior owner
  call). Geometry: list = overlay on the leading icon/avatar column; grid = `CardTile.cornerBadges`
  slot top-left (M-4 mirror); detail = inline 16px before the name. Gating fix: revoked rows render
  NEITHER badge (the chip-era flag-only gating leaked the pending chip onto revoked rows —
  `service.js` revoked stored rows carry `published:false`). Spec: MemberStateBadges.md. Branch
  `feature/11-member-state-badges` (worktree wt-badge off `ai-feature` @ 65b7096); docs-first →
  RED → GREEN. `[done]` — gates: full client suite **178 suites / 1895 pass** (branch base
  177/1869 + 1 suite / 26 tests); server leg N/A (only the `fileManager.sharedExcludedChip`
  en+ko deletion — locale-mirror suite (`serverErrorCodesI18nMirror`, serverErrors.\* scope)
  re-run green); `E2E_BACKEND_MODE=s3 collections-desktop` **14/14 green first run** (012
  migrated to badge ids, asserted in grid default AND the kept list path). Commits: docs
  `ca25263`, RED `6f6e190`, GREEN+locales `c43855a`, E2E `4170bdc`.

- **§11 follow-up 5 (2026-10-02, owner ruling 2026-10-01 — per-collection new dot):** the
  sidebar dot rule becomes the SERVER cursor: dot ⇔ the requesting user has NEVER opened
  that collection (`GET /` row `last_visited_at == null`). `createCollection` SEEDS the
  creator's digest cursor (`last_visited_at = created_at`) INSIDE the same journaled create
  TX — self-created collections never dot; collections shared to me dot until first open;
  opening (`GET /:id/items` stamp, existing) clears on the next list refresh. Server: new
  repo `listDigestCursorMap(userId)` (both dialects + conformance: two seeded cursors +
  absent-row case) → facade passthrough → one batched read in `listCollections`, attached
  to `serializeCollection` rows. Client `useFolderTreeController`: `COLLECTIONS_VISIT_KEY`
  localStorage cursor, its write effect and the `created_at > cursor` comparison are
  REMOVED; `newCollectionIds` is NULL-based; rows re-fetch when `currentPath` returns to
  `/__collections__`. Note: revoke→re-grant keeps the grantee's stale cursor (no re-dot) —
  accepted, flagged for owner. **→ RESOLVED by ruling B (owner, 2026-10-02, P0 closeout):**
  both revoke paths now DELETE the grantee's cursor row inside the journaled revoke TX —
  re-grant after revoke RE-DOTS; `undoAction` of a revoke restores the grant but NOT the
  cursor (undo-revoke re-dots — accepted boundary). Spec: collectionsService.md §2.8. Branch `feature/per-collection-new-dot` (worktree wt-dot off
  `ai-feature` @ 4e303b9); docs-first → RED → GREEN. `[done]` — gates: server `test:ci`
  **130 suites / 2447 pass (5 skipped)**; PG leg `test:ci:pg:adapters` **23 suites /
  346 pass (1 skipped)** incl. the new cursor conformance; client **178 suites / 1919
  pass**; `E2E_BACKEND_MODE=s3 collections-desktop` **14/14 green** (002 carries the
  no-dot-on-self-create pin + `last_visited_at` truthy on the creator row). Commits:
  docs `94a7f9d`, RED `a8a2d9a`, GREEN + ledger `this`.
- **§11 FOLLOW-UP batch (2026-10-01, owner-spotted post-ship defects)** — branch
  `fix/polish-11-followups` (worktree wt-11f off `e8e29db`); docs-first `34fefb7` → RED →
  GREEN, one commit per concern:
  - F1 `[done]` M-1/M-6 stragglers on `AddToCollectionMenu` rows: `primary` middle-truncates at
    a FIXED 280px menu paper (budget 192 = 280 − 2×16 MenuItem padding − 56 reserved check
    ListItemIcon; 16px body1 metrics, family idiom per CollectionsSection) and the leftover
    `item_count` secondary is DELETED; `collection-option-*` testids kept. RED 2 → GREEN. `9963b79`.
  - F2 `[done]` M-9 gap closed: `/__collections__/__archive__` breadcrumb renders
    `Collections › Archive` (STATIC `nav.collectionsArchive`, tree parity; parent chip →
    `/__collections__` like the member/liked chain). RED 1 → GREEN. `22aa6d5`.
  - F3 `[done]` archive surface renders ZERO pseudo-tiles (owner ruling supersedes the M-2
    "Likes only" default; active view unchanged: Likes FIRST / Archive LAST incl. empty state);
    CollectionsListView.md M-2 wording amended. RED 2 → GREEN; E2E-014 rewritten (both tile
    testids absent in archive view + Collections › Archive crumb; liked surface reached via its
    verified route since no tile remains there as exit). `d267c70`.
  - F5 `[measured — no behavior change]`: jsdom computed-style measurement (emotion sheet
    rules ARE resolved by `getComputedStyle` — assertable): Recent child row and ALL three
    Collections child rows render `padding-left: 24px` (identical emotion class hash). The
    briefing's "~48px recent" reading conflated the empty-state Box (`:134`) with the rows; no
    shared `SECTION_CHILD_INDENT` constant introduced (minimal-change rule). Parity pinned by
    per-section computed-paddingLeft tests + spec notes in both section specs. `d267c70`.
  - F4 `[report-only]`: full chip/badge inventory delivered to owner (member excluded/
    unpublished chips render list-ONLY while grid/detail comparators track the fields silently;
    `MemberRowControls` in-menu not-shared chip; M-4 card corner badges; ArchiveNode count Badge
    as the remaining sidebar count; search/mypage/migration chips; KO `sharedExcludedChip`
    typo). No code or doc changes.
  - Gates: full client suite **176 suites / 1862 tests** (base 1856 + 6 new); server leg N/A
    (no server source touched); `E2E_BACKEND_MODE=s3 collections-desktop` **14/14 green**
    (two E2E adaptations landed: truncation-aware `uiAddToCollection` fragments, 014 title kept
    under the 255-byte `buildName`→NAME_MAX budget — `49ff9b4`); eslint/prettier clean.

## 12. Refactor — sidebar tree-row unification (owner-directed, 2026-10-01)

Branch `refactor/tree-row-unification` (off `ai-feature` @ bb36c97). ONE shared row primitive
(`TreeRow`) for ALL sidebar child rows (file/shared already share `BaseFolderTreeItem`;
recent/collections join). Owner ruling 2026-10-01: section children move onto the tree's
level-based indent (`pl: level*2`); the F5 24px pins are rewritten to the TreeRow model.
`BaseFolderTreeItem` props surface UNCHANGED — its suite passing unmodified is the regression
gate. Behavior change declared in the ruling: the file-tree name cell's inline
`ResizeObserver`+CSS-ellipsis detection is replaced by the TreeRow observed-width
middle-truncation (single font-metrics source; also retires the last direct `ResizeObserver`
use in a pure view).

| Task            | Objective                                                                                    | Deps  | Verification                                                            | Status   |
| --------------- | -------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------- | -------- |
| R12.1 docs      | TreeRow.md + amend BaseFolderTreeItem/RecentFilesSection/CollectionsSection specs            | none  | owner-ruling date present; prettier clean                               | `[done]` |
| R12.2 RED pins  | rewrite F5 pins to TreeRow usage + cross-section indent equality (recent/collections/shared) | R12.1 | pins FAIL pre-migration; other section tests keep passing               | `[done]` |
| R12.3 primitive | extract `TreeRow`; `BaseFolderTreeItem` consumes it (props unchanged)                        | R12.2 | `BaseFolderTreeItem.test.js` UNMODIFIED green; TreeRow unit tests green | `[done]` |
| R12.4 migration | Recent/Collections child rows → TreeRow; testids/clicks/selection/slice(0,10) kept           | R12.3 | folder-tree suite group green (pins now GREEN)                          | `[done]` |
| R12.5 closure   | full client run + eslint/prettier + report                                                   | R12.4 | 176 suites green; optional s3 collections-desktop E2E                   | `[done]` |

- **§12 execution log (branch `refactor/tree-row-unification`, base bb36c97):**
  - R12.1 docs `37aafb9`. R12.2 RED `f1be9b8` — RED observed: TreeRow suite failed
    (primitive missing), both F5 pins failed (`data-tree-row` absent); the other 27 tests
    in the three suites kept passing. R12.3 primitive `80f5e1b` — `BaseFolderTreeItem.test.js`
    passed UNMODIFIED (regression gate; zero test edits, no justification needed).
    R12.4 migration `c30827c` — pins GREEN.
  - Gates: folder-tree group 8 suites / 67 pass; targeted union (folder-tree +
    `FileManagerView` + `pages/FileManager`) 30 suites / 360 pass; FULL client
    `CI=1 npm test` **177 suites / 1869 tests pass** (baseline 176 / 1861 + TreeRow
    suite with 8 tests); eslint `--max-warnings=0` + prettier clean on touched files;
    `E2E_BACKEND_MODE=s3 --project=collections-desktop` **14/14 green** (own port band,
    project-scoped stack). Server leg N/A (no server source touched).
- **§12 follow-up (2026-10-01, owner ruling A):** the unification equalized PADDING but not the
  reserved leading column — file/shared rows kept the 20px chevron-spacer slot while recent/
  collection rows omitted it (≈24px icon misalignment, reported by the owner). `TreeRowSpacer`
  exported; all sidebar child rows now reserve the leading column; parity pins upgraded to
  assert the leading+icon column pair. Folder-tree group 99/99; BaseFolderTreeItem suite
  untouched-green.

## 13. Cross-leak ownership fix (owner-approved 2026-10-01)

- `[done]` Branch `fix/collections-admin-ownership` (worktree wt-own, base fd1bac4): admin
  cross-leak ownership defect per RCA 2026-10-01. R1 `isOwnerNode` honors the
  admin-owns-everything convention (foreign stays owner-keyed; real cross-leak preserved);
  R1.1 callers enumerated — permissionPolicy/files/trash/fileLikes already admin-guarded or
  ACL-bypassed (unchanged), collections `service.js` :262 the fixed intent; R2 badge matrix
  both-flags → VpnLock only; R3 definitions landed in AI_FEATURE_PLAN §3.2 +
  collections-platform §3.2. Commits: docs `d97bf09` → RED `14bc0f3` → fix `4efa3e9` +
  `0c87b1d` + pins `429f993` → RCA `c8c3cf8`. Gates: server 130/2412, client 178/1895,
  PG 23/344, E2E collections-desktop 14/14 — all green. Known residual (listed, not fixed):
  `loadVisibleCandidates` is home+grants scoped, so an ADMIN requester's DERIVED candidate
  set still misses nodes outside their home subtree — publishItems flip/materialize is
  stored-row based and unaffected; candidate-set widening for admins is a separate ruling.

## 14. Admin-operator pivot — admin never participates in personal-storage surfaces (owner-approved 2026-10-01)

Owner ruling 2026-10-01 (supersedes §13's DEFINITIONAL rows): the admin is a PURE OPERATOR —
collections/likes/dashboard are personal-storage surfaces and the admin actor never participates
in them; enforcement is hybrid (server gates here; client hiding is the sibling UI task). §13 R1
KEPT as-is: `isOwnerNode`'s admin-owns-everything bypass remains the FILE-ACL convention
(permissionPolicy consumers); only the collections DEFINITIONS flipped. §13's residual
"admin derived candidates" (`loadVisibleCandidates`) is declared MOOT — no admin collection flow
exists behind the gates. Error contract: reuse `serverErrors.collections.forbidden` (403) —
no new i18n codes; grantee=admin banned at grant creation; usage recording and the journal are
unchanged (gates make admin rows unreachable). RCA: 2026-10-01 pivot adjudication entry.

| Task             | Objective                                                                                                                                                          | Deps | Verification                                                                                        | Status                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------- | --------------------------- |
| U1 server gates  | `requireNonAdmin` on ALL collections/file-likes/dashboard routes + grantee-admin service ban (+ docs-first flips)                                                  | none | RED→GREEN; server `test:ci` + `test:ci:pg:adapters`; ownerNodeResolver admin tests UNMODIFIED-green | `[done]`                    |
| U2 client gating | collections/likes/dashboard surfaces ABSENT for admin actors (sibling agent, `wt-pivot-cli`)                                                                       | U1   | client suite + eslint/prettier; server 403 already enforces regardless                              | `[done]` (merged `5ac5246`) |
| U3 e2e migration | collections E2E migrated to a regular-user actor (scratch user provisioning, home-based workspaces, dual-token cleanup); admin-403 coverage owned by U1 unit gates | U1   | `collections-desktop` 14/14 twice consecutive                                                       | `[done]`                    |

- **§14 execution log (branch `feature/admin-operator-server`, base `822df02`):** U1 commits:
  docs `d22e617` → RED `df8f654` → gates `5f5a00a` → ledger (this commit). RED observed: 30 new
  gate tests failed, 107 pre-existing green. GREEN gates: server `test:ci` **130 suites / 2441 pass
  (5 skip)**; PG adapters leg **23 suites / 344 pass (1 skip)**; affected groups
  (collections+dashboard+policy) 174/174. eslint/prettier clean.
- **§14 U3 execution log (branch `test/e2e-admin-operator-migration`, base = ai-feature incl.
  U1+U2 merges; worktree `wt-pivot-e2e`):** `collections-desktop` migrated to a REGULAR-USER
  actor — commits docs `22d4b09` → code `beae34a` → ledger (this commit). New
  `e2e/helpers/scratchUser.ts` (`loginScratchAdmin` + `ensureScratchRegularUser`, admin-API
  create which also ensures the `/<username>` home node); `loginAndOpenWorkspace`/
  `loginAndOpenOwnedWorkspace` generalized into `loginAndOpenUserWorkspace` (home-based case
  folder, returns `{base, token, userCreds}`); all 14 cases + case 001 direct login rewired;
  ownership comments flipped to home-closure wording. Dual-token cleanup: collection purges stay
  on the user session; `flushPrivateWorkspaceCleanups` gained an optional OPERATOR fallbackToken
  (`perm-delete` is admin-only BY DESIGN — the admin stays bootstrapped for operator duties, the
  pivot's role split; documented in `helpers/files.ts`). No admin-403 E2E legs added — those
  assertions belong to the U1 unit gates (owner ruling in the U3 brief); no assertion weakened.
  Gates (2026-10-02, own port band, project-scoped compose): full
  `E2E_BACKEND_MODE=s3 collections-desktop` **14/14 twice consecutively** (1.4 m / 48.2 s); run
  logs show the designed user-403→operator-200 perm-delete fallback per workspace purge.
  tsc+prettier clean on touched files (e2e eslint-ignored per repo config). Product finding:
  NONE — no collections/dashboard/file-likes endpoint wrongly 403s the regular user. Remaining
  debt (report-only): no other e2e suite touches collections/file-likes/dashboard surfaces
  (grep: `api/collections|file-likes|dashboard` appears only in `collections.spec.ts`); the
  ledger U2 row still reads `[todo]` on this base although U2 is merged (`5ac5246`) — left to
  the U2 owner/coordinator.

## 15. P0 closeout batch (owner-approved 2026-10-02, branch `feature/p0-closeout` @ `e483466`)

- I1 `[done]` **ruling B — revoke deletes the grantee digest cursor** (re-grant re-dots;
  undo-revoke restores the GRANT but NOT the cursor — accepted boundary, spec'd):
  docs `2729824` → RED `be585c6` → GREEN (repo `deleteDigestCursor` typedef + sqlite/postgres
  twins + conformance; journaled inside the `revokeAccess` TX covering BOTH revoke paths).
  Undo-path bug found + fixed + RCA-logged: `applyCollectionInverse` dropped the journal row
  on the single-inverse branch, so undo-of-a-revoke had never worked (grant-access inverse
  reads `row.actor`).
- I2 `[done]` **collections mobile E2E** — `e2e/collections.mobile.spec.ts` (015..017) +
  `collections-mobile` project on its own scratch slot `:5014` (standalone sibling, no
  `dependencies`); `loginAndOpenUserWorkspace`/`seedFile` hoisted to
  `e2e/helpers/collectionsWorkspace.ts` (shared with the desktop leg). Coverage plan rows
  - `testMatch`/config stale comments fixed. Spec-vs-brief mismatch reported: mobile forces
    DETAIL→LIST ONLY (grid stays grid on mobile) + detail toggle hidden — assertions follow the
    spec, not the brief's "grid/detail→list" wording. Commits `5b61fe5`/`5e28b7b`/`39543be`.
- I3 `[done]` **both-mode collections runs** — hermetic projects restructured
  (`HermeticEntry` + `pushHermetic`, `collectionsSpecs` pushed in BOTH mode branches);
  010 add-settle flake fixed (Case B: Enter races the documented separate
  `POST /:id/items`; settle-poll + fallback-excluded card locator) + RCA-logged.
  Gates: s3 `collections-*` **17/17 × 3 consecutive**; webdav **17/17 × 3 consecutive**.
  Commit `04345f8`.
- I4 `[done]` **stale-ledger sweep** — §9 exit-gate degradation-matrix bullet → owner-
  confirmed ruling (T4.3/P1+, P0 lifecycle suite complete incl. mobile + both modes);
  §11 pending-color line → resolved with carrier/8px commit citations; §11 follow-up-5
  cursor note annotated (I1). Base-red repair: two client test pins still asserted the
  retired 4px corner inset after `e483466` moved code+CardTile.md to 8px (Case B) — realigned;
  full client suite green again. Report-only: `MemberStateBadges.md` grid row still describes
  the retired top-right `-6/-6` ring-offset geometry while committed `CardTile.md`/code say
  top-left 8px — the owner's MAIN-checkout working tree carries an in-flight edit of that doc;
  left untouched to avoid clobbering it.
- Closeout gates (all on this branch): server `test:ci` **130 suites / 2455 pass (5 skip)**;
  PG leg `test:ci:pg:adapters` **23 / 347 (1 skip)**; client **178 / 1919**;
  e2e collections s3 **17/17** ×3; webdav **17/17** ×3; eslint `--max-warnings 0` +
  prettier clean on every touched source file.

## 16. EmbeddingGemma 2 adoption — V1/V3 revival (owner decision 2026-10-08, branch `feature/eg2-v1v3-docs`)

Owner record (verbatim, 2026-10-08): "V1 V3 도입할거야. 안할 이유가 없잖아." — following the
EG2 probe session (PoC addendum §6; artifacts in git-ignored `data/corpus/eg2-test/`).
The 2026-09-16 retirements of V1 (image-embedding path) and the audio text-only routing are
**reversed**; the audio ATTRIBUTE-GENERATION ban (E13) and all no-absolute-θ rules are
**kept**. Live embed server `10.0.0.106:8082` now runs embeddinggemma-2 (llama.cpp b11459,
`--pooling mean` required — cls mis-shapes the plain-text space silently; GPU serving).

Doc changes in this changeset (docs-first step; no product code):

- AI_FEATURE_PLAN.md: §4.2 request-shape/profile-property rule · §4.3 media chunk ladder ·
  §4.13c MRL dims · §4.15 provenance extended to server-shape flags + adoption checklist ·
  §4.17 media near-dup band note · §4.19 caption role change · §4.20 E1-M call site ·
  §4.21 rewrite (V1/V3, fallback ladder, E13 ban boundary) · §4.23.1/.2/.3 media
  capabilities + positive-control probes · §5 `media_direct` source · §9 revocation entry ·
  §10 Q10 status TRIGGERED.
- POC.md: §6 addendum (probes, bands, failure modes, scorecard deltas).
- docs/spec llmPresets.md + llmAdapter.md: capability set, EG2 preset row, media probes,
  `embedMedia`, overlength media ladder — updated in the same PR (AGENTS §1).
- DDL: `001_initial_normalized_schema.sql` embeddings.source CHECK + `media_direct`
  (checksum recovery one-liner per §6 DDL policy; applied to prod manually at the
  ai-feature→dev deploy).

Release-runbook obligation before shipping the model (§4.15 checklist / Q10): re-measure on
the dev reference set — text near-dup θ_dup, unrelated-floor spread, image/audio/video
near-dup bands, mutual-kNN tier edges (0.82/0.86/0.80/0.72 were caption-space measures),
char→token factor (1.7 was bge-m3), media token rates/segment windows,
query-embed latency profile (informational — the <100 ms class gate is deleted by the §20
owner ruling 2026-10-15). E3 recall@20
must be re-run with TRUE image queries (no captions) against the wedding ground-truth tree
before the caption-path 0.829 baseline is replaced.

The former tag θ_lo/orthogonality measurement is not an active release obligation after the
tag layer was dissolved; its PoC result remains historical evidence (§19).

Open probe gaps explicitly not closed by this decision: interleaved text+media fusion
untested on llama.cpp serving; native video input needs `-ub ≥2048` on the server (owner
infra call, not product); EG2 Korean text quality unmeasured beyond directional probes.

**Battery outcome (2026-10-08, branch `feature/q10-eg2-battery`)** — Q10 release-measurement
run complete: 4 parallel harnesses rebuilt from PoC §2 methods (artifacts in git-ignored
`data/corpus/q10/`); results logged in PoC addendum §6.5. llmPresets EG2 row updated from
null+pending to measured profile values (θ_dup 0.955, chPerTok 1.5, throughput, media bands
flag-only, image-space tiers provisional-OK). Two profile fields stay open BY DECISION, not
by omission: `thetaLo` (→ AI_FEATURE_PLAN §10 **Q11 — owner: percentile re-anchor vs
margin-rule vs 0.92-restricted; blocks T1.8 on EG2** — RESOLVED 2026-10-16 by dissolution,
field removed from the profile schema entirely, see §19) and text-space tier rerun (rides T1.x
evolution calibration, §4.9). Remaining carry-forward: interleaved fusion, native
`video_embed` `-ub` infra call, 100k-doc media backfill cost (rides T1.4/Q9 sizing study).

## 17. Built-in embedding engine — q4, boot-BLOCKING provisioning (trigger scope amended — §22) (owner decision 2026-10-14, branch `feature/embed-builtin-q4-docs`)

Owner rulings (verbatim, 2026-10-14, following the PoC §6.6/§6.7/§6.8 probes):

1. **Embedding is an inherent product capability** — no separate model-serving step is
   required. The product embeds the engine in-process (`@huggingface/transformers` + the
   official `onnx-community/embeddinggemma-2-ONNX` export, **dtype q4**, 473 MB full
   multimodal set, RSS ~1.1 GB measured). External llama.cpp/HTTP servers remain valid
   overrides (and the interactive/GPU-throughput path for media). npm distribution stays
   light: a checked-in **`model.lock.json`** (repo + pinned revision `daa72c51…` + per-file
   sha256 + dtype), not model bytes ("just fix it" — incl. the llm_models DDL columns).
2. **Provisioning is BOOT-BLOCKING with a CLI progress log** (per-file), atomic and
   checksum-verified; `WEA_MODEL_DIR` pre-seed skips download (multi-instance optimization,
   never a mode); failed attempt ⇒ boot continues, embed caps OFF + admin reason. One
   universal rule regardless of replica count — the STRICT/ban mode considered earlier is
   REJECTED (identical-build replicas make download-if-absent already correct). (Trigger
   scope amended by owner ruling 2026-10-15 — §22: the blocking run is provider-triggered,
   not unconditional per boot.)
3. **Migration posture: big-bang.** Owner is the sole user of every DB; at the
   `ai-feature`→`dev` deploy a dedicated **big-bang migration script** rewrites the live DB
   (001 was edited directly for `media_direct` [§16] and `llm_models.engine/precision/
model_revision` [this section]; checksum-recovery per §6 DDL policy is owner-side).
   No ALTER chain, no compatibility path.
4. **PLAN bookkeeping as NEW items** (owner: "신규 항목으로"): task **T1.0** added to P1,
   this §17 ledger section, PoC **§6.8**, AI_FEATURE_PLAN §4.2/§4.12/§4.15/§4.20/§4.23.5/§5
   - §10 **Q12**; specs llmPresets (embedded default row + lock schema + scenarios) and
     llmAdapter (provision.js/embedded client/provisioning error class) updated same PR.

Open measurements (rides §10 Q12 / §16 runbook): q4 text θ_dup + baseline-spread re-check,
~~target-hardware query-embed latency verdict~~ (<100 ms clause deleted by owner ruling
2026-10-15, §20), q4 long-audio pooling drift. ~~Q11 (θ_lo)
remains independently open.~~ **[SUPERSEDED 2026-10-16: Q11 closed by DISSOLUTION — §19.]**

## 18. Embedding model pinned to EG2 (owner decision 2026-10-14, branch `feature/pin-eg2-conformance`)

Owner record (this turn): "eg2를 유일한 모델로 놓고 다른 모델은 지원하지 않는게 좋겠어. 단지
내장 eg2를 사용할건지 외부 api를 호출할건지 두가지 선택지만 남기고자해 (LLM은 유지)" +
refinements: precision-level drift is irrelevant ("같은 공간의 노이즈") — the enemy is an
entirely different vector space; endpoint-declared model names are worthless as identity
(aliased server = cautionary example from our own env).

Rulings encoded:

1. **Embed = 2 providers, 1 model**: `embedded` (lockfile identity) | `external-endpoint`
   (any dialect — **transport matrix kept**, the earlier "OpenAI-compat 단일화" proposal was
   retracted as not implied by the decision and hostile to Ollama users). bge-m3 removed from
   the manifest + CI (history stays in PoC/AI_FEATURE_PLAN). No embed fallback chain:
   provisioning/conformance failure ⇒ embed OFF, honestly.
2. **Conformance gate (external only)**: structural dim + reference-kit median-cos ≥ τ;
   **τ = release artifact, calibration item rides §10 Q12** (positives EG2 ×
   precision/engine; negatives embeddinggemma-1 twin + 768-d foreign). The initially
   proposed reference τ=0.97 self-check-failed against in-session data (q4↔q8 P01 .9604)
   → aggregate median + calibrated threshold + role redefinition agreed over two review
   rounds; precision-declared UI field dropped (annotation only).
3. **θ constants single-set per model** (quantization noise tolerated) — withdraws the
   per-precision re-check; Q12 re-scoped to kit calibration + hardware latency + info-only
   drift.
4. Doc set this change touched: llmPresets (§1/§2.2 conformance field/§2.3 restructure/
   §2.4 no-fallback/§2.5 verify-before-save/§4 fixtures), llmAdapter (§2.2/§2.3/§2.4/§2.8/
   §5), AI_FEATURE_PLAN (§1 scope note/§4.2/§4.12/§4.20/§4.23.2/§10 Q12), SETUP (table +
   checklist), PLAN T1.1. No DDL change (precision/model_revision columns from §17 serve).

## 19. Tag layer dissolved to descriptive-only (owner decision 2026-10-16, branch `feature/tag-dissolve`)

Owner record (2026-10-16, after the θ_tag/θ_lo/lifecycle review chain): "llm tag는 파일을
묶어주는 범례가 아니라 그냥 파일을 설명하는 단어 정도로 남기고 parent hint 기능도 쓸모
없어보여. tag 필터, tag 검색등은 애초에 생각하지 않는 기능이니 정형화된 카테고리처럼 만들
이유도 없어." Rulings:

1. **LLM tags = description**: `ai_enrichments.tags` (free words) is the ONLY storage;
   consumers are exactly display (AI Info chips), llmNamer + merge-arbiter text material.
   No tag filters, no tag search, no vocabulary status.
2. **Retired**: θ_tag vector predicate matching (§3.2), θ_lo + parent hints + `tag_parents`,
   `tag_embeddings` cache + E3 embed call site, LLM-tag materialization in `ai_tag_raw`,
   tag vocabulary injection into parse.nl, tag facet source in §4.9 create. T1.8 withdrawn.
3. **Survives untouched**: derived local facets (`mime:`/`ext:`/`month:`/`path:` →
   `ai_tag_raw`, folded by derivedTagsService) as string-equality predicates + naming
   material — no embedding, model-invariant; E6c "nothing merges automatically" becomes law.
4. **Evidentiary chain** (PoC §6.5/§6.9): tag-band overlap made any absolute θ invalid; the
   refined string-rule trial (263/318) showed the correct error layer is strings, and
   cos REVERSED on discrimination (real .679 < junk .881) — dissolving beat re-anchoring.
5. **DDL posture**: `tag_embeddings`/`tag_parents` definitions stay in 001 only until the
   big-bang deploy (§17 ruling) drops them + `JOURNAL_DOMAIN` enum loses the unused `tags`
   value; NO new code references them (grep-gate in llmPresets §4).
   **Superseded 2026-10-28:** no deployment consumed 001, so both retired tables were removed
   directly from 001 (merge `e704cc71`, log §31.5); the big-bang DROP is no longer needed.
   `JOURNAL_DOMAIN.TAGS` remains (DDL CHECK + constant parity) and is the only residual of
   this bullet.
6. **Docs touched**: AI_FEATURE_PLAN §3.1/§3.2/§4.9/§4.10/§4.11/§4.12/§4.15/§4.18(rewritten)/
   §4.19/§4.20/§4.23.3/§5/§10(Q11 closed)/§12.9; llmPresets (θ_lo field gone, map row, §4);
   specs: aiTagStore (derived-facet scope), collectionsService/evolutionService/searchService/
   derivedTagsService tag clauses; PoC §6.9; PLAN §7/§16 pointers above.

## 20. Request-path latency clause removed (owner ruling 2026-10-15, branch `chore/remove-e2-latency-clause`)

Owner ruling (verbatim, 2026-10-15, on the P1 risk briefing): "해당 조항은 필요없어. 삭제해." —
the §4.2 clause "query-embed must be <100 ms class model" is DELETED; there is no interactive
latency ship gate for the embed role. Kept unchanged: the request-path exception family
(invariant 11), mandatory `query_parses` caching, kill-switch, honest no-LLM fallback
(§4.6/§4.12) — CPU-served built-in query-embed is a legitimate (slower) state, profiled and
displayed, never gated off. Latency/serving-mode figures remain INFORMATIONAL profile fields;
PoC §6.7/§6.8 measurements stand as the evidence trail (untouched, historical).

Sweep executed (this changeset): AI_FEATURE_PLAN §4.2 clause · §4.15 adoption-checklist item ·
§10 Q12 latency-verdict item (renumbered, ruling dated inline) · PLAN §16 runbook item +
§17 open-measurements entry (struck) · §18 ruling text kept as the dated record, its
Q12 "hardware latency" scope superseded here · specs (state-only wording): llmAdapter.md
`embedQuery` row, llmPresets.md embedded-row `latency` field + external-row `query-embed class`
field, searchService.md query-embed step. Effect on the P1 wave plan: Q12 runbook reduces to
kit calibration ① + informational drift ②; T1.5 semantic search is no longer blocked on a
hardware latency verdict.

## 21. Q12 conformance reference-kit calibration run (owner directive 2026-10-15, branch `chore/q12-tau-calibration`)

Owner directive (verbatim): "P1 실행 전에 τ 보정 그냥 지금 진행하자." — the §18-2 runbook item
pulled forward ahead of P1 Wave A.

Run evidence: dev box (6-core CPU) in-process transformers.js 4.3.1 harness reusing the PoC
§6.7 seam (`/tmp/opencode/tjs`) + live GPU llama.cpp b11459 @10.0.0.106 (EG2 Q4_K_XL,
`--pooling mean`). Kit = 24 strings (en/ko/digits/mixed); canonical = built-in ONNX q4 text,
doc-prefix convention, single-string, unit-norm float32. Positives medians 0.9855–0.9858
(worst pair 0.967) vs negatives 0.033/0.040 (max pair 0.100) — fully separable. **τ = 0.90**
adopted over the 0.51 cluster midpoint (asymmetric failure cost + mid-band derivative
protection). Full numbers + selection rationale: AI_FEATURE_PLAN §10 Q12 DONE record.

Shipped artifacts: `server/infrastructure/adapters/llm/eg2-reference-kit.json` (checked-in
release artifact — data only; `presets.js` lands with T1.1 and imports it), llmPresets §2.2
(kit location)/§2.3 (activation gate carries the measured τ), SETUP runbook checklist item
ticked. P1 effect: the T1.1 EG2 conformance gate now ships calibrated; Q12 reduces to the
② informational-drift item only.

## 22. Provisioning is provider-triggered, hot on override clear (owner ruling 2026-10-15, branch `chore/provision-trigger-ruling`)

Owner ruling (verbatim): "external embed row active 이면 provisioning 보류하도록해. 해제시 즉시
provisioning 하고 해당 옵션 자체가 hot-load이므로 내장 임베더도 재기동없이 적용될 수 있도록 하자.
(이후 external로 전환시에는 이미 provisioning 된 모델을 삭제하진 않음, WEA_MODEL_DIR에 이미 모델이
있는 경우도 마찬가지)"

Encoded rules:

1. **Boot BLOCKING provisioning runs only for a CONFIGURED boot while the built-in is the
   active embed provider** (no enabled remote embed override row; a setup-mode boot is
   rule 5). Remote active ⇒ the trigger is DEFERRED and
   absence of weights is the normal state — never a caps-off signal (the role runs on the
   override).
2. **Clearing the remote override triggers provisioning immediately, in place** — built-in
   activation is restart-free like every other LLM config (T2/dbOnly hot rule, §4.2). Weights
   present ⇒ instant; absent ⇒ status card with per-file progress, embed role in `preparing`
   (§4.12), probe suite runs on completion.
3. **Switching to remote NEVER deletes existing weights**; a pre-existing `WEA_MODEL_DIR`
   (pre-seeded or previously provisioned) ⇒ zero download attempts, zero network egress —
   every trigger is idempotent.
4. §17-2 stands for the trigger's INTERNALS (boot-blocking-with-progress-log, atomic,
   sha256, no strict/ban mode, one universal rule across replicas) — this ruling amends the
   trigger SCOPE only.
5. **Setup mode never downloads; the next CONFIGURED boot is ordinary processing** (owner
   rulings 2026-10-15 — "(b)로 진행해... 앱은 앱대로 실행하고, 모델은 모델대로 다운로드 하고,
   embed가 필요한 작업들은 pending 하고" → "내 의미는 wizard가 끝난뒤 모델을 받으라는거야" → final
   simplification: "wizard 상태에서는 provisioning 안하고 재부팅 했을때는 그냥 일반적인 처리로
   진행하면 되는거 아냐? ... 이게 구별이 필요한 문제야?"): a setup-mode boot makes NO
   provisioning attempt (zero bytes, zero egress; the wizard never waits). Setup apply
   requires a restart anyway, so wizard exit lands on a normal configured boot running the
   rule-1 posture unchanged — the provider decision (remote-override row vs built-in) is the
   ONLY discriminator: built-in selected + weights missing ⇒ blocking attempt with CLI
   per-file progress (failure: warn + caps-off admin reason); remote enabled ⇒ skip (absence
   is normal, no caps-off). No event hook, no marker — the "fire IN PLACE at setup
   completion" framing is superseded, and the review finding D3 (posture discriminator)
   dissolves. The runtime in-place trigger (rule 2) applies to override-clear only; rules
   2/6 `preparing`/park/drain semantics hold for any attempt wherever it runs.
6. **Role gating during the provisioning window (review finding D1, encoded in the sweep):**
   the presence rule refines to "lockfile present + weights provisioned (or an enabled,
   conformance-passed remote row) = configured". During an in-place run the built-in `embed`
   role is NOT configured: consumers PARK (claim-exclusion, zero attempt inflation) and drain
   in claim order once the role flips configured — never claim-and-fail. Encoded: llmAdapter
   §2.2/§2.3 `roleConfigured`, aiJobService §2.3 step 4, AI_FEATURE_PLAN §4.2 presence rule.
7. **Readiness-state vocabulary (review finding D2, owner directive 2026-10-15 — "provisioning
   이라는 단어보단 전반적으로 널리 쓰일 수 있는 준비 진행중 단어"):** the non-terminal state is the
   GENERIC `preparing` — `backendHealth` rows gain `preparing/phase/progress` fields, the admin
   display becomes 5-state `not_configured | preparing(phase, progress) | probe_failed(reason) |
partial | ok`. Provisioning is `phase='provisioning'`, its first producer; future preparation
   surfaces (index rebuild, cache warm) reuse the state. `settings/public.ai` booleans and the
   user-facing absent rule stay `ok`-derived (preparing ⇒ absent-not-disabled).

Docs touched: AI_FEATURE_PLAN §4.2 (built-in bullet + presence rule + §4.12 note + §4.23.5
card + §10 Q12 tail scoped) · PLAN T1.0 row + §17 heading/pointer · llmAdapter §2.1 peer /
§2.2 presence / §2.3 `roleConfigured` / §2.4 trigger list / §2.8 `provisioning` error row /
§5 trigger-matrix verification · llmPresets §2.2 lock comments, §2.3 `provisioning` +
`offline result` fields, §2.5 clear-override + wizard sentences, §4 scenario set ·
backendHealth state shape + `report` API + 5-state AI display + verification ·
routes/admin §3.2 health row · routes/setup + client pages/Setup: wizard scope
**chat/vision/asr only** (embed needs no wizard surface; readiness card waiting state) ·
client MyPage/useMyPageController/CollectionDashboard: 5-state chip ·
features/collections-platform §4.2/§4.12/§4.23.5 · features/config-source-resolution
(dbOnly correction, AI-step wording, boot-order trigger) · features/setup-wizard env-only
first-run note · bootSequence §2 step 8b · TESTING_STRATEGY AI tiers (None-column fixture
qualification + provisioning-trigger fixtures) · SETUP.md boot-frozen caveat +
`WEA_MODEL_DIR` operator note. POC.md untouched (dated evidence trail).

## 23. E2E gap coverage (test/e2e-gap-coverage, 2026-10-15)

- `e2e/retrieval.spec.ts` NEW — E2E-RETRIEVAL-001..007: server-wide name search
  results mode (T0.11 contract: typing=client-only two-stage rule, Enter→
  `POST /api/search`, `/search/click {node_id}`, P0 `semantic_available:false`
  ⇒ save button absent + chip-Save inert, chips in sessionStorage
  `wea.recentSearchQueries` cleared on logout, trashed nodes never surface).
  Scratch-hermetic `retrieval-desktop` project on the new `:5015` slot
  (e2e-band.cjs `scratchRetrieval`, span comment 5002..5015; webdav host-mode
  leg deferred per config comment); regular-user actor + operator perm-delete
  fallback (collections pattern). Findings: chip Save MENU ITEM renders per
  SearchBarResultsMode.md §2.7 but creates nothing at P0 (saveChipQuery bails
  on `semantic_available !== true`) — asserted as zero-IO, not absence.
- collections.spec.ts: +018 rename/lock/undo, +019 properties-dialog like
  shared-state, +020 sidebar Archive-node routing + tile order; 010 amended
  with the `updated` sort switch — NOTE: member add bumps
  `last_member_change_at` ONLY (`repo.touchMemberChange`); the `updated_at`
  bump the sort keys on comes from PUT /:id (poll-guarded, second-granular
  sqlite stamps).
- mypage-admin.spec.ts: +E2E-ADMIN-009 admin-reports on the SHARED stack —
  real `POST /api/admin/cleanup/orphaned` persisted row, no-fetch-on-mount
  contract (AdminReportsContent.md §2.4), payload-mirrored expand, backfill
  ⇔ nullCount>0 matrix rule; NO repair clicks (shared state).
- Docs: TESTING_STRATEGY E2E ID ranges + RETRIEVAL; E2E_COVERAGE_PLAN
  inventory row + retrieval table + 018..020/010/ADMIN-009 rows;
  TEST_GIT_GUIDE slot prose 5002..5015.

## 24. Search UI rework — zones, chip chain, morph (owner ruling 2026-10-16, chain `feature/search-ui-rework`)

- Owner-adjudicated v4 brief: results render inside the real FileList/FileGrid/FileDetail
  as accordion zones (A=current-folder matches w/ folder-path header, B=server name
  matches 'All results' cloud+search header, C=semantic 'Suggested results' wand slot —
  empty while P0), sticky frosted headers w/ counts + collapse toggle (`wea.searchZonesCollapsed`);
  SearchBarResultsMode overlay DELETED. Breadcrumb row replaced by SearchQueryChipBar
  (committed-chain chips, hover/tap-revealed Undo=revert-to-snapshot zero-IO; single chip
  Exit; LibraryAdd = full-snapshot union → AddToCollectionMenu set-target mode). Chained
  submits = intersect-name refinement behind the applyStep op seam (RAG-pluggable,
  resultRef retained opaque). Live typing in results mode promotes+highlights, never
  hides; browse-mode filter keeps hiding + gains yellow `palette.highlight` (#F7D154)
  live highlight (dual-kind `searchHighlight`). FloatingSearchBar morph: start-icon
  collapse, submit moved to the FAB-slot 56px ghost button (hover=FAB gradient fill;
  composite cloud+search / cloud+mirrored-wand by `ai.embed` flag, orbit pending glyph,
  Add overlay in results mode; controlled-mount FAB). Sidebar/folder navigation EXITS
  results mode (owner ruling). Union selection + bulk read-only gating spans zones;
  server rows get EditOff corner badge from NEW additive hasRead/hasWritePermission on
  POST /api/files/metadata (permission engine shared with listing; no SQL — PG leg N/A
  by path rule, diff-verified); metadata enrichment chunked ≤100 in the gateway.
- Waves: docs(0b9e808) → S(d6c744d) ∥ A(dcec8ab) ∥ B(8b2ef04) → C(eeb68a1) → E2E test/sr-e2e
  (d528057 + client fix 2461807 double-click-open guard order) → gates fix/sr-gates (3871c51).
  Ledger-clobber incident: WP-C task commit overwrote PLAN.md with its working plan —
  restored at ff0969a (d02c4f6); standing rule: task branches never edit PLAN.md.
- Gates: client 180 suites/2033; server 131/2485(5 pre-existing skips); eslint+prettier
  (7 pre-existing format-debt files untouched); E2E retrieval desktop+mobile 42/42 ×2
  (011 sticky two-point assertion stable incl. push-up sample), collections 20/20, s3
  shared stack 94/93+1skip — all first-attempt green.
- Deferred/flagged (not blocking): Zone B thumbnails await a zone-local merge seam (icon
  placeholders — "render defaults" accepted); save-from-results (semantic) affordance
  intentionally removed, substrate kept for P1 T1.5; sortMode zone-ordering has unit gap
  covered only by E2E 020; `gotoAsAnonymous` helper race structural (untripped in all
  runs, report-only); `ai.embed` chosen for the wand glyph (one-line swap if owner wants chat).

## 25. Search rework follow-ups (sr2+sr3, owner-directed 2026-10-16)

- sr2 — `3773312` zone thumbnails: nodeId→url state map in useSearchResults merged
  zone-locally (member idiom; survives re-derivation/undo aliasing), Zone B end-to-end,
  Zone C seam unit-covered; full client 180/2044. `488d90b` gotoAsAnonymous root fix:
  context-level clearCookies + one-shot addInitScript storage wipe (no live-document
  clear ⇒ no 401-redirect race); retrieval 019 inline workaround retired; auth ×3,
  share-public ×3, retrieval 42/42 — 0 flake. sortMode unit gap kept as-is (owner).
- sr3 — `f3f2e56` five visual defects (owner-approved list): native search-cancel
  suppressed (single ✕, role=searchbox kept); writable→read-only location change
  resets hasWritePermission synchronously + morph emit moved to useLayoutEffect
  (FAB flash gone; reset proven safe against synthetic views via permId guard);
  FAB scale moved to the disc element (in-place shrink, no px constants, root keeps
  opacity seam — disc gained pointer-events:none, found via E2E-017 where the
  self-scaled invisible disc had swallowed the ghost button's clicks); composite
  glyph extracted to SearchGlyphIcon (overlay outside the cloud on a contrast plate,
  mirrored wand inside, Add plate left — SAB + zone-B header single-source);
  zone header px removed (row-edge alignment) + inter-zone gap via container grid.
  Gates: client 180/2055, eslint/prettier, docsStatePurity, retrieval dual 42/42.
- sr4 — `f1824d3` glyph rework (owner visual ruling): plate composite replaced by a
  single knockout SvgIcon (stroke magnifier/wand cut through the filled cloud via
  `useId`-scoped SVG mask; no plates; per-line knockout on wand mirror fixed), pending
  orbit keeps the composite and moves only the overlay group, `submitSearch`
  single-flight guard kills the lone-glyph flicker; zone headers plain Cloud (B) /
  unmirrored AutoAwesome (C) with `search-zone-glyph-b/c` seams; specs restated.
  Gates: targeted 132 (incl. knockout/single-flight), full client 2057, eslint/prettier,
  docsStatePurity, retrieval dual E2E 42/42.
- sr5 — `150896f` owner follow-ups: every search holds `pending` for at least one
  full orbit cycle (`SEARCH_ORBIT_CYCLE_MS=1600`, single source shared by the
  glyph animation and the commit hold — a fast response cannot skip the cycle);
  a mid-window `exitResults` discards the late commit (sequence counter, guards
  on own refs not the act-stale `modeRef`); the input field resets on every
  results-mode exit AND on every successful commit (term hands off to the chip
  strip — `onCommit` seam; restores original requirement 6). Specs/E2E plan
  restated; retrieval helper waits out the hold window and re-summons the ✕ with
  hold text when the field is empty; 013/018 assert the reset. Gates: full client
  2059, eslint/prettier, docsStatePurity, retrieval dual E2E 42/42 (3.8m).
- sr6 — `279d4c4` orbit-knockout lockstep + retrieval consolidation (owner rulings): the
  pending orbit now carries its own knockout cut — the mask group shares the overlay's
  animation class (same-mount lockstep, single-sourced geometry), keyframes
  `translateX(-R) rotate(-t) translateX(R) rotate(t)` (R=4.5u, counter-clockwise, home
  at the 3-o'clock point, upright glyph, svg overflow visible); Add knockout split static.
  retrieval E2E consolidated 21 → 11 (002/009→001, 015→002, 017→003, 007→005, 010+011→007,
  012/013/018→008; 019 → E2E-SHARE-012 in share-public; 021 → EXP-011 assertions; IDs
  renumbered, old IDs retired in E2E_COVERAGE_PLAN). Sticky-case Zone B volume 15 → 26
  (mobile viewport boundary flake observed once). Gates: client 2062, docsStatePurity 3/3,
  retrieval 22/22 (3.1m), share-public 22/22 ×2 (one unrelated first-run SHARE-005 mobile
  flake did not recur), EXP-011 green.
- sr7 — SMIL single-clock orbit (`feature/sr7-smil-orbit`): the CSS-mask knockout
  followed the orbiting glyph in discrete steps (mask repaint cadence vs glyph
  paint path); the overlay geometry is now defined once in <defs> and rendered
  twice via <use> (visible line + mask knockout) sharing ONE SMIL timeline —
  two additive animateTransform (orbit-center rotation, upright counter-spin),
  begin=indefinite + beginElement() on pending mount, per-variant centers
  (search lens / wand cluster), 1-decimal coordinate rounding. Gates: targeted
  108, full client 2064, eslint/prettier, docsStatePurity; no E2E change
  (final-states policy; orbit seam presence/absence preserved).

## 26. E2E dual-platform convergence (owner-directed, 2026-10-16, branch `feature/sr8-e2e-format-convergence`)

- Format audit remediation — ALL suites now follow the dual-platform standard:
  - `registration-settings`: dedicated `s3-regset-desktop`/`-regset-mobile` chained pair
    (removed from desktopSpecMatch; the global `registration_enabled` serializes across
    the chain; ADMIN-007 uses the mypage drawer idiom).
  - `core-flow.desktop` → `core-flow.shared`: EXP-009/010/011 + OVERLAY-008/010 moved dual
    (mobile: detail-toggle-absence, tap-open, drawer tree, action-sheet delete).
  - `trash-admin`: `-mobile` chained on the shared :5012 scratch; platform-flagged delete.
  - `collections`: the standalone mobile twin (collections.mobile.spec.ts, :5014) RETIRED —
    ONE dual file on the shared :5013 slot; 015..017 absorbed as reason-carrying desktop
    skips; card-open tap/dblclick seam, shared `openFileActions` (context menu vs action
    sheet), drawer tree navigation with the mypage-admin dispatch-retry idiom, MyPage
    drawer entry, 018 mobile reorders the undo-toast arc inside its 8s window.
  - `webdav-reconcile` stays smoke-only (backend contract, not a UI-platform surface).
- CLIENT parity gap fixed by the conversion: the mobile FileActionSheet never received
  `onAddToCollection` (T0.5 deferred wiring) — now wired via the shell-owned
  `handleOpenAddToCollection` (viewport-centered anchor); FileActionSheet.md restated.
- Gates: collections dual 40/40, trash-admin 2/2, regset 6/6, shared-stack dual 134+3
  sanctioned skips; client 2064; eslint/prettier; docsStatePurity 3/3. Remaining
  single-platform files are platform-OWNED interaction primitives only (DESKTOP-_/MOBILE-_).
- 018 contract parity follow-up (2026-10-19, branch `test/col018-mobile-parity`,
  merge `f82d7d7`): the convergence audit surfaced two residuals. (1) the regset
  dedicated pair is registered in the non-core config branch only, so
  `E2E_CORE=1` no longer runs E2E-AUTH-009/010 + E2E-ADMIN-007 (reported to the
  owner, acknowledged as-understood, no action requested — open residual;
  W5 mypage-admin shape). (2) case 018's mobile arc verified only
  the undo result. Owner ruling: same-role UI surfaces must pass the SAME
  verification level — the mobile arc now asserts the renamed card +
  `name_locked=true` poll pre-undo (desktop order, ~1 s — stable inside the 8 s
  toast window), desktop gains the post-undo sidebar not-contains check; the
  sidebar-reflect contract is verified on both platforms with timing-only
  adaptation (desktop pre-undo 'Q3 reports' / mobile post-undo restored
  fragment). E2E_COVERAGE_PLAN row 018 restated. Gates: targeted 018 both
  projects green (5.2 s mobile), full dual collections 37+3 = 40/40 equivalent,
  prettier, docsStatePurity 3/3.

## 27. P1 execution waves (owner-adjudicated 2026-10-20; execution ledger — overlay; §7 task rows unchanged)

Base: `ai-feature` @ `d9e6c3d` (regset fix merged; dev contains ZERO unique commits —
dev ⊆ ai-feature, verified — so no dev sync is needed). TDD per unit
(docs → RED → GREEN → gates → merge into `ai-feature`); task branches never edit
PLAN.md (§24 standing rule). Unit sizes: S ≤1d, M ≈2–3d, L ≈4d+. Split principle:
single-owner files (DDL/manifests) are touched by exactly one unit per wave; every unit
keeps its own worktree branch (`wt-*` idiom) and targeted-gate evidence in the ledger.

| Wave | Units (parallel)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Deps                               | RED-first targets                                                                                                                                                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | A1 (T1.2a) repos `llm_models`/`ai_jobs`/`ai_usage_daily` + restart-survival (M) ∥ A2 (T1.2b) repos `embeddings`/`embeddings_chunk`/`ai_enrichments` (M) ∥ A3 (T1.0a) `model.lock.json`+`provision.js`+embedded client+`preparing` producer (L) ∥ A4 (T1.0b) dead tag-surface purge (S) ∥ A5 (T1.4a) `vectorMath`+extractors+`TextVectorJs` oracle (M) → A6 (T1.4b-pg) pgvector adapter (M) ∥ A7 (T1.4b-vec0) vec0 adapter+ACL helper (M)                                                                   | none (roots; A6/A7 after A5)       | A3: posture scenarios ×5 (setup-mode zero-egress / remote-active defer / override-clear in-place / `WEA_MODEL_DIR` idempotent / sha256-fail caps-off); A4: aiTagStore §2.6 grep assertions flipped to absence; A5: exact≡oracle; A6/A7: recall@50≥0.99 @ef400 held-out queries only                                                                        |
| B    | B1 (T1.1a) `presets.js`+probe matrix ∥ B2 (T1.1b) adapter core (per-call resolution, `roleConfigured`, budget chain, breaker, usage) → B3 (T1.1c) wizard AI step (chat/vision/asr) + 5-state admin display ∥ B4 (T1.3a) worker core (`claimNext({excludeKinds})` — aiJobsStore.md §2.3 gains the row at this docs step; backoff; park&drain) → B5 (T1.3b) embed pipelines (chunk-pool ladder → embeddings/embeddings_chunk) ∥ B6 (T1.3c) §4.1 hooks ×4 + `content_hash` write-side (register (b) absorbed) | A; B3←B1,B2; B5←B4+A2+A5; B6←B4+A1 | B1: declared≠probed ⇒ capability off+warning, τ=0.90 kit + dim==768; B2: hot re-probe restart-free, breaker 5-fail→OPEN 300s; B4: excludeKinds park (zero attempt inflation), backoff `min(30s·2ⁿ,30min)`; B6: 4 seam enqueues + hash population — **audit-remediated**: exactly 4 seams, decision table hook, restore re-hash (see Wave B remaining note) |
| C    | C1 (T1.5a) query-embed + `query_parses` cache + response shape + honest degrade → C2 (T1.5b) scorer (segment-AND min, max-over-chunks, dynamic baseline gate) → C3 (T1.5c) client zone C activation ∥ C4 (T1.7) vector near-dup + dashboard feed                                                                                                                                                                                                                                                           | B                                  | `sr1.` result_ref signature; absent vs honestly-empty distinction; per-query dynamic baseline gate; dedup vs name section; cap 50                                                                                                                                                                                                                          |
| D    | D1 (T1.6) seed collections (preview+confirm+`llmNamer` swap) ∥ D2 (T1.9a) media capability probes+positive controls → D3 (T1.9b) media embed pipelines (audio `min(ub/25 s,327s)` windows / 1 fps frame sampling / image single / `media_direct`) → D4 (T1.9c) V2 caption fallback + backfill scope                                                                                                                                                                                                        | B (+C4 corpus)                     | formulas cited, never a literal "19 s"; D2: content-wrapper shape / re-encode band / base64-as-text diverges / pooling match                                                                                                                                                                                                                               |

Exit gate: orchestrator `server/index.js` integration + full server/client `test:ci` +
`test:ci:pg:adapters` + CI grep-gates (zero `CacheAdapter|operationProgress` in
`domains/(collections|ai)/**` + tag-purge absence) + docsStatePurity; the
`ai-feature`→`dev` merge stays a single event after ALL §7 phases.

### Owner rulings recorded (2026-10-20 — full text in AI_FEATURE_PLAN §12.13)

- **E2E-AI-001 → C1** ("(1)한건만 만들기"): one hermetic semantic-search case, scratch `:5016`,
  `WEA_MODEL_DIR` pre-seed. TESTING_STRATEGY updated; spec rows land with the C1 docs step.
- **Built-in video direct-embed** ("내장모델에서도 영상 임베딩 가능하도록 해"): embedded provider
  substitutes the model window (8,192) for the server `ub`; video = local ffmpeg 1 fps sampling,
  ≤ window/140 frames/segment, image-processor path. Encoded §4.3/§4.20/§4.21 + llmAdapter
  §2.5/§2.6. `-ub ≥2048` = external throughput override only (no longer a blocker for D3).
- **Unified admin re-embed action** ("UI/UX 표면 기준으로는 같은 동작"): initial-coverage backfill =
  model-change full re-embed = ONE admin-launched rate-limited action. Mostly already law;
  made explicit in §4.2/§4.15/§4.21, aiJobService §2.4, routes/admin §3.2. D4 backfill scope =
  admin-manual trigger, no auto bulk enqueue.
- **tagVocabulary.js — KEEP** (audited NOW per owner, not at execution): exports only `foldTag`
  (pure string fold); `derivedTags.js` + collections tag-atom provider (string-equality,
  §19-3-surviving) call it. A4 trims only the stale header line; purge surface = aiTagStore
  §2.3/§2.4 (11 methods → 3) + repo twins + DDL rows (001:389/397 → big-bang script) + test
  scenarios (exports 14→3; no-normalization pin re-homed onto `replaceRawTags`).
- **δ_base — CLOSED 2026-10-20 (owner: "선택1로 하자")**: the specced COMPOSED gate stands
  unchanged. δ_base = **0.08** ships in the EG2 profile (junk margin ceiling .073 < δ <
  real-single floor .083; at 0.08: 100% junk rejected, 100% real-single accepted; POC §6.10,
  positive control = Q12-kit median-cos 1.000000). The per-segment AND amendment was measured
  and REFUTED (single-word segments behave like junk — .030–.048 vs junk .023–.061; 0/6
  composites pass); the best-segment variant measured 4/6 composites at δ=0.08 but was NOT
  adopted. Composite (multi-segment) queries may return honestly-empty under the gate —
  accepted v1 behavior, name section covers them; revisit only against real usage. The C2
  implementation rule from the runs is encoded in searchService §2.3: the baseline sample
  EXCLUDES the candidate set (36.8% contamination otherwise). The C2 calibration entry
  condition is SATISFIED — no pending calibration remains.
- **P1 open items: ALL CLOSED (2026-10-20 briefing session)** — E2E-AI-001 assigned (C1),
  built-in video direct-embed ruled, unified admin re-embed action ruled, tagVocabulary
  disposition resolved (KEEP), δ_base measured and gate design decided. **No blockers remain;
  Wave A may start.**

### Wave A execution log (2026-10-20 — orchestrator; base `aafabd2`)

Base note: §27's stated base `d9e6c3d` was superseded by `aafabd2` (the δ_base option-1
decision record merged after the ledger was written); all Wave A branches cut from
`aafabd2`. Worktrees `wt-a1..wt-a5` (port-band / container discipline per §10 closure idiom).

- **A4 (T1.0b) `[done]` — merged into `ai-feature` (orchestrator gate: full server
  `test:ci` green before merge).** Branch `feature/p1-a4-tag-purge`, base `aafabd2`.
  Commits: docs `0c29f1e` (aiTagStore.md §2.1 purge-state note — DDL DROPs belong to the
  big-bang script; §2.6 grep scoped to runtime code with the 001 + DDL-parity exception;
  maintenanceScheduler.md §3.3 dissolved nightly tag pass removed, §3.4→§3.3 renumber) →
  RED `143116a` (exports 14→3 pin + §2.6 grep-absence; 13 offender hits observed against
  pre-purge code) → refactor `525cdc5` (facade 14→3: `listRawTags`/`listNodeIdsByRawTag`/
  `replaceRawTags`) → `3e8c54b` (repo twins + `aiTagShared.js` purged, −434 lines) →
  docs `d996df6` (tagVocabulary.js stale header line ONLY — `foldTag`/exports untouched
  per §27 ruling) → test `7a85167` (conformance purged to the `ai_tag_raw` leg; no-
  normalization pin re-homed onto `replaceRawTags`). Gates: targeted 8 suites / 147 pass;
  `domains/{collections,ai}` 10/202; full server `test:ci` 131 suites / 2464 pass (5 skip);
  PG adapters leg 23 / 335 (reused the wt-pivot-srv e2e PG on :5433 — orchestrator aware).
  Post-purge grep: `tag_embeddings|tag_parents|getTagVectors|upsertAutoParent` hits only in
  the three DDL-parity enumeration tests + the test's own assertion file — zero runtime
  references. `derivedTags.js`/`derivedTagsService.js`/`foldTag`/derived-facet machinery
  untouched (verified by diff). DDL 001:389/397 still defines the tables per §19-5 — the
  big-bang script owns the DROPs (orchestrator/big-bang scope, recorded in the spec).
- **A1 (T1.2a) `[done]` — merged into `ai-feature` (orchestrator merge `1a4f317`).**
  Branch `feature/p1-a1-llm-repos`, base `aafabd2`. Scope: `llm_models`/`ai_jobs`/
  `ai_usage_daily` repositories (interface + sqlite/pg twins + shared mappers +
  `llmModelsStore`/`aiJobsStore`/`aiUsageDailyStore` facades) + restart-survival
  (ai_jobs stale-running reap; ai_usage_daily DB-truth history; llm_models
  identity-keyed idempotent upsert). New specs `llmModelsStore.md` +
  `aiUsageDailyStore.md`; TESTING_STRATEGY conformance enumeration updated.
  Gates: new suites 6/47 green; repositories dir 15/227; domains/ai 8/63;
  eslint/prettier clean. RCA_LOG entries for GREEN-phase incidents (Case B:
  `%NEXT_RETRY%` replaceAll in twins; facade fixture math).
  **Orchestrator integration fix (`8c333d9`)**: docsStatePurity forbids
  `AI_FEATURE_PLAN` pointers in scoped specs — the A1-added store specs cited
  the design authority inline; reworded to spec-local references (server
  docsStatePurity 3/3 green).
  **Open flag for Wave B**: `llm_models.dim` column does not exist (llmAdapter
  §2.3/vectorStore.md reference an absent column; resolved per DDL/§5 — no dim
  in the repository); B2's `syncModelRegistry` dim persistence needs an owner
  decision at the B2 docs step.
- **A3 (T1.0a) `[done]` — merged into `ai-feature` (orchestrator merge `86598ba`).**
  Branch `feature/p1-a3-provision`, base `aafabd2`. Scope:
  `server/infrastructure/adapters/llm/{model.lock.json, provision.js,
clients/embedded-onnx.js}` + backendHealth `preparing/phase/progress`
  producer + posture×7 & lock/preparing test suites + `@huggingface/transformers`
  dep + docs (llmPresets/llmAdapter/configRegistry/config-source-resolution).
  RED: 15 failing / 2 passing → GREEN: provision suites 17/17 (5 posture
  scenarios: setup-mode zero-egress / remote-active defer / override-clear
  in-place hot / `WEA_MODEL_DIR` idempotent / sha256-fail caps-off).
  Positive control: median-cos 1.000000 vs `eg2-reference-kit.json`, dim 768.
  Gates: infrastructure 28/463; admin+store 15/259 (3 pre-existing skip);
  docsStatePurity 3/3. RCA: transformers.js tokenizer load with zero egress
  (Case B — local-path loading + `useFS`).
  **Orchestrator integration remains**: boot step 8b call site
  (`server/index.js`) + override-clear trigger wiring (B2) — the provisioner
  is ready for both call sites; `hint='ai.provisionFailed'` i18n mirror is
  B3/admin-surface scope.
- **A5 (T1.4a) `[done]` — merged into `ai-feature` (orchestrator merge `2a855d9`).**
  Branch `feature/p1-a5-vectormath`, base `aafabd2`. Scope:
  `server/domains/ai/vectorStore/{vectorMath, TextVectorJs}.js` +
  `server/domains/ai/extractors/{documentText, textChunking}.js` +
  conformance harness `runExactEngineConformance` (bit-parity exact≡oracle
  across 12 held-out queries, `toBe` not tolerance) + `vectorMath.md` spec +
  `--experimental-vm-modules` jest flag + `pdfjs-dist` server dep +
  TEST_GIT_GUIDE §4 note. Gates: conformance 13/13 bit parity; local union
  5/54; full server test:ci 135 suites / 2531 pass (baseline 131 + exactly
  the 4 new suites / 46 tests — vm-modules flag safe repo-wide); PG leg N/A
  (no repository/SQL/executor touched). vectorMath public surface for
  A6/A7: `serializeVector`/`parseVector`/`dotProduct`/`l2Norm`/
  `cosineSimilarity`/`unitNormalize`/`meanPool`/`truncateAndRenormalize`
  (MRL §4.13c); A6/A7 reuse `runExactEngineConformance` unchanged.
- **A2 (T1.2b) `[done]` — merged into `ai-feature` (orchestrator merge
  `a9944d8`; RCA_LOG conflict resolved append-only, both sides kept).**
  Branch `feature/p1-a2-vector-repos`, base `aafabd2`. Scope:
  `EmbeddingsRepository`/`EmbeddingsChunkRepository`/`AiEnrichmentsRepository`
  (interface + sqlite/pg twins + shared mappers) + tuple-keyset chunk cursor
  (`(node_id, chunk_idx)` pagination — boundary-node chunks never skipped) +
  chunk replace scoped to the incoming model space with PK upsert on
  collision + specs `embeddingsChunkStore.md`/`aiEnrichmentsStore.md`.
  Gates: conformance 3/3 suites 42/42 (sqlite leg); eslint/prettier clean.
  **Orchestrator integration fixes (`c8ef6b9`)**: the A2-added files tripped
  two pre-existing gates — (1) aiTagStore §2.6 purge-gate naive raw-string
  match caught the dissolved-tag tokens inside A2's documentary comments
  (A2 had flagged this exact risk in its report); rephrased the commentary to
  descriptive equivalents in 4 source files + 1 conformance test; (2)
  docsStatePurity caught `retirement-narration` in embeddingsChunkStore.md
  §2.8; (3) `deleteByModel` in `EmbeddingsChunkRepository` collided with the
  purge-gate's forbidden dead-method list — renamed to `deleteSpace` across
  interface/twins/conformance/spec (§2.3/§2.4 reworded). Gates after fixes:
  full server test:ci 146 suites / 2621 pass (5 skip) green; PG adapter leg
  N/A for the fixes (comment/doc-only); A2's PG twins ride the orchestrator
  pg:adapters run at the wave gate.
- **Wave A remaining**: A6 (T1.4b-pg pgvector adapter) + A7 (T1.4b-vec0 vec0
  adapter + ACL helper) — dependencies satisfied (A5 merged); both launched
  in parallel on `feature/p1-a6-pgvector-adapter` / `feature/p1-a7-vec0-adapter`
  (base `a9944d8`), worktrees wt-a6/wt-a7. RED-first targets: recall@50≥0.99
  @ef400 held-out queries only; conformance harness reuse unchanged.
- **A6 (T1.4b-pg) `[done]` — merged into `ai-feature` (orchestrator merge
  `2cac99e`).** Branch `feature/p1-a6-pgvector-adapter`, base `a9944d8`.
  Scope: `server/domains/ai/vectorStore/PgVector.js` (canonical TEXT-row
  truth + adapter-managed `pg_vector_shadow` sync, KNN re-ranking via `<=>`
  with `SET LOCAL hnsw.ef_search = 400` fixed, `rebuildShadow` stale-dim
  drop-rebuild) + docs-first vectorStore.md refinement + `test:ci:pg:vector`
  script on its own :5434 port + E2E PG image swapped to
  `pgvector/pgvector:pg16` + 22-test ANN-leg suite. RED: module-absent →
  GREEN: 22/22 against a real pgvector/pg16 container (recall@50 = 1.0000
  @ ef400 held-out; ef-contrast 0.4140 proves the SET LOCAL knob bites).
  Shadow-table DDL owned by the adapter per §6 — never in the tracked chain.
  Orchestrator gate re-run on the main checkout: 22/22 green; full server
  test:ci 147 suites / 2621 pass (pgvector suite CI-skipped by design,
  exercised via its dedicated script).
- **A7 (T1.4b-vec0) `[done]` — merged into `ai-feature` (orchestrator merge
  `dd17927`).** Branch `feature/p1-a7-vec0-adapter`, rebased onto
  `ai-feature` @ `e37b2ae` before merge (A6 had landed in between; the
  vectorStore.md/conformance-harness overlaps merged clean). First attempt
  died commit-less on the sqlite-vec loading seam — the orchestrator
  pre-verified the environment facts and re-injected them into the retry
  brief (`allowExtension: true` DatabaseSync option, `+`-prefixed declared
  aux PKs, f32-distance semantics). Scope: `SqliteVec.js` (vec0 virtual
  table adapter-managed per §6; `+node_id/+chunk_idx/+model_id` aux PKs,
  `chunk_idx=-1` pooled marker; `user_version` generation stamp keyed on
  canonical row-count+dim; **f64 rescoring over canonical TEXT rows so
  exact≡oracle bit-parity holds — vec0's f32 distance ranks candidates
  only**); shared engine-agnostic `aclFilter.js` (oversample→rescore, no
  join-KNN — A6's pg path may consume it unchanged); sqlite-vec dep;
  vectorStore.md §2.4a/§2.5/§2.6/§5 vec0-scoped amendments. Gates: seam
  suites 75 tests green (recall@50 = 1.0000 over 40 held-out queries);
  full server test:ci 148 / 2666 on the branch. RCA: pdfjs-dist/@napi-rs
  native-lib corruption in the worktree was environmental (orchestrator
  verified md5 divergence on `skia.linux-x64-gnu.node`; fixed via npm ci —
  no test altered).
- **Wave A exit gate — PASSED (2026-10-21, orchestrator)**: after the A7
  merge the orchestrator PG adapter leg surfaced 22 real defects in the
  A1/A2 merged twins and ONE environment-stale failure class:
  1. **AiJobs PG placeholder dialect (Case A)** — `CLAIMABLE_PREDICATE`
     carried a literal sqlite `?`; the PG twin interpolated it verbatim ⇒
     PG 42601 on every claim. Fixed with a `%PARAM%` slot resolved per
     dialect (`?` sqlite / `$1` postgres) — commit `c49dca4`.
  2. **AiJobs enqueue return shape (Case A)** — the PG twin read
     `result.rows` but `postgresExecutor.run()` yields `{changes, lastId}`
     ⇒ every enqueue resolved null on PG. Fixed to
     `{ id: Number(result.lastId) }` — same commit.
  3. **LlmModels stale-schema (environment)** — the shared e2e PG database
     predated the §17 `engine/precision/model_revision` columns and its
     `_schema_migrations` checksum matched the CURRENT file (the T1.0
     editing of 001 happened BEFORE this DB was ever provisioned; the
     stored checksum is of the edited file — the drift detector can never
     catch columns missing on a table created by an even older DDL
     generation). Resolved by dropping the schema and letting the leg
     re-apply 001; columns verified present. No code change.
     Final gates: server `test:ci` 148 suites / 2647 pass (27 skip) green;
     client `test:ci` 180 suites / 2064 pass green; `test:ci:pg:adapters`
     29 suites / 415 pass (1 skip) green; `test:ci:pg:vector` 22/22 green;
     grep-gates clean (zero `CacheAdapter|operationProgress` in runtime code —
     the one service.js hit is a documentary comment stating the invariant;
     zero `tag_embeddings|tag_parents|getTagVectors|upsertAutoParent` outside
     the DDL-parity enumeration tests); docsStatePurity green. **Wave A
     complete: A1–A7 all merged. Wave B (B1–B6) may start.**
     Standing flag carried forward: `llm_models.dim` does not exist (B2's
     `syncModelRegistry` dim persistence needs an owner decision at the B2
     docs step).

### Wave B execution log (2026-10-21 — orchestrator; base `efe649b`)

First-tranche dispatch: B1/B2/B4 in parallel (independent subagents);
B2's dim-persistence blocker resolved owner-side BEFORE B2 launched
(`llm_models` gets NO dim column — runtime derivation from the model
profile + per-row persistence on `embeddings.dim`/`embeddings_chunk.dim`).

- **B1 (T1.1a) `[done]` — merged (`c1b3893`).** `presets.js` manifest +
  probe-matrix authority rule (declared ≠ probed ⇒ capability off + admin
  warning) + `evaluateConformance` EG2 activation gate (τ=0.90 kit +
  dim==768; τ lives exclusively in `eg2-reference-kit.json` — no hardcoded
  τ) + `kit()/findPreset/getPresetByFamilyRole` + llmPresets.md §2.2a.
  RED module-absent → GREEN 31/31; docsStatePurity 3/3. B2 must consume
  LLM_PRESETS/evaluateCapabilityMatrix/evaluateConformance.
- **B2 (T1.1b) `[done]` — merged (`73da31d`; RCA_LOG both-sides-kept).**
  llmAdapter core (per-call resolution, `roleConfigured`, budget chain,
  breaker 5-fail→OPEN 300s, usage accounting) + T2 dbOnly breaker tunables
  (`LLM_BREAKER_THRESHOLD`/`LLM_BREAKER_COOLDOWN_S`) registered in the
  config registry + dim docs task resolved (§2.3 runtime derivation;
  vectorStore.md minimal correction). RED module-absent → GREEN
  llmAdapter 21/21; docsStatePurity 3/3. Seams: remote `createClient`
  dialect, `probeRole` suite, `presetFor`/`fetchPublishedMetadata` (B1);
  boot call site + admin "test" button (B3); `embedQuery` query_parses
  cache (C1).
- **B4 (T1.3a) `[done]` — merged (`ed96203`; clean with B2).** Worker
  core: `claimNext({excludeKinds})` park&drain (zero attempt inflation;
  shared `KIND_EXCLUSION_CLAUSE` + `buildClaimPredicate`; both twins
  reworked, per-dialect placeholder discipline kept) + backoff ladder
  `min(30s·2ⁿ, 30min)` verified (BASE 30_000 / MAX 1_800_000) +
  aiJobsStore.md §2.3/§2.4 contract text. RED absent-support → GREEN
  conformance 21/21 (sqlite leg), facade 3/3, docsStatePurity 3/3.
  **Orchestrator PG leg verified**: `test:ci:pg:adapters` 29 suites /
  418 pass — the PG twin mirrors the sqlite predicate exactly.
- **Wave B remaining**: B3 (T1.1c wizard AI step ← B1+B2 satisfied),
  B5 (T1.3b embed pipeline ← B4+A2+A5 satisfied), B6 (T1.3c hooks×4 +
  `content_hash` write-side ← B4+A1 satisfied) — all three launched in
  parallel on `feature/p1-b3-wizard-ai-step` / `feature/p1-b5-embed-pipeline` /
  `feature/p1-b6-hooks-content-hash` (base `ed96203`), worktrees
  wt-b3/wt-b5/wt-b6. RED-first targets per §27: B3 wizard rows + locale
  mirror; B5 pipeline drain + restart survival; B6 hook registration +
  content_hash population.
- **B3/B5/B6 relaunch (2026-10-21, after interruption)**: the first
  parallel launch died mid-flight — wt-b3/wt-b5/wt-b6 worktrees were
  never created and the subagents left NO commits; the only residue was
  unverified pre-RED scaffolding (commitHookRegistry/commitHooks +
  embeddings stores + vectorStore/index.js + file-service hook wiring)
  sitting uncommitted on the main checkout. Cleanup: scaffolding stashed
  (`git stash push -u` — message "B5/B6 partial scaffolding from
  interrupted session (pre-RED)") and the main checkout restored to
  `ai-feature @ 0c6ad08`. Branch situation: `feature/p1-b6-hooks-content-hash`
  existed from the dead session (pointing at `0c6ad08`) and was reused for
  wt-b6; B3 got `feature/p1-b3-wizard-ai-step` and B5 got
  `feature/p1-b5-embed-pipeline-work` (the old B5 branch name is occupied
  by the main checkout of the prior session and was left in place).
  All three worktrees were recreated on base `0c6ad08` and three fresh
  RED-first subagents launched (sessions: B3 `ses_ea2f50c51ffe…`, B5
  `ses_ea2f50c52ffe…`, B6 `ses_ea2f50c53ffe…`). B6's brief carries the
  stash pointer as reference-only — the scaffolding must not be adopted
  wholesale without a fresh RED cycle.
  B5 (T1.3b embed pipeline ← B4+A2+A5 satisfied) — both in flight on
  `feature/p1-b3-wizard-ai-step` / `feature/p1-b5-embed-pipeline`, worktrees
  wt-b3/wt-b5.
- **B6 (T1.3c) audit remediation `[in remediation → GREEN]`** — the audit
  against aiJobService.md §2.2 confirmed 4 violations (erroneous delete seam
  violating the DDL kind CHECK; restore seam re-asserting `content_hash=null`;
  missing WebDAV-upload and copy seams; hardcoded kind `'embed'` instead of
  the decision table). Remediated on `feature/p1-b6-hooks-content-hash`:
  delete seam removed (zero `'delete'` enqueues); `onNodeContentCommitted`
  hook module `domains/ai/nodeContentHook.js` (decision table: text →
  embed+features on chat-probe, image/video → caption on vision-probe else
  embed, audio → asr on asr-probe else embed, directory → none; capability
  probes via the shared config resolver); 4 seams wired post-commit (S3
  upload/overwrite, WebDAV upload success, copy with REUSED source hash,
  restore with re-read `sha256Buffer` fresh hash); hash write-side at every
  seam. RED 11+ behavior failures observed → hook suite 39/39 GREEN;
  2 pre-existing tests updated to the spec'd contract (Case B, RCA log);
  full server `test:ci` 2741 pass / 27 skip / 0 fail. Docs reconciled
  (§4.20 tag-embedding call site, §2.2 anchors, RCA_LOG). Awaiting merge
  orchestration (NOT merged to dev from the remediation session).
- **B3/B5/B6 closure + Wave A/B similar-issue audit (2026-10-21 — orchestrator)**:
  all three merged into `ai-feature` — **B5** `0dc702c` (B5 branch
  `feature/p1-b5-embed-pipeline-work`; embed pipeline: facades + pipelines/embed.js
  with park&drain drain, restart survival, stale-dim backfill driver, tx-bound
  statement hooks), **B6** `2283755` (remediation per the block above — PLAN.md
  conflict on the B6 rows resolved append-only, both sides kept), **B3** `6d62075`
  (wizard AI step: docs `0c4a4c2` → RED `c00c6bf` → GREEN `cb6106c`; server
  setup+llm 120/120, client 62/62; vision/asr probes return honest
  `mediaProbePending` — positive-control samples are T1.9-owned; admin
  config-editor test button UI rides P4).
  **Wave A/B similar-issue audit** (independent read-only agent, B6 violation
  classes as the checklist): Wave A spec docs (aiJobService.md / aiJobsStore.md
  / DDL kind CHECK) internally consistent — B6's deviations were Case A by the
  relaunched session, not downstream ambiguity; B1/B2/B4 merged work CLEAN (B4
  twin conformance is real-store, no mocked-store pinning; B4's pending PG
  leg now satisfied via B5's run: 29 suites / 418 pass incl. AiJobs twins);
  B3/B5 in-flight work clean of all five similarity classes. Watch-items
  recorded (tracked, not blocking): (1) Case C seeds — hook-arity wording
  (aiJobService.md:26 `onNodeContentCommitted(nodeId)` vs :36-37 "receives the
  fresh hash") and NULL `content_hash` skip semantics undefined at the §2.2
  skip boundary (NULL hash ⇒ skip never matches ⇒ re-embed: cost leak, not a
  correctness bug — owner ruling recommended); (2) `ai_jobs` kind enum has no
  JS shared constant (DDL CHECK + spec prose only — add `AI_JOB_KIND` during
  B5/B6 integration wiring); (3) sqlite twin `excludeKinds` empty-string
  binding mismatch (latent, no current caller); (4) B5 §2.4 reuses
  `content_hash` as a driver marker string (`shadow-rebuild:<nodeId>:<modelId>`)
  — semantic overload review; (5) merge-order note — B5/B6 both converge on
  `server/domains/ai` + `aiJobService.md` (merged B5→B6 here, resolved clean);
  (6) stash `stash@{0}` (pre-RED B5/B6 scaffolding) contains a latent
  `ReferenceError` (JS `None`) and overlaps 4 of B6's files — salvage value
  realized (restore-hash pattern lives in the B6 remediation), safe to DROP.
  **Wave B complete pending the full-gate run (orchestrator).**
- **Wave B exit gate — PASSED (2026-10-21, orchestrator)**: after merging B5
  `0dc702c` → B6 `2283755` → B3 `6d62075` into `ai-feature` (PLAN.md row conflict
  resolved append-only) and recording the audit ledger, the full orchestrator
  gates ran on the merged tip (`f243b0e`): server `test:ci` **154 suites /
  2755 pass (27 skip)** green; client `test:ci` **182 suites / 2079 pass** green
  (2 net-new suites from B3's aiRoleState + SetupAiStep); `test:ci:pg:adapters`
  **29 suites / 418 pass (1 skip)** green — covers the merged A2 twins, B4's
  AiJobs predicate twins, and the embed-pipeline store fountains; CI grep-gates
  clean (the one `CacheAdapter|operationProgress` hit is the documentary
  invariant comment in `collections/service.js:11` — Wave A precedent; tag-purge
  hits confined to the §2.6 assertion file itself + the 001 DDL-parity
  enumeration test). **Stash `stash@{0}` DROPPED per audit recommendation** (the
  restore-hash salvage pattern is realized in B6's remediation; the scaffolding
  carried a latent JS-`None` ReferenceError and overlapped 4 B6 files). Wave
  A + Wave B complete on `ai-feature`; Wave C (C1 query-embed → C2 scorer →
  C3 client activation ∥ C4 near-dup) is the next entry.

### Wave C execution log (2026-10-22 — orchestrator)

Pre-wave orchestrator integration (base commit `9ae8189`, full server test:ci
155 suites / 2766 pass green before dispatch): Wave B left three specced boot
call sites unwired — (a) bootSequence §2 step 8b provisioning in
`server/index.js` (setup-mode zero-egress / remote-override defer / built-in
blocking attempt with warn-only caps-off failure); (b) the llmAdapter runtime
singleton `server/infrastructure/llmAdapterRuntime.js` (`getLlmAdapter()`,
getMigrationGate idiom) + boot wiring of `presetFor`/`probeRole` seams
(`server/infrastructure/llmBootWiring.js`) + `syncModelRegistry()`; (c) the
aiJobService §2.3 worker loop `server/domains/ai/jobService.js`
(`startAiWorker`/`stopAiWorker`, WEA_SKIP_AI_WORKER seam, stale reap, role-gate
parking, hot T2 poll interval, production `readNodeText` =
blobStorageService.downloadBlob + documentText.extractText with
unextractableText ⇒ null skip) + the §2.3 step 5 per-job wall clock
(AI_JOB_TIMEOUT_MS race in pipelines/embed.js; late markDone stays a
{changes:0} no-op) + T2 keys AI_WORKER_POLL_MS/AI_WORKER_CONCURRENCY/
AI_JOB_STALE_MS/AI_JOB_TIMEOUT_MS registered (+ configRegistry.md rows). Also
`5e5a3f6`: the uncommitted aiJobService.md draft landed state-only (hook
signature `onNodeContentCommitted(nodeId, contentHash)`; NULL-hash never-skip
rule; provenance in AI_FEATURE_PLAN §12.13). Worktree hygiene: Wave B
worktrees/branches removed; E2E-AI-001 pre-seed located at
`/tmp/opencode/delta-base/models` (482MB, lock revision `daa72c51…`).

- **C1 (T1.5a) `[done]` — merged (`f655416`).** Branch
  `feature/p1-c1-query-embed`, base `9ae8189`. Commits: docs `5b8f906` → RED
  `2611422` (13 failing + QueryParses conformance module-absent) → feat
  `9e16044` → fix `e46620e` (provisioner installs/verifies the nested
  `<modelDir>/<repo>/<revision>` tree the ONNX client reads + E2E-AI-001
  scratch wiring on :5016) → `805c68c` (worker drain wiring: activeModelId +
  fileNodesStore factory + adapter typed-vector normalization). Scope:
  query_parses get-or-embed cache (QueryParsesRepository interface + sqlite/pg
  twins + conformance + facade; JSON envelope vector `{space, dim, v}`;
  hit_count on cache hits only; predicates reserved `[]`), honest degrade
  matrix (gate-off ⇒ `semantic` omitted + `semantic_unavailable_reason`; the
  leg ran ⇒ `semantic_available:true` retained even on provider failure —
  absent vs honestly-empty distinction), scorer seam §2.5a
  (`semanticScorer({userId, queryVec, segmentVecs, sampleFn})` — scoring leg
  C2-owned, no scorer ⇒ honestly empty), assembly/dedup/cap
  (SEARCH_SEMANTIC_LIMIT 50), result_ref `sr1.` space-identity chain
  (registry row id → repo@revision lock fallback), search_hit logging for
  semantic returned nodes, registry keys SEARCH_SEMANTIC_LIMIT/
  BASELINE_SAMPLE_DOCS. E2E-AI-001 (`e2e/ai.spec.ts`, `ai` project on :5016,
  WEA_MODEL_DIR pre-seed): green ×2 consecutively (first search 5.0 s real
  EG2 embeds, replay 0.8 s cache hits). Gates: server test:ci 156 suites /
  2792 pass; eslint/prettier clean; docsStatePurity 3/3. C1 fixes landed
  en-route (B-owner review welcome): provisioner flat-tree vs nested-tree
  mismatch; worker never claimed (activeModelId missing); readNodeText store
  factory; the pre-seed dir was missing 4 small lock files (fetched from the
  pinned revision; all 13 sha256-verify).
- **C4 (T1.7) `[done]` — merged (`1deeadd`).** Branch `feature/p1-c4-near-dup`,
  base `9ae8189`, files disjoint from C1 (clean merges both). Commits: docs
  `a160cb3` → RED `298ab0c` → feat `f9a6804` → refactor `8e64a00` → style
  `764b5f8` → dashboard render `a02c1e5` → prettier sweep `af9d4d0`. Scope:
  `server/domains/ai/nearDupFinderService.js` (vector near-dup over canonical
  pooled embeddings; θ_dup read from `presets.profile.thetaDup` — field added
  to EG2_PROFILE per the llmPresets numbers row; hash-first precedence — exact
  content_hash dups never surface; union-find components; keep rule = smallest
  node id; ACL-scoped; honest degrade with no embeddings) + dashboard feed
  (GET /api/dashboard near-dup block + CollectionDashboard render). Gates:
  server test:ci 156 suites / 2804 pass; client 182 suites / 2080 pass;
  eslint/prettier clean; docsStatePurity 3/3.
- **Orchestrator merge-gate fixes**: `33ed33c` provisioner default HF fetcher
  (boot/in-place triggers without a fetcher could never complete the download
  — posture 6 test added, 8/8); `985b476`+`2bc31e1` query_parses boundary
  timestamp normalization (pg Date → ISO string in both twins) + conformance
  instant-compare (Case B; RCA-logged 2026-10-22). **Merge gates (tip
  `2bc31e1`)**: server test:ci **157 suites / 2812 pass**; client test:ci
  **182 suites / 2080 pass**; `test:ci:pg:adapters` **30 suites / 426 pass**;
  `test:ci:pg:vector` **22/22** — all green. C1/C4 worktrees + branches
  removed. **Remaining**: C2 (scorer, in flight), C3 (client zone C), Wave C
  exit gate (E2E re-run on the merged tip + grep-gates + ledger).
- **C2 (T1.5b) `[done]` — merged (`57c0dee`).** Branch
  `feature/p1-c2-semantic-scorer`, base `2bc31e1` (worktree wt-c2 with
  symlinked node_modules — disk at 93%). Commits: docs `acf34aa` → feat
  `be6fc4c` (RED disclosed: the suite was already green at commit time — the
  first session died uncommitted; no standalone RED commit exists, disclosed
  not manufactured). Scope: `server/domains/ai/semanticScorer.js` — the §2.5a
  seam: per-segment `vectorStore.neighbors(segVec, k=50)` → per-node
  max-over-chunks cosine → MIN across segments (single-segment degenerates);
  per-query dynamic baseline gate — baseline sample from
  `sampleVisibleNodeIds` EXCLUDING the candidate set, spread = sample's max
  min-across-segments, keep only `top ≥ spread + δ_base`, miss ⇒ honestly
  empty; `EG2_PROFILE.deltaBase: 0.08` added (margin read from the profile,
  never hardcoded; llmPresets schema row updated); new
  `FileNodeRepository.listVisibleFileNodeIds(userId)` twins (+conformance +
  facade) as the ACL-anchored candidate seam; `SCORING_LANDED` flipped in
  `e2e/ai.spec.ts` — owner-ruling assertion active. Gates: targeted
  scorer+search+FileNode conformance 107/5 green; full server test:ci
  **158 suites / 2821 pass**; docsStatePurity 3/3; eslint/prettier clean;
  E2E AI case ×2 consecutive green (34.2 s / 33.9 s). **Merge gates (tip
  `57c0dee`)**: `test:ci:pg:adapters` **30 suites / 426 pass** incl. the new
  twins. A stale main-checkout draft of the C2 docs/presets edits (first
  session residue, superseded wording) was discarded before the merge — the
  committed branch version is authoritative. **Remaining**: C3 (client zone C,
  in flight) + Wave C exit gate. **Ledger correction (2026-10-22, §28 C-2):**
  the "twins (+conformance + facade)" claim holds for the facade and twins but
  NOT for conformance — no `listVisibleFileNodeIds` conformance case exists
  (only a mock in `semanticScorer.test.js`); remediation is tracked in
  §28.3.5 (C8).
- **C3 (T1.5c) `[done]` — merged (`0200f9e`).** Branch
  `feature/p1-c3-zone-c`, base `57c0dee` (worktree wt-c3). Commits: docs
  `2f5fc25` → feat `ac5228d` → fix `3cd0da6`. RED captured as a run, not a
  standalone commit (disclosed): 12 failing across 3 suites (zone C score
  order, span-zones union, save bail matrix, chip gating). Scope: zone C
  activation in the real FileList/FileGrid (delivered score order — no client
  re-sort; zone header count + collapse persistence; union selection + bulk
  read-only gating spans zones; EditOff badges; zone-local thumbnail map
  idiom), chip-bar Save affordance live per the §2.6 gate, `ai` E2E case
  gains the zone-C UI leg. E2E incident fixed root-cause (RCA-logged): the
  shared-stack webServer boot provisioned EG2 weights into the checkout-
  shared `data/modelos`, leaking the semantic leg into the "unconfigured"
  retrieval scratch — the retrieval scratch `beforeAll` now pins
  `AI_SEMANTIC_SEARCH_ENABLED=false` via the documented admin config API
  (gate-off emits the identical omit shape per searchService §2.3 step 3).
  Gates: client 182 suites / 2095 pass; docsStatePurity 3/3; eslint/prettier
  clean; retrieval dual 22/22; ai case ×2 green. Follow-up surfaced (became
  C5): the §2.6 save server dispatch was unshipped — the live affordance
  created a user-origin member-less collection indistinguishable from a real
  save (the exact C3 report finding). **Ledger correction (2026-10-22, §28
  C-1):** the "union selection + bulk read-only gating spans zones" claim is
  false as shipped — `FileManager.js:279-286` unions Zone A+B only; remediation
  is tracked in §28.2.3 (C8).
- **C5 (T1.5 search-origin save leg — added plan-gap unit) `[done]` — merged
  (`ad047b3`).** Branch `feature/p1-c5-search-save-leg`, base `0200f9e`
  (worktree wt-c5). Commits: RED `8c2e1ec` (10 server failures — route
  dispatched `{name, semantic}` to manual: 201 with `origin:'user'`, empty
  members; client payload mismatch + dialog-absent) → feat `741b502` → test
  `96fc42d` (pre-existing gcService flake pinned Case B — second-granularity
  `deleted_at DESC` straddle; RCA-logged). Scope: POST /api/collections third
  dispatch arm `{ name, semantic: { resultRef, predicates: [], nodeIds } }` →
  `createSearchCollection` (origin='search'; stored definition snapshot
  `{kind:'search', result_ref, predicates}` — the result_ref IS the centroid
  reference per searchService §2.4 replay rule, replay chains never
  persisted; no embed gate — flattened snapshot; initial batch via addItems
  mechanics with `published:true` explicit; `rejected_not_readable` additive
  key — never 4xx-silent; `emptyNodeIds`/`invalidDefinition` errors; two
  journaled commands, undo pointer = the create command with tip-undo
  cascade); client `SearchSaveDialog` (confirm = the batch approval per
  invariant 5, member preview, en/ko keys) + payload reconciliation.
  Disclosed minimal readings: additive `rejected_not_readable` on the
  `{collection, undo}` row; non-empty `predicates` rejected at P1 (reserved
  set); all-unreadable batch creates an empty search collection (§2.4
  partial-success precedent). Gates: server 158 suites / 2832 pass; client
  183 suites / 2098 pass; docsStatePurity 3/3; eslint/prettier clean; ai E2E
  ×2 green incl. the save leg (dialog → 201 → collection with the semantic
  member published:true → card opens with the member row); retrieval dual
  22/22.
- **Wave C exit gate — PASSED (2026-10-22, orchestrator; tip `ad047b3`)**:
  server `test:ci` **158 suites / 2832 pass (27 skip)**; client `test:ci`
  **183 suites / 2098 pass**; `test:ci:pg:adapters` **30 suites / 426 pass
  (1 skip)**; `test:ci:pg:vector` **22/22**; E2E `ai-desktop` ×2 consecutive
  green (58.2 s / 37.5 s incl. the save leg) + `retrieval` dual **22/22**
  (3.2 m); grep-gates clean (the one `CacheAdapter|operationProgress` hit is
  the documentary invariant comment in `collections/service.js:11` — Wave A
  precedent; tag-purge tokens confined to the DDL-parity enumeration tests +
  the §2.6 assertion file); docsStatePurity green (in-suite). Worktrees
  wt-c1..wt-c5 + all C branches removed. **Wave C complete: C1–C5 all
  merged.** T1.5 is fully shipped (semantic search end-to-end incl. the
  search-origin save). Remaining in P1: **Wave D** (D1 seed collections
  preview + confirm + `llmNamer` swap ∥ D2 media capability probes + positive
  controls → D3 media embed pipelines → D4 V2 caption fallback + backfill
  scope). NOTE for D1: `createSeedCollection` exists (T0.3, embed-gate entry)
  but the seed leg's confirm-dialog surface can reuse C5's
  `SearchSaveDialog` copy constants — extraction deferred (minimal change).

## 28. Wave C audit remediation (2026-10-22) — gap ledger (orchestrator)

> Audit base: `ai-feature` @ `d7d3b01` (Wave C exit tip). Gates re-run on the main
> checkout: server `test:ci` 158 suites / 2832 pass (27 skip); client `test:ci`
> 183 / 2098; `test:ci:pg:adapters` 30 / 426 (1 skip); `test:ci:pg:vector` 22/22;
> docsStatePurity 3/3. **Verdict:** Wave C is merged and gate-green, but P1 is NOT
> complete. The audit found **three P0 integration defects** (native vector seam
> unwired, remote-embed conformance gate unenforced, Zone C excluded from
> selection/bulk gating), **seven P1 closure items**, and **eight P2/P3 cleanups**.
> This section is the binding remediation ledger; work units are C6–C9 (below).
> Task branches never edit this file — the orchestrator owns these rows.
>
> Severity: **P0** = must close before Wave D D2/D3 (correctness, contract, or
> dependency blocker); **P1** = belongs in the P1 closure batch; **P2** = assigned to a
> named later unit; **P3** = documentation/hygiene. Effort: S ≤0.5d, M 1–2d, L 3d+.

### 28.1 Gap inventory

**Wave A**

| ID  | Sev | Gap                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                                           | Remediation                                                                                      | Placement |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------- |
| A-1 | P0  | Native vector engines unreachable in production; read AND write paths bypass the `vectorStore` seam; `vectorOps` health row absent. Canonical TEXT writes stay bit-equivalent — the bypassed artifacts are the adapter-managed shadow index and the §2.2 one-TX contract (performance + contract defect, not a current result error) | `vectorStore/index.js` missing (`vectorStore.md:20` names it); `semanticScorer.js:85-86` + `nearDupFinderService.js:123-124` default to `TextVectorJs`; `pipelines/embed.js:81` falls back to direct hooks; no `vectorOps` in code | C6: factory + runtime singleton + reader/writer wiring + health row (28.2.1)                     | C6 / M    |
| A-2 | P3  | `aiTagShared.js` still exists although the Wave A log says "purged"                                                                                                                                                                                                                                                                  | 667 B file required by `sqlite/AiTagRepository.sqlite.js:4` and `postgres/AiTagRepository.postgres.js:4`                                                                                                                           | Keep the helper, correct the Wave A wording + `aiTagStore.md §2.1` File Paths (28.4)             | C9 / S    |
| A-3 | P2  | `aiEnrichmentsStore.md §2.1` promises a facade + test file that do not exist                                                                                                                                                                                                                                                         | `server/store/aiEnrichmentsStore.js` and `__tests__/aiEnrichmentsStore.test.js` absent                                                                                                                                             | T4.1 docs step: add the facade (T4.1 coverage filters need it) or strike the claim (28.4)        | T4.1 / S  |
| A-4 | P1  | `test:ci:pg:vector` hardcodes :5434 while compose exposes :5433; no CI/runbook entry                                                                                                                                                                                                                                                 | `server/package.json:14`; `docker-compose.e2e.yml:40`; no CI config in repo                                                                                                                                                        | C9: reuse the 5433 server with a separate `webdav_vector_test` DB + TEST_GIT_GUIDE line (28.3.1) | C9 / S    |
| A-5 | P1  | `provision.js` ships Portuguese error strings, CLI logs and comments                                                                                                                                                                                                                                                                 | `provision.js:43,139,140,168,172,212,221`; `clients/embedded-onnx.js` comments                                                                                                                                                     | C9: translate to English (AGENTS language rule) (28.3.2)                                         | C9 / S    |
| A-6 | P2  | Spec/code drift around the vector seam and conformance harness                                                                                                                                                                                                                                                                       | `vectorMath.md §5` signature; `vectorStore.md §2.5` interim note; `PgVector` inline ACL duplicate                                                                                                                                  | C6 docs step + T2.2 docs step (28.4)                                                             | C6 / S–M  |

**Wave B**

| ID  | Sev | Gap                                                                                                                                      | Evidence                                                                                                                             | Remediation                                                                                               | Placement   |
| --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------- |
| B-1 | P0  | Probed-capability authority + EG2 conformance gate are pure functions with zero production callers; remote embed activation is not gated | `presets.js:180,235`; no callers outside tests; `llmAdapter.md:91` claims the probe suite runs the gate; `roleConfigured` ignores it | C7: probe cache + conformance in `roleConfigured`/`probeLlm` + `effectiveCapabilities` for hooks (28.2.2) | C7 / M      |
| B-2 | P2  | Budget-chain step 2 (published metadata) never injects                                                                                   | `adapters/llm/index.js:123` seam; `server/index.js:353-358` does not inject                                                          | T4.1: fetch `/v1/models` / `/props` / `/api/show`, TTL-cache, inject (28.4)                               | T4.1 / S–M  |
| B-3 | P3  | vision/asr readiness rows never render                                                                                                   | `backendHealth.js:9` tracks `ai.embed`/`ai.chat`; `backendHealth.md:41` states vision/asr are deliberately not tracked               | **By design**; clarify T1.1c wording, no code change (28.4)                                               | C9 / S      |
| B-4 | P1  | `backfill` jobs are enqueued but unexecutable forever; the driver condition misses real model changes; `content_hash` is overloaded      | `pipelines/embed.js:34` (`backfill` in `UNEXECUTABLE_KINDS`), `:188` (`existing.modelId === modelId`), `:190-195` marker             | C6: fix the condition + dedupe; defer the executor to T4.1 (unified re-embed) (28.3.3)                    | C6/T4.1 / M |
| B-5 | P1  | Audit watch-items unresolved: no `AI_JOB_KIND`, `excludeKinds` empty-string bind mismatch, `content_hash` overload                       | `shared/constants.js` lacks the enum; `aiJobsShared.js:76-78` filters but twins bind the raw array (`sqlite:76`, `postgres:73`)      | C7: shared constant + filtered binding + tests; overload resolved by B-4 (28.3.4)                         | C7 / S      |
| B-6 | P2  | No direct tests for boot step 8b / `llmBootWiring` / job-timeout race                                                                    | `server/index.js:297-341`; `llmBootWiring.js` suite absent; `embedPipeline.test.js` has no timeout case                              | C7 timeout test; T4.3 boot/e2e coverage (28.4)                                                            | C7/T4.3 / M |

**Wave C**

| ID  | Sev | Gap                                                                                                                             | Evidence                                                                                                                             | Remediation                                                                   | Placement   |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------- |
| C-1 | P0  | Zone C rows are excluded from selection, select-all and bulk read-only/write gating                                             | `FileManager.js:279-286` unions A+B only; `FileManagerView.md:127` requires A+B+C; `FileManager.md:259-261` contradicts it           | C8: include `zoneCRows` (dedupe by entry key) + reconcile both specs (28.2.3) | C8 / S      |
| C-2 | P1  | `FileNodeRepository.listVisibleFileNodeIds` has twins + facade but no conformance coverage                                      | Only `semanticScorer.test.js:28` mocks it; `FileNodeRepository.conformance.test.js` lacks the case; `searchService.md §2.5` omits it | C8: conformance block (sqlite + PG) + spec row (28.3.5)                       | C8 / S      |
| C-3 | P1  | `BASELINE_SAMPLE_DOCS` is registered but never consumed                                                                         | `configRegistry.js:186`; `semanticScorer.js:57,172` hard-uses 500                                                                    | C8: per-call `configResolver` read inside `score()` (T2-hot) (28.3.6)         | C8 / S      |
| C-4 | P3  | Save dialog has no total member count — only a "+N more" overflow counter above the 12-tile cap (nothing renders under the cap) | `SearchSaveDialog.js:39-86`; `SearchQueryChipBar.md:53`/`useSearchResults.md:72` promise "count + names"                             | D1 docs step: add the count or align the spec (28.4)                          | D1 / S      |
| C-5 | P3  | No `query_parses` store spec                                                                                                    | Contract lives only inside `searchService.md`                                                                                        | T3.4 docs step: add `docs/spec/server/store/queryParsesStore.md` (28.4)       | T3.4 / S    |
| C-6 | P1  | Client/search/E2E docs drift and contradiction                                                                                  | `FileManager.md` vs `FileManagerView.md`; `searchService.md:183`; `E2E_COVERAGE_PLAN.md:401`; PLAN's `ai` vs real `ai-desktop`       | C8 + T4.3: reconcile in the same PRs that touch those files (28.3.7)          | C8/T4.3 / S |

### 28.2 P0 remediation detail (must land before Wave D D2/D3)

#### 28.2.1 A-1 — vectorStore seam factory and full wiring (C6)

- **New seam:** `server/domains/ai/vectorStore/index.js`
  `createVectorStore({ executor, modelId, health, loadRows, hooks })` selects, in order:
  PG `probePgVector(executor)` → `PgVector`; sqlite `getSqliteConnection()` + `sqlite-vec`
  load → `SqliteVec`; otherwise `TextVectorJs`. Returns the §2.2 interface
  `{ upsert, neighbors, allVectors, impl }` plus the pipeline write hooks
  `{ upsertPooled, replaceChunks, transaction }`. `rebuildShadow(modelId)` is exposed for
  C6/T4.1 callers.
- **Runtime singleton:** `server/domains/ai/vectorStoreRuntime.js` with
  `getVectorStore()` / `resetVectorStore()` (the `llmAdapterRuntime` idiom); boot creates it
  after the DB probe, active-model changes reset it (stale-dim rebuild lives in the adapter
  `init()`: `atttypmod` for PG, `user_version` for vec0).
- **Readers:** `searchService.js` passes
  `engineFactory: (modelId, loadRows) => getVectorStore()` to `createSemanticScorer`;
  `dashboard/service.js` does the same for near-dup.
- **Writer:** `createEmbedPipeline` receives `vectorStore: getVectorStore().hooks` so the
  pooled + chunk + shadow halves commit in ONE TX. The current direct-SQL fallback stays
  for tests/capability-absent paths only.
- **Scope note:** the direct SQL hooks are bit-equivalent to the repository twins for the
  canonical `embeddings`/`embeddings_chunk` rows (verified against
  `sqlite/EmbeddingsRepository.sqlite.js:35-45`), so today's results are correct. The
  defect is the unmaintained adapter-managed shadow index, the §2.2 one-TX contract, and
  the O(n) fallback; P0 is justified because D3 media writes must consume the seam and a
  native reader wired without the writer would return stale shadow results.
- **Health:** add `'vector'` to `backendHealth.js` `TRACKED_KEYS`; report
  `{ ok, reason, hint }` on degrade (`CREATE EXTENSION vector` ≥0.7 / sqlite-vec binary).
  `GET /api/admin/health` maps it to `vectorOps: 'native' | 'fallback_js'`
  (`routes/admin.md:255` — a P1 target).
- **RED targets:** factory selection matrix (pg/sqlite/fallback), health row, reader
  injection, writer hook invocation + single-TX assertion, `vectorOps` wire shape.
- **Exit:** with pgvector installed the semantic path uses `PgVector`; with the extension
  absent it degrades to `TextVectorJs` and reports `fallback_js`; no feature is gated off.

#### 28.2.2 B-1 — probed-capability authority at runtime (C7)

- **Probe cache:** adapter-level `Map<configSignature, { capabilities, conformance }>`,
  invalidated by `observeRole` on signature change (re-probe debounce already exists).
- **EG2 conformance gate:** for `engine='remote'` `probeLlm('embed')` runs the checked-in
  `eg2-reference-kit.json` strings through the endpoint and calls `evaluateConformance`;
  pass ⇒ `configured`; fail ⇒ `ai.embed` `probe_failed` with `reason='nonConformingEndpoint'`
  and consumers park. Embedded rows stay exempt (lockfile sha256 is identity). Cache the
  verdict by signature — one activation pass, not per call.
- **Capability matrix:** `evaluateCapabilityMatrix(preset, probeResults)` feeds
  `effectiveCapabilities` for chat/vision/asr; `nodeContentHook`'s decision table and media
  gates read effective capabilities (declared ≠ probed ⇒ capability OFF + `ai.<role>`
  warning `hint`).
- **i18n:** `serverErrors.ai.nonConformingEndpoint` + en/ko mirrors.
- **RED targets:** same-space remote ⇒ configured; same-dim foreign space ⇒ probe_failed +
  job park; config change ⇒ exactly one re-probe; declared-but-failed capability ⇒ off +
  warning; built-in EG2 unchanged.
- **Exit:** no remote embed can be active without a passing conformance verdict; wizard and
  admin surfaces show the same effective capability set.

#### 28.2.3 C-1 — Zone C in selection and bulk gating (C8)

- Build one zone union helper in `FileManager.js`:
  `[...zoneARows, ...zoneBRows, ...zoneCRows]`, deduped by `getEntryKey` (a node may appear
  in name and semantic zones), and use it for both `selectionSortedSource` and
  `selectionDisplaySource`; `selectionKeyIndex` then covers C automatically.
- **RED targets:** select a writable Zone C row ⇒ bulk move/delete enabled; select a
  read-only Zone C row ⇒ read-only gate/banner fires; select-all includes C; A/C duplicate
  counts once.
- **Docs:** `FileManager.md:259-261` → A ++ B ++ C (single source with
  `FileManagerView.md:127`).
- **Exit:** bulk operations and permission gating behave identically across all three zones.

### 28.3 P1 closure remediation detail

#### 28.3.1 A-4 — pg:vector runnable everywhere

Reuse the existing pgvector container on `:5433` with a separate database
(`webdav_vector_test`) instead of a second container/port. Parameterize
`test:ci:pg:vector` (`WEA_TEST_PG_PORT=${WEA_TEST_PG_PORT:-5433}`,
`WEA_TEST_PG_DATABASE=webdav_vector_test`), document the one-line command in
`docs/TEST_GIT_GUIDE.md`, and add a preflight that fails with the compose instruction when
the port is closed. Add the stage to the operator pipeline (Jenkins) at the next runbook
touch.

#### 28.3.2 A-5 — English-only provisioning surface

Translate all `provision.js` / `embedded-onnx.js` logs, errors and comments to English
(e.g. `invalid model.lock.json…`, `[provisioning] Downloading …`, `1/12 files`). Verify with
a grep for the Portuguese tokens (0 hits) plus the provision suites.

#### 28.3.3 B-4 — backfill driver correctness, executor deferred to T4.1

- Fix the enqueue condition to `existing.modelId !== modelId || existing.dim !== dim`.
- Keep `backfill` parked (`UNEXECUTABLE_KINDS`) until T4.1; record T4.1 as the executor
  owner (unified admin re-embed: initial coverage + model-change full re-embed, §4.15).
- Do not add a DDL column. If the `content_hash` marker must stay, document it as an opaque
  driver key and ensure job dedupe never compares it against a file hash. Preferred: drop
  the per-node driver once T4.1's admin action + factory `init()` rebuild own the path.
- RED: model change enqueues one deduped driver; stale-dim rebuild runs through the C6
  factory; no orphan `pending` backfill rows after a re-embed.

#### 28.3.4 B-5 — watch-items

- Add `AI_JOB_KIND` to `shared/constants.js` (`EMBED|FEATURES|CAPTION|ASR|BACKFILL`) and
  replace literals in `pipelines/embed.js` / `nodeContentHook.js`; add a DDL-parity test
  mirroring the `USAGE_ACTION` precedent.
- Normalize `excludeKinds` once (`(opts.excludeKinds || []).filter(Boolean)`) and bind the
  normalized array in BOTH twins; add a conformance case with `['', 'caption', null]`.
- `content_hash` overload: resolved by §28.3.3.

#### 28.3.5 C-2 — `listVisibleFileNodeIds` conformance

Add a conformance block to `FileNodeRepository.conformance.test.js`: own-root node, path
grant, point grant, foreign/denied node, trashed node; assert exact set equality. Add the
method to `searchService.md §2.5`. Run `test:ci:pg:adapters` for the PG twin.

#### 28.3.6 C-3 — `BASELINE_SAMPLE_DOCS` consumption

Give `createSemanticScorer` a `configResolver` seam and resolve
`BASELINE_SAMPLE_DOCS` per `score()` call (numeric parse, fallback 500) so the T2/dbOnly
knob is hot. `searchService` passes its resolver into the default scorer. RED: change the
config value → the next search samples the new cap without restart.

#### 28.3.7 C-6 — documentation reconciliation

In the same PRs that touch the files: `FileManager.md` zone union (C-1),
`searchService.md:183` default-scorer wording, `searchService.md §2.5` repository row
(C-2), `E2E_COVERAGE_PLAN.md:401` AI-case state (Zone C + save legs, scoring active),
PLAN C1 project name `ai` → `ai-desktop`. Add these files to the §7.1 task-spec map where
missing.

### 28.4 P2/P3 assignments (named owner required; no orphan items)

| ID  | Assignment                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-2 | C9 docs: keep `aiTagShared.js`, fix the Wave A wording and `aiTagStore.md §2.1` File Paths.                                                                                                                         |
| A-3 | T4.1 docs step: add `aiEnrichmentsStore` facade + test (T4.1 coverage filters) or strike the spec claim; sync `TESTING_STRATEGY.md:91`.                                                                             |
| A-6 | C6 docs step (vectorMath signature, ACL interim note) + T2.2 docs step (seam usage); optional PgVector → `aclFilter` consolidation.                                                                                 |
| B-2 | T4.1: `createPublishedMetadataFetcher` (free GETs, TTL cache) injected into the adapter; or spec step 2 as deferred.                                                                                                |
| B-3 | **No code change.** `backendHealth.md:41` is authoritative (embed/chat only). Reword T1.1c to "5-state display for tracked roles"; wizard keeps per-role probe rows.                                                |
| B-6 | C7 adds the timeout-race test; T4.3 adds boot step 8b / `llmBootWiring` e2e coverage.                                                                                                                               |
| C-4 | D1 docs step: add the TOTAL member count to `SearchSaveDialog` (the "+N more" overflow counter is not a total and is absent under the 12-tile cap) or align the host specs; optionally add a dedicated dialog spec. |
| C-5 | T3.4 docs step: add `docs/spec/server/store/queryParsesStore.md` (+ TESTING_STRATEGY conformance enumeration).                                                                                                      |

### 28.5 Closure waves (execution ledger)

| Unit | Branch (from `ai-feature`) | Scope                                                                                                         | Deps      | RED-first targets                                                                                                     | Effort |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| C6   | `fix/p1-c6-vector-seam`    | A-1, A-6, B-4(1) — factory, runtime singleton, reader/writer wiring, `vector`/`vectorOps` health, driver fix  | A5–A7, C2 | selection matrix pg/sqlite/fallback; reader injection; writer hook + single TX; `vectorOps` wire; model-change driver | M      |
| C7   | `fix/p1-c7-llm-gates`      | B-1, B-5, B-6(timeout) — conformance gate, probe cache, effective capabilities, `AI_JOB_KIND`, `excludeKinds` | B1, B2    | same-space vs same-dim foreign; probe-failed park; one re-probe per change; matrix off+warning; binding conformance   | M      |
| C8   | `fix/p1-c8-search-zone-c`  | C-1, C-2, C-3, C-6 — Zone C selection/bulk, repo conformance, config knob, client/search docs                 | C1–C5     | Zone C select/select-all/bulk/read-only; repo ACL set equality; hot baseline change; spec reconciliation              | S–M    |
| C9   | `chore/p1-c9-hygiene`      | A-2, A-4, A-5, B-3(docs) — English surface, pg:vector runbook, tag-helper wording, 5-state wording            | none      | Portuguese grep 0; pg:vector green from a clean checkout; docsStatePurity                                             | S      |

**Order:** C6 ∥ C7 ∥ C8 ∥ C9 after the audit; merge C6 and C7 **before** Wave D D2/D3
(D2 media probes consume effective capabilities; D3 media writes consume the seam).
C8 and C9 may merge any time. Wave D D1 is independent of C6/C7.

### 28.6 P1 exit-gate redefinition (supersedes the §27 Wave C exit claim)

Wave C's suite counts stand, but P1 closes only when ALL of the following are observed on
the merged tip:

1. `npm run test:ci` (server + client), `test:ci:pg:adapters`, `test:ci:pg:vector` green.
2. pgvector environment reports `vectorOps='native'` and semantic/near-dup go through the
   native engine; extension-absent environment reports `fallback_js` with a hint and no
   feature gate.
3. A same-dim, foreign-space remote embed endpoint is rejected at activation
   (`probe_failed`) and its consumers park; a conforming endpoint activates without restart.
4. Zone C rows participate in select-all, bulk operations and read-only gating.
5. `AI_JOB_KIND` + `excludeKinds` binding tests green; no orphan `pending` backfill rows.
6. `docsStatePurity` green; `FileManager.md` / `FileManagerView.md` / `searchService.md` /
   `E2E_COVERAGE_PLAN.md` reconciled; no PLAN-cited spec promises an absent file.
7. E2E `ai-desktop` + `retrieval` dual green on the remediation tip.

### 28.7 Standing notes

- Task branches never edit PLAN.md (§24); only the orchestrator records C-6..C-9 outcomes
  here.
- No DDL change is required by this remediation (job kinds stay in 001; `backfill` remains
  a valid CHECK value for T4.1). Any future driver-key column is a big-bang decision (§17-3).
- D2/D3 remain gated on C6/C7; D1 may start immediately.
- The audit itself changed documentation only; no product code was touched.

### 28.8 Execution log (2026-10-22) — P1 closure + Wave D landed

All remediation units and Wave D are merged on `ai-feature`; no DDL change was made.
Commits: C6 `c063fad`, C7 `6a6d577`, C8 `1d213f7`, C9 `84c8662`, D1 `e687488`,
D2 `665832d`, D3 `5cf5adc`, D4 `3ea16c7`, style sweep `6343c6e`.

| Unit | Status   | Landed scope                                                                                                                                                                                                     |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C6   | `[done]` | vectorStore factory + runtime singleton; search/near-dup reader wiring; embed-pipeline writer hooks (canonical + PgVector shadow in ONE TX); `vector`/`vectorOps` health; model-OR-dim backfill driver condition |
| C7   | `[done]` | EG2 conformance gate at remote-embed activation (signature-cached); `probeState` effective capabilities; `AI_JOB_KIND`; normalized `excludeKinds` binding; timeout-race test                                     |
| C8   | `[done]` | Zone C in selection/select-all/bulk read-only gating; `listVisibleFileNodeIds` conformance (sqlite + PG); hot `BASELINE_SAMPLE_DOCS`; client/search docs reconciled                                              |
| C9   | `[done]` | English provisioning surface; `test:ci:pg:vector` on the compose PG with its own database; tag-helper docs; embed/chat-only health wording                                                                       |
| D1   | `[done]` | live seed preview via `vectorStore.neighbors` (ACL-scoped, degraded missing-embedding path); `createSeedCollection` with `seed_vector` definition + `published:true` batch; `templateNamer`/`llmNamer`           |
| D2   | `[done]` | OpenAI-compatible remote client (embed/chat/vision/asr/media); embedded processor media path; positive-control media probes (photo/re-encode/base64-text/audio/video); vision/asr real fixtures                  |
| D3   | `[done]` | caption + asr pipelines; `media_direct` ladder, V2 caption/transcript fallback, V0 `metadata_only`; `aiEnrichmentsStore`; drain of embed/caption/asr                                                             |
| D4   | `[done]` | shared media fallback-corpus rule; media coverage classification + deterministic admin re-embed scope (no auto enqueue; T4.1 owns the action)                                                                    |

**Gates (merged tip):** server `jest --ci` **169 suites / 2956 tests pass (28 skipped), 1
pre-existing failure** (`domains/admin/routes/__tests__/reports.test.js` cleanup-row parity
— reproduced unchanged on base `39e6cfc`); client **183 / 2102 pass**; `test:ci:pg:adapters`
**30 / 432 pass (1 skip)**; `test:ci:pg:vector` **22 / 22** (compose pgvector); embedded
multimodal smoke **1 / 1** (image near-dup 0.9506, audio 0.7393, video 0.8447); E2E
`ai-desktop` **1 / 1 pass** (1.8 m); docsStatePurity green in-suite; eslint clean;
prettier clean. `retrieval-desktop` E2E did not reach the app assertions: the scratch stack
(port-band PG `:5453` / S3) failed to bind/boot in this environment (`ECONNRESET` on login,
PG connections terminated at teardown) — not reproduced as a product failure; rerun in a
clean band is required.

**Deviations / residual ownership:** `backfill` execution and the admin re-embed launcher
remain T4.1 (the kind stays parked, no orphan enqueues); `planMediaBackfill` intentionally
plans only `missing ∪ stale_space`, not same-model probe flips; `metadata_only` writes one
segment row in addition to the pooled row; seed θ ships as `0.62` from the routes example
until a release measurement replaces it; the remote dialect client is OpenAI-compatible
(llama.cpp presets) — Ollama/other dialect presets are not shipped; media E2E/degradation
matrix remains T4.3. The pre-existing admin-reports parity failure and the retrieval
scratch-stack boot issue are recorded here, not fixed by this wave.

### 28.9 Residual closure (2026-10-22) — C10

The P2/P3 audit items still assigned to later units were pulled forward and closed on
`fix/p1-c10-residuals` (merge `edc3ac8`):

- **B-2** published-metadata budget step 2 — `createPublishedMetadataFetcher` in
  `llmBootWiring.js` (free `/v1/models`, `/props`, Ollama `/api/show`; TTL cache;
  errors ⇒ null), injected at boot.
- **B-4** backfill executor — `pipelines/backfill.js` (`rebuildShadow()` per claimed
  driver, no provider calls/enqueues, failure ⇒ backoff), drained behind the embed gate
  only when a vectorStore is installed; `features` remains the only parked kind.
- **B-6** boot wiring tests — `llmBootWiring.test.js` (preset/probe delegation + metadata
  fetcher GET paths/cache/error handling).
- **C-4** save-dialog total member count (`search-save-member-count`, en/ko) alongside the
  existing overflow counter.
- **C-5** `docs/spec/server/store/queryParsesStore.md` + searchService/TESTING_STRATEGY links.

**Final gates (tip `edc3ac8`):** server `jest --ci` **171 suites / 2974 pass (28 skipped),
1 pre-existing failure** (`reports.test.js` cleanup-row parity, reproduced on base);
client **183 / 2102**; `test:ci:pg:adapters` **30 / 432 (1 skip)**; `test:ci:pg:vector`
**22 / 22**; E2E `ai-desktop` **1 / 1** (1.8 m, rerun after C10); docsStatePurity green;
eslint/prettier clean on the changed surface.

**Still outside this wave (unchanged ownership):** T4.1 admin launcher/rate limit for the
backfill action (the executor now exists); T4.3 media hermetic E2E + degradation matrix;
the pre-existing admin-reports test failure; the retrieval scratch-stack boot issue
(`:5453` / S3 bind) noted in §28.8.

### 28.10 Admin-reports retention moved to the maintenance scheduler (2026-10-23)

The last pre-existing gate failure was root-caused to the **write path**: every
successful `admin_reports` insert ran a retention DELETE, so the cleanup parity test's
old fixture row (and, in production, arbitrary historical rows) could be removed by an
unrelated report write. The fix is structural, not an assertion tweak:

- **Writer is append-only.** `createAdminReportsWriter` no longer accepts/executes a
  prune seam; `writeReport` only inserts.
- **Retention is a maintenance job.** `runAdminReportsRetention` (bounded
  `ADMIN_REPORTS_RETENTION_BATCH`=1000 batches, `admin-reports-retention` lock,
  `retention_off`/`locked` skips, hot `ADMIN_REPORTS_RETENTION_DAYS`) +
  `startAdminReportsRetentionScheduler` (`ADMIN_REPORTS_RETENTION_INTERVAL_MS`=24h,
  `WEA_SKIP_ADMIN_REPORTS_RETENTION`). Boot runs one pass; the timer covers steady state.
- **Repository:** `deleteReportsOlderThan(cutoff, { limit })` on both twins + facade
  (sqlite/PG conformance includes the bounded batch).
- **Docs:** admin.md §2.2.6, maintenanceScheduler.md §3.4, configRegistry rows.

Gates on the merged tip: server `jest --ci` **173 suites / 2977 tests pass (28 skipped),
0 failed** (the previously failing `reports.test.js` cleanup parity now passes with the
original assertion); PG `AdminReportsRepository.conformance` **12/12**; docsStatePurity
3/3; prettier/eslint clean. Client is unchanged by this refactor.

### 28.11 E2E infrastructure isolation + WebDAV directory hardening (2026-10-23)

The remaining "environment" failure was traced to four interacting causes, not one:

1. **Duplicate MKCOL socket hang** — `ensureDirectoryExists` blindly re-issued MKCOL
   for every path segment; bytemark drops the socket on duplicate MKCOL of recently
   created deep collections (the surfaced 500 reason was `socket hang up`).
2. **Scratch WebDAV root sharing** — suites created `/setup-e2e/<caseId>` but seeded
   the ROOT URL into the scratch DB, so users/files landed outside their case subtree.
3. **Compose/bind staleness** — one fixed compose project + host bind mount let
   containers/DAV locks survive across bands/runs.
4. **Fixed 5 s assumptions** — cold production-build static assets and WebDAV
   operations exceeded the login/row-visibility timeout.

Fixes merged (`b7dc218`, merge `4270230`):

- Existence-first directory creation in BOTH `server/utils/webdav.js` and the
  blobstore adapter (`client.exists` before MKCOL) — a product-level robustness fix.
- One scratch contract: `scratchWebdavUrl(caseId)` + `prepareScratchWebdav` (create +
  PROPFIND-verify + seed the SAME case-scoped URL); all scratch suites migrated; the
  root default is gone. `WEBDAV_UPSTREAM_URL` follows the same case root.
- Per-band compose project (`-p webdav-easyaccess-<offset>`) in every compose call and
  a per-band named `webdav_data` volume; global setup resets only the WebDAV volume.
- Fail-fast E2E: `expectOk` surfaces status+body, child exit logs code/signal + stderr
  tail, bounded `buildName` slug, test-only 65 s keep-alive, global expect timeout 15 s.
- TEST_GIT_GUIDE updated (per-band project/volume + case-root contract).

Gates on the merged tip: `retrieval-desktop` + `retrieval-mobile` **22/22** (5.9 m);
`collections-desktop` **17/17**; `ai-desktop` **1/1**; full server **173 suites /
2978 pass (28 skipped), 0 failed**; prettier clean. Client code is unchanged by this
infra wave.

### 28.12 Admin config + trash-admin E2E follow-up (2026-10-23)

| Task   | Objective                                                                   | Inputs                                        | Expected outputs                                           | Verification                                 | Dependencies |
| ------ | --------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------- | ------------ |
| 28.12a | Expose registered `GC_VERSION_TTL_DAYS` as an editable Runtime number field | config registry + SystemConfigEditor contract | Spec, UI metadata/locale, unit and E2E pins agree          | targeted client tests + admin-config-desktop | none         |
| 28.12b | Remove unrelated UI upload setup from global-trash test                     | `uploadFileAt` precedent in `E2E-TRASH-003`   | API-seeded fixture; trash/purge behavior remains UI-tested | trash-admin desktop/mobile E2E               | none         |

Both tasks are independent; docs precede tests and implementation. Follow-up diagnosis confirmed
that UI delete returns after the async job is accepted, not completed; E2E-TRASH-007 now captures
the UI-triggered 202 response and polls its job through the existing `waitForBulkJobToComplete`
helper before asserting list/trash state. The case timeout is 90 seconds because scratch boot and
UI interactions together exceeded the generic 30-second limit. E2E-ADMINCFG-004 now treats the
UI-triggered config PUT response (200) as save completion, does not retry on a missing Snackbar,
and has a 90-second case timeout for its five save cycles. The A22 server test compares offset
results against the actual unpaginated response order instead of fixture creation order.

Verification: client CI 183 suites / 2102 passed; server CI 173 suites / 2978 passed (28
skipped; 2 suites skipped by selection); trash-admin desktop + mobile both passed; admin-config
desktop E2E-ADMINCFG-001/002/004 passed in a full-run attempt, and 004/005/008 passed again in a
targeted run. The full admin-config project still stopped at unrelated E2E-ADMINCFG-006: its
negative connection probe returned HTTP 500 twice, and the test timed out while waiting for the
UI to leave “Testing...”.

### 28.13 E2E-ADMINCFG-006 connection-probe retry diagnosis

| Task   | Objective                                                     | Inputs                                             | Expected outputs                                                      | Verification                                         | Dependencies |
| ------ | ------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- | ------------ |
| 28.13a | Stop retrying an intentional failed admin connection probe    | config probe contract + shared HTTP retry behavior | `testConfig` sends one request; normal retry policy remains unchanged | adminService/httpClient unit tests + ADMINCFG-006    | none         |
| 28.13b | Validate the repaired surface and repository regression gates | 28.13a implementation                              | All affected admin E2E, client/server CI, related trash E2E green     | serial E2E runs + `npm run test:ci` in client/server | 28.13a       |

Verified hypothesis: `/api/admin/config/test` reports an unreachable WebDAV probe as HTTP 500;
the generic transport retries all 5xx, so the UI remains in `testing` while repeat probes run.
The API contract permits a non-2xx probe failure without prescribing status, and the HTTP
transport already supports request-scoped `maxRetries`; use that seam for this probe only.
Implementation applied: adminService spec now defines a single-attempt connection probe;
`testConfig` passes `maxRetries: 0`, with unit assertions for call policy and transport behavior.
Focused tests passed (adminService/httpClient: 36/36). The complete admin-config desktop
project passed (11 passed); ADMINCFG-006 passed in the project run and in the earlier isolated
check. The mobile project had one transient loading-state failure on its first attempt and then
passed its complete dependency-chain run (22/22). Trash-admin's first concurrent run failed
before the seeded item rendered; the serial desktop/mobile rerun passed (2/2). Server CI passed
173 suites / 2,978 tests (28 skipped). Client CI initially had 11 test timeouts while competing
with server/E2E workloads, then passed serially: 183 suites / 2,103 tests. No implementation
failure remained reproducible. `git diff --check` was clean; changes remain uncommitted.

## 29. P2 execution plan — membership snapshot overlay (2026-10-26)

> Execution ledger overlay for §7 P2. Task rows/definitions stay unchanged; this section records
> the binding D1/D2 resolution and the wave order. Docs-first (AGENTS §2.1): Wave 0 lands the
> contract text + schema before any P2 code. `ai-feature`-only merges; `dev` untouched.

### 29.1 Binding decisions (full rationale: AI_FEATURE_PLAN §12.14)

- **D1** — definition evaluation is **compute-on-write**. `collection_items` is the single
  membership state; reads never evaluate definitions. Reconcile applies
  `score >= theta_in` (add) / `>= theta_out` (keep) / `< theta_out` (remove); offsets come from
  `profile.membershipHysteresis`. No derived snapshot table.
- **D2** — `system|seed|search` definitions materialize into `collection_items` with
  `source`/`reason`; initial batches `published=true`, later rule adds follow `publish_mode`.
  Manual rows and rule rows coexist; `Exclude` deletes + inserts the exclusion. Wire
  `membership` keeps `stored` (manual) vs `derived` (rule-managed).
- **D3** — membership/seed/centroid/grouping use pooled vectors; `vectorStore.neighbors`
  (max-over-chunks) stays retrieval-only.
- **D4** — merge suggestion state machine gains `dismiss_count` (2-week re-raise once, then
  30-day sleep); `rejected` stays terminal.
- **D5** — archive constants: `AI_EVOLUTION_INACTIVE_DAYS=30`, `AI_EVOLUTION_MIN_AGE_DAYS=14`
  (ε=0), with `AI_EVOLUTION_CREATE_RATE_DAYS=7`.
- **D6** — queue-drain hint (`uploadComplete`) stays in P2 scope (latency sugar; the server
  debounce is authoritative). Its route contract lands in the T2.2 docs step.
- **D7** — P2 writes merge suggestion score/state only; arbiter recommendation stays T3.1/T3.4
  (`arbiter_verdict/reason` NULL in P2).

### 29.2 Wave plan (branches from `ai-feature`; merge back to `ai-feature` only)

| Wave | Unit                    | Branch                             | Scope                                                                                                                                                                                  | Deps    | Status                                                                                                                                                                                               |
| ---- | ----------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | P2.0 contracts/schema   | `chore/p2-contract-reconciliation` | snapshot-contract specs; `001` adds `collection_items.source/reason` + `collection_merge_suggestions.dismiss_count`; hint route contract; docs-purity + schema parity                  | P1      | `[done]`                                                                                                                                                                                             |
| 1a   | T2.1 vectors + hook     | `feature/t21-definition-vectors`   | pooled seed/centroid evaluator, predicate+vector AND, `AI_VIEW_WEIGHT_ALPHA`, `checkUploadAdmissions` materialization + 4 commit seams, seed preview/creation replacement              | Wave 0  | `[done]` — full server 176/3009, PG CollectionsRepository conformance 31/31; reconcile/read-path switch remains T2.2                                                                                 |
| 1b   | T2.2a triggers/skeleton | `feature/t22-evolution-triggers`   | `evolutionService` skeleton, `AI_EVOLUTION_*` registry, `startEvolutionScheduler`, `WEA_SKIP_EVOLUTION_SCHEDULER`, per-user lock, `night_eval` report, debounce + hint, reconcile pass | Wave 0  | `[done]` — full server 177/3060 (28 skipped); reconcile + trigger/hint tests green                                                                                                                   |
| 2a   | T2.2b-i read model      | `feature/t22b-read-path`           | stored-only read path + digest, auto-pin reconcile, merge candidates with D4 state; no create/split yet                                                                                | 1a + 1b | `[done]` — full server 177/3042 (28 skipped); PG CollectionsRepository conformance 33/33                                                                                                             |
| 2b   | T2.2b-ii create         | `feature/t22b-create`              | mutual-kNN create (dedup/facets/gates/tombstones), initial materialization, promotion handling                                                                                         | 2a      | `[done]` — full server 178/3055 (28 skipped); create-pass suite 12                                                                                                                                   |
| 2c   | T2.2b-iii split         | `feature/t22b-split`               | hot-subset sibling split; parent untouched                                                                                                                                             | 2b      | `[done]` — full server 179/3073 (28 skipped); split suite 16; PG UsageRepository conformance 10/10                                                                                                   |
| 3    | T2.3 archive/purge      | `feature/t23-archive-purge`        | archive gate (D5) + purge/tombstone, member-activity read, item ordering activity decay                                                                                                | 2c      | `[done]` — full server 179/3082 (28 skipped); archive/purge + ordering tests green                                                                                                                   |
| 3    | T2.4 digest             | `feature/t24-digest-derived`       | materialized `added_since`, removed_since trash/purge refinement, cursor regression                                                                                                    | 1a      | `[done]` — closed by T2.2b-i stored digest (materialized adds, journal+trash removals, cursor); purge side is the spec'd display-truth approximation                                                 |
| 3    | T2.5 preview close      | `test/t25-preview-close`           | vector definition preview + owner/400/409 regression                                                                                                                                   | 1a      | `[done]` — full server 179/3093 (28 skipped); vector/self-centroid/owner 400-409 regressions green                                                                                                   |
| 4    | Integration             | orchestrator                       | scheduler/hint mounts already landed in T2.2a; full P2 gates + E2E + ledger closure                                                                                                    | Wave 3  | `[done]` — server 179/3093, client 183/2110, PG adapters 30/444(+1 skip), PG vector 22/22, lint/docs-purity green; E2E `s3-collections-desktop` 17 pass/3 mobile-skip, `s3-ai-desktop` 1/1 (band 20) |

### 29.3 P2 verification gates

- Per wave: RED-first suites; full `cd server && npm run test:ci`; client `test:ci` only when the
  hint/UI seam changes.
- Repository/schema touched ⇒ `test:ci:pg:adapters` with new conformance cases (item `source`/
  `reason` round-trip, dismiss counter, member-activity read).
- Vector native path touched ⇒ `test:ci:pg:vector`.
- Membership stability: two reads between passes return the same set; `GET /`,
  `GET /:id/items` and `for-nodes` perform zero definition evaluation.
- Hysteresis: `theta_out ≤ score < theta_in` keeps a member and rejects a non-member; automatic
  removal below `theta_out` deletes the row only (user Exclude is the exclusion path).
- Journal/report: every pass act `actor='system'`; `admin_reports(kind='night_eval')` written;
  no tag writes; kill switches leave suggestions/rendering intact.
- E2E: `collections-desktop` lifecycle after T2.3; `ai-desktop` smoke after T2.1/T2.2. The full
  hermetic AI/degradation matrix remains T4.3.
- CI grep gates unchanged (`CacheAdapter|operationProgress`, tag-purge absence);
  `docsStatePurity` green; prettier/eslint clean.

**P2 exit gate PASSED (2026-10-26, Wave 4):** tip `a4a83b83`. Gates — server `test:ci`
**179 suites / 3,093 tests pass (28 skipped)**; client `test:ci` **183 / 2,110**; PG adapters
**30 suites / 444 pass (1 skip)** on an isolated band; PG vector **22/22** (recall 1.0 @ ef400);
server/client lint + `docsStatePurity` green (one pre-existing test-file `no-unused-vars`
cluster fixed in `a4a83b83`). E2E (band 20, S3): `s3-collections-desktop` **17 pass / 3
mobile-only skips / 0 fail**, `s3-ai-desktop` **1/1**; per-band stack torn down. P2 is CLOSED on
`ai-feature`; the single `ai-feature`→`dev` merge remains a later event after ALL §7 phases.

**P2 residue closed (2026-10-27, owner-directed):** the exit-gate audit left two specified
but unimplemented items; both landed on `ai-feature` per their binding specs.
(1) **`uploadComplete` client hint** (D6 latency sugar; `useFileOperations.md §3`) —
`collectionsRepository.notifyEvolutionHint` (absorbed, silent POST `/evolution/hint`) +
gateway re-export; `useFileOperations.notifyUploadQueueDrained` fired exactly once per
drained upload batch (no-permission/cancel-all/terminal/batch-error paths; empty batch never
fires). One RCA: the seam was first bound as a named import from the default-export-only
gateway — synchronous throw aborted the upload completion path (2 FileManager upload-flow
failures at the first full gate); fixed to the default binding with full absorption, RCA
2026-10-27.
(2) **`AI_VIEW_WEIGHT_ALPHA` reader** (§2.3 ordering-only soft boost) — per-call α read
(shipped-default fallback), views = per-user `node_activity` open+preview lifetime counts,
`cosine × (1 + α·log10(1 + views))` re-ranks the SEED-PREVIEW sample over the top-K set;
`ids`/`count`/batch stay raw (admission un-boosted); the definition-preview arm keeps its
node_id asc sample (no cosine ordering exists there).
Gates: server `test:ci` **179 suites / 3,096 tests (28 skipped)**, client `test:ci`
**183 suites / 2,120 tests**, eslint/prettier clean; no repository/SQL change ⇒ PG leg N/A.

**T2.1–T2.5 closed (2026-10-26):** every §7 P2 task is implemented and merged — definition
engine/pooled vectors, silent-evolution passes (reconcile/create/split/merge-candidates/auto-pin),
archive/purge + activity ordering, materialized digest, and the vector preview contract. Final
gates: full server **179 suites / 3,093 tests pass (28 skipped)**; PG CollectionsRepository 33/33
and UsageRepository 10/10 conformance; `docsStatePurity` green; eslint/prettier clean. The
Wave-4 exit gate above closes the phase.

**Historical T2.2 intermediate snapshot** (before T2.3 closure; superseded by the T2.1–T2.5
closeout above): all silent-evolution passes were merged — triggers/scheduler/report,
reconcile, create, split, merge candidates, auto-pin reconcile. Final gates: full server
**179 suites / 3,073 tests pass (28 skipped)**; PG CollectionsRepository 33/33 and
UsageRepository 10/10 conformance; `docsStatePurity` green; eslint/prettier clean. Archive/purge
and item activity ordering were still T2.3 work at that intermediate point.

## 30. P3 execution plan — proposals, sharing, subscriptions (owner-adjudicated 2026-10-27)

> Execution ledger overlay for §7 P3. Task rows/definitions stay unchanged; this section records
> the substrate re-scope (P1/P2 + §10 polish already landed a large share of the P3 server
> surface), the owner rulings, and the wave order. Per unit: docs-first (AGENTS §2.1) → RED →
> GREEN → gates → merge into `ai-feature` only; task branches never edit PLAN.md (§24 standing
> rule — the orchestrator owns these rows). Base: `ai-feature` @ `f91ecf38` (P2 closed).

### 30.1 Substrate re-scope (audit 2026-10-27; orchestrator spot-checked against source)

| Task | Already landed (verified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Actual residual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3.1 | Server complete: DDL `collection_merge_suggestions` incl. `dismiss_count`/`arbiter_verdict`/`arbiter_reason` (001:265–269); repo twins + facade; routes `GET /merge-suggestions` (`routes.js:80`), `POST /:id/merge/:other`, `/:id/merge-dismiss` (:410), `/:id/merge-reject` (:430); evolutionService Pass 5 candidates (Jaccard ≥0.7 ∧ sizeRatio ≥0.7, D4 dismiss/reopen cadence); service serialization already maps additive `recommendation`; client seams (`useCollections.mergePair`/dismiss/reject) | **MergeProposalCard** greenfield (`FileManager.js:1262` still `mergeSlot: null`); server §2.4 conformance audit (payloads, score-desc order, error codes, survivor/name_locked rule, grants-dropped, undo); **arbiter** (T3.4-gated; `arbiterCalls: 0` placeholder); overlap-sample payload extension anchored INTO T3.1 (R2)                                                                                                                                                                                                                                                                                                               |
| T3.2 | Grants CRUD + `DELETE /:id/grants/me` (P-1) + publish pipeline + `publish_mode ask\|off\|auto` (001:190) + cross-leak (`resolveMemberViews`) + live per-read resolution                                                                                                                                                                                                                                                                                                                                     | **`shareService.js` split** (spec-named file `server/domains/collections/shareService.js`; spec's own note assigns the delegation to this task); **`is_tip` per-subject server-side computation** (register (e); `actions/service.js:129–151` comment names T3.2) + `routes/actions.md`/`actionJournalStore.md` docs; audit/close: `assertMemberConsumable`, `publishPendingCount` owner-only, admin-grantee-ban parity (§14); **CollectionPropertiesDialog** greenfield (dispatch seam reserved `FileManager.js:728–731`); viewer chip surface                                                                                             |
| T3.3 | DDL `file_suggestions` (001:337–348); dashboard computed suggestions + `POST /suggestions/accept` (un-journaled P0 state); near-dup availability gating (C4)                                                                                                                                                                                                                                                                                                                                                | Greenfield: `FileSuggestionsRepository` interface+twins+conformance (PG leg REQUIRED) + facade; **store/route specs written at this docs step** (§7.1); rule-variant generator pass (hash-first exact dups, filename/temp/screenshot/installer patterns); vector variant from C4 near-dup groups — **θ_dup reads the profile (EG2 0.955); the task-row "0.97" is the superseded generic default**; hash-twin members excluded; short-doc cosine exception; accept → **command-unit journal undo**; dismiss (component already renders `row.id && onDismiss` — host does not pass it); expiry retention; dashboard AI-block §4.12 gate audit |
| T3.4 | `query_parses` cache + `{space,dim,v}` envelope + reserved `predicates` (C1); grammar `ATOM_TYPES = path/tag/like/date/size` (`definitionEngine.js:27`); chat adapter (B2)                                                                                                                                                                                                                                                                                                                                  | Greenfield: `parse.nl` under the request-path exception family (≤1 call batched with query-embed, closed grammar, session predicate state field/value only, parse failure ⇒ silent vector+name fallback); `query_parses.predicates` storage begins; additive two-section response extension; client `applyStep` consumption (minimal)                                                                                                                                                                                                                                                                                                       |
| T3.5 | `action_journal` domain enum already includes `batch` (no writer); `OperationProgressStore.setJobCancelled` exists                                                                                                                                                                                                                                                                                                                                                                                          | Greenfield: batch worker honors `job.cancelled` per item (today write-only); ONE journal command row `domain='batch'`, subject `batch:<jobId>`, item-level inverse list in payload (actionJournalStore.md binding); undo path (fingerprint mismatch ⇒ skip, mixed results allowed); client undo integration (`useBulkOperations` has ZERO undo wiring today); docs step checks the `file`-domain enum row (rename undo per §4.11 matrix)                                                                                                                                                                                                    |
| T3.6 | Server COMPLETE: `POST /for-nodes` (`routes.js:94`), `getForNodes`, `listForNodes` twins, tests; client `getMemberships` seam landed but unconsumed                                                                                                                                                                                                                                                                                                                                                         | Client only: membership chips (grid `cornerBadges` slot / list leading overlay idiom, `getMemberships` batched ≤100 per §24 chunking precedent) + files-surface toolbar bulk add-to-collection (`FileManagerControls` supports it; shell passes it only in memberMode); file-listing contracts stay frozen                                                                                                                                                                                                                                                                                                                                  |

### 30.2 Owner rulings (2026-10-27)

- **R1 (merge band)**: the card gate stays **Jaccard ≥ 0.7** in the LLM-free default; 0.55–0.7
  band pairs become cards ONLY via an arbiter verdict (chat configured). §4.19's "chat off ⇒
  card still appears" sentence is superseded by this ruling — amend docs-first at the T3.1c/T3.4
  docs steps (provenance → AI_FEATURE_PLAN §12).
- **R2 (compare overlay)**: owner ruling 2026-10-27 — the `overlap_sample` payload extension is
  anchored INTO T3.1: the card ships with the REAL compare overlay, not the skeleton state.
  Server `GET /merge-suggestions` gains `overlap_sample: [{a_node_id, b_node_id}]` + per-side
  unique samples (the extension AI_FEATURE_PLAN §12.11 rules as REQUIRED "at its own docs
  step" — T3.1's docs step is that step); MergeProposalCard.md's "until shipped, skeleton
  rows" sentence is amended in the same PR (docs-first).
- **R3 (parser E2E)**: T3.4 is verified in P3 by unit/integration tests with an adapter-injected
  fake chat; the parser E2E case (E2E-AI-002) rides the T4.3 fake-LLM harness.
- **θ_dup governance** (recorded, no ruling needed): the vector suggestion variant reads the
  active profile `thetaDup` (EG2 0.955 measured, Q10); PLAN task-row "0.97" is superseded.

### 30.3 Wave plan (branches from `ai-feature`; merge back to `ai-feature` only)

| Wave | Unit                                                  | Branch                         | Scope                                                                                                                                                                                                                                                                                                                                                                                         | Deps         | RED-first targets                                                                                                                                                                                                                       | Effort |
| ---- | ----------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1    | T3.1 merge card UI + overlap payload (+ server audit) | `feature/t31-merge-card`       | MergeProposalCard (68px collapsed one-liner, `+N more` chip cycling, expand → REAL two-column compare overlay, [Merge primary][Keep separate ghost][Later text]), `mergeSlot` wiring, merge → undo toast, zero-pending ⇒ zero layout footprint, en/ko; server: §2.4 conformance audit with pins + `overlap_sample: [{a_node_id, b_node_id}]` + per-side unique samples payload extension (R2) | none         | card-is-confirmation (no extra dialog), no-stack single card, Later/Keep-separate dispatches, undo toast on merge, overlay renders real sample rows (zero-fabrication caveat retired), `mergeSameCollection`/`suggestionNotFound` codes | M–L    |
| 1    | T3.2a sharing server core                             | `feature/t32a-share-service`   | `shareService.js` split (spec file path), `is_tip` per-subject computation (register (e)) + actions-feed docs, audit/close `assertMemberConsumable` + `publishPendingCount` owner-only + admin-ban parity, editor membership-write path verification                                                                                                                                          | none         | two-actors×one-subject is_tip matrix, route parity after the split, admin grantee 403                                                                                                                                                   | M–L    |
| 1    | T3.3 file_suggestions persisted leg                   | `feature/t33-file-suggestions` | repo (interface+twins+conformance) + facade + NEW store/route specs + rule-variant generator pass + vector variant (profile θ_dup, hash-twin excluded, short-doc exception) + accept → command-unit journal undo + dismiss + expiry retention + dashboard AI-block gate + client (onDismiss wiring, undo toast, expiry footer)                                                                | none         | twins conformance incl. PG leg, accept-undo restoration, dismiss state transitions, AI-block absent when embed unconfigured                                                                                                             | M–L    |
| 1    | T3.5 batch journal + cancellation                     | `feature/t35-batch-journal`    | worker honors `job.cancelled` per item; ONE journal command row (`batch:<jobId>`, item-level inverses); undo path (fingerprint mismatch ⇒ skip); client `useBulkOperations` → `handleUndoable` + `useUndoToast` consumption; docs: `file`-domain enum row check                                                                                                                               | none         | mid-batch cancel reflects per-item skip, single journal row, mixed-batch undo, 409 cascade path                                                                                                                                         | M      |
| 2    | T3.2b sharing client                                  | `feature/t32b-sharing-ui`      | CollectionPropertiesDialog (Sharing tab: grants list/add via UserSelectionMenu/revoke, `publish_mode` radio + exposure-explicit copy, owner-only tab), `sharing` dispatch seam, viewer chip surface, i18n                                                                                                                                                                                     | T3.2a        | owner-only tab gating, grant add/revoke flows, publish_mode PUT, viewer sees no tab (absent-not-disabled)                                                                                                                               | M      |
| 2    | T3.6 membership chips                                 | `feature/t36-membership-chips` | chips in grid/list via batched `getMemberships` (≤100), files-toolbar bulk add wiring, comparator extensions, i18n; file-listing contracts frozen                                                                                                                                                                                                                                             | none         | chip accuracy/caps, batched fetch, writable multi-select gating, listing contract pins                                                                                                                                                  | S–M    |
| 2    | T3.4 NL parser                                        | `feature/t34-nl-parser`        | `parse.nl` (≤1 call batched with query-embed, closed grammar, session predicate state, silent fallback), `query_parses.predicates` storage, additive two-section response, minimal client consumption                                                                                                                                                                                         | B2+C1 (done) | cache hit ⇒ zero chat calls, schema-checked grammar-constrained output, chat-off ⇒ P1-identical response                                                                                                                                | L      |
| 3    | T3.1c merge arbiter                                   | `feature/t31c-merge-arbiter`   | nightly arbiter pass over 0.55–0.7 band pairs (chat-configured only); prompt MUST carry symmetric-difference inputs (names, top tags, sizes, ≤5 member summaries per side + unique-member counts/ratios/samples); verdict → `arbiter_verdict/reason` + `recommendation` prefill; `sibling` ⇒ no card; `arbiterCalls` metric; budgets/kill-switch; advises-never-acts                          | T3.4 + T3.1  | prompt builder asserts symmetric diff, chat-off ⇒ zero calls + cards unaffected, verdict persisted                                                                                                                                      | M      |
| 3    | Exit gate                                             | orchestrator                   | full gates + E2E extension + ledger closure                                                                                                                                                                                                                                                                                                                                                   | all          | §6 gates + docsStatePurity + grep-gates                                                                                                                                                                                                 | —      |

**Merge order**: Wave 1 = T3.5 → T3.3 → T3.2a → T3.1 (T3.1 is the only Wave-1 unit editing
`FileManager.js`; T3.5's client leg touches it minimally — sequence its merge first). Wave 2 =
T3.2b → T3.6 → T3.4 (T3.2b/T3.6 both touch `FileManager.js` — stated order resolves).

### 30.4 Verification gates (§29.3 discipline carried forward)

- Per wave: RED-first suites; full `cd server && npm run test:ci`; client `test:ci` when client
  seams change; `test:ci:pg:adapters` whenever repositories/schema are touched (T3.3 twins
  REQUIRED; T3.2a if grant surfaces change); `test:ci:pg:vector` only if a vector path changes.
- **No DDL change is expected in P3** — `file_suggestions`, `collection_merge_suggestions`
  (incl. arbiter columns), grants, `publish_mode` all shipped in 001. Any discovered gap is a
  big-bang-script decision (§17-3), never an ALTER chain.
- Membership stability pins: `GET /`, `GET /:id/items`, `POST /for-nodes` perform ZERO
  definition evaluation (T3.6 regression).
- CI grep-gates unchanged (`CacheAdapter|operationProgress`, tag-purge absence); docsStatePurity
  green; eslint/prettier clean on touched files; new specs state-only (docsStatePurity covers).
- E2E: collections dual gains E2E-S3-COLLECTION-021+ (merge card lifecycle incl. undo; sharing
  grant → recipient view → leave → re-grant re-dot; suggestions accept-undo-dismiss);
  E2E_COVERAGE_PLAN rows added at each docs step; `ai-desktop` unchanged (parser E2E → T4.3
  per R3); per-worktree port-band discipline per TEST_GIT_GUIDE.

### 30.5 P3 exit gate

All §7 P3 rows closed (T3.1 includes the T3.1b/1c legs), full server/client `test:ci` +
`test:ci:pg:adapters` green on the merged tip, extended E2E suites green, grep-gates +
docsStatePurity clean, this ledger updated. The single `ai-feature`→`dev` merge remains a later
event after ALL §7 phases (P4 still open).

### Wave 1 execution log (2026-10-27 — orchestrator; tip `45aeaf2b`)

Base `e2182166` (§30 committed). Worktrees wt-t35/t33/t32a/t31 with symlinked root
node_modules (npm-workspaces-safe: `@webdav-easyaccess/shared` → the worktree's own `shared/`);
bands 40/60/80/100. Merged in §30.3 order T3.5 → T3.3 → T3.2a → T3.1.

- **T3.5 `[done]`** — merge `ac116fe9`. Branch gates server 179/3117, client 183/2130. Audit
  miss found+fixed: `batchMove/batchCopy` never returned `succeeded` entries (client always
  showed `0/N done`); poll response gained additive `undo:{action_id}`; `useUndoToast` per-call
  `refresh` override. Delete batches deliberately NOT journaled (undo-matrix rule), cancelled
  move/copy batches journal the succeeded prefix. RCA: Setup-suite contention flake class.
- **T3.3 `[done]`** — merge `7edac8e5` + boot wiring `fc28c8b7` (expiry scheduler in
  `server/index.js`, orchestrator-owned). Branch gates server 183/3160, PG 31/455(+1 skip — the
  REQUIRED new-twins leg), client 183/2125. Generator placements: short-doc cosine exception
  lives in the persisted generator leg (§4.17 assigns it to the near-dup suggestion VARIANT;
  computed C4 summary block stays verbatim); θ_dup read from the active profile — never
  hardcoded. Accept-undo applies inside the journal TX via the tx-bound repository client
  (nested withSqliteTransaction deadlock avoided — documented, `dashboardService.md` §2.6).
- **T3.2a `[done]`** — merge `f841f916`. Branch gates server 180/3114; collections route-parity
  matrix byte-identical after the `shareService.js` split. §30.1 under-called three gaps, all
  closed: `assertMemberConsumable` never existed, self-grant ban, re-grant hidden-clear (+
  `grantAccess` inverse now captures `{role, grantedBy}` — journal-inverse behavior change,
  pinned). `isVisibleToGrantee` auto-arm scoped to virtual rows (Case C, RCA-logged).
- **T3.1 `[done]`** — merge `45aeaf2b`. Branch gates server 179/3106, client 185/2143 (serial),
  PG 30/445(+1 skip). REAL Case-A defect found by the §2.4 audit: **merge undo was never
  executable** (no `merge-collections` inverse case ⇒ every Undo 409'd) — full inverse executor
  shipped (name_locked/added_by/published/source/reason fidelity, dropped-set-stripping
  move-back) + `insertCollection nameLocked` twin extension + conformance pin. Second Case-A:
  `dismiss/rejectMergeSuggestion` skipped the hook-spec refresh/error channel. Payload
  extension per R2 shipped (`overlap_sample` cap 8 + per-side unique samples cap 4, revoked
  members excluded). E2E 021/022 (merge card, dual) + 023 (suggestions lifecycle) planned;
  021/022 spec code written (`playwright --list` verified), 023 code at exit gate.
- **Conflict resolutions (orchestrator)**: `actionJournalStore.md` Consumers/domain tables
  unioned (batch rows + file suggestion-accept rows; `file` is no longer writer-less);
  `FileManager.md` undo-toast/merge-slot bullets unioned; RCA_LOG append-only ×2;
  **E2E-ID collision**: T3.1's merge-card keeps `E2E-S3-COLLECTION-021/022` (spec code shipped
  under those ids), T3.3's planned suggestion case renumbered to **023**.
- **Wave-1 exit gates (merged tip)**: server `test:ci` **184 suites / 3209 pass (28 skip)**;
  client `test:ci` **185 / 2158**; `test:ci:pg:adapters` **31 / 456 (1 skip)** on the shared
  :5433 (its `webdav_test` DB was stale-schema — dropped and recreated fresh from current 001
  by T3.1, drift source eliminated); grep-gates + docsStatePurity green (in-suite). PG vector
  leg N/A (no vectorStore engine path changed). Carried to exit gate: E2E runs (021/022
  green-run deferred, 023 code), `ai-desktop` regression, TEST_SUMMARY refresh.
- **R1 provenance** (§4.19 "chat off ⇒ card still appears" supersession): NOT yet recorded —
  no AI_FEATURE_PLAN §12 P3 section exists; lands at the T3.4/T3.1c docs steps per ruling.

**Wave 2 (T3.2b ∥ T3.6 ∥ T3.4) launched from tip `45aeaf2b`; merge order T3.2b → T3.6 → T3.4.**

### Wave 2 execution log (2026-10-27 — orchestrator; tip `211758c4`)

All three units launched in parallel on base `17068cd7` (wt-t32b/wt-t36/wt-t34, bands
40/60/80), merged in §30.3 order T3.2b → T3.6 → T3.4.

- **T3.2b `[done]`** — merge `6e0a1271`. Branch gates dialog 18/18, hooks 19/19, shell 2/2.
  Owner-only `CollectionPropertiesDialog` Sharing tab (grants list/add via UserSelectionMenu/
  revoke, publish_mode radio + exposure copy), the reserved `sharing` dispatch seam wired,
  viewer chip, 43+2 en/ko keys mirror-pinned, **E2E-S3-COLLECTION-024** spec code
  (grant→recipient-view→leave→re-grant re-dot, dual-registered, mobile skips). Client +
  docs/e2e only (15 files). RCA ×2 Case-B + one update-loop fix (deps narrowed to stable
  identity). NOTE: an orphaned full-client jest run from the unit's session kept saturating
  the host after completion — killed by the orchestrator (9 workers); the full-client gate
  then ran on the merged tip itself.
- **T3.6 `[done]`** — merges `f8bd9687`. Session initially ended mid-flight (pending
  realignment commits + running gate) — resumed, closed out serially. Branch gates: full
  client **187/2205 serial**, server collections route suite **85/85 incl. the §30.4
  zero-definition-evaluation pins** (`GET /`, `GET /:id/items`, `POST /for-nodes`), docs+one
  server TEST-only file, zero server source. Files-surface membership badges
  (`useCollectionMemberships`, chunked ≤100, failure-swallow), files toolbar bulk add,
  admin/share-link render nothing (inert gateway extended). Latent bug found+fixed: search
  zone B/C rows are CONVERTED explorer entries (`nodeId`) not raw rows — naive id collection
  would silently skip zone rows (pinned). Ruling taken per citable clauses (Case-C avoided):
  bulk-add gates on READABLE rows (membership is a collection write), not the write gate —
  `BulkActionToolbar.md` §3 + §3.2; recorded in `FileManagerControls.md`. **E2E id 025
  reserved** (planned row). Deferred `(target)` rows kept out of scope: FilePropertiesDialog
  "Member of" row, member-route checkmarks.
- **T3.4 `[done]`** — merge `211758c4`. Branch gates: server **185/3251**, client 185/2163,
  PG adapters **31/460(+1 skip)** (recordPredicates twins). `parse.nl` (≤1 chat call batched
  with query-embed, closed grammar IMPORTED from `definitionEngine.js` — never forked; strict
  schema + cardinality; never throws ⇒ silent vector+name fallback), `query_parses.predicates`
  storage begins, additive snake `predicates` response field, client `applyStep` verbatim
  storage, kill switch `AI_NL_PARSE_ENABLED` (T2 dbOnly hot). RED targets pinned: cache-hit
  zero-chat, chat-off byte-identical P1 response (raw-body equality), violation matrix.
  **Carries R1 docs half**: AI_FEATURE_PLAN §4.19 sentence SUPERSEDED + new **§12.15 P3
  provenance ledger** (R1/R3 + parse.nl D1–D5) — the Wave-1 deferred provenance lands here.
  SQL application of the atoms is §4.22's separate engine step — v1 effect is refined text
  only (D-reading recorded). E2E-S3-AI-002 planned row only (T4.3 per R3).
- **Conflict resolutions (orchestrator)**: RCA_LOG append-only ×2 (T3.6/T3.4 entries kept
  alongside T3.2b's); `E2E_COVERAGE_PLAN.md` collections table union (HEAD 001–024 + theirs 025) + deferral bullets (bulk-toolbar-add removed — now 025; sharing rides 024);
  `FileManager.md` host bullets union (properties-host + membership-chip host + bulk-add all
  kept). `FileManager.js` auto-merged across the three units — verified by the full gates.
- **Wave-2 exit gates (merged tip `211758c4`)**: server `test:ci` **185 suites / 3252 pass
  (28 skip)**; client `test:ci` **188 / 2235**; `test:ci:pg:adapters` **31 / 460 (1 skip)** —
  all rc=0. Wave-2 worktrees/branches removed.

**Wave 3 (T3.1c merge arbiter) launched from tip `211758c4` (wt-t31c, band 120).** P3 exit
gate follows: E2E batch (021/022/024 runs + 023/025 spec code + runs), ai-desktop regression,
grep-gates + docsStatePurity, TEST_SUMMARY refresh, ledger closure.

### Wave 3 + P3 exit-gate closure (2026-10-27 — orchestrator)

- **T3.1c merge arbiter `[done]`** — merge `ea480625`. Branch gates server 187/3277(+28 skip),
  client untouched (recommendation prefill verified already shipped in T3.1), PG adapters
  **required and run** 31/461(+1 skip) — the verdict rows extend `upsertMergeSuggestion`
  twins (write-once INSERT only). R1 compliance VERIFIED on the merged tip (Pass-5 emission
  unchanged at Jaccard ≥0.7 ∧ sizeRatio ≥0.7; band rows never emitted ⇒ the arbiter is the
  ONLY promotion path for 0.55–0.7). Two stale pre-R1 sentences retired at its docs step.
  Postures: FULL-nightly-leg-only (≤1 call/user/day budget), advise-never-act (post-verdict
  members byte-identical, no journal), dismissed rows re-raise WITHOUT chat (verdict
  preserved). **Owner visibility:** two new fixed product constants — arbiter batch cap
  8 pairs/call, `arbiter_reason` cap 200 chars (spec'd, smallest defensible bounds). No boot
  wiring (rides the already-wired evolution scheduler full leg; `AI_MERGE_ARBITER_ENABLED`
  hot, read at fire time). RCA ×1 (Case B, conformance global-read collision).
- **E2E exit batch `[done]`** — merge `4eb898b9` (branch `test/p3-exit-e2e`, band 40,
  workers=1). New dual cases **023** (persisted suggestions accept→undo→dismiss) and **025**
  (membership badges + bulk add + admin zero-badge/zero-IO negative); coverage rows
  **021–025 flipped planned→covered** on first-ever green browser runs — NO product defects
  (4 first-run failures all Case-B: 021 undo assertion amended to the routes/collections.md
  loser-recreation rule + name-resolved members-back set [stronger, spec-anchored]; 024
  picker-exact-match + goto client-route idioms; RCA ×3 logged). Results: `s3-collections-
desktop` 22 pass/3 static skip, `s3-collections-mobile` 24 pass/1 static skip,
  `s3-retrieval` dual 11/11 + 11/11, `s3-ai-desktop` 1/1 (47.1 s, EG2 pre-seed resolved from
  the default `WEA_E2E_MODEL_DIR`). Release budget `E2E_EXPECTED_SKIPS` 6→7 (024 static
  mobile skip); group counts re-listed 249/7/256 — **full default-gate re-pin deferred to the
  next release run** (evidence line records it; §30.5 requires the extended suites only).
  Fidelity notes (report-only): 025 fixture is all-read-only-grant (a single listing cannot
  mix own-writable and granted rows); 024 tab-absence enforced structurally via the grantee
  card menu, explicit dialog-tab leg optional later.
- **Infra defect found+fixed by the orchestrator** — commit `ee4fdcee`: the band allocator
  auto-skips bands mapping browser-RESTRICTED ports (5060/5061 — band 40 mapped
  scratchRetrievalMobile onto SIP 5060 and WebKit refused navigation; RCA-logged by the E2E
  unit), pinned bands keep working with a loud warning. `node --check` + eslint + prettier
  clean; forced-40 warning path verified on a scratch checkout.
- **TEST_SUMMARY re-pins (orchestrator-owned figures)**: client 188 suites/2235, server
  189/3305 (totals incl. skips), PG adapters 31/461+1 — stale placeholders removed.

**P3 EXIT GATE — PASSED (2026-10-27; final tip at closure):** §30.5 checklist against the
source: all §7 P3 rows closed — T3.1 (+T3.1b = the set-Jaccard candidate variant already
shipped as the P2 Pass-5 emission, now with the card UI + arbiter promotion leg + real compare
overlay per R2; +T3.1c arbiter above), T3.2 (a+b), T3.3, T3.4, T3.5, T3.6. Gates on the
merged tip (server `test:ci` re-run POST-e2e-merge: **187 suites passed + 2 skipped /
3,277 pass + 28 skip, rc=0**; client **188/2235** — client/src untouched by the post-gate
merges; `test:ci:pg:adapters` **31/461+1 skip** — no repository/SQL file touched by the
post-gate merges; grep-gates clean (`CacheAdapter|operationProgress` — only the documentary
invariant comment in `collections/service.js:11`, Wave-A precedent; tag-purge 0);
docsStatePurity green (in-suite); eslint/prettier clean). Membership-stability pins green
(collections route suite 85/85 incl. the §30.4 zero-definition-evaluation pins).
`ai-feature` now carries the merged P3. The single `ai-feature`→`dev` merge remains a later
event after ALL §7 phases — **P4 (admin & scale) is the open phase**; carried into P4: T4.1
admin re-embed launcher (executor exists since C10), T4.3 hermetic AI/media E2E +
degradation matrix + E2E-AI-002 fake-LLM harness (R3), §4.22 delta-semantics SQL leg of
parse.nl, Case-C candidates (archived-side merge code, pending-count wording), release
full-matrix re-pin, and the §30.6 defer-audit residuals below.

### 30.6 P3 defer audit residuals (2026-10-28)

> Source: the P3 executor's post-close self-audit. Each row was re-verified against the
> current source/spec/E2E on 2026-10-28; the **verified state** column is source truth, not
> the audit's wording. P3's feature rows stay closed; these are post-gate residuals for the
> pre-dev-merge remediation and P4, not a reopening of the P3 exit gate.

| ID  | Audit item                                           | Verified state                                                                                                                                                                                                                                                                                        | Disposition / owner                                                                                                                                                                                           | Verification gate                                               |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| A   | E2E-BULK-010 (batch move undo toast)                 | **Real gap at audit time.** `docs/E2E_COVERAGE_PLAN.md` was `planned`; no test existed.                                                                                                                                                                                                               | **CLOSED (§31.1, §31.6):** dual core-flow case merged as `2a933ecb`, targeted 2/2; coverage row is covered.                                                                                                   | `core-flow.shared` both platforms green; coverage row covered.  |
| B   | near-dup "30d unopened + low score" keeper heuristic | **Open at audit time.** The audit found a deterministic keeper where the design plan named a quality heuristic.                                                                                                                                                                                       | **CLOSED (§31.1–§31.2):** v1 keeper scorer, weights, exposure, reason refresh, and UI shipped in `303bd702`; the v1 policy is recorded in §31.2.                                                              | Scorer/spec/tests and v1 decision recorded.                     |
| C   | pending-count "publish_mode != auto" wording         | **Real doc ambiguity, not a code bug.** `routes/collections.md:246-247` said keyed on `publish_mode != auto`; `collectionShareService.md:75` says owner-only count of `published=false` rows; code counts all parked rows (`shareService.js:148-155`), test `collectionShareService.test.js:220-236`. | **CLOSED (2026-10-28):** count all parked rows regardless of `publish_mode`; route/service specs and auto-mode regression test were updated.                                                                  | Docs/code agree; route + service tests updated.                 |
| D   | parse.nl v1 negation absent                          | **Intentional v1 scope, owner visibility missing.** `AI_FEATURE_PLAN.md:1827-1828` says "no negation, no any_of"; `searchService.md:266` restates; `ATOM_TYPES` is path/tag/like/date/size only; the parser imports the shared grammar.                                                               | No P3 code change. Record in P4 §4.22 delta-semantics; any negation needs a grammar decision, never a parser-side invention.                                                                                  | P4 §4.22 scope note.                                            |
| E   | `assertMemberConsumable` bridge waiting              | **Intentional v1 boundary.** Function implemented/tested (`shareService.js:308-322`; `collectionShareService.test.js:699-853`); no files-domain route carries collection context in v1 (`collectionShareService.md:141`).                                                                             | No code change. Track as a precondition: any future collection-context preview/download route MUST call the pre-check; add to the P4 security note.                                                           | Future-route review checklist.                                  |
| L1  | 024 grantee "tab absence" leg                        | **Coverage-plan overclaim at audit time; unit coverage real.** The E2E browser leg asserts the owner tab; the grantee tab absence is unit-covered.                                                                                                                                                    | **CLOSED:** the coverage row now states that grantee tab absence is unit-covered; browser coverage remains optional.                                                                                          | Coverage-plan wording; unit test remains the behavior pin.      |
| L2  | query_parses malformed-string PG untestable          | **Open documentation nuance.** The spec still promises malformed stored string ⇒ `null`; PG binds `::jsonb` and rejects malformed input at write, so only sqlite/raw-row can exercise that branch.                                                                                                    | **OPEN / pre-merge:** clarify the spec as sqlite raw-row only (PG JSONB rejects malformed input at write); optionally add sqlite raw-row and shared-mapper tests. Owner: T3.4 docs maintainer / orchestrator. | Spec wording; optional sqlite and mapper tests.                 |
| L3  | `E2E_EXPECTED_SKIPS` 6→7 full matrix re-pin          | **Release evidence is now present** in §§31.8 and 32.1: embedded S3 253/7/260; model-free S3 252/8/260; WebDAV 41/0. The stale `skip-budget.js` comment still says the default is 6.                                                                                                                  | **Release soak CLOSED.** Track the stale reporter comment as a separate small cleanup; owner: E2E infrastructure maintainer.                                                                                  | Full matrix green at `E2E_WORKERS=1`; comment cleanup separate. |

**Current disposition (updated 2026-10-28):** A/B/C/L1 and the L3 release soak are closed by
the evidence cited above and later sections. L2 remains a pre-dev-merge documentation cleanup;
D belongs to the §4.22 P4 parser scope; E remains a future-route security precondition. The
`skip-budget.js` default-count comment is a separate E2E-infrastructure cleanup. P3 remains
closed; these items do not reopen its feature verdict.

**Wave 0 closure (2026-10-29):** L2 is closed by the SQLite-only wording and the
mapper/raw-row tests; the `skip-budget.js` default comment is aligned. E remains a standing
precondition for any future collection-context file route. See §33.7.

### 30.7 Search semantic-availability wire (2026-10-28)

- **Contract:** `POST /api/search` no longer emits `semantic_available`. The `semantic`
  key's PRESENCE is the availability signal (`absent` = leg not run; `[]` = ran honestly
  empty; non-empty = scored rows). `semantic_unavailable_reason` is now a readiness token
  (`not_configured | preparing | provisioning_failed | probe_failed | non_conforming |
disabled`) sourced from the new `llmAdapter.getRoleReadiness('embed')`; it is not an i18n
  error key.
- **Client:** `useSearchResults` derives the per-step `semanticAvailable` from
  `Array.isArray(response.semantic)`; the save gate stays "section present AND non-empty".
- **Docs:** routes/search, searchService, client hook/service/chip specs, `api.md`,
  `shared-contracts.md`, and E2E coverage updated in the same change.
- **Gates:** server `test:ci` 189 suites / 3309 tests (28 skip); client 188 / 2235;
  `docsStatePurity` 3/3; `playwright test --list` 256 tests. No repository/SQL change ⇒ PG
  leg N/A.

## 31. Post-P3 remediation execution (2026-10-28)

> Owner decisions: hysteresis **enabled with provisional offsets** (±0.02) and refined after
> operation; `for-nodes` hides non-published rows from non-owners; storage-usage sparkline is **P4
> (T4.4)**; embed-probe completeness + media-warning emit are **pre-merge (C3-A/C4-A)**; shared
> enums are **promoted to code (D1-A)**; near-dup keeper quality ships with the v1 weights and
> the confirmed exposure defaults. Each unit is a task branch → `ai-feature`; worktrees are
> isolated; full gates run on the merged tip (task units run targeted suites only).

### 31.1 Units (status)

| Unit             | Branch / worktree                                            | Scope                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LLM readiness    | `fix/llm-probe-readiness` (merged `58ec21a3`)                | **DONE**: C3-A embed probe (dim/non-empty/non-degeneracy/pooling/positive control) + C4-A embed media warning (`partial`) + C6 hot registry sync/reset |
| AI hooks         | `fix/ai-hooks-reeembed-derivatives` (merged `16a0152f`)      | **DONE**: C1 content-change re-embed (hash-aware job reset) + derived tags wired at the four commit seams                                              |
| Collections      | `fix/collections-touch-order-membership` (merged `f63fe741`) | **DONE**: C2 explicit unpin, C4 active-model similar sort, C7 dialect-safe activity fallback, for-nodes published filter for non-owners                |
| Hysteresis       | `feature/membership-hysteresis` (merged `dc94a109`)          | **DONE**: EG2 `membershipHysteresis { inDelta: 0.02, outDelta: -0.02 }` (provisional) + band tests/spec                                                |
| Undo TX          | `fix/suggestion-undo-tx` (merged `8370ef52`)                 | **DONE**: tx-aware untrash/rename + retry convergence for suggestion accept undo (PG/WebDAV)                                                           |
| Tag DDL          | `chore/remove-retired-tag-ddl` (merged `e704cc71`)           | **DONE**: removed `tag_embeddings`/`tag_parents` from 001 + parity/grep/docs; no big-bang script (§31.5).                                              |
| Docs             | `docs/contract-reconciliation` (merged `da99ba62`)           | **DONE**: D2 actions/api `file` writer, D3 ARCHITECTURE, D7 setup-wizard, D8 pointers; setup-step follow-up `fee1fee5`.                                |
| Member of        | `feature/file-properties-member-of` (merged `593bb666`)      | **DONE**: D6 host + chips + navigation + tests                                                                                                         |
| B keeper quality | `feature/near-dup-keeper-quality` (merged `303bd702`)        | **DONE**: B v1 scorer/exposure/reason-refresh/UI; no DDL                                                                                               |
| BULK-010         | `test/p3-bulk-010` (merged `2a933ecb`)                       | **DONE**: dual core-flow batch-move undo E2E (2/2 targeted); coverage row covered                                                                      |
| Shared enums     | `refactor/shared-platform-enums` (merged `48751091`)         | **DONE**: Phase 1 constants/docs/tests + Phase 2 consumer migration (`refactor/shared-enum-consumers`, merged `309eb579`, §31.3).                      |

### 31.2 B v1 decisions (confirmed)

- Weights: Activity 0.45, Media Quality 0.30, Name 0.15, Centrality 0.10.
- `low score` = `node_activity.score`; 30d unopened = raw activity penalty ×0.25 (not a gate).
- Exact dups keep smallest node id; rule kinds unchanged; short-document exception unchanged.
- Exposure: additive `reason.keep` (`name`, `relative_score`, `confidence`, `basis`, `factors`,
  `unopened_30d`, `score_version:'v1'`); existing `keep_node_id`/`score` stay.
- No legacy backfill; reason-only refresh for existing pending near-dup rows (id/expiry/state
  stable). UI: `Keep: <name> · <basis>` + accessible “Why this keeper?” (group-relative score
  and factor bars only in the detail).

### 31.3 Shared enums Phase 2 migration record (completed)

**DONE (merge `309eb579`):** the server consumers now use the shared constants for
publish/grant/journal/LLM roles and collection origin/status plus merge/file suggestion
states; the intentional setup `chat|vision|asr` subset and `status:'all'` filter pseudo-value
stay local. The migration list below is retained as the change record.

**Historical Phase 2 starting state:** Phase 1 had shipped the constants without server
consumers. The follow-up branch (`refactor/shared-enum-consumers`) replaced the local
arrays/literals with the shared constants. The checklist below is a completed change record,
not a queue of remaining work:

- `collections/service.js:49` `VALID_PUBLISH_MODES` → `PUBLISH_MODE`
- `collections/shareService.js:28` `VALID_GRANT_ROLES` → `GRANT_ROLE`
- `actions/service.js:24-33` `JOURNAL_DOMAINS` → `JOURNAL_DOMAIN` (`TAGS` remains a separate
  DDL/constant parity decision; see §31.5)
- `infrastructure/adapters/llm/index.js:39` `ROLES` → `LLM_ROLE`
- `collections/evolutionService.js:1737` merge-state subset → `MERGE_SUGGESTION_STATE`
  (exclude `DISMISSED`; do not use `ALL` blindly)
- `setup/setupCore.js:49` `LLM_ROLES` (`chat|vision|asr`) is an intentional wizard subset —
  keep it local or add a documented subset constant; never map it to `LLM_ROLE`
- Literal origin/status/merge/file-suggestion sites (see the Phase 1 report) → the matching
  constant. `status:'all'` is a list-filter pseudo-value, never passed to `isValid`; SQL
  literals require template interpolation.
- Known gaps: `JOURNAL_DOMAIN.TAGS` has no writer; `file_suggestions.state` has no DDL CHECK
  (add one only in a DDL-scoped change). The Phase 1 test pins value/ALL/isValid parity.

### 31.4 Merge/gate order

`wt-colls`/`wt-hyst`/`wt-tagddl`/`wt-docs`/`wt-bulk`/`wt-memberof` may merge independently;
`wt-undo` before `wt-b`; `wt-llm`/`wt-hooks` before the final full gate; `wt-enums` Phase 1
after the code units (Phase 2 follows). Final gate: server/client `test:ci`, PG adapters for
repository/DDL/undo units, dual E2E (collections/retrieval/ai + core-flow), docsStatePurity,
prettier/eslint, release matrix before the single `ai-feature`→`dev` merge.

### 31.5 Execution log — tag DDL removal (2026-10-28)

- Branch `chore/remove-retired-tag-ddl`, commit `4466da5a`, merge `e704cc71`.
- Removed the `tag_embeddings`/`tag_parents` CREATE blocks from 001 (no ALTER/migration
  script). DDL-parity suites now expect **36 tables** and assert both names absent;
  `aiTagStore.test.js` keeps the server-wide grep gate and adds the 001 absence pin.
- Specs: `aiTagStore.md` purge paragraph deleted, `aiEnrichmentsStore.md` linger note
  replaced, `vectorStore.md` stale `tag_embeddings lookups` example corrected.
- Gates: 5 targeted sqlite suites / 50 pass; 3 real-PG suites / 18 pass on a fresh DB;
  docsStatePurity included; eslint/prettier clean.
- **Operational:** 001's checksum changed. Already-migrated local/e2e DBs need a reset —
  recreate the DB or `DROP TABLE IF EXISTS tag_embeddings, tag_parents; DELETE FROM
_schema_migrations WHERE filename='001_initial_normalized_schema.sql';` then re-run
  migrations. No production data migration exists (never deployed).
- **Residual:** `JOURNAL_DOMAIN.TAGS` remains in the 001 CHECK + shared constant for parity;
  remove both together in a DDL-scoped change or keep as the last unused enum member.

### 31.6 Execution log — remediation unit merges (2026-10-28)

- **Merged:** LLM readiness `58ec21a3`; AI hooks `16a0152f`; collections
  `f63fe741`; hysteresis `dc94a109`; undo TX `8370ef52`; docs `da99ba62` + setup
  follow-up `fee1fee5`; Member of `593bb666`; B keeper quality `303bd702`; BULK-010
  `2a933ecb`; tag DDL `e704cc71`; shared enums Phase 1 `48751091`.
- **Targeted gates:** LLM adapter/backendHealth/search 136; AI hooks 51; collections +
  repository conformance + presets 390; undo/dashboard/fileNodes 89; B dashboard/
  nearDup/fileSuggestions 115 + client checklist/dashboard 30; Member of client 177;
  tag DDL sqlite 50 + real PG 18; BULK-010 dual E2E 2/2; docsStatePurity green.
- **Caveats carried:** LLM hot registry sync uses `metadata:false` (next boot refreshes
  model-specific metadata) and the real-weights positive control remains opt-in; re-embed
  reset can overlap a still-running execution (guarded `markDone` no-op); derived tags do not
  refresh on rename/move (backfill remains); a multi-field PUT containing `pinned:false`
  skips auto-pin for that request; grantee `for-nodes` chips now omit unpublished rows;
  WebDAV undo retry is idempotent but a new name collision can still require a manual move;
  B keeps short-document members keeper-eligible, does not backfill legacy rows, and keeper
  flips churn rows; BULK-010 raised the E2E inventory 256→258 (the release re-pin was pending
  at this snapshot; later inventory and soak evidence are in §§31.8 and 32.1); tag DDL changed
  the 001 checksum (local DB reset note in §31.5).
- **Open at this snapshot:** the release-matrix soak, `JOURNAL_DOMAIN.TAGS` parity decision,
  P4 hysteresis calibration, and remaining P4 work. The release soak was later completed in
  §31.8; the other items remain tracked in the Current status section.

### 31.7 Integration-gate snapshot before release soak (2026-10-28)

This is a point-in-time snapshot before Run D in §31.8. Its counts and pending-release
statement are historical; the later release evidence and T4.5–T4.13 results are recorded in
§§31.8 and 32.1.

- **Merged tip:** `309eb579` (`ai-feature`). All eleven remediation units plus enums Phase 2
  are merged; task worktrees are removed.
- **Jest:** server `test:ci` **192 passed + 2 skipped suites (194 total) / 3353 passed + 28
  skipped (3381 total)**, rc=0; client `test:ci` **188 / 2245**, rc=0.
- **PostgreSQL:** `test:ci:pg:adapters` **31 suites / 471 passed + 1 skipped (472)**, rc=0,
  on a freshly recreated `webdav_test` DB (plain PG :5433) so the 001 checksum is current.
- **Targeted:** shared-enum Phase 2 24 suites / 531; B server 115 + client 30; collections/
  conformance/presets 390; undo/dashboard/fileNodes 89; Member of client 177; LLM 136;
  AI hooks 51; tag DDL sqlite 50 + real PG 18; BULK-010 dual E2E 2/2.
- **E2E inventory at this snapshot:** `playwright test --list` **258 tests in 18 files**;
  BULK-010 registered under both s3 projects and its targeted dual run is green. The full
  release matrix had not yet run at this point; Run D later closed it in §31.8.
- **Docs:** `docsStatePurity` green; prettier clean on touched files; `TEST_SUMMARY` re-pinned
  to server 194/3381, client 188/2245, PG 31/471+1; E2E coverage inventory updated to 251/7/258
  (Core 142/3/145).
- **Not merged to `dev`.** The single `ai-feature`→`dev` merge remains after the release soak
  and the remaining P4 work.

### 31.8 Release matrix evidence (2026-10-28)

Four full release-matrix attempts on the merged remediation tip. Runs A–C are red for
host-capacity/transport reasons (not reproducible product regressions — targeted reruns below);
**Run D with `E2E_WORKERS=1` is GREEN and is the release evidence.**

| Run              | Config                         | S3 (command used at run time)                      | WebDAV (`test:e2e:release:webdav`)      |
| ---------------- | ------------------------------ | -------------------------------------------------- | --------------------------------------- |
| A `19c1b880`     | 3 workers                      | 238 passed / 3 failed / 7 skipped / 10 did not run | 39 passed / 1 failed / 1 did not run    |
| B `7593e6fc`     | 3 workers                      | 250 passed / 1 failed / 7 skipped                  | 40 passed / 1 failed                    |
| C `8396b23f`     | 2 workers (`E2E_WORKERS=2`)    | 238 passed / 2 failed / 6 skipped / 12 did not run | 34 passed / 2 failed / 5 did not run    |
| **D `00881ada`** | **1 worker (`E2E_WORKERS=1`)** | **253 passed / 7 skipped / 260, rc=0 (26.8m)**     | **41 passed / 0 skipped, rc=0 (12.2m)** |

> Gate-name note (2026-10-28 split): the embedded default command used for the D row is now
> `test:e2e:release:embed`. `test:e2e:release` exports `WEA_SKIP_EMBED_MODEL=1` and intentionally
> skips `E2E-S3-AI-001` (252/8/260); `test:e2e:release:all` keeps the embedded default leg.

- **Run A product regression (fixed):** `E2E-WEBDAV-ADMINCFG-004` — the admin warning card
  rendered healthy/not-configured `ai.*` tracker rows (C4-A added a healthy `ai.embed` row).
  Fixed in `7593e6fc` (card shows `preparing | probe_failed | partial` only) + client unit
  coverage; targeted rerun 1/1 green.
- **Run A test-budget fix (merged):** `E2E-S3-TRASHADMIN-001` asserted the first listing 15s
  after a full page reload; the release matrix's client boot exceeds that. Budget raised to
  60s (`2e51aba5` / merge `8396b23f`), matching retrieval's first-paint budget.
- **Failure inventory across A–C:** trash-admin desktop row-not-removed after a completed
  delete (A, B, C); retrieval/collections `toBeVisible` timeouts at 60s (A, C);
  `E2E-EXP-004` / `E2E-EXP-002` `folders/create` 500 `databaseQueryFailed`
  (`Connection terminated due to connection timeout`, runs B and C); `E2E-WEBDAV-MIG-001`
  and a trash-admin mobile case `ECONNRESET` on scratch-server requests (C). The failing set
  changes every run.
- **Capacity evidence:** host has 6 cores / 15 GB; `uptime` 15-minute load average reached
  ~12 while the matrix ran (3–5 scratch servers, each booting the ONNX embedding model, plus
  the Chromium workers). Traces show 9.6s client boot solo vs 24s+ under the matrix, 12–14s
  main-thread gaps between the delete completion and the listing refresh, and one retrieval
  run where Enter was pressed on a focused/filled search box but **zero** `POST /api/search`
  reached that scratch server (the client absorbs transport failures and returns to browse).
- **Targeted reruns on the same tip (all green):** webdav-admin-config `ADMINCFG-004` 1/1;
  trash-admin desktop+mobile pair 2/2; trash-admin desktop solo 1/1; BULK-010 dual 2/2.
- **Release gate (Run D):** 260 S3 tests (253/7/260, skip budget 7 enforced, `--retries=0
--fail-on-flaky-tests`) and 41 WebDAV tests all green; `E2E-TRASH-013` passed in both
  projects (8.7 s / 9.1 s). Serial execution removes the host-capacity flakes that the 3- and
  2-worker runs hit; the canonical 3-worker configuration remains unusable on this 6-core
  runner, so the gate runs with `E2E_WORKERS=1` here.

### 31.9 Search cancel surface (2026-10-28)

- **Delivered:** while a server search is pending, the 56px search button is the cancel control
  (cloud+cross composite, `Cancel search` label/`title`, `data-cancel-active`); clicking it or
  pressing Escape aborts the single `POST /api/search` through an `AbortController` and restores
  the pre-submit mode/chain (browse→browse, refinement→previous results) with **no error toast**.
  The pill's ✕ is hidden for the pending window. A 300 ms post-submit guard stops a submit
  double-click from cancelling itself; the search POST carries an explicit 60 s timeout so a
  hung request can no longer ride the 5-minute transport default.
- **Specs:** `docs/spec/client/hooks/useSearchResults.md` (§2.3 `cancelSearch`, §2.5/§2.6
  user-cancel ≠ failure, verification rows), `docs/spec/client/components/file-manager/FloatingSearchBar.md`
  (§2.6/§2.7/§2.8 pending cancel + hidden ✕ + Escape), `docs/features/client-ui.md` (feature state).
- **Tests:** client 188 suites / **2261** tests, rc=0 (new: 8 hook cancel cases, 4 bar cases,
  3 button cases); `docsStatePurity` green (removed the `T4.1` task marker accidentally added to
  `SystemSettingsContent.md` in `7593e6fc`); prettier/eslint clean on touched files.
- **E2E:** no new case was added because the interaction is client-unit covered. The full-matrix
  re-pin was pending when this note was recorded and was later completed in §31.8.

## 32. P4 plan — bulk-job polling resilience (2026-10-28)

Scope: the bulk-operation polling gap exposed by the release-matrix traces. The search-side
error surface is **dropped** (owner decision 2026-10-28: the existing 5 s snackbar stays, and
Enter while pending stays an inert no-op — no persistent row, no hint). The policy and task
descriptions below preserve the original plan; implementation and gate status are recorded in
§32.1–§32.2.

**Evidence.** (a) `useBulkOperations` polls with `setInterval(400)` and a bare
`catch { console.error }` (`useBulkOperations.js:303`, twin at `:628`); the terminal branch is the
single owner of `clearProcessing`, `onOperationComplete` → listing refresh, recent/trash
notifications and the progress terminal state — so a status endpoint that keeps failing (404
after a restart — the job store is the in-memory `bulkJobStore`, TTL 1 h) leaves the row and the
progress item stuck with no user-visible signal. (b) Search failure already surfaces a 5 s
snackbar and now has an explicit cancel surface (`§31.9`), so no search-side work remains.

**Policy** (D1 resolved; D2/D3 merged per the owner direction).

| Key                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Rationale                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `POLL_MAX_FAILURES` (`N`)   | 5 consecutive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ~6 s of backoff before declaring the status unreadable                                              |
| Backoff                     | 400 → 800 → 1600 → 3200 → 5000 ms (cap)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | keeps the first seconds responsive, stops hammering a struggling server                             |
| Per-request timeout         | 10 s (status GET only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | the 300 s transport default would freeze the item for minutes                                       |
| Unreadable status (stalled) | ONE state for BOTH triggers: (1) 5 consecutive status-read failures, (2) `404` job-expired. Entering it **automatically refreshes the listing once** (`onOperationComplete`/`refreshNow`, same call as a terminal job) — the user is never asked to trigger it. The operation's **progress item** (same drawer/panel entry, no new row/banner) becomes `status:'error'`, `stalled:true`, `keepOnError:true` with the message "작업 상태를 확인할 수 없습니다. 작업이 이미 반영되었을 수 있습니다." and only the existing `확인` (dismiss). | one surface, one wording; the poll has stopped, so the listing is reconciled without extra friction |
| When it fires               | fast failures: ~6 s (400+800+1600+3200 ms backoff after the 1st failure); hanging requests: up to ~56 s (5 × 10 s timeout + backoff); `404`: immediately                                                                                                                                                                                                                                                                                                                                                                                   | bounded, explainable feedback instead of an infinite spinner                                        |
| Refresh                     | `onOperationComplete` (host `refreshNow`) runs FIRST on any terminal/stalled outcome, each remaining side effect isolated in its own try/catch                                                                                                                                                                                                                                                                                                                                                                                             | the listing must not depend on notifications/progress                                               |
| Cancel                      | POST cancel → one forced status fetch (10 s) → terminal handler or the same stalled state                                                                                                                                                                                                                                                                                                                                                                                                                                                  | cancel is not an escape hatch if it cannot observe the result                                       |

**Task graph** (each task lists objective / inputs / outputs / verification / deps).

- **T4.5 — Specs first (docs).** Write the polling-failure contract into
  `docs/spec/client/hooks/useBulkOperations.md` (new §: scheduling, backoff, N, 404, terminal
  ordering, stalled item shape, cancel force-check) and `docs/spec/client/components/file-manager/FileOperationProgress.md`
  (stalled row + action); update `docs/features/client-ui.md`. Search specs unchanged.
  Verify: `docsStatePurity`, review. Deps: none.
- **T4.6 — `bulkJobPoller` module + unit tests (TDD).** Extract the duplicated delete/move/copy
  loop into framework-free `client/src/pages/FileManager/hooks/bulkJobPoller.js`: self-scheduling
  `setTimeout` (no `setInterval`), in-flight guard, backoff/N, 404-expiry, `dispose()` abort,
  exactly-once terminal callback. Inputs: T4.5 policy, current hook. Verify: new
  `bulkJobPoller.test.js` with fake timers (success, N failures → one stalled, 404 → expired
  immediately, no overlapping fetch, dispose mid-flight, terminal-once). Deps: T4.5. Parallel
  with T4.7.
- **T4.7 — Progress drawer stalled state (one state, D2+D3 merged, no action button).** Render
  the stalled message for `stalled:true` items and keep only the existing `확인` dismiss; i18n
  `fileManager.bulkStatusUnavailable` (identical wording for the 5-failure and the 404 trigger).
  The listing refresh is fired by the hook (§T4.8), not by the item. Verify: unit tests on the
  drawer + a hook-level test that both triggers set the same flag/message and call the refresh
  callback exactly once. Deps: T4.5. Parallel with T4.6.
- **T4.8 — Delete path migration + refresh-first terminal handling.** Replace the delete loop;
  on terminal **and on the merged stalled state** call `onOperationComplete` before
  notifications, each side effect isolated. The stalled entry fires the refresh exactly once. Verify: existing bulk/delete client tests + new stalled/expired cases; manual
  trace check. Deps: T4.6, T4.7.
- **T4.9 — Move/copy path migration.** Same for move/copy, preserving the undo pointer
  (exactly once) and the skipped-by-conflict/permission buckets. Deps: T4.8.
- **T4.10 — Cancel force-check.** `handleCancelBulkOperation`: cancel POST → one forced status
  fetch → single terminal handler, or the same stalled state (which refreshes). Guard against double terminal
  handling. Verify: unit test (cancel → status completed → refresh once; cancel → status fails
  → stalled + refresh). Deps: T4.8.
- **T4.11 — DROPPED (owner decision).** No persistent search error row and no pending-Enter
  hint: the 5 s snackbar contract (`useSearchResults.md` §2.6) and the single-flight inert Enter
  stay as they are. No task.
- **T4.12 — E2E fault injection + inventory re-pin.** ONE new case in `e2e/trash.spec.ts`
  (runs under `s3-desktop` + `s3-mobile`): abort `**/api/files/bulk-operation/**` right after a
  real delete → the progress item reaches the stalled state → **the deleted row disappears
  without any user action** (the automatic refresh reconciled the listing) while the item keeps
  the stalled message until `확인`. Search gets NO new case (row dropped).
  Inventory moves 258 → 260; re-pin `E2E_COVERAGE_PLAN.md` + `TEST_SUMMARY` after the first real
  run (`E2E_EXPECTED_SKIPS` stays 7). Deps: T4.8–T4.10.
- **T4.13 — Gates.** Client `test:ci`, server `test:ci` (no server change expected unless T4.6b
  lands), `docsStatePurity`, prettier/eslint, targeted E2E (new cases + retrieval/trash/BULK-010),
  then the release matrix on a host with CPU headroom (§31.8). Deps: all.
- **T4.6b (optional hardening) — `Cache-Control: no-store`** on `GET /api/files/bulk-operation/:jobId`
  (mutable polling endpoint; Express still emits validators today, observed 304s in traces).
  Server unit test asserts the header. Independent; can ship with T4.6.

**Decisions.** (owner answers 2026-10-28)

- **D1 — resolved:** `N`=5, backoff 400→800→1600→3200→5000 ms, status GET timeout 10 s.
- **D2/D3 — merged (owner direction), auto-refresh:** ONE stalled state with one identical
  message ("작업 상태를 확인할 수 없습니다. 작업이 이미 반영되었을 수 있습니다.") for both
  triggers (5 consecutive read failures, `404`). Entering the state **refreshes the listing
  automatically** — no `목록 새로고침` button, no user question. The progress item keeps the
  message until `확인` (dismiss). A failed auto-refresh leaves the stale listing with the
  message still visible.
- **D4 — resolved:** Enter while pending stays inert (no hint, no resubmit).
- **D5 — resolved:** one bulk case in `trash.spec.ts` (+2 instances → 258→260); no search case.

### 32.1 Execution log — bulk polling resilience (2026-10-28)

- **Delivered:** framework-free `client/src/pages/FileManager/hooks/bulkJobPoller.js` (self-scheduling
  `setTimeout`, single in-flight read, 5-failure budget with 400/800/1600/3200 ms backoff, 10 s
  status timeout, `maxRetries: 0`, 404 = expired, exactly-once terminal/stalled, `dispose()` abort,
  `checkNow({failFast})`). Both delete and move/copy loops now run through it; the terminal path
  refreshes the listing FIRST and isolates notifications/tree/undo/progress; the stalled state
  (5 failures or 404) auto-refreshes once and shows the single
  `fileManager.bulkStatusUnavailable` progress item with only `확인`; cancel forces one status read
  and falls into the same stalled state on failure. `GET /api/files/bulk-operation/:jobId` now
  sends `Cache-Control: no-store`.
- **Specs:** `useBulkOperations.md` §2.6.1 (+ verification rows), `FileOperationProgress.md`
  (stalled item, no Retry), `docs/features/client-ui.md`.
- **Tests:** client 189 suites / **2279** tests rc=0 (bulkJobPoller 12, hook stalled/expired/cancel
  +5, fileService options +1); server 194 suites / **3382** (3354 passed, 28 skipped) rc=0
  (no-store route test); `docsStatePurity` green; prettier/eslint clean.
- **E2E:** `E2E-TRASH-013` (fault injection: job-status polling aborted, delete succeeds) targeted
  2/2 green on `s3-desktop` + `s3-mobile`; inventory re-pinned to S3 **253/7/260**, Core
  **144/3/147**, WebDAV unchanged 41/0. `playwright test --list` confirms 260 in 18 files.
- **Release matrix:** GREEN at `E2E_WORKERS=1` on the merged tip `00881ada` — S3 253/7/260 and
  WebDAV 41/0, rc=0 (§31.8, Run D). The PG adapter leg is unaffected (no storage change).
- **Model-free timing (tip `cb965996`, `WEA_SKIP_EMBED_MODEL=1`):** S3 release leg
  **252/8/260 rc=0 in 13m40s at 1 worker** and **8m18s at 2 workers** (the extra skip is the
  intentional `E2E-S3-AI-001` model-free skip, counted by the skip-budget reporter). The
  model-on serial baseline was 26m50s, so the seam roughly halves the gate and makes
  `E2E_WORKERS=2` viable on this host.

### 32.2 Current status of the bulk-polling work

| Task  | Status      | Closure evidence                                                                                                                                                                 |
| ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4.5  | `[done]`    | Polling and stalled-state contracts updated in the specs and feature doc (§32.1).                                                                                                |
| T4.6  | `[done]`    | `bulkJobPoller` and fake-timer unit coverage delivered (§32.1).                                                                                                                  |
| T4.7  | `[done]`    | Stalled progress-item state and shared message delivered (§32.1).                                                                                                                |
| T4.8  | `[done]`    | Delete path uses the poller and refresh-first terminal handling (§32.1).                                                                                                         |
| T4.9  | `[done]`    | Move/copy paths use the poller and preserve undo/skipped-item behavior (§32.1).                                                                                                  |
| T4.10 | `[done]`    | Cancel forces one status read and converges on the terminal/stalled handler (§32.1).                                                                                             |
| T4.11 | `[dropped]` | Search keeps its existing short snackbar and inert pending Enter behavior (§32 decisions).                                                                                       |
| T4.12 | `[done]`    | `E2E-TRASH-013` passed on desktop and mobile; inventory is S3 253/7/260, Core 144/3/147, WebDAV 41/0 (§32.1).                                                                    |
| T4.6b | `[done]`    | The bulk-operation status route sends `Cache-Control: no-store`; route test passed (§32.1).                                                                                      |
| T4.13 | `[done]`    | Client/server CI, docs/lint checks, targeted E2E, and the serial release matrix are reported green in §32.1. Reconcile the exact server test total before updating summary pins. |

### 32.3 Remaining P4 and pre-merge work

The accountable role is listed below; the orchestrator assigns an individual implementer when
the work is dispatched. These items, not the completed bulk-polling add-on, keep the overall
P4 phase open.

| Item                                            | Status                   | Accountable role                                             | Next action / exit condition                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4.1 admin AI surface and re-embed launcher     | `[open]`                 | P4 orchestrator; assign the implementation owner at dispatch | Deliver the admin AI surface and rate-limited re-embed action, including initial coverage/model-change use (§28.9, §30.5).                                                                     |
| T4.2 media ladder                               | `[needs-reconciliation]` | P4 orchestrator                                              | D2–D4 already report the media probes, pipelines, fallback, and backfill scope delivered (§28.8). Mark T4.2 absorbed by those units or state the remaining P4-only scope.                      |
| T4.3 hermetic AI/media E2E                      | `[open]`                 | P4 E2E owner; assign at dispatch                             | Add the fake-LLM/degradation matrix and E2E-AI-002 parser case (§30.5).                                                                                                                        |
| T4.4 capacity series → storage usage (§33.8 W2) | `[open]`                 | P4 dashboard owner; assign at dispatch                       | Add per-user `storage_usage_snapshots` (live + trash + version history via `object_map.size`), daily scheduler, gateway series, Storage sparkline, and their specs/tests (§7, §7.1, §33.8 W2). |
| §4.22 delta-semantics SQL leg                   | `[deferred]`             | Search/parser owner; assign with the task                    | Apply the parsed predicate delta semantics without inventing grammar beyond the shared contract (§30.5).                                                                                       |
| §30.6 L2 query-parses contract                  | `[open]`                 | T3.4 docs owner / orchestrator                               | State that malformed raw JSON is a sqlite-only read case; PostgreSQL JSONB rejects malformed data on write. Add optional focused tests (§30.6).                                                |
| `JOURNAL_DOMAIN.TAGS` parity                    | `[needs-decision]`       | Project owner                                                | Decide whether to retain or remove the unused enum value; if removed, change the shared constant and DDL CHECK together (§31.5).                                                               |
| P4 hysteresis calibration                       | `[open]`                 | AI-profile/release owner; assign at calibration              | Re-measure the provisional ±0.02 offsets against operational data as planned in §31.1/§31.6.                                                                                                   |
| §30.6 E future-route security precondition      | `[deferred]`             | Owner of any future collection-context file route            | Require `assertMemberConsumable` before adding a preview/download route with collection context; the current service contract already records the precondition.                                |
| `skip-budget.js` stale default comment          | `[open]`                 | E2E infrastructure maintainer                                | Update the comment from the old default of 6 to match the current budget behavior; do not change runtime skip handling without its own test.                                                   |

**Gate-count reconciliation:** §32.1 records server `194 suites / 3382 tests` and client
`189 / 2279`. `client/TEST_SUMMARY.md` now matches 189/2279. The server summary's historical
3386 and 3381 pins conflict with the 3382 total recorded here. Check the original server run
output before choosing a canonical total; retain the reported gate result but do not repin a
different number without that evidence.

## 33. P4 execution plan — admin, scale, and pre-merge closure (2026-10-29)

> Execution-ledger overlay for §7 P4 (T4.1–T4.4) and the pre-merge carry-forward items of
> §32.3. Task rows and definitions stay unchanged in PLAN.md §7; this section carries the
> binding owner rulings, the wave plan, and the verification gates. Docs-first (AGENTS §2.1)
> applies per task; every task branch merges into `ai-feature` only; `dev` stays untouched
> until the §33 exit gate. §32.3 remains the accountable-role record this plan supersedes;
> its rows are not rewritten — the disposition table in §33.5 is the current state.

### 33.1 Binding decisions (owner rulings, 2026-10-29)

- **D1 — T4.2 is recorded `[done]`: absorbed.** §28.8 D2–D4 delivered the §4.21 contract:
  media capability probes with positive controls (D2), the `media_direct` ladder + V2
  caption/transcript fallback + V0 `metadata_only` (D3), and the shared fallback-corpus rule
  - coverage classification + deterministic re-embed scope planning (D4). The residue is
    re-pointed, not residual scope: the backfill launcher + rate limit belong to **T4.1**;
    media E2E + the degradation matrix belong to **T4.3**; Ollama/other-dialect presets stay
    recorded as not-shipped (OpenAI-compatible llama.cpp only); the seed θ `0.62` is covered by
    the release measurement under the hysteresis-calibration item. The PLAN.md T4.2 row flips
    to absorbed in the same commit that records §33.
- **D2 — `JOURNAL_DOMAIN.TAGS` is removed.** One unit edits all four parity points together:
  `shared/constants.js`, the `001` DDL CHECK, `docs/shared-contracts.md`, and
  `server/utils/__tests__/sharedPlatformEnums.test.js`. RED-first: flip the parity test to
  expect absence, then remove. The `001` edit uses the standing checksum one-liner recovery.
- **D3 — the §4.22 delta-semantics SQL leg is implemented in P4** (Wave 2). The grammar
  contract stays frozen (`add|replace|exclude|$ref`, `nl1` envelope); no negation handling is
  invented parser-side (§30.6 D — any negation needs a grammar ruling, tracked separately if
  encountered).
- **D4 — the server test-count pin (3382 vs 3386/3381) resolves at the P4 exit gate run**,
  from fresh canonical output — no archaeology and no repin without run evidence.

Design points deliberately left to each task's docs-first step (resolved there, not here):
the storage-usage snapshot row shape, the fake-LLM harness injection mechanics, and the new
scratch E2E port entry. The settings-journal push-vs-pull semantics is resolved by U4
(polling; no settings pub-sub).

### 33.2 Wave plan

| Wave | Unit                                   | Branch                              | Scope                                                                                                                                                                                                        | Deps | Effort | Status       |
| ---- | -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------ | ------------ |
| 0    | CF skip-budget comment                 | `chore/skip-budget-comment`         | `e2e/reporters/skip-budget.js:12` default 6→7, comment-only; no runtime change without its own test                                                                                                          | —    | XS     | `[done]`     |
| 0    | CF §30.6 L2 query-parses note          | `docs/query-parses-sqlite-note`     | record that malformed raw JSON is a sqlite-only read case (PostgreSQL JSONB rejects malformed data on write) in the query_parses persistence contract; optional focused sqlite raw-row + shared-mapper tests | —    | S      | `[done]`     |
| 0    | CF §30.6 E precondition confirmation   | (docs commit; may ride the L2 unit) | confirm the `assertMemberConsumable` future-route precondition is recorded in the service contract; close the item as recorded                                                                               | —    | XS     | `[done]`     |
| 0.5  | Preceding DDL: cancelled AI job status | `chore/ai-job-cancelled-status`     | `001` `ai_jobs.status` + `cancelled`; docs/schema test; no dev migration script (dev DBs are ephemeral; the production migration is deployment-owned) — see 33.8 W7                                          | —    | XS     | `[done]`     |
| 1    | T4.4 storage usage series              | `feature/t44-storage-usage`         | `storage_usage_snapshots` + `object_map.size` + daily scheduler + gateway/UI — see 33.3/33.8 W2; merged `5d306d17`                                                                                           | 0.5  | M–L    | `[done]`     |
| 1    | T4.1 admin AI panel + launcher         | `feature/t41-admin-ai-panel`        | full text+media launcher + cancel-pending + config-backed gates; docs → endpoints → tab → launcher — see 33.3/33.8 W1/W5/W6; merged `12d32e87`                                                               | 0.5  | L+     | `[done]`     |
| 1    | T4.3 harness + degradation matrix      | `test/t43-fake-llm-harness`         | fake embed+chat harness + per-column suites; AI-001 remains real EG2 — see 33.3/33.8 W3; merged `8a5df061`                                                                                                   | 0.5  | M–L    | `[done]`     |
| 2    | T4.3 parser E2E + inventory re-pin     | `test/t43-parser-e2e`               | `E2E-S3-AI-002` over the harness; `docs/E2E_COVERAGE_PLAN.md` inventory + skip-budget expected-skips re-pin ("smoke-list update"); merged `7c3c1833`                                                         | W1.3 | S–M    | `[done]`     |
| 2    | §4.22 SQL leg (D3)                     | `feature/search-delta-sql`          | delta structuring + `$ref` binding + SQL/vectorStore execution; merged `50cab252` (path-anchor fix `c33e74b2`)                                                                                               | —    | L      | `[done]`     |
| 2    | D2 execution                           | `chore/remove-tags-journal-domain`  | TAGS removal across the four parity points; merged `b57a4c98`                                                                                                                                                | —    | S      | `[done]`     |
| 2    | hysteresis calibration                 | (owner-run, no branch)              | deferred post-release by owner ruling 2026-10-30 (§33.11): provisional ±0.02 ships as the first release artifact; re-measure after evolution/reconcile produces operational data                             | —    | owner  | `[deferred]` |
| 3    | P4 exit gate                           | `ai-feature`                        | gates of 33.4 + count re-pin (D4) + pre-closure record §33.11; final closure + single `ai-feature`→`dev` merge await owner go-ahead                                                                          | all  | —      | `[wip]`      |

**Merge order:** Wave 0 units land immediately and in parallel. The preceding DDL unit
(`chore/ai-job-cancelled-status`) lands first. T4.4, T4.1, and T4.3 then dispatch in parallel
off that commit. T4.4 is the only remaining `001` editor; T4.1 and T4.3 do not edit `001`.
Wave 2 units follow their deps. The exit gate runs only after every active row above is
closed.

### 33.3 Task graph (each task lists objective / inputs / outputs / verification / deps)

- **Preceding DDL — cancelled AI job status.** Objective: make `cancelled` a terminal
  `ai_jobs` status before T4.1/T4.4 start. Outputs: the `001` `ai_jobs.status` CHECK gains
  `cancelled`; `aiJobsStore.md`/`aiJobService.md` status docs and a schema/conformance
  assertion. No dev migration script: development DBs are ephemeral and the production
  migration/backfill is deployment-owned. Deps: none.

- **T4.4 — Dashboard storage usage series.** Objective: a per-user daily storage-usage
  series with the Storage sparkline. `bytes` covers the user's live + trash subtree and all
  active/history object versions; pending/orphaned objects are excluded. Version history is
  S3-only; WebDAV graphs current+trash bytes. No data ⇒ the block is omitted; no fabricated
  series. Inputs: §4.16 storage-usage rule; the scheduler template
  (`startAdminReportsRetentionScheduler`/`startFileSuggestionsExpiryScheduler` shape in
  `server/infrastructure/maintenanceScheduler.js`); the client seam
  (`CollectionDashboard.js:96` duck-typed `loadCapacitySeries`, renamed to
  `loadStorageUsageSeries` in the T4.4 docs-first step; sparkline render at :446–470, unit
  pin "seam absent ⇒ block omitted", E2E negative pins in `e2e/collections.spec.ts`);
  `object_map`/`filecache` size data. Outputs:
  `storage_usage_snapshots` + `object_map.size` added to
  `001_initial_normalized_schema.sql` + AI_FEATURE_PLAN §5; `StorageUsageSnapshotsRepository`
  sqlite/postgres twins + conformance suite; store facade; storage-usage aggregate query
  (active+history, trash included, no `deleted_at` filter); daily scheduler
  (`WEA_SKIP_STORAGE_USAGE_SNAPSHOT` skip seam, hot interval resolution, cross-replica lock, no
  boot-time capture; first point next daily tick, `server/index.js` composition wiring);
  `object_map.size` population on new writes (the production migration owns existing-row
  backfill); gateway `loadStorageUsageSeries()` (swallow failures → `null`); sparkline
  wire-through + seam-present client test cases. Policy: UTC `YYYY-MM-DD`, 30-day
  retention, 2-point minimum, null size ⇒ skip + warning. Verify: server+client `test:ci`,
  `test:ci:pg:adapters` (new repository), conformance suite, scheduler test,
  `docsStatePurity`, DDL exact-list tests. Docs-first: create
  `docs/spec/server/store/storageUsageSnapshotsStore.md`; update
  `docs/spec/server/routes/dashboard.md`,
  `docs/spec/server/infrastructure/maintenanceScheduler.md`,
  `docs/spec/server/infrastructure/configRegistry.md`, `docs/api.md`,
  `docs/spec/client/services/explorerGateway.md`,
  `docs/spec/client/components/mypage/content/CollectionDashboard.md`. Deps: preceding DDL.

- **T4.1 — Admin AI panel + full text+media launcher.** Objective: the §4.15 governance tab
  inside the MyPage admin area + the ONE rate-limited, cancellable re-embed action covering
  text nodes and the media coverage plan. Hardcoded evolution gates are not exposed; only
  config-backed gates are editable. Per-user top-N is deferred. Inputs: §4.15 panel contract
  (existing pipeline/cost/evolution/model data; missing series labelled `not instrumented`;
  failed jobs display-only; kill switches; aggregates-and-ids only, never other users' file
  names/queries/contents; profile-constant provenance), the existing
  `planMediaBackfill` plus a new text-node coverage query, `AI_GEN_<KIND>` generation
  settings, the preceding DDL's `ai_jobs.status='cancelled'`, the `myPageRegistry.js`
  admin-tab pattern, the `AdminReportsContent`/`adminService` patterns, invariant 4 and
  invariant 5. Outputs: admin-domain routes + service; launcher preview → one confirmation
  dialog → rate-limited enqueue (global one active, 15-minute cooldown, `retry_after_seconds`;
  no per-launch node cap); generation bump + hook wiring; `enqueueMany` job ids +
  `cancelPending({ jobIds })`; `settings`-domain `ai-reembed` journal row with a
  `cancel-ai-jobs` inverse and “Cancel pending jobs” partial-undo copy; failed jobs
  display-only; config-backed gate editing + live impact counts; settings journal covers AI
  gate/kill-switch config changes plus the launcher row (never secrets); `AiAdminContent` +
  `adminService` seams. Verify:
  route/service tests, client component/hook tests, cancel race tests, `docsStatePurity`,
  grep-gate (zero `CacheAdapter|operationProgress`). Docs-first:
  `docs/spec/server/routes/admin.md` panel surface; new
  `docs/spec/client/components/mypage/content/AiAdminContent.md` + hook spec;
  `docs/spec/server/store/aiJobsStore.md`, `docs/spec/server/services/aiJobService.md`,
  `docs/spec/server/store/actionJournalStore.md`, `docs/spec/server/routes/actions.md`,
  `docs/shared-contracts.md` snake_case response note. Deps: preceding DDL; parallel with
  T4.3/T4.4.

- **T4.3 — Hermetic fake-embed AI/media E2E + degradation matrix.** Objective: a fake
  embed+chat harness (local `node:http` in the Playwright process, injected through the
  scratch DB role config; never a real provider) + one suite per §4.12 capability column.
  The matrix is weightless: fake embed must pass the EG2 conformance kit; AI-001 remains the
  single real-EG2 fidelity case; AI-002 uses fake embed+chat and lives in a separate
  file/describe so AI-001's model-free skip cannot swallow it. Inputs:
  `docs/TESTING_STRATEGY.md` AI tiers; the `E2E-S3-AI-001` precedent (`e2e/ai.spec.ts`,
  scratch :5016); the fake `/v1` precedent in
  `server/domains/setup/__tests__/setup.test.js`; the llmAdapter role config. Outputs: the
  fake server + new scratch port `5021` (API-only; band 40 is 5061, browser-restricted);
  strip `WEA_SKIP_AI_WORKER` in the scratch child env; degradation suites including media
  capability-absent fallback legs (V2 caption→E1, V0 `metadata_only`); AI-002 parser case
  remains Wave 2 (harness-ready); `docs/E2E_COVERAGE_PLAN.md` Wave 1 rows. No skip-budget
  change in Wave 1. B-6 boot-step 8b
  coverage is closed by the existing unit/boot evidence. Verify: new suites green;
  `playwright test --list` count recorded; None/embed/embed+chat columns green with no real
  adapter present. Docs-first: TESTING_STRATEGY harness-contract details (injection
  mechanics + port); E2E_COVERAGE_PLAN rows (AI-002 stays planned until Wave 2; the
  degradation-matrix deferral row resolves); Wave 2 owns the final AI-002/inventory
  re-pin. Deps: preceding DDL (base only); parser case depends on the harness unit.

- **§4.22 SQL leg (D3).** Objective: server-side execution of parsed deltas. Inputs: the
  frozen grammar contract (`PARSE_ENVELOPE_GRAMMAR = 'nl1'`,
  `server/domains/ai/nlParser.js`); the §4.22 owner table (structuring + `$ref` binding =
  rule table; rerun/intersect/exclude-similar = SQL + vectorStore; ACL = `fileNodesStore`
  final-stage joins); current state — a request `result_ref` is accepted and ignored
  (`search.test.js:317`). Outputs: rule-table delta structuring, `$ref` → latest-signature
  binding, rerun/intersect/exclude-similar execution, updated
  `docs/spec/server/services/searchService.md` + `docs/spec/server/routes/search.md`.
  Verify: service tests + E2E over the T4.3 harness; grammar unchanged (additive only).
  Deps: none hard; sequenced in Wave 2 to keep Wave 1 fully parallel.

- **D2 execution — TAGS removal.** Objective: the dead enum value gone. Outputs:
  `shared/constants.js` (`TAGS` out of the enum + `ALL`), the `001` DDL CHECK, the
  `docs/shared-contracts.md` enum list, and the `sharedPlatformEnums.test.js` parity
  assertions, edited together. Verify: server `test:ci` incl. the parity suite. RED-first:
  flip the parity test to expect absence, then remove. Deps: none.

### 33.4 Verification gates

- `npm run test:ci` (server + client) on every unit; `test:ci:pg:adapters` for the T4.4
  repository twins; `docsStatePurity` (runs inside server CI); CI grep-gates for
  `domains/(collections|ai)/**` and new stores (zero `CacheAdapter|operationProgress`).
- Preceding DDL: `001` is edited directly; development DBs are ephemeral. The production
  migration (existing-table CHECK/column changes + `object_map` size backfill) is a
  deployment-owned script, not a feature-branch deliverable.
- T4.4 storage-usage policy: per-user bytes include live + trash + active/history object
  versions; version history is S3-only (WebDAV = current+trash); UTC day, 30-day retention,
  2-point minimum, null size ⇒ skip + warning.
- Degradation matrix: the None and embed columns pass green with no real adapter present;
  the embed+chat column runs over the fake-LLM harness; AI-001 remains the only real-EG2
  case.
- Exit gate (Wave 3): the full release matrix in both legs (model-free + model-on, §31.8
  discipline), the canonical server test-count re-pin (D4), the §33 execution-log closure,
  and the §33.5/PLAN.md status flips — then the single `ai-feature`→`dev` merge via the
  normal PR flow.

### 33.5 §32.3 disposition after this plan

| §32.3 item                                  | Disposition                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| T4.1 admin AI surface and re-embed launcher | Closed — `feature/t41-admin-ai-panel`, merged `12d32e87` (§33.10)                                                                                |
| T4.2 media ladder                           | Closed as absorbed by §28.8 D2–D4; residue re-pointed to T4.1/T4.3 (D1)                                                                          |
| T4.3 hermetic AI/media E2E                  | Closed — harness `8a5df061` + parser/delta E2E `7c3c1833` (§33.10)                                                                               |
| T4.4 storage usage series                   | Closed — `feature/t44-storage-usage`, merged `5d306d17`; `object_map.size` + `storage_usage_snapshots` (§33.8 W2, §33.10)                        |
| Preceding DDL: cancelled AI job status      | Closed — branch `chore/ai-job-cancelled-status` (§33.8 W7, §33.9)                                                                                |
| §4.22 delta-semantics SQL leg               | Closed — `feature/search-delta-sql`, merged `50cab252` + path-anchor fix `c33e74b2` (§33.10)                                                     |
| §30.6 L2 query-parses contract              | Closed — SQLite-only malformed-read wording + targeted mapper/raw-row tests (§33.7)                                                              |
| `JOURNAL_DOMAIN.TAGS` parity                | Closed — removal `16878077`, merged `b57a4c98` (§33.10)                                                                                          |
| P4 hysteresis calibration                   | **Deferred post-release** — owner ruling 2026-10-30 (§33.11); provisional ±0.02 ships first, re-measured after operational evolution data exists |
| §30.6 E future-route security precondition  | Confirmed as recorded; remains a standing precondition for any future collection-context route                                                   |
| `skip-budget.js` stale default comment      | Closed — comment-only unit (§33.7)                                                                                                               |
| Gate-count reconciliation                   | Closed — fresh exit-gate run pinned in §33.10 (D4)                                                                                               |

### 33.6 T4.1 UI/UX rulings (owner, 2026-10-29)

Owner rulings from the T4.1 UI/UX review; they bind the T4.1 docs-first specs
(`docs/spec/server/routes/admin.md` panel surface, the new
`docs/spec/client/components/mypage/content/AiAdminContent.md`). The PLAN.md T4.1 row text
stays unchanged per the overlay convention — the "settings journal subscription" clause is
refined by U4 below.

- **U1 — single scroll with section anchors.** The panel stacks the §4.15 blocks in one
  scrollable column with section headers (an in-tab summary strip anchors to each section);
  the kill switches occupy a fixed top area. No content-level sub-tabs and no accordions —
  the accordion is the settings idiom, not an operations-dashboard idiom.
- **U2 — role split with the settings tab.** The five-state `ai.<role>` rows stay in the
  SystemSettingsContent health card: the §4.12 contract, its CTA into `/api/admin/config` +
  `probeLlm`, and the pinned E2E navigation path are preserved. The AI tab is the
  operations/monitoring deep surface; the two surfaces cross-link each other and never
  duplicate a full render.
- **U3 — launcher flow: preview → confirm → health-tracked progress.** The launcher first
  renders the deterministic `planMediaBackfill` scope as per-coverage-state counts plus the
  text coverage counts (§33.8 W1), requires one confirmation dialog (invariant 5), then
  hands progress tracking to the pipeline-health block — the job queue is the single
  progress surface, with no parallel progress UI and no orphan enqueues. The rate limit is
  surfaced in the launcher response.
- **U4 — polling-based refresh.** Panel data refreshes by polling (the CollectionDashboard
  `getActions` precedent); no new settings-domain pub-sub channel is built. The
  settings-journal producer for gate-param/kill-switch changes (invariant 4) stays in scope
  — it feeds the rollback feed consumed from `GET /api/actions`, not a push channel. U4
  resolves the settings-journal semantics point deferred in §33.1; the storage-usage
  snapshot row shape, the fake-LLM harness injection mechanics, and the scratch E2E port
  entry remain docs-first decisions.

### 33.7 Wave 0 closure (2026-10-29)

- **skip-budget comment** — `e2e/reporters/skip-budget.js` now names the current default
  budget (`7`); no runtime change. Branch `chore/skip-budget-comment`, merge `9da6b253`.
- **§30.6 L2 query-parses contract** — `docs/spec/server/store/queryParsesStore.md` states
  that malformed stored JSON is a SQLite raw-row/legacy read case: PostgreSQL JSONB rejects
  malformed input at write, while the shared mapper defensively maps a malformed string to
  `null`. Added `queryParsesShared.test.js` (mapper boundary) and a SQLite raw-row case in
  `QueryParsesRepository.conformance.test.js`. Branch `docs/query-parses-sqlite-note`,
  merge `05885290`.
- **§30.6 E precondition** — confirmed recorded in
  `docs/spec/server/services/collectionShareService.md` §2.6: the download/preview bridge
  paragraph names the `assertMemberConsumable` route-level pre-check and its 404-masquerade
  rule, and §4 carries the verification scenario. No code change; the item is closed as
  recorded and remains a standing precondition for any future collection-context file route.
  Rides the L2 branch.
- **Verification** — targeted `queryParsesShared` + `QueryParsesRepository` suites:
  19/19 passed; `docsStatePurity`, eslint, and Prettier (source/spec files) passed. Full
  local `test:ci`: server 194 passed + 1 skipped suite, 3365 passed + 28 skipped tests
  (3393 total); client 189 suites / 2279 tests passed; the PostgreSQL adapter leg
  (`test:ci:pg:adapters`) passed 31 suites / 472 tests (1 skipped). The server total is
  recorded as run evidence for the exit-gate reconciliation (D4), not as a new summary
  pin.

### 33.8 Wave 1 scope rulings (owner, 2026-10-29)

- **W1 — T4.1 launcher is the full text+media re-embed.** The ONE admin action covers the
  initial coverage pass and a model-change re-embed over text nodes plus the media coverage
  plan (`planMediaBackfill` is the media half). The preview shows both text and media
  coverage; generation bump + seed enqueue are the launcher's job. U3's media-only preview
  wording is extended accordingly.
- **W2 — T4.4 is storage usage, not capacity.** The series is per-user logical storage
  usage: live + trash subtree plus all active/history object versions. `object_map.size` is
  added (new writes populate it; production migration backfills existing rows).
  `storage_usage_snapshots(user_id, day, bytes, created_at)` is UTC `YYYY-MM-DD`, one row per
  user/day, 30-day retention, 2-point minimum, no boot-time capture. Pending/orphaned
  objects are excluded; version history is S3-only, so WebDAV graphs current+trash bytes.
  Null size ⇒ skip the snapshot for that user + warning (never a partial series).
- **W3 — T4.3 matrix is weightless fake embed+chat.** `None`/`embed`/`embed+chat` use fake
  roles; AI-001 remains the single real-EG2 fidelity case; AI-002 uses fake embed+chat in a
  separate file/describe. New scratch port 5021 is API-only (band 40 = 5061 is
  browser-restricted). `WEA_SKIP_AI_WORKER` is stripped from the scratch child env. No
  Wave 1 skip-budget change.
- **W4 — Per-user top-N is deferred.** T4.1 shows the global `ai_usage_daily` per-role
  ledger plus `not instrumented` for per-user top-N. A separate post-T4.4 accounting unit
  owns `ai_usage_user_daily`, adapter `userId` propagation, job owner attribution, and the
  top-N API.
- **W5 — T4.1 cancels pending jobs.** `ai_jobs.status` gains the terminal `cancelled`
  state. The launcher journals a `settings`-domain `ai-reembed` row with a
  `cancel-ai-jobs` inverse carrying job ids; `enqueueMany` returns the enqueued ids and
  `cancelPending({ jobIds })` cancels only `pending` rows. Running jobs finish; spent
  provider cost is not refunded; cancelled jobs are not retried. Failed jobs remain
  display-only in v1 (no retry/abandon UI).
- **W6 — Hardcoded evolution gates are hidden.** The admin panel/API exposes only
  config-backed gates (`AI_EVOLUTION_*`, `AI_MERGE_*`, activity/retention keys) with live
  impact counts + settings-journal rollback. Hardcoded create/merge thresholds and profile
  fallbacks stay release-time constants and are not shown. The model-registry constants
  block keeps per-model profile/release provenance only. Settings journaling covers AI
  gate/kill-switch config changes plus the launcher `ai-reembed` audit row; secret values are
  never written to `action_journal`.
- **W7 — Preceding DDL.** `chore/ai-job-cancelled-status` lands first and edits `001`
  directly (`ai_jobs.status` CHECK + docs/schema test). Development DBs are ephemeral, so
  there is no feature-branch dev migration/backfill script; the production migration
  (existing-table CHECK/column changes + `object_map` size backfill) is deployment-owned.
  T4.4 is the only remaining `001` editor; T4.1/T4.3 do not edit `001` after the preceding
  DDL.
- **W8 — T4.1 panel completeness.** v1 shows existing data and labels missing series
  `not instrumented`: 24h fail uses `markFailed`'s `finished_at` (small code
  instrumentation); the degraded histogram uses the adapter's `degraded` counter when it is
  written. Survival curves, merge-accept time series, per-version history, and per-user
  top-N are not instrumented in v1. No fabricated values.
- **W9 — Launcher defaults.** One global active launcher, 15-minute cooldown,
  `retry_after_seconds` in the response, no per-launch node cap. The journal uses the
  `settings` domain; cancel targets job ids, never a whole generation. Failed jobs are
  display-only.
- **W10 — T4.3 coverage/re-pin.** B-6 boot-step 8b coverage is closed by existing
  unit/boot evidence. Wave 1 records the new matrix rows/counts; Wave 2 owns the final
  AI-002 + inventory/skip-budget re-pin.

### 33.9 Preceding DDL closure (2026-10-29)

- **Branch** `chore/ai-job-cancelled-status`, commit `dfa6a51e`.
- **Schema/contract** — `001` `ai_jobs.status` CHECK includes `cancelled`; both store twins
  include `cancelled` in `countByStatus`; `aiJobsStore.md`/`aiJobService.md` status text
  updated; the conformance suite pins terminal/not-claimable/not-failed behavior.
- **Migration policy** — no feature-branch dev migration script; development/test DBs are
  ephemeral. The production migration (existing-table CHECK/column changes + `object_map`
  size backfill) remains deployment-owned.
- **Verification** — targeted conformance 30/30; PG adapter leg 473 passed / 1 skipped;
  full server `test:ci` 194 passed + 1 skipped suite, 3366 passed + 28 skipped; client
  `test:ci` 189 suites / 2279 tests passed; `docsStatePurity`, eslint, and Prettier clean.

### 33.10 P4 closure — unit merges and exit-gate evidence (2026-10-29)

- **Merged on `ai-feature`:**
  - D2 `chore/remove-tags-journal-domain` → `16878077` (merge `b57a4c98`). RED-first parity
    test; enum/DDL/contracts/parity points edited together; stale `tags` references removed.
  - T4.3 Wave 1 `test/t43-fake-llm-harness` → `326126c9` (merge `8a5df061`). In-process fake
    embed/chat/vision server, API-only scratch slot `5021`, `E2E-S3-AI-003..007` matrix,
    `WEA_SKIP_AI_WORKER` stripped from the scratch child env.
  - T4.4 `feature/t44-storage-usage` → `722bb1f7` (merge `5d306d17`).
    `storage_usage_snapshots` + `object_map.size`, repository twins/conformance, S3/WebDAV
    subtree aggregate, write-side size population, daily locked scheduler with skip seam,
    `GET /api/dashboard/storage-usage`, gateway/sparkline, 2-point minimum.
  - D3 `feature/search-delta-sql` → `4fc3c536` (merge `50cab252`), plus path-anchor fix
    `46872ce3` (merge `c33e74b2`). Additive `delta` grammar/envelope, rule-table structuring,
    request-ref-only `$ref` binding, replay under current ACL, intersect/exclude/
    exclude-similar, deterministic delta signatures, bounded `query_parses.listAll` derivation.
    The delta path atom now anchors both `value` and `prefix` so the shared grammar re-parse
    cannot drop the requester root.
  - T4.1 `feature/t41-admin-ai-panel` → `ebb2a7d3` (merge `12d32e87`). Admin AI panel
    summary/preview/launch routes, text+media coverage, internal generation rows/hook wiring,
    `enqueueMany` ids + `cancelPending`, `markFailed.finished_at`/24h counts, settings-domain
    journaling + `set-setting`/`cancel-ai-jobs` inverses, 15-minute rate limit, single-scroll
    `AiAdminContent` with polling and confirmation flow.
  - T4.3 Wave 2 `test/t43-parser-e2e` → `ad5ceec9` (merge `7c3c1833`). `E2E-S3-AI-002`
    parser/cache/kill-switch/invalid-output/delta replay over the fake harness; inventory
    re-pinned to 266 default / 147 core / 41 WebDAV.
- **Exit-gate verification (integrated tip):**
  - Server `npm run test:ci`: **202 passed + 1 skipped suites (203)**; **3465 passed + 28
    skipped tests (3493)**. Client `npm run test:ci`: **191 suites / 2304 tests passed**.
  - Real-PostgreSQL adapter leg on a freshly recreated `webdav_test`:
    **32 suites / 492 passed + 1 skipped (493)**.
  - `docsStatePurity` 3/3; Prettier/ESLint clean on changed files; CI grep-gate shows no
    `CacheAdapter|operationProgress` imports in `domains/(collections|ai)` or the new stores.
  - `playwright test --list`: default **266** (19 files), core **147**, WebDAV **41**.
    Fake matrix suite **6/6** green in both normal and `WEA_SKIP_EMBED_MODEL=1` modes.
  - Full release matrix: model-free default **258 passed / 8 skipped / 266** (the extra skip
    is the conditional AI-001 model-free skip; skip budget accepts it); model-on default
    **259 passed / 7 skipped / 266**, rc=0. AI-001 remains the only real-EG2 case.
- **D4 count reconciliation:** the canonical pin is the exit-gate run above (server
  202/3465, client 191/2304, PG 32/492+1 skipped); `server/TEST_SUMMARY.md` and
  `client/TEST_SUMMARY.md` carry the same numbers. No historical pin is retained as current.
- **P4 coverage:** T4.4 storage-usage series; T4.1 admin AI panel + full text/media launcher +
  cancel-pending; T4.3 hermetic matrix + AI-002 parser/delta E2E; D3 §4.22 SQL leg; D2 tag
  domain removal. T4.2 remains absorbed (§33.1 D1); per-user top-N stays deferred (W4).
- **Hysteresis disposition:** owner ruling 2026-10-30 moved the calibration to post-release
  (§33.11). The provisional offsets ship as the first release artifact; no code unit or
  pre-merge gate remains blocked on it. The exit gate stays `[wip]` until the owner calls
  the final closure; no `ai-feature`→`dev` merge has been performed.
- **Deployment note:** production migration remains deployment-owned (existing-table
  CHECK/column changes, `object_map.size` backfill). Development/test DBs are ephemeral;
  editing `001` uses the standing checksum-recovery one-liner.

### 33.11 P4 pre-closure snapshot — hysteresis deferred post-release (2026-10-30)

- **Owner ruling (2026-10-30):** the pre-merge hysteresis measurement cannot run against
  current production because production does not yet contain the AI platform schema or any
  evolution/reconcile history. The owner selected the post-release calibration path:
  - ship the provisional EG2 profile offsets `{ inDelta: 0.02, outDelta: -0.02 }` as the
    first release artifact;
  - keep the hysteresis row `[deferred]`, not `[open]`, and do not block the P4 exit gate
    on it;
  - re-measure after the platform has run evolution/reconcile on operational data and
    update `presets.js` + this ledger with the measured values.
- **Post-release measurement trigger:** after `ai-feature` is deployed and at least two
  nightly reconcile passes have produced membership state, capture two or more dated
  database snapshots (PostgreSQL `pg_dump -Fc` or SQLite `.backup`) into
  `/tmp/opencode/hysteresis/incoming/`. The measurement compares stored-member /
  non-member score distributions and membership flips across snapshots, then chooses
  `inDelta`/`outDelta` and records the evidence in a new dated ledger section.
- **Pre-closure state:** every P4 code unit and gate in §33.4 is green (server 202/3465
  passed tests, client 191/2304, PG 32/492+1 skipped; default/WebDAV release matrix green;
  `docsStatePurity`, lint, and grep gates clean). The P4 exit gate remains `[wip]` and the
  single `ai-feature`→`dev` merge remains unperformed, awaiting the owner's explicit
  go-ahead. No production migration has been run from this branch.
- **Artifact inventory for the pre-closure review:** `docs/E2E_COVERAGE_PLAN.md` carries the
  P1–P4 E2E rows; the phase-by-phase case inventory requested for the exit-gate review is
  recorded in the session report (not duplicated in this ledger).

### 34. Post-P4 UI/UX hardening closure (2026-10-30)

> Owner directive: apply all recommended UI/UX and test hardening before the P4 exit gate;
> exclude hysteresis calibration and exit-gate closure itself. This overlay does not change
> the §33 exit-gate status: it stays `[wip]`, and `ai-feature`→`dev` remains unmerged.

**Merged units**

| Unit                                                                                             | Branch                                      | Merge      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | ---------- |
| File-list membership badges removed (visual only; hook/API/checkmarks/properties chips retained) | `refactor/remove-file-membership-badges`    | `46de4c1b` |
| FilePropertiesDialog AI Info tab + `GET /api/ai/enrichments/:nodeId`                             | `feature/file-ai-info-tab`                  | `64b58d5a` |
| Atomic collection properties server endpoint + composite undo                                    | `feature/collection-properties-atomic-save` | `fac27bbf` |
| Collection properties draft save / `onBack` / role-badge sharing UX                              | `feature/collection-properties-draft-save`  | `7e03b4d4` |
| Merge recommendation sticky/accordion/hover-tap detail/B→A/reason redesign                       | `feature/merge-recommendation-ui`           | `dc46b511` |
| Storage server domain split + `/api/storage/usage` breakdown                                     | `feature/storage-domain-server`             | `345987c6` |
| Storage client split + `StorageDashboard`/usage UI + `CollectionsOverview`                       | `feature/storage-domain-client`             | `6f3e757e` |
| Admin AI panel parity + contract manifest/fixture + `admin-ai` E2E                               | `feature/admin-ai-parity`                   | `95591029` |
| AI matrix browser UI + storage usage E2E + inventory re-pin                                      | `test/p4-ui-e2e`                            | `9e29592d` |
| Admin AI i18n gate-key alignment after storage rename                                            | (direct test fix)                           | `4e56ab3e` |

**Resulting state**

- **Storage ownership:** `server/domains/storage`, `/api/storage`,
  `storage_suggestions`, `StorageDashboard`, `StorageCleanupSuggestions`,
  `storageRepository`; collection status/journal moved to `CollectionsOverview`. Storage
  and collections no longer import each other.
- **New user usage feature:** current total/live/trash/version breakdown + 30-day series,
  S3/WebDAV semantics, `incomplete` on NULL sizes, 2-point minimum, no quota/capacity.
- **Badges:** files-surface collection markers removed; `for-nodes` remains for
  AddToCollectionMenu checkmarks, FilePropertiesDialog “Member of”, and bulk add.
- **Merge UI:** sticky region between toolbar and list; body/footer accordion; desktop
  hover/mobile tap detail; no active-pair cursor; two collection-card 2×2 preview panels
  (B absorbed → A survivor, newest-added `preview_items`, no filename labels) shared with
  the collection grid; each side CONTAINER uses the grid-view `grey.100` + divider theme
  (cells stay transparent); a shared
  strip of up to 3 mini tiles plus `+N` and the deterministic reason form one centered group
  on desktop (two centered rows on mobile); the expanded accordion reserves bottom padding
  so its last row clears the footer; the detail is a Popper portal anchored to the row,
  so it may escape the accordion/card clip while staying adjacent (never card-level), and
  card actions stay clickable.
- **Properties:** dialog-wide draft, Save/Discard/Cancel, cross-tab save, role badge toggle,
  hierarchical `onBack`, one atomic `PUT /:id/properties` TX and one composite undo;
  role changes preserve the grantee hidden flag; new grants clear it. The footer keeps the
  contained-primary Close at the far right and inserts an outlined-primary Save before it
  only while dirty, so the Close position never shifts.
- **File AI:** read-gated AI Info tab with tags/summary/caption/transcript/safe media/
  provenance; no category/degraded fabrication.
- **Admin AI:** rendered/API-only contract manifest, sentinel fixture, null-safe rendering,
  launcher/preview reasons, journal errors, and eight browser E2E cases.
- **E2E:** browser AI matrix (`AI-008..012`, AI-015), admin-AI cases, and a dedicated
  storage suite (`STORAGE-001..002` in `e2e/storage.spec.ts`; the former COLLECTION-023
  moved there) under the independent `s3-storage-desktop`/`s3-storage-mobile` projects
  (dedicated `:5022`/`:5023` scratch slots). Default inventory 283 (277 passed / 6 skipped
  model-on; 276/7 model-free), WebDAV 41/0.

**Verification (2026-10-30)**

- Server `test:ci`: 205 passed + 1 skipped suites; 3496 passed + 28 skipped tests.
- Client `test:ci`: 197 suites / 2390 tests passed.
- PostgreSQL adapter leg on a freshly recreated `webdav_test`: 32 suites / 492 passed +
  1 skipped.
- Release E2E: model-on 277/6 rc=0; model-free 276/7 rc=0; WebDAV 41/0 rc=0.
- Merge detail portal + preview-parity follow-up: server `domains/collections`
  **332/332**; client `MergeProposalCard` + `CollectionsListView` + `FileManager`
  **159/159**; COLLECTION-021 desktop+mobile **2/2** (portaled previews outside the
  accordion, container-level grid-view theme, shared strip 3 tiles + `+N` centered with
  the reason on desktop and centered on two rows on mobile, mobile `50vh` accordion cap +
  footer clearance).
  The E2E C/D fixture seeds 10 shared + one unique per side for visual count review (no
  C/D count assertions).
- `docsStatePurity` 3/3; Prettier/ESLint clean on changed files; docs/DOM count pins
  updated.
- `client/TEST_SUMMARY.md`, `server/TEST_SUMMARY.md`, `PLAN.md`, and
  `docs/E2E_COVERAGE_PLAN.md` carry these current pins; §33.10/§33.11 remain historical
  pre-hardening snapshots.

**Excluded / still open**

- Hysteresis calibration remains the owner-run post-release item (§33.11).
- P4 exit gate stays `[wip]`; no `ai-feature`→`dev` merge has been performed.
- Predicate/delta chips remain deferred to the future conversational-search phase.
- P3 was not rolled back as a whole; only the files-surface membership badges were removed.
