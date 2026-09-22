# PLAN.md — AI-Driven Storage: Task Graph

> **Design authority: `AI_FEATURE_PLAN.md`.** Invariants (§2), domain model & lifecycles (§3),
> behavior specs (§4.x), schema (§5), rejections/extension points (§9–§10) live there —
> **read it before implementing any task below; task rows reference its sections by number.**
> This file carries only: work units + deps + verification + binding conventions (§6–§8).
> Graduation status (2026-09-17, commits 34ee64c→76ae679): the §8 docs gate is DONE —
> `docs/features/collections-platform.md` + the full `docs/spec/**` contract suite are
> published and binding. This graph stays as the execution ledger (work units + deps +
> verification); it no longer shrinks.

## Branching & merge policy (binding — overrides AGENTS.md §2.2 step "merge to dev" for this workstream)

- Chain: `dev` → **`ai-feature`** → per-task branches (`feature/…`, `fix/…`, `test/…`,
  `chore/…` derived from `ai-feature`).
- Every task branch merges back into **`ai-feature` only**. Direct merges of this
  workstream's branches into `dev` are FORBIDDEN.
- **`ai-feature` → `dev` merge happens exactly once, when every §7 task is complete** and
  the verification gates (§6/§8) have passed; it follows the normal PR flow. Until then
  `ai-feature` may merge/pull FROM `dev` (sync direction dev→ai-feature only).
- Rationale: the platform is one coherent capability shipped as one unit (P0 has user-
  visible surfaces; half-merged states leave UI without endpoints and vice versa).

## 6. Conventions (binding; verified against repo house style)

- **Wire casing**: request bodies camelCase nodeId-based (`{ nodeIds }`, `{ seedNodeId }`);
  **responses are snake_case — the CODING_STYLE.md Express-Patterns rule is binding for all
  NEW endpoints** (`collection_id`, `publish_mode`, `created_at`, `result_ref`). The file
  domain's existing camel responses (`nodeId` in listings) are legacy violations, not
  precedent — repo-wide compliance rewrite is tracked as DEF-24 in
  `docs/IMPROVEMENT_PLAN.md`; new AI surfaces must not propagate the legacy style. SQL
  snake_case maps to camel domain objects at the repository boundary (internal, unchanged).
- **Domain layout** (recentFiles precedent): `server/domains/<camelCaseDomain>/{routes.js,
service.js, __tests__/}`; route handlers via `asyncHandler`; service throws bare string
  codes translated by route-level `ERROR_MAP`/`mapServiceError`; per-router
  `authenticateToken, requireUser`; mount in `server/index.js` **after** the app-level
  migrationGate middleware and with `setupModeGuardInstance` (coverage invariant,
  ARCHITECTURE §1.3) on a kebab-case plural path `/api/collections`.
- **Persistence**: no SQL outside repositories — interface `server/store/repositories/`
  `<Plural>Repository.js` + `sqlite/`+`postgres/` twins + `<Plural>Repository.conformance.
test.js`; store facade `server/store/<plural>Store.js` thin dialect dispatch on
  `storage.getExecutor()`. **DDL policy**: the ENTIRE §5 schema — every table, P0–P4, AI
  included — lives in `001_initial_normalized_schema.sql` (single source of truth); the
  numbered chain resumes at `002_…` only after the platform merge. No ALTERs of existing
  tables. Single-file ownership keeps cross-file FK ordering (declare `llm_models` before
  `collection_centroids`) and parallel-branch DDL conflicts moot; the file stays
  `convertPostgresToSqlite`-compatible. The file is checksum-tracked: an edited
  already-applied file fails boot fast by design — recovery is the standing one-liner
  (`DELETE FROM _schema_migrations WHERE
  filename='001_initial_normalized_schema.sql'`, then boot re-applies; every statement is
  `IF NOT EXISTS`, so pre-existing tables no-op). Operational/prod DB is migrated manually
  at the single `ai-feature`→`dev` merge/deploy. TEXT+CHECK enums,
  `<table>_<purpose>` indexes,
  `created_at/updated_at TIMESTAMPTZ DEFAULT NOW()`. **Derived vector artifacts (pgvector
  shadow table, sqlite vec0 virtual table) are created/managed by the vectorStore adapter —
  never part of the tracked DDL chain (§4.13).** **sqlite driver: `node:sqlite` (Node ≥24
  floor, replaces `sqlite3` npm inside `db/sqliteExecutor.js` only — T0.12); vec0 integer
  PKs bind via BigInt; experimental-warning tolerated per §4.13.**
