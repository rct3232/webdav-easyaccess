# PLAN.md — AI-Driven Storage: Task Graph

> **Design authority: `AI_FEATURE_PLAN.md`.** Invariants (§2), domain model & lifecycles (§3),
> behavior specs (§4.x), schema (§5), rejections/extension points (§9–§10) live there —
> **read it before implementing any task below; task rows reference its sections by number.**
> This file carries the active task graph, binding conventions (§6–§8), and the
> execution-ledger index; completed phase logs and execution plans (§9–§33) live in
> [`PLAN_EXECUTION.md`](PLAN_EXECUTION.md). Detailed product design remains in
> `AI_FEATURE_PLAN.md`. Graduation status (2026-09-17, commits 34ee64c→76ae679): the §8
> docs gate is DONE — `docs/features/collections-platform.md` + the full
> `docs/spec/**` contract suite are published and binding. Preserve completed execution
> evidence; update the current-state summary and annotate superseded snapshots instead
> of deleting history.

## Current status (2026-10-31)

| Area                    | Status         | Current disposition                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0–P3                   | `[done]`       | Closed on `ai-feature`; see [`PLAN_EXECUTION.md`](PLAN_EXECUTION.md) §§9, 28–30.                                                                                                                                                                                                                                                                                                                                                                        |
| P4 feature work         | `[done]`       | T4.1, T4.3 (Wave 1 harness/matrix + Wave 2 AI-002/parser re-pin), T4.4, the §4.22 delta-semantics SQL leg (D3), and D2 are merged on `ai-feature`; see [`PLAN_EXECUTION.md`](PLAN_EXECUTION.md) §33.10. Per-user top-N is deferred to a post-T4.4 unit. Wave 0 cleanups are closed (§33.7). T4.2 is closed as absorbed by §28.8 D2–D4 with residue re-pointed (§33.1 D1).                                                                               |
| P4 Wave 1 decisions     | `[done]`       | Owner rulings recorded in [`PLAN_EXECUTION.md`](PLAN_EXECUTION.md) §33.8: full text+media launcher; storage usage with trash + version history; fake-embed matrix; `cancelled` job status + cancel-pending inverse; hardcoded gates hidden; preceding DDL branch.                                                                                                                                                                                       |
| Preceding DDL           | `[done]`       | `chore/ai-job-cancelled-status` merged (`dfa6a51e`); see [`PLAN_EXECUTION.md`](PLAN_EXECUTION.md) §33.9. `ai_jobs.status='cancelled'` is available for T4.1.                                                                                                                                                                                                                                                                                            |
| P4 bulk-poll resilience | `[done]`       | T4.5–T4.10, T4.12, and T4.6b are recorded complete in [`PLAN_EXECUTION.md`](PLAN_EXECUTION.md) §32.1; T4.11 was dropped; T4.13 gates are recorded green there.                                                                                                                                                                                                                                                                                          |
| Pre-merge carry-forward | `[deferred]`   | Hysteresis calibration moved to post-release calibration by owner ruling 2026-10-30 ([`PLAN_EXECUTION.md`](PLAN_EXECUTION.md) §33.11): the provisional `{ inDelta: 0.02, outDelta: -0.02 }` ships as the first release artifact and is re-measured after the platform has run evolution/reconcile on operational data. The §4.22 SQL leg (D3), `JOURNAL_DOMAIN.TAGS` removal (D2), Wave 0 items, and the E2E release matrix are closed (§33.7, §33.10). |
| Post-P4 UI/UX hardening | `[done]`       | Storage domain split + usage feature, file-list badge removal, merge recommendation redesign, collection properties draft/atomic save, FileProperties AI tab, admin AI parity, and AI/storage UI E2E are merged; see [`PLAN_EXECUTION.md`](PLAN_EXECUTION.md) §34.                                                                                                                                                                                      |
| Test-count pin          | `[done]`       | Current run: server **206 suites passed / 3499 tests passed** (+28 skipped; 207 suites / 3527 total), client **198 suites / 2401 tests passed**; real-PostgreSQL adapter leg **32 suites / 492 passed + 1 skipped**; E2E default **278 total** (model-on 272/6, model-free 271/7), WebDAV 41/0. Pins recorded in `server/TEST_SUMMARY.md`, `client/TEST_SUMMARY.md`, and [`PLAN_EXECUTION.md`](PLAN_EXECUTION.md) §34.                                  |
| P4 exit gate            | `[wip]`        | Code units, repository/client suites, and all release-matrix legs are green; the pre-closure record is [`PLAN_EXECUTION.md`](PLAN_EXECUTION.md) §33.11 and the hardening closure is §34. Final status flips and the single `ai-feature` → `dev` merge are intentionally not performed pending owner go-ahead.                                                                                                                                           |
| `ai-feature` → `dev`    | `[not merged]` | Pre-closure only. All code units and gates are green; the release merge awaits the owner's exit-gate go-ahead.                                                                                                                                                                                                                                                                                                                                          |

