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
  (`like` signal — register (a)). — DONE 2026-09-23 on `feature/t05-file-collection-menus`
  (branch-local; register (a) like/download/preview recording landed). Orchestrator follow-ups:
  mount `app.use('/api/file-likes', setupModeGuardInstance, require('./domains/collections/fileLikesRoutes'))`
  in `server/index.js`; host wiring of the new callbacks (Add-to-collection/like rows,
  MemberRowControls into T0.4's `onMemberAction('menu')` seam, fileLikes client repository);
  `GET /versions/download` + `open` signals intentionally not recorded (deferred); bulk batch
  publish is P3; dialog AI tab (`ai_features`) P1 / member chips P3.
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
    persisted suggestion ids (T3.3), capacity-series seam (later task — block omitted), dup-finder
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
  (no AI surfaces exist in P0); its suite lands with T4.3 — owner confirmation requested,
  exit-gate text above written pre-wave-split. `ai-feature` now carries the merged P0.
  (`ai-feature`→`dev` merge remains a single event after ALL §7 phases.)
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
- **§11 follow-up 3 (2026-10-01, owner decisions — F4 report follow-up):** the two list-only
- **§11 follow-up 4 (2026-10-01, owner badge round):** card badges split by pin kind — auto-pin = PushPin+AutoAwesome
  composite (click unpin), user pin = plain PushPin (new `collectionsUserPin` key, click unpin, testid
  `card-userpin-chip-*`); received marker on cards switched to the generic `Share` glyph and the TREE's
  received icon swap was retired (plain Collections icon). Pending-color still awaiting owner choice.
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