- **Error codes**: `SERVER_ERROR_CODES` nested under camelCase domain key → full i18n key
  `serverErrors.collections.<key>` / `serverErrors.ai.<key>`; client `en.json`+`ko.json`
  mirror is mandatory (shared-contracts).
- **Client layering**: IO via `services/collectionsRepository.js` (swallows failures to
  fallback values) + `collectionsNotifier.js` pub-sub + `explorerGateway.js` re-export;
  orchestration in page-local hooks under `pages/FileManager/hooks/`; MyPage entries use
  `{ id, icon, labelKey, visibility }` registry shape.
- **Scheduling**: new schedulers are functions added to
  `server/infrastructure/maintenanceScheduler.js` with `shouldSkip`/`resolveIntervalMs`
  seams (not a new module file).
- **E2E**: IDs `E2E-COLLECTION-001`/`E2E-AI-001` with third-person declarative titles;
  files `<name>.<platform>.spec.ts`; hermetic suites get dedicated scratch ports
  (next free `:5013+`) per TESTING_STRATEGY destructive-case policy.
- **Config keys**: metadata DB connection = T0 presence-block (`WEA_DB_*`, boot-frozen).
  **`LLM_*` = T2 `dbOnly`, fully hot** (per-call resolver, re-probe on change, no restart —
  §4.2); DB connection presence selects the vector engine (boot), LLM presence never does.
  Runtime knobs T2 (+dbOnly where DB-editable). No new secret encryption anywhere
  (settings are plaintext by decision; `secret:true` = UI masking only).
- **Numeric constants (PoC, 2026-09-16)**: every AI threshold (θ_dup, edge cos tiers,
  ef_search, char/token safety factor, reasoning on/off) is a **release artifact measured
  by the project on its own reference set** — shipped in per-model profiles, displayed in
  admin with provenance, NEVER computed at runtime from user data and never a shipped
  dataset. `ef_search=400` fixed (external-query recall). Arbiter/keeper prompts always
  carry symmetric-difference inputs. vec0: BigInt PKs, oversample→filter (no join-KNN).
  All chat roles reasoning-off by default; probes use in-domain samples only. Activity
  constants (§3.4: score weights, H=30d, archive min-age 14d) follow the same discipline
  but are product T2-hot constants (dbOnly, defaults shipped, admin-displayed) — not
  AI-profile numbers.
- **Verification gates**: `npm run test:ci` (+ `test:ci:pg:adapters` for repository twins);
  CI grep-gate: `domains/(collections|ai)/**` and new stores contain zero
  `CacheAdapter|operationProgress` imports; conformance suite per new repository; E2E for
  lifecycle (create→digest→archive→undo→restore→purge) and degradation matrix.

## 7. Task graph (phases; deps in parentheses)

### P0 — Non-AI foundation (shippable alone)

- T0.1 `content_hash` (A1 decision 2026-09-22 — no persistent migration-state mark): boot
  runs a cheap non-blocking completeness probe (`COUNT(*) WHERE content_hash IS NULL`) →
  warn log + admin_reports row (`kind='failsafe'`, `contentHashCompleteness` payload
  section); the admin repair action (`POST /api/admin/reports/:id/repair`) backfills ALL
  NULL rows (idempotent, `WHERE content_hash IS NULL`); write-side population at the §4.1
  commit points covers new writes. Consume for exact-dup/dedup paths — NULL rows never
  form a dup group.
- T0.2 full-schema DDL: author ALL §5 tables (P0–P4) into
  `001_initial_normalized_schema.sql` per §6 DDL policy + collections/file_likes repos +
  facades + conformance twins.
- T0.3 Collections CRUD API `/api/collections` (§3.1/§3.2 ops; activity sort =
  `activity_score` desc w/ `last_member_change_at`/`created_at` fallback per §3.4) +
  route spec + integration tests.
