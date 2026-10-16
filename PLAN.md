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
  publish is P3; dialog AI tab (`ai_enrichments`) P1 / member chips P3.
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

- T1.0 Embedded embedding engine (owner decision 2026-10-14, PoC addendum §6.8 / AI_FEATURE_PLAN
  §4.2+§5): `model.lock.json` (repo/revision/files+sha256/dtype=q4) + `provision.js`
  (**provider-triggered per §22**: boot-BLOCKING only for a CONFIGURED boot where the built-in
  is the active embed provider — the first boot after the wizard is ordinary boot processing
  under the same posture; on remote-override clear the trigger
  runs in place, restart-free (embed `preparing`, jobs queue drains); CLI per-file progress
  log, atomic; `WEA_MODEL_DIR`/existing weights ⇒ zero egress; switching to remote never
  deletes weights; no ban-mode) + `clients/embedded-onnx` (transformers.js in-process, media via processor
  objects) + local positive-control probe + `llm_models.engine/precision/model_revision`
  (DDL 001 edited here; live/prod DB moves by the BIG-BANG script at the §6 merge/deploy —
  owner is the sole user, no compat path) + caps-off-on-failure path (§4.12).
- T1.0b Dead tag-surface purge (rides §19 dissolution): delete `tag_embeddings`/
  `tag_parents` DDL rows (big-bang script), the 11 zero-caller facade/repo methods
  (aiTagStore §2.1 purge-state note), their conformance scenarios, and llmPresets/
  profile θ_lo remnants; grep-gate `no tag_embeddings|tag_parents|getTagVectors|
upsertAutoParent references` across `server/` except the purge commit itself.
  RED-first: flip aiTagStore §2.6 grep assertions to expect absence, then delete.
- T1.1 LLM adapter (T2-hot: per-call config resolution, re-probe on change, restart-free
  §4.2) + budgets/breaker + startup probe + preset manifest & preset×capability probe-matrix
  verification (declared≠probed ⇒ capability off + admin warning, §4.23) + **EG2 model-pin
  enforcement: remote-embed activation requires the reference-kit conformance gate
  (§4.23.2, kit threshold calibrated via §10 Q12 runbook item; endpoint self-naming never
  consulted)** + wizard optional
  skippable AI step storing DB rows (§4.23.5) — embed role covered by T1.0 (built-in;
  wizard/step surface = chat/vision/asr + provisioning status card).