**Status convention:** `[todo]` = not started; `[wip]` = in progress; `[done]` = complete;
`[open]` = approved work remains; `[deferred]` = intentionally carried to a later trigger or
phase; `[dropped]` = no longer in scope; `[needs-decision]` = owner ruling required; and
`[needs-reconciliation]` = records or scope disagree. `[not merged]` describes the release
state, not a task. Dated execution logs are point-in-time evidence; the latest closure record
and this summary determine current status. Do not choose a test total without run evidence.

**Open work detail:** the P4 execution plan (owner rulings, waves, gates) is
[`PLAN_EXECUTION.md` §33](PLAN_EXECUTION.md); §32.3 remains the accountable-role and
exit-condition record it supersedes.

## Branching & merge policy (binding — overrides AGENTS.md §2.2 step "merge to dev" for this workstream)

- Chain: `dev` → **`ai-feature`** → per-task branches (`feature/…`, `fix/…`, `test/…`,
  `chore/…` derived from `ai-feature`).
- Every task branch merges back into **`ai-feature` only**. Direct merges of this
  workstream's branches into `dev` are FORBIDDEN.
- **`ai-feature` → `dev` merge happens exactly once, when every active task in §7 and its
  later execution-plan overlays is complete** and the applicable verification gates (§6/§8)
  have passed; it follows the normal PR flow. Until then
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
  numbered chain resumes at `002_…` only after the platform merge. No ALTERs in the tracked
  `001` file. Single-file ownership keeps cross-file FK ordering (declare `llm_models` before
  `collection_centroids`); one DDL owner lands at a time (Wave 1 uses the preceding
  `chore/ai-job-cancelled-status` unit before T4.1/T4.4/T4.3 dispatch). The file stays
  `convertPostgresToSqlite`-compatible. Development DBs are ephemeral, so `001` is edited
  directly there. The file is checksum-tracked: an edited already-applied file fails boot
  fast by design — the standing one-liner (`DELETE FROM _schema_migrations WHERE
  filename='001_initial_normalized_schema.sql'`, then boot re-applies) is a recovery escape
  hatch, not a migration path; existing-table CHECK/column changes are applied by the
  deployment-owned production migration at the single `ai-feature`→`dev` merge/deploy.
  TEXT+CHECK enums,
  `<table>_<purpose>` indexes,
  `created_at/updated_at TIMESTAMPTZ DEFAULT NOW()`. **Derived vector artifacts (pgvector
  shadow table, sqlite vec0 virtual table) are created/managed by the vectorStore adapter —
  never part of the tracked DDL chain (§4.13).** **sqlite driver: `node:sqlite` (Node ≥24
  floor; T0.12 replaces the `sqlite3` driver across the executor/storage, metadata-migration,
  schema-init, and metadata-presence call sites, not only `db/sqliteExecutor.js` — see the
  scope correction in `PLAN_EXECUTION.md` §9); vec0 integer
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
- T0.12 **SQLite driver migration** `sqlite3` npm → `node:sqlite` (Node ≥24 floor; covers
  `db/sqliteExecutor.js`, `store/storage.js`, `metadataMigrationService.js`,
  `sqliteSchemaInit.js`, and `metadataPresence.js` per the scope correction in `PLAN_EXECUTION.md` §9; behavior
  suite green on both drivers; BigInt PK binding convention documented) — prerequisite for
  T1.4 native sqlite vector path.

### P1 — Embeddings + semantic search

- T1.0 Embedded embedding engine (owner decision 2026-10-14, PoC addendum §6.8 / AI_FEATURE_PLAN
  §4.2+§5): `model.lock.json` (repo/revision/files+sha256/dtype=q4) + `provision.js`
  (**provider-triggered per `PLAN_EXECUTION.md` §22**: boot-BLOCKING only for a CONFIGURED boot where the built-in
  is the active embed provider — the first boot after the wizard is ordinary boot processing
  under the same posture; on remote-override clear the trigger
  runs in place, restart-free (embed `preparing`, jobs queue drains); CLI per-file progress
  log, atomic; `WEA_MODEL_DIR`/existing weights ⇒ zero egress; switching to remote never
  deletes weights; no ban-mode) + `clients/embedded-onnx` (transformers.js in-process, media via processor
  objects) + local positive-control probe + `llm_models.engine/precision/model_revision`
  (DDL 001 edited here; live/prod DB moves by the BIG-BANG script at the §6 merge/deploy —
  owner is the sole user, no compat path) + caps-off-on-failure path (§4.12).