- T0.4 Sidebar `__collections__`/`__archive__` + list view + card menus (client per §6).
- T0.5 File-side: `Add to collection` submenu (context+multi-select), member-row controls
  (§3.2 exact set), like toggle everywhere. Like toggles wire `usageService.recordEvent`
  (`like` signal — register (a)).
- T0.6 `usage_events` + nightly rollup in maintenanceScheduler (item accumulator `S_k` +
  `collections.activity_score` recompute) + item activity score fn (T2 constants: §3.4
  weights, H=30d).
- T0.7 `action_journal` infra + `commitChange` + TX/lock discipline (writers v1 =
  collections only) + `GET /api/actions` + snackbar/30d-feed UI.
- T0.7b existing-infra edits (§4.14 Tier A plumbing incl. `admin_reports`, gcService tier
  add-ons, registry keys, probeLlm slot, error codes + locales, settings/public ai flags,
  SystemConfigEditor whitelist fix, WEA_SKIP test seams).
- T0.8 admin reports endpoints + render + row repair actions via existing
  `repair-sync`/`perm-delete` + kind-dispatched `POST /api/admin/reports/:id/repair`
  (hash backfill for the `failsafe` content-hash completeness row).
- T0.9 LLM-free items pulled from AI-phases: exact-dup finder (**hash-first — cosine 1.0
  detection redundant, PoC §2.2/E2**), local derived tags (mime/ext/month/path — v1 set
  per §4.10; EXIF rejected for v1),
  stored digest banner, cosine-free rule evaluation (path/tag/like predicates incl.
  upload-hook rule check). NULL content_hash rows never form a dup group — pre-backfill
  dup coverage depends on the register (b) backfill action until write-side lands (T1.3).
- T0.10 user dashboard `Storage` v1 (hygiene: exact dups, trash, journal feed, collections
  status, rule-based suggestions block fed by T0.9 per §4.16 — A7 decision 2026-09-22) —
  no LLM/vector blocks yet. Journal feed renders member-op rows: decide `subject_label`
  capture there (register (d)).
- T0.11 server-wide **name search** + results-mode UI + two-section rendering with
  client-side highlight (LLM-free §4.6 stage; semantic section lands as P1 add-on).
  Search results wire `search_hit`/list-entry-click recording (register (a)).
- T0.12 **sqliteExecutor driver migration** `sqlite3` npm → `node:sqlite` (Node ≥24 floor;
  confined to the seam per §6; behavior suite green on both drivers; BigInt PK binding
  convention documented) — prerequisite for T1.4 native sqlite vector path.

### P1 — Embeddings + semantic search

- T1.1 LLM adapter (T2-hot: per-call config resolution, re-probe on change, restart-free
  §4.2) + budgets/breaker + startup probe + preset manifest & preset×capability probe-matrix
  verification (declared≠probed ⇒ capability off + admin warning, §4.23) + wizard optional
  skippable AI step storing DB rows (§4.23.5).
- T1.2 AI repos (`llm_models`,`embeddings`,`embeddings_chunk`,`ai_features`,`ai_jobs`,
  `ai_usage_daily` — tables already shipped in the T0.2 full-schema DDL) +
  restart-survival test.
- T1.3 jobs worker (claim per dialect, backoff, lockManager, seam, hooks §4.1). Hooks §4.1
  carry the upload/copy/restore `content_hash` write-side population (register (b)).
- T1.4 `vectorMath` + local extractors (unit-tested pure) + **`vectorStore` seam** (§4.13):
  exactly two impls — Native adapters (PG pgvector≥0.7 HNSW **ef_search=400 fixed** / sqlite
  **node:sqlite + sqlite-vec vec0** / future RDB adapters) and `TextVectorJs` fallback
  (missing capability ⇒ degrade + admin health warning, never AI-off). Conformance:
  exact≡oracle, ANN recall≥0.99 **@ ef400 measured with HELD-OUT (external) queries**;
  vec0 BigInt-PK + oversample-then-filter ACL helper. Pre-req T0.12.
- T1.5 semantic branch of §4.6: segment-AND scorer + per-query dynamic baseline gate +
  max-over-chunks scoring (`POST /api/search` gains `semantic`; name section shipped by
  T0.11) + query-embed + dedup/hide-save rules. Budget chain per §4.3 lives in T1.1 adapter.