- T1.2 AI repos (`llm_models`,`embeddings`,`embeddings_chunk`,`ai_enrichments`,`ai_jobs`,
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
- T1.8 tag pipeline — **WITHDRAWN 2026-10-16 (§4.18 dissolved, PoC §6.9, PLAN §19)**: no
  `tag_embeddings` cache, no θ_tag/θ_lo, no parent-hint pass, no LLM-tag materialization.
  Slot kept for numbering continuity; derived local facets (`ai_tag_raw`) + string-equality
  predicates stay as-is from P0/T0.9.
- T1.9 media direct-embed pipeline (V1/V3 revived, owner 2026-10-08; §4.20 E1-M/§4.21,
  deps T1.1–T1.4): media-capability probes with positive controls (§4.23.2), §4.3 media
  chunk ladder (19 s audio windows / frame sampling under server ub), `media_direct`
  source rows + segment chunks, V2 caption-fallback path when media capability absent,
  backfill scope for media rows. Gated release-measurement of profile constants
  (§4.15 adoption checklist, Q10) rides the release runbook (`docs/SETUP.md`), NOT product
  code (§12.9 preset rule).

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
- T4.2 media ladder per §4.21 (revised 2026-10-08/14): **V0(ffprobe) + V1(image/video
  direct-embed) + V3(audio direct-embed + conditional ASR)** on the built-in q4 engine
  (batch-class on CPU; external GGUF+GPU server is the throughput override) + **V2(VLM
  captions)** as display/arbiter material and the media-caps-absent fallback — behind
  capability flags; V1
  image-embedding REVIVED 2026-10-08 (PoC §6) — the old RETIRED note is withdrawn; ASR scope
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
- T1.6/T1.7/T2.1-T2.5 `docs/spec/`services/{collectionsService,evolutionService,aiJobService}.md, store/aiTagStore.md (derived-facet scope), components/file-manager/MergeProposalCard.md
- T3.1/T3.1b/T3.2 `docs/spec/`routes/collections.md, services/{collectionsService,collectionShareService}.md, store/collectionsStore.md, components/dialogs/CollectionPropertiesDialog.md, components/mypage/content/SuggestionsChecklist.md (publish/leave + suggestion routes are flagged sync items there — write at T3.2/T3.3 docs step)
- T3.3 `docs/spec/`components/mypage/content/SuggestionsChecklist.md (+ file_suggestions store/route specs at its docs step)
- T3.4 `docs/spec/`services/searchService.md, routes/search.md, hooks/useSearchResults.md
- T3.5 `docs/spec/`store/actionJournalStore.md, hooks/{useFileOperations,useUndoToast}.md
- T3.6 `docs/spec/`routes/collections.md, services/collectionsService.md
- T4.1/T4.2/T4.3 `docs/spec/`infrastructure/{llmPresets,llmAdapter}.md, services/aiJobService.md, routes/admin.md, docs/SETUP.md + testing: docs/TESTING_STRATEGY.md (AI tiers)

## 8. Docs gate (per phase, before code — AGENTS §2.1)

**State-only rule (restated; recurs since 2026-10-14):** `docs/spec/**` and
`docs/features/**` carry decided/implemented STATE only — dated rulings, rationale,
retracted proposals, and "why we changed" narratives live ONLY in AI_FEATURE_PLAN (design
authority) and this ledger / PoC addenda (AGENTS §2.1.5, AI_FEATURE_PLAN §12 preamble).
Mechanical sweep — **codified** since 2026-10-15 as `server/__tests__/docsStatePurity.test.js`
(runs inside `cd server && npm run test:ci`): rejects `2026-1[01]-dd`, `dissolv`, `retir`,
`withdraw`, `supersed`, `initially proposed`, `purge state`, `pending T[0-9]`, task provenance
(`T0.N`-style), `AI_FEATURE_PLAN`/`PLAN.md` pointers, `ruling`, rationale clauses,
`owner`-attributions in prose, plus a §-citation resolver (qualified pointers must match a
numbered heading in the named file; bare pointers must resolve against any repo heading).
`(target)`/`out of scope`/`deliberate` markers are WARN-tier (printed, not failing) —
target-contract notation, judged by eye. Provenance lifted out of specs lands in
AI_FEATURE_PLAN §12.

New: `docs/features/collections-platform.md`; routes `docs/spec/server/routes/{collections,
search,actions}.md`; stores `.../store/{collectionsStore,fileLikesStore,actionJournalStore,
aiJobsStore, embeddingsStore, embeddingsChunkStore, aiTagStore}.md`; services
`.../services/{collectionsService,aiJobService,evolutionService,collectionShareService,
searchService}.md`; infrastructure
`.../infrastructure/{llmAdapter,llmPresets,vectorStore}.md` (+ budget-chain section in
llmAdapter.md; embedded provider contract + `model.lock.json` schema + provisioning/
failure-path in llmPresets.md/llmAdapter.md — T1.0 docs step) + `maintenanceScheduler.md` update; client
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
- **§11 follow-up 3 (2026-10-01, owner decisions — F4 report follow-up):** the two list-only
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
tag θ_lo/ortho band (measured in §6.5 — feature since dissolved, §19), char→token factor (1.7 was bge-m3), media token rates/segment windows,
query-embed latency profile (informational — the <100 ms class gate is deleted by the §20
owner ruling 2026-10-15). E3 recall@20
must be re-run with TRUE image queries (no captions) against the wedding ground-truth tree
before the caption-path 0.829 baseline is replaced.

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
