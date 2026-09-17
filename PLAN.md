# PLAN.md — AI-Driven Storage: Task Graph

> **Design authority: `AI_FEATURE_PLAN.md`.** Invariants (§2), domain model & lifecycles (§3),
> behavior specs (§4.x), schema (§5), rejections/extension points (§9–§10) live there —
> **read it before implementing any task below; task rows reference its sections by number.**
> This file carries only: work units + deps + verification + binding conventions (§6–§8).
> At execution start, content graduates per AGENTS.md §2.1 docs-first into
> `docs/features/collections-platform.md` + specs (§8 docs gate) and this graph shrinks.

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
  responses follow `CODING_STYLE.md` Express Patterns (snake_case) — but the repo is mixed in
  practice (file listing returns `nodeId`), so each new endpoint's response casing is decided
  in the docs step against the adjacent domain's actual payloads and recorded in `api.md`.
  SQL snake_case maps to camel domain objects at the repository boundary.
- **Domain layout** (recentFiles precedent): `server/domains/<camelCaseDomain>/{routes.js,
service.js, __tests__/}`; route handlers via `asyncHandler`; service throws bare string
  codes translated by route-level `ERROR_MAP`/`mapServiceError`; per-router
  `authenticateToken, requireUser`; mount in `server/index.js` **after** the app-level
  migrationGate middleware and with `setupModeGuardInstance` (coverage invariant,
  ARCHITECTURE §1.3) on a kebab-case plural path `/api/collections`.
- **Persistence**: no SQL outside repositories — interface `server/store/repositories/`
  `<Plural>Repository.js` + `sqlite/`+`postgres/` twins + `<Plural>Repository.conformance.
test.js`; store facade `server/store/<plural>Store.js` thin dialect dispatch on
  `storage.getExecutor()`. New tables append to the numbered DDL chain
  (`002_collections.sql`, `003_ai.sql`): TEXT+CHECK enums, `<table>_<purpose>` indexes,
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
- **Config keys**: connection secrets T0 presence-block (`WEA_DB_*` precedent); runtime
  knobs T2 (+dbOnly where DB-editable). No new secret encryption anywhere (settings are
  plaintext by decision; `secret:true` = UI masking only).
- **Numeric constants (PoC, 2026-09-16)**: every AI threshold (θ_dup, edge cos tiers,
  ef_search, char/token safety factor, reasoning on/off) is a **release artifact measured
  by the project on its own reference set** — shipped in per-model profiles, displayed in
  admin with provenance, NEVER computed at runtime from user data and never a shipped
  dataset. `ef_search=400` fixed (external-query recall). Arbiter/keeper prompts always
  carry symmetric-difference inputs. vec0: BigInt PKs, oversample→filter (no join-KNN).
  All chat roles reasoning-off by default; probes use in-domain samples only.
- **Verification gates**: `npm run test:ci` (+ `test:ci:pg:adapters` for repository twins);
  CI grep-gate: `domains/(collections|ai)/**` and new stores contain zero
  `CacheAdapter|operationProgress` imports; conformance suite per new repository; E2E for
  lifecycle (create→digest→archive→undo→restore→purge) and degradation matrix.

## 7. Task graph (phases; deps in parentheses)

### P0 — Non-AI foundation (shippable alone)

- T0.1 `content_hash`: live DB already 100% populated (PoC §2.2) — verify at boot
  (migration-state check), consume for exact-dup/dedup paths; write-side population only
  where empty.
- T0.2 collections tables + repos + facades (§5 lines `collections*`, `file_likes`,
  `collection_digest_cursors`, `collection_visibility`) — `002_collections.sql`.
- T0.3 Collections CRUD API `/api/collections` (§3.1/§3.2 ops; activity-sort graceful
  fallback) + route spec + integration tests.
- T0.4 Sidebar `__collections__`/`__archive__` + list view + card menus (client per §6).
- T0.5 File-side: `컬렉션에 추가` submenu (context+multi-select), member-row controls
  (§3.2 exact set), like toggle everywhere.
- T0.6 `usage_events` + nightly rollup in maintenanceScheduler + activity score fn.
- T0.7 `action_journal` infra + `commitChange` + TX/lock discipline (writers v1 =
  collections only) + `GET /api/actions` + snackbar/30d-feed UI.
- T0.7b existing-infra edits (§4.14 Tier A plumbing incl. `admin_reports`, gcService tier
  add-ons, registry keys, probeLlm slot, error codes + locales, settings/public ai flags,
  SystemConfigEditor whitelist fix, WEA_SKIP test seams).
- T0.8 admin reports endpoints + render + row repair actions via existing
  `repair-sync`/`perm-delete`.
- T0.9 LLM-free items pulled from AI-phases: exact-dup finder (**hash-first — cosine 1.0
  detection redundant, PoC §2.2/E2**), local derived tags (mime/ext/month/path/EXIF),
  stored digest banner, cosine-free rule evaluation (path/tag/like predicates incl.
  upload-hook rule check).
- T0.10 user dashboard `저장공간` v1 (hygiene: exact dups, trash, journal feed,
  collections status) — no AI blocks yet.
- T0.11 server-wide **name search** + results-mode UI + two-section rendering with
  client-side highlight (LLM-free §4.6 stage; semantic section lands as P1 add-on).
- T0.12 **sqliteExecutor driver migration** `sqlite3` npm → `node:sqlite` (Node ≥24 floor;
  confined to the seam per §6; behavior suite green on both drivers; BigInt PK binding
  convention documented) — prerequisite for T1.4 native sqlite vector path.

### P1 — Embeddings + semantic search

- T1.1 LLM adapter + budgets/breaker + probes + boot wiring (§4.2/§4.3) + \*\*preset manifest
  (§4.23) and preset×capability probe-matrix verification (declared≠probed ⇒ capability off
  - admin warning)\*\*.
- T1.2 `003_ai.sql` (`llm_models`,`embeddings`,`embeddings_chunk`,`ai_features`,`ai_jobs`,
  `ai_usage_daily`) - repos + restart-survival test.
- T1.3 jobs worker (claim per dialect, backoff, lockManager, seam, hooks §4.1).
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
  chip, grant UI in props tabs, leave (§4.7).
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

## 8. Docs gate (per phase, before code — AGENTS §2.1)

New: `docs/features/collections-platform.md`; routes `docs/spec/server/routes/{collections,
search,actions}.md`; stores `.../store/{collectionsStore,fileLikesStore,actionJournalStore,
aiJobsStore,embeddingsStore}.md`; services `.../services/{collectionsService,aiJobService,
evolutionService,collectionShareService,searchService}.md`;
infrastructure `.../infrastructure/llmAdapter.md` (+ `llmPresets.md` §4.23) +
`maintenanceScheduler.md` update; client
per-component/service specs (`docs/spec/client/services/collectionsRepository.md`, hooks,
components). Updates: `api.md`, `ARCHITECTURE.md` (§1.0 domain tree, §1.2 infra table),
`shared-contracts.md` (code blocks), `TESTING_STRATEGY.md` (hermetic suites, E2E ID ranges),
`SETUP.md` (LLM env block + preset table §4.23 + Node ≥24 floor & sqlite driver note
T0.12), `docs/features/client-ui.md` (virtual
collections), `docs/features/config-source-resolution.md` (preset/wizard surface),
`docs/spec/server/store/storage.md` if T0 presence semantics extend.