- T1.6 seed collections: preview endpoint + confirm dialog + `templateNamer`
  (collections domain) / `llmNamer` strategy swap.
- T1.7 near-dup finder (vectors) → feeds §4.17 vector variant.
- T1.8 tag pipeline: `tag_embeddings` cache + §4.18 3-step (ortho normalization →
  parent hints → gray band untouched); embed role required, None state = normalized
  string equality only. (No merge/alias tables.)

### P2 — Silent evolution

- T2.1 definition engine (predicates + seed/centroid vectors, evaluation at hook, caps).
- T2.2 evolution pass + `AI_EVOLUTION_TRIGGER` config (nightly|upload|both, budgets) +
  multi-tier create (mutual-kNN seed-expansion, **content_hash dedup pre-pass**, facet
  sources + promotion-not-duplication, §4.9 pass 1) + auto-pin on user-touch incl. member
  add/remove/exclusion (§4.9b; exclusion-rate archive trigger removed) + containment-safe
  merge metrics (§4.9c) + split/archive gates + journal (§4.9).
- T2.3 activity archiver + `ARCHIVE_RETENTION_DAYS` purge + tombstones.
- T2.4 derived-side digests (`/items?since=`, cursors) — stored side done T0.9c.
- T2.5 `GET /api/collections/:id/preview` (rule dry-count + sample).

### P3 — Proposals, sharing, subscriptions

- T3.1 merge detector + suggestions + card UI (§4.4); arbiter (T3.4-gated) prompt MUST pass
  symmetric-difference input per §4.19.
- T3.1b set-Jaccard merge variant (LLM-free, same pipeline).
- T3.2 sharing: grants, live resolution, publish pipeline/modes, cross-leak rule, viewer
  chip, grant UI in props tabs, leave (§4.7). Cross-user writes move `is_tip` to
  per-subject server-side computation (register (e)).
- T3.3 `file_suggestions` rule variant + accept/undo (θ_dup 0.97, short-doc cosine
  exception, §4.17); dashboard AI-block appears when embed configured (§4.12); vector
  variant rides T1.7.
- T3.4 NL parser (chat) → shared predicate grammar + `query_parses` cache. Output contract
  must be additively extendable to §4.22 delta semantics (`add|replace|exclude|$ref`)
  without redefinition — conversation itself is NOT a task here.
- T3.5 batch worker journal subscription + honor `job.cancelled` per item.
- T3.6 `POST /api/collections/for-nodes` membership chips (file-listing contracts frozen).

### P4 — Admin & scale

- T4.1 admin AI tab (pipeline/cost/governance/models, impact-preview tuning, settings
  journal subscription) (§4.15).
- T4.2 media ladder **V0(ffprobe)→V2(VLM captions→text space)→V3(ASR TRANSCRIPTION ONLY)**
  behind capability flags; V1 image-embedding RETIRED (single text space, §4.21); ASR scope
  freeze: transcript + probe meta only — no genre/desc (E13), escape-prompt mandatory,
  `media_kind=music` transcript excluded from content scoring; frames/transients never
  persisted; image near-dup = caption-space distance (weaker vs reencode — accepted).
- T4.3 e2e hermetic AI suite (in-process fake LLM server via adapter injection; scratch
  project port; smoke-list update) + degradation-matrix suite.

### 7.1 Contract-spec references (mandatory)

**Every task below MUST be implemented against its contract specs — read them first; a
mismatch with §7.1 files is a bug in whichever side is newer (docs-first: fix the spec in
the same PR).** AI_FEATURE_PLAN.md sections carry their own "Contract specs" lines; this
map is the task-row view. All §7.1 spec files now exist (written by the §8 docs gate,
2026-09-17) — they are the binding contract specs. Path prefixes are implicit:
component/hook/service/page specs live under `docs/spec/client/`; route/store/service/
infrastructure specs live under `docs/spec/server/`.