- T1.0b Dead tag-surface purge (rides `PLAN_EXECUTION.md` §19 dissolution): remove the 11 zero-caller
  facade/repo methods (aiTagStore §2.1), their conformance scenarios, and llmPresets/profile
  θ_lo remnants; the retired table definitions were removed directly from
  `001_initial_normalized_schema.sql` (no big-bang script, per `PLAN_EXECUTION.md` §31.5). Grep-gate runtime code
  for zero `tag_embeddings|tag_parents|getTagVectors|upsertAutoParent` references; explicit
  DDL-parity and absence-assertion tests are allowed to name the retired symbols. RED-first:
  flip aiTagStore §2.6 assertions to expect absence, then delete. **DONE 2026-10-28:** merge
  `e704cc71`, log `PLAN_EXECUTION.md` §31.5.
- T1.1 LLM adapter (T2-hot: per-call config resolution, re-probe on change, restart-free
  §4.2) + budgets/breaker + startup probe + preset manifest & preset×capability probe-matrix
  verification (declared≠probed ⇒ capability off + admin warning, §4.23) + **EG2 model-pin
  enforcement: remote-embed activation requires the reference-kit conformance gate
  (§4.23.2, kit threshold calibrated via AI_FEATURE_PLAN §10 Q12 runbook item; endpoint self-naming never
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
- T1.8 tag pipeline — **WITHDRAWN 2026-10-16 (§4.18 dissolved, PoC §6.9, `PLAN_EXECUTION.md` §19)**: no
  `tag_embeddings` cache, no θ_tag/θ_lo, no parent-hint pass, no LLM-tag materialization.
  Slot kept for numbering continuity; derived local facets (`ai_tag_raw`) + string-equality
  predicates stay as-is from P0/T0.9.
- T1.9 media direct-embed pipeline (V1/V3 revived, owner 2026-10-08; §4.20 E1-M/§4.21,
  deps T1.1–T1.4): media-capability probes with positive controls (§4.23.2), §4.3 media
  chunk ladder (audio windows use the provider/model-window formula; video samples at 1 fps
  under the applicable model window), `media_direct` source rows + segment chunks, V2
  caption-fallback path when media capability is absent, and media-row backfill scope. Gated
  release measurement of profile constants (§4.15 adoption checklist, Q10) rides the release
  runbook (`docs/SETUP.md`), not product code (AI_FEATURE_PLAN §12.9 preset rule).

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
- T3.3 `storage_suggestions` rule variant + accept/undo (`thetaDup` is read from the active
  profile; EG2 is 0.955, not the superseded generic 0.97), short-doc cosine exception,
  §4.17; dashboard AI-block appears when embed is configured (§4.12); vector variant rides
  T1.7.
- T3.4 NL parser (chat) → shared predicate grammar + `query_parses` cache. Output contract
  must be additively extendable to §4.22 delta semantics (`add|replace|exclude|$ref`)
  without redefinition — conversation itself is NOT a task here.
- T3.5 batch worker journal subscription + honor `job.cancelled` per item.
- T3.6 `POST /api/collections/for-nodes` membership chips (file-listing contracts frozen).

### P4 — Admin & scale

- T4.1 admin AI tab (pipeline/cost/governance/models, config-backed gate impact preview,
  settings journal) + the ONE full text+media re-embed launcher (rate-limited, confirm
  dialog, cancel-pending inverse; hardcoded gates hidden) (§4.15, §33.8).
- T4.2 media ladder **[done — absorbed 2026-10-29, §33.1 D1]** per §4.21 (revised 2026-10-08/14):
  D2–D4 delivered the probes, direct-embed pipelines, fallbacks, and backfill scope
  (`PLAN_EXECUTION.md` §28.8); reconciled 2026-10-29 as absorbed with the residue re-pointed
  to T4.1 (launcher/rate limit) and T4.3 (media E2E/degradation matrix). The original scope was **V0(ffprobe) + V1(image/video
  direct-embed) + V3(audio direct-embed + conditional ASR)** on the built-in q4 engine
  (batch-class on CPU; external GGUF+GPU server is the throughput override) + **V2(VLM
  captions)** as display/arbiter material and the media-caps-absent fallback — behind
  capability flags; V1
  image-embedding REVIVED 2026-10-08 (PoC §6) — the old RETIRED note is withdrawn; ASR scope
  freeze: transcript + probe meta only — no genre/desc (E13), escape-prompt mandatory,
  `media_kind=music` transcript excluded from content scoring; frames/transients never
  persisted; image near-dup = caption-space distance (weaker vs reencode — accepted).
- T4.3 e2e hermetic AI suite (in-process fake embed+chat via adapter injection; AI-001
  remains the real-EG2 case; scratch project port; smoke-list update) + degradation-matrix
  suite.
- T4.4 dashboard storage usage series (P4): per-user daily `storage_usage_snapshots`
  (live + trash + version history via `object_map.size`), daily scheduler, gateway
  `loadStorageUsageSeries()`, and the Storage sparkline + tests. No data ⇒ the block is
  omitted; no fabricated series.

### 7.1 Contract-spec references (mandatory)

**Every task below MUST be implemented against its contract specs — read them first; a
mismatch with §7.1 files is a bug in whichever side is newer (docs-first: fix the spec in
the same PR).** AI_FEATURE_PLAN.md sections carry their own "Contract specs" lines; this
map is the task-row view. The original §7.1 contract-spec set was written by the §8 docs
gate (2026-09-17); later task overlays add their spec references below, with new contracts
created in the task's docs-first step. Path prefixes are implicit:
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
- T0.11/T1.5 `docs/spec/`routes/search.md, services/searchService.md, components/file-manager/SearchQueryChipBar.md, hooks/{useSearchResults,useExplorerSession}.md, components/file-manager/FloatingSearchBar.md
- T0.12 `docs/spec/`store/{storage,executor}.md (target sections)
- T1.1/T1.4 `docs/spec/`infrastructure/{llmAdapter,llmPresets,vectorStore}.md
- T1.2 `docs/spec/`store/{embeddingsStore,embeddingsChunkStore,aiJobsStore}.md
- T1.3 `docs/spec/`services/aiJobService.md
- T1.6/T1.7/T2.1-T2.5 `docs/spec/`services/{collectionsService,evolutionService,aiJobService}.md, store/aiTagStore.md (derived-facet scope), components/file-manager/MergeProposalCard.md
- T3.1/T3.1b/T3.2 `docs/spec/`routes/collections.md, services/{collectionsService,collectionShareService}.md, store/collectionsStore.md, components/dialogs/CollectionPropertiesDialog.md, components/mypage/content/SuggestionsChecklist.md (publish/leave + suggestion routes are flagged sync items there — write at T3.2/T3.3 docs step)
- T3.3 `docs/spec/`components/mypage/content/SuggestionsChecklist.md (+ storage_suggestions store/route specs at its docs step)
- T3.4 `docs/spec/`services/searchService.md, routes/search.md, hooks/useSearchResults.md
- T3.5 `docs/spec/`store/actionJournalStore.md, hooks/{useFileOperations,useUndoToast}.md
- T3.6 `docs/spec/`routes/collections.md, services/collectionsService.md
- T4.1/T4.2/T4.3 `docs/spec/`infrastructure/{llmPresets,llmAdapter}.md, services/aiJobService.md, routes/admin.md, store/aiJobsStore.md, store/actionJournalStore.md, routes/actions.md, client/components/mypage/content/AiAdminContent.md, docs/SETUP.md + testing: docs/TESTING_STRATEGY.md (AI tiers)
- T4.4 docs-first adds the storage-usage contract: `docs/spec/server/store/storageUsageSnapshotsStore.md`
  (new), `docs/spec/server/routes/storage.md`, `docs/spec/server/infrastructure/maintenanceScheduler.md`,
  `docs/spec/server/infrastructure/configRegistry.md`, `docs/api.md`,
  `docs/spec/client/services/explorerGateway.md`, and
  `docs/spec/client/components/mypage/content/CollectionDashboard.md`.
- T4.5–T4.10 `docs/spec/client/hooks/useBulkOperations.md`,
  `docs/spec/client/components/file-manager/FileOperationProgress.md`,
  `docs/features/client-ui.md`; T4.6b `docs/spec/server/routes/files.md`;
  T4.12 `docs/E2E_COVERAGE_PLAN.md` + `docs/TESTING_STRATEGY.md`; T4.13
  `docs/TEST_GIT_GUIDE.md` (release-gate procedure). T4.11 is dropped.

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

## Execution ledger map

Completed execution ledgers are preserved verbatim in
[`PLAN_EXECUTION.md`](PLAN_EXECUTION.md):

| Sections | Contents                                                                                    |
| -------- | ------------------------------------------------------------------------------------------- |
| §9–§15   | P0 execution waves, UI polish, refactors, admin-operator pivot, P0 closeout                 |
| §16–§28  | Embedding adoption, built-in engine, tag dissolution, search UI/E2E, P1 waves, Wave C audit |
| §29–§30  | P2 and P3 execution plans and exit gates                                                    |
| §31–§32  | Post-P3 remediation, release evidence, bulk-polling resilience, remaining P4 work           |
| §33      | P4 execution plan: owner rulings, waves, gates, §32.3 disposition                           |

Section numbers are stable identifiers. Code comments and historical records may
cite `PLAN §N`; for N ≥ 9, read the matching section in `PLAN_EXECUTION.md`.