- T0.2 `docs/spec/`store/collectionsStore.md, store/fileLikesStore.md, store/actionJournalStore.md
- T0.3 `docs/spec/`routes/collections.md, services/collectionsService.md, hooks/useCollections.md
- T0.4 `docs/spec/`components/folder-tree/CollectionsSection.md, components/file-manager/CollectionsListView.md, hooks/useFolderTreeController.md, pages/FileManager.md, components/file-manager/FileManagerView.md
- T0.5 `docs/spec/`components/file-manager/{FileContextMenu,FileActionSheet,BulkActionToolbar→FileManagerControls,AddToCollectionMenu,MemberRowControls}.md, components/dialogs/FilePropertiesDialog.md
- T0.6 `docs/spec/`infrastructure/maintenanceScheduler.md
- T0.7 `docs/spec/`store/actionJournalStore.md, routes/actions.md, hooks/useMessage.md, components/feedback/UndoToast.md, hooks/useUndoToast.md
- T0.7b/T0.8 `docs/spec/`routes/admin.md, routes/config.md (unchanged surface), infrastructure/backendHealth.md, components/SystemConfigEditor.md
- T0.9 `docs/spec/`store/aiTagStore.md, services/collectionsService.md (rule evaluation)
- T0.10 `docs/spec/`components/mypage/content/CollectionDashboard.md, hooks/useMyPageController.md, pages/MyPage.md
- T0.11/T1.5 `docs/spec/`routes/search.md, services/searchService.md, components/file-manager/SearchBarResultsMode.md, hooks/{useSearchResults,useExplorerSession}.md, components/file-manager/FloatingSearchBar.md
- T0.12 `docs/spec/`store/{storage,executor}.md (target sections)
- T1.1/T1.4 `docs/spec/`infrastructure/{llmAdapter,llmPresets,vectorStore}.md
- T1.2 `docs/spec/`store/{embeddingsStore,embeddingsChunkStore,aiJobsStore}.md
- T1.3 `docs/spec/`services/aiJobService.md
- T1.6/T1.7/T1.8/T2.1-T2.5 `docs/spec/`services/{collectionsService,evolutionService,aiJobService}.md, store/aiTagStore.md, components/file-manager/MergeProposalCard.md
- T3.1/T3.1b/T3.2 `docs/spec/`routes/collections.md, services/{collectionsService,collectionShareService}.md, store/collectionsStore.md, components/dialogs/CollectionPropertiesDialog.md, components/mypage/content/SuggestionsChecklist.md (publish/leave + suggestion routes are flagged sync items there — write at T3.2/T3.3 docs step)
- T3.3 `docs/spec/`components/mypage/content/SuggestionsChecklist.md (+ file_suggestions store/route specs at its docs step)
- T3.4 `docs/spec/`services/searchService.md, routes/search.md, hooks/useSearchResults.md
- T3.5 `docs/spec/`store/actionJournalStore.md, hooks/{useFileOperations,useUndoToast}.md
- T3.6 `docs/spec/`routes/collections.md, services/collectionsService.md
- T4.1/T4.2/T4.3 `docs/spec/`infrastructure/{llmPresets,llmAdapter}.md, services/aiJobService.md, routes/admin.md, docs/SETUP.md + testing: docs/TESTING_STRATEGY.md (AI tiers)

## 8. Docs gate (per phase, before code — AGENTS §2.1)

New: `docs/features/collections-platform.md`; routes `docs/spec/server/routes/{collections,
search,actions}.md`; stores `.../store/{collectionsStore,fileLikesStore,actionJournalStore,
aiJobsStore, embeddingsStore, embeddingsChunkStore, aiTagStore}.md`; services
`.../services/{collectionsService,aiJobService,evolutionService,collectionShareService,
searchService}.md`; infrastructure
`.../infrastructure/{llmAdapter,llmPresets,vectorStore}.md` (+ budget-chain section in
llmAdapter.md) + `maintenanceScheduler.md` update; client
per-component/service specs (`docs/spec/client/services/collectionsRepository.md`, hooks,
components). Updates: `api.md`, `ARCHITECTURE.md` (§1.0 domain tree, §1.2 infra table),
`shared-contracts.md` (code blocks + enums + response-casing note per §6),
`TESTING_STRATEGY.md` (hermetic suites, E2E ID ranges), `SETUP.md` (LLM as T2/DB-row
config, preset table §4.23, Node ≥24 floor & sqlite driver note T0.12),
  `docs/features/client-ui.md` (virtual collections),
  `docs/features/config-source-resolution.md` (preset/wizard surface),
  `docs/spec/server/store/{storage,executor}.md` (node:sqlite driver),
  `docs/spec/server/store/repository-contract.md` if vec0 shadow / chunk rows change repo rules

## 9. P0 execution waves (execution ledger — overlay; §7 task rows/definitions unchanged)

> TDD per AGENTS §2.1 (docs → RED → GREEN → verify → merge). Status markers:
> `[todo]` → `[wip]` → `[done]`. Root ruling 2026-09-22: T0.2, T0.12, T0.7b, T0.11 are the
> dependency-free entry points. T0.1's remaining scope (boot completeness probe + failsafe
> row + repair backfill) depends on T0.2 (`admin_reports` DDL) and T0.8 (repair endpoint) →
> absorbed into Waves 1–2; its write-side is already implemented (content_hash DDL +
> commit-point population + tests verified in FileNodeRepository twins).

| Wave | Tasks (parallel) | Entry condition | RED-first test targets | Status |
| ---- | ---------------- | --------------- | ---------------------- | ------ |
| 0 | T0.2 ∥ T0.12 ∥ T0.7b (∥ T0.11 if capacity) | none (roots) | T0.2: 3 conformance twins + dual-dialect §5 table-presence; T0.12: node:sqlite driver + BigInt PK binding; T0.7b: en/ko i18n key mirror + settings/flags exposure | `[done]` — T0.11 carried into Wave 2 |
| 1 | T0.3 ∥ T0.6 ∥ T0.7 ∥ T0.8 (+ T0.1 absorbed) | T0.2 + T0.7b merged | T0.3: camelCase req / snake_case res + activity_score fallback sort; T0.8: NULL content_hash backfill idempotency | `[done]` |
| 2 | T0.4 ∥ T0.5 ∥ T0.9 ∥ T0.11 (carried from Wave 0) + pre-tasks: register (c) (failsafe-row consolidation, small `chore/`) and register (f) (test-infra leak fix, small `test/`) | T0.3 API surface (client) / T0.2 (T0.9) | component+hook tests; T0.9 hash-first dup (NULL never forms a group), derived tags v1 | `[todo]` |
| 3 | T0.10 → P0 exit gate | T0.9 + T0.7 + T0.8 merged | dashboard blocks per §4.16 | `[todo]` |

- **P0 exit gate**: full `npm run test:ci` (client+server) + `test:ci:pg:adapters` + all new
  conformance suites + E2E-COLLECTION-001 lifecycle & degradation matrix — then `ai-feature`
  carries the merged P0. (`ai-feature`→`dev` merge remains a single event after ALL §7 phases.)
- **Wave-1 provenance (2026-09-22)**: branch `feature/t08-admin-reports-repair` — T0.8 + the
  T0.1 remainder landed: `admin_reports` store (`server/store/adminReportsStore.js`,
  AdminReportsRepository sqlite/postgres twins + conformance), `GET /api/admin/reports(/:id)`
  + the kind/action-dispatched `POST /api/admin/reports/:id/repair` (`content_hash` NULL-hash
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
  not in `docs/IMPROVEMENT_PLAN.md`: (a) usage-event recording wiring rides the owning tasks
  — T0.5 like, T0.11 search_hit/list-entry-click, files-domain wiring for download/preview
  (Wave 2+); (b) upload/copy/restore `content_hash` write-side population rides the §4.1
  hook wiring in T1.3 (P1) — boot probe + backfill cover the gap meanwhile; (c) DONE 2026-09-22 (wave-2 pre-task):
  consolidated — startup row is now a single `kind='failsafe'` row whose payload merges the
  scan report and the section; (d) journal `subject_label` capture decided at T0.10 (Wave 3) when the feed
  renders member-op rows; (e) `is_tip` becomes per-subject server-side computation when
  T3.2 introduces cross-user writes (P3); (f) pre-existing test-infra leak —
  `migration.test.js` writes `data/webdav.db`, `createTestDatabase` cleanup can leave
  `WEA_SQLITE_PATH='undefined'` (stray `server/undefined` SQLite files) — wave-2 pre-task
  (`test/`).
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
