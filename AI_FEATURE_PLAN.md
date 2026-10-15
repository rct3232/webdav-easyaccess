# AI_FEATURE_PLAN.md — AI-Driven Storage: Design & Behavior Reference

Companion to `PLAN.md` (task graph, conventions §6–§8 there). Task rows reference the
sections below by §number; file:line anchors are verified seams in the current code.

## 1. Purpose & framing

Turn the app from a storage web client into an **AI-driven storage management application**.
Differentiator: backend-agnostic layer (WebDAV remote or S3, sqlite or PG, any LLM provider
incl. fully local Ollama) — competitors are hardware/cloud-locked. Scope refinement
(2026-10-14, owner): **embedding is model-pinned to EG2** — provider breadth applies to the
_generation_ roles (chat/vision/asr) and to the embed _transport_ (built-in vs external
endpoint), not to the embed _model_; both embed paths must pass the EG2 conformance gate
(§4.23.2).

Positioning fact that shapes everything: **LLM is an enrichment dependency, never a render
dependency.** The collection platform (P0) ships and is useful with zero LLM configured.

## 2. Core invariants (do not relitigate; each was decided with rationale)

1. **View by collection, mutate by file.** Collection grants give list/preview/**download**
   only. Rename/move/delete/rename of file nodes NEVER happen through a collection.
   `collection_grants` is a separate table domain: never written to or read by `aclService`,
   `permissionStore`, permission caches, or `__shared__` (ARCHITECTURE §1.4 model untouched).
2. **Exposure expansion is always explicit.** No automation ever shares a file/collection.
   (User-confirmed carve-out: the only consent prompt allowed in the silent model.)
3. **Silent evolution applies only to `origin='system'` collections.** Auto-create/split/
   archive/soft-delete never touch `user|seed|search` origin objects (they lack the
   re-derivability that justifies silent deletion for system ones). They get ordering gravity
   only.
4. **Undo journal replaces proposal-inboxes.** System acts silently; every act is journaled
   with an inverse; the UI safety valve is undo, not pre-approval. Merge is the sole
   exception: merges are PROPOSED (user veto over destroying a named object), via in-context
   cards (see §4.4) — never a notifications center.
5. **User-triggered destructive/change actions get one confirmation dialog; system actions
   get none but are journaled.** ("Seed create" and "search→save collection" are
   user-triggered → confirm dialog with member preview. User delete/archive of collections:
   archive→permanent-delete 2-step, trash-parity.)
6. **Membership: derived, not stored — except manual membership.** Rule/seed/search/centroid
   collections evaluate definitions (upload hook, O(definitions) cosine); `origin='user'`
   collections store rows in `collection_items`. View = `stored ∪ derived − exclusions`.
   Rationale: trash/purge/permission changes propagate for free; undo stays small.
7. **Naming has two implementors, template first.** `templateNamer` (collections domain,
   deterministic, locale-string based) is default and FINAL; `llmNamer` (ai domain) replaces
   it only for new creations once chat is configured; never renames existing (`name_locked`).
8. **No new state in CacheAdapter** — AI/collection state is DB-backed by
   design). Enforced by grep-gate in CI (§6 verification).
9. **Likes are per-file, viewer-scoped:** `file_likes(user_id,node_id)`; the heart reflects
   the CURRENT VIEWER'S OWN like only, identical across all collections for that file.
   Other users' like states, counts, and any aggregate of likes are never displayed anywhere
   (shared views included).
10. **Permanent delete-from-archive is unrecoverable** (trash-parity contract): journal rows
    are cascade-purged, except a 1-row `collection_tombstones` (system-origin only) that
    blocks silent regeneration of the same definition for its retention window.
11. **Request-path LLM rule (generalized):** no LLM call blocks a request; the allowed
    exception family is **explicitly user-initiated interactive roles only** — query embed
    (E2, now), `parse.nl` (T3.4), and (future) content-Q&A/RAG — each with mandatory cache,
    kill-switch and no-LLM fallback (§4.22). Enrichment, batch adjudication, naming and
    arbiters are NEVER on request paths (vision-model request-path calls explicitly banned).

## 3. Domain model & lifecycles

### 3.1 Collection

- `origin`: `system` (silent generator, split child) | `user` (manual)
  | `seed` (right-click "collect similar") | `search` (semantic query saved).
- `status`: `active` | `archived`. Lifecycle:
  `active →(auto by activity gates | manual, confirm 1) archived →(restore | permanent
delete, archived-only, confirm 1) gone`. Permanent delete lives ONLY on cards inside
  `__archive__`. Auto expiry: archived rows older than `ARCHIVE_RETENTION_DAYS` are purged by
  the GC pass (soft-delete parity with `TRASH_RETENTION_DAYS`).
- Sidebar: `__collections__` virtual node (folder-tree precedent `__recent__`/`__shared__`/
  `__trash__`), depth=1: expanding shows the collection list; no tree-walking into members.
  `__archive__` is a virtual child node that auto-contains every `status=archived`
  collection (no separate archive screen, no per-collection button). Shared-with-me
  collections appear in the same activity-sorted list distinguished only by an icon chip
  (never pinned to top).
- List sort options (collection list view): `activity (default) | name | created | updated |
similar` (similar = centroid cluster grouping with group headers, not one path order;
  centroid from §4.9; greedy nearest-neighbor over ≤~20 rows in JS). Sidebar tree order is
  fixed `activity`.
- `publish_mode` per collection: `ask` (B, **default**) | `off` (A) | `auto` (C) — governs
  ONLY members that would enter a _live-shared_ view (see §4.7). Enabling sharing itself
  remains the explicit act; within a shared collection, `ask` parks new members in the
  pending-publish banner.
- Name uniqueness: partial-unique per owner over active; collision → suffix counter
  (reuse the trash-restore suffix precedent).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/routes/collections.md`, `docs/spec/server/store/collectionsStore.md`, `docs/spec/client/hooks/useCollections.md`, `docs/spec/client/components/file-manager/CollectionsListView.md`

### 3.2 Members

- Stored rows: `collection_items (collection_id, node_id, added_by, published bool)`.
  Both FKs CASCADE (recent_files precedent, DDL 001 `recent_files` table). Removal = membership only,
  NEVER trashes the node.
- Derived membership: evaluated from `definition` (predicates: path-prefix/tag/like/date/
  size; and/or vector-similarity to `seed_vector`/centroid) — no stored rows.
  - **View-weighted scoring**: inclusion is decided by predicate-bool or similarity ≥ θ;
    for similarity definitions the score gets a soft usage boost
    `score = cosine × (1 + α·log10(1+views))` (α T2, default 0.1; views = per-user
    `node_activity` rollup). The boost moves BORDERLINE BAND members (θ±δ) and ordering
    only — it can never drop a clear match nor admit a weak one; cold files ≈ ×1.0.
    Requires **hysteresis** θ_in > θ_out on the same definition so drift in view counts
    doesn't flip membership every night (enter above θ_in, leave below θ_out; tag/path/
    date predicates are bool and unaffected). Cost: rollup join at evaluation (rows already
    cached per user; negligible vs the cosine itself).
  - **Tag predicate = folded string equality over `ai_tag_raw` — and `ai_tag_raw` holds
    ONLY derived facets** (kind-prefixed `mime:`/`ext:`/`month:`/`path:`, §4.10). LLM tags
    (`ai_enrichments.tags`) never enter rules: descriptive material only (§4.18, dissolved
    2026-10-16). The former vector-matched tag predicate (`θ_tag`, `tag_embeddings`) is
    RETIRED — semantic expansion lives in document/media-vector collections (§4.5/§4.6),
    never in tag-string fuzzy.
- `collection_exclusions (collection_id,node_id)`: applies to derived members only
  ("Exclude" on an auto-added file = block for this definition). Exclusion = **touch** →
  auto-pins (§4.9b); its rate is a quality metric for admin/tuning, never an archive
  trigger.
- Member row states, rendered per read (join-time ACL check — precedent
  `domains/recentFiles/service.js enrichRecentEntry`): normal | **revoked** (file existed in
  view, now not readable → gray placeholder row WITHOUT filename/thumbnail; metadata after
  revocation is a leak) | trashed-by-owner (hidden, row kept) | purged (row cascaded away).
- Foreign members (files the collection owner doesn't own) in a LIVE-SHARED view are
  **excluded from rendering** with a `Not owner's file — not shared` badge marker
  (`MemberStateBadges`, §12.10) in the owner's view (cross-leak rule; §4.7). Operator rule (owner pivot 2026-10-01): collections/likes/dashboard
  are personal-storage surfaces — the ADMIN actor NEVER participates in them; every endpoint is
  server-gated 403 (`collections.forbidden`) for admin requesters, so an admin-owned collection
  is unreachable by definition. The `permissionPolicy.js` convention (admin owns the whole tree)
  remains — it scopes FILE-ACL surfaces only (permissionPolicy consumers), not these surfaces.
  Adding foreign files to collections is otherwise allowed (rule:
  you may only add what you can read).
- Member-row controls (context menu & multi-select) — file-mutating items (move/copy/rename/
  delete) are DELIBERATELY ABSENT; collection is a view, not a workspace. Present:
  exclude | publish on/off (owner/editor — own collections serialize `granted_role:null`; §12.1) | download (if file ACL allows) |
  `Reveal original location` (route the user to the file's real location where normal menus apply) |
  properties (read-only tab subset for non-owners) | like toggle.
  Multi-select adds: batch exclude (stored→delete rows; system→insert exclusions), batch
  publish, `Add to another collection` (membership copy). No batch delete — by rule.
- Collection-card context menu by origin: user/system: rename(→`name_locked=true`), pin,
  archive, share settings, delete(archived only). viewer(received): open, `Revoke permission`
  (real self-grant revocation — `DELETE /:id/grants/me`, Path 1 §12.1), no mutations.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/routes/collections.md`, `docs/spec/server/store/collectionsStore.md`, `docs/spec/client/components/file-manager/MemberRowControls.md`, `docs/spec/client/components/file-manager/FileContextMenu.md`

### 3.3 Like

`file_likes(user_id,node_id,created_at)`. Entry points: context menu (main list AND
collection member rows — one component state) + properties-dialog title-header right-edge
icon toggle. NO inline heart on list rows (density; rejected). Consumers: activity score
(top weight), split-trigger hot set, quality-gate fast path (liked clusters skip the 2-week
persistence requirement). v1: no other-user like display.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/store/fileLikesStore.md`, `docs/spec/client/components/dialogs/FilePropertiesDialog.md`, `docs/spec/client/components/file-manager/FileContextMenu.md`

### 3.4 Usage signals

`usage_events(user_id,node_id,action,created_at)` — actions: open | download | preview |
search_hit | like. Logged ONLY at low-frequency endpoints (download/preview/search-hit/
like/list-entry-click); NOT on directory listings (write-amplification guard). Nightly
rollup → `node_activity(user_id,node_id,opens,downloads,previews,search_hits,last_seen_at,likes,updated_at,score,…)`; raw events
rolled off at 90d by GC.

**Activity score (owner re-adjudication 2026-09-22 — two levels, one formula family):**

- **Item accumulator** (per user+node; maintained by the nightly rollup):
  `S_k = S_(k-1) · 2^(−Δt_k/H) + Σ_(events in interval k) w_a`, H = 30d half-life,
  `w_open=1, w_preview=2, w_download=3, w_search_hit=1, w_like=5`; stored as
  `node_activity.score` (count columns stay lifetime totals). Weights/H are T2 hot
  product constants (dbOnly, defaults shipped, admin-displayed — tuning values per §4.15
  counters, not AI-profile numbers). Item ordering inside a collection applies read-time
  lazy decay `S_read = S · 2^(−(now−updated_at)/H)`.
- **Collection score** (first-class, persisted `collections.activity_score REAL`, §5):
  `activity_score = Σ_(current members) S_m` — PURE activity (usage + likes, decayed).
  Recomputed by the nightly rollup AND on every membership mutation (non-journaled,
  alongside the `last_member_change_at` stamp; ≤500 members ⇒ negligible).
  **Exclusion negatives and definition age are NOT score ingredients** (owner decision
  2026-09-22): an excluded/removed member's score leaves the sum with the member itself —
  no separate penalty (exclusions are touches/§4.9b pins per owner decision 2026-09-16,
  never penalties or triggers) — and age lives ONLY in the archive gate as min-age grace
  (§4.9 pass 3).
- **Consumers:** card list `sort=activity` = `activity_score DESC, last_member_change_at
DESC, created_at DESC` (timestamp chain = tie-breaker + graceful fallback while the
  score is absent/all-zero — supersedes the prior "score never reorders the card list"
  store decision); item ordering = activity score desc, `node_id` asc (read-time decay);
  archive gate = event-based ε/N (§4.9 pass 3).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/maintenanceScheduler.md`, `docs/spec/server/store/collectionsStore.md (activity sort)`, `docs/spec/server/services/evolutionService.md (archive gate)`

## 4. Behavior specifications

### 4.1 Upload→enrichment hooks (exact seams)

Enqueue `ai_jobs` fire-and-forget AFTER commit at: S3 `server/service/uploadService.js` TX2
return (≈:73-88), WebDAV success return in `server/domains/files/services/fileService.js`
(≈:230-240), `fileService.copyFile` success, `versionsService.restore`. Pattern precedent:
thumbnail invalidation `uploadService.js:181-187`. Idempotency by
`UNIQUE(ai_jobs.node_id,kind,generation)` + skip-if same `content_hash` (never re-pays for
crash-retries, copies, restores). Content re-read via `blobStorageService.downloadBlob`
(works both backends; upload buffer is not retained). Also populate `filecache.content_hash`
(null today, `blobStorageService.js:66`) at the same commit points.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/services/aiJobService.md`, `docs/spec/server/store/aiJobsStore.md`

### 4.2 LLM adapter (new `server/infrastructure/adapters/llm/`)

- Factory by **runtime presence**: role-based clients — `embed`, `chat`, optional `vision`,
  `asr` — each `{BASE_URL, API_KEY, MODEL}`. **All `LLM_*` keys are T2 `dbOnly`** (admin
  config, masked secrets, DB-stored plaintext — app-layer secret encryption was removed by
  the `refactor/remove-app-encryption` workstream, see the W-A note in
  `docs/IMPROVEMENT_PLAN.md`) — NOT boot-owned: unlike the metadata
  backend (T0) and blob store (T1), the LLM is an enrichment dependency (invariant 5), so
  its config is fully hot. No `LLM_ENABLED` flag — role presence (non-empty resolved
  config) decides candidacy; probes decide truth (§4.23).
- **Hot reconfiguration (operating-time apply, immediate adoption)**: the adapter layer is
  a thin factory resolving connection per call via `configResolver` (5s TTL +
  `invalidateCache` on settings PUT); an internal client cache keyed by the resolved-config
  signature rebuilds on change. On signature change: re-probe the role (debounced ~60s) +
  admin "test" button as manual trigger → `backendHealth` rows and `settings/public`
  `ai` flags update live; running enrichment workers pick new config at the next job; E2
  query-embed uses it at the next request (mid-switch failure degrades per §4.12, never
  surfaces as error); budget breakers/daily counters reset. `LLM_*` registry entries are
  `dbOnly` — the resolver reads DB → default and IGNORES env, so a `.env`-provided `LLM_*`
  value is never effective (DB is the only config surface; §12.8 records the superseded
  "env remains legal" note). Contrast recorded: **native vector capability (§4.13) is
  boot-frozen (DB tier) — restart required; LLM config never is.**
- Presets declare EXPECTED capabilities, probes decide actual ones (§4.23).
  Unconfigured role ⇒ that capability degrades (never fatal). Startup probe (symmetric to
  s3/webdav probes, `index.js:272-327`) is the INITIAL probe — not the only one; reports into `backendHealth`, `probeLlm` added to
  `backendProbe.js:263` + `POST /api/admin/config/test` target `llm`.
- Budget/circuit: `llm_models.max_input_chars` is set by the §4.3 budget chain (admin >
  published metadata > preset default > passive down-only limiter — never by probing);
  adapter owns the truncation policy ladder and per-role daily call/token caps (budget
  breaker → pause role, surface in admin). Overlength never fails a job: degrade + flag
  (`truncated`, `degraded`).
- **Request shape is a profile property (EG2 probe, 2026-10-08):** embedding servers differ
  in ways that fail SILENTLY. Measured against llama.cpp b11459 serving embeddinggemma-2:
  (a) top-level `image`/`audio` fields on `/v1/embeddings` are ignored — success returns the
  TEXT vector of whatever `input` held (near-duplicate of the plain-text control, cos≈1.0);
  media must ride the `{"input":[{"content":[...]}]}` wrapper; (b) text inputs carry task
  prefixes (`task: search result | query:` / `title: … | text: …`, text-only — media takes no
  prefix) and omitting them degrades quality without error; (c) the server's `--pooling` flag
  changes the plain-text vector space without error (measured: mis-pooling shifted an
  unrelated-pair cosine 0.457→0.664); (d) fp16 inference is banned for this model family
  (NaN/silent degradation). The adapter MUST send the profile-declared format/prefixes and
  the probe MUST verify media consumption + server pooling shape (§4.23.2) — declared
  capabilities in `/v1/models` prove nothing (observed: multimodal declared, media silently
  dropped).
- **Built-in embed engine (owner decision 2026-10-14, PoC §6.8)**: the `embed` role is a
  product **inherent capability** — an in-process engine (transformers.js + pinned ONNX
  export, **q4** default = 473 MB full multimodal set; RSS ~1.1 GB) needs NO external
  serving step. Presence rule for embed therefore becomes "lockfile present = configured"
  (config presence = role candidacy, unchanged in spirit); external llama.cpp/HTTP embed
  servers remain valid provider overrides (and the GPU throughput path for media, since
  in-process media embed is batch-class: ~7 s/image on CPU). Distribution: a few-KB npm
  lockfile {repo, revision pin, files[]+sha256, dtype:'q4'}. **Provisioning is
  provider-triggered, not per-boot-unconditional** (owner ruling 2026-10-15, PLAN §22):
  it runs **BLOCKING at boot only for a CONFIGURED boot while the built-in is the active embed
  provider** (no enabled remote embed override), and **in place when setup completes or that
  override is cleared** — built-in activation is restart-free like every other LLM config
  (weights present ⇒ instant; absent ⇒ progress status card, role pending during the download
  per §4.12). Setup mode itself fetches NO bytes and the wizard NEVER waits on provisioning —
  the trigger fires on setup completion (PLAN §22-5). A pre-provisioned `WEA_MODEL_DIR` ⇒ zero download attempts, zero network egress;
  switching to remote NEVER deletes existing weights (triggers are idempotent — a
  re-trigger is a no-op). While a remote override is active, provisioning is DEFERRED and
  the absence is not a failure state (the role runs on the override). The attempt itself:
  **auto-provisions with the CLI logging per-file download progress** (atomic
  temp-file+rename, sha256-verified, idempotent) — one universal rule for single node or
  N replicas, no strict/ban mode (rejected: replicas are identical builds; pre-provisioning
  is an optimization, not a switch). Provisioning attempt fails (offline, checksum
  mismatch) ⇒ boot continues with embed caps OFF + admin prompt; never a crash, never silent.
  `llm_models` records the identity: `engine` (embedded|remote); remote activation is additionally
  **conformance-gated** (EG2 pin: dim + reference-kit median, §4.23.2 — endpoint-declared
  names are untrusted metadata); `precision`/`model_revision` annotate what is verifiably known
  — space key discipline (§4.20) reads them.
- **No LLM call on request paths** except semantic-search query-embed (results cached).
  Nightly evolution ≈ ≤1 chat call/user/day with aggregate-only
  input and 1 structured multi-output (create+split+merge candidates).
- No auto-backfill on model change: `embeddings.model_id/version` + `dim` recorded; admin
  triggers re-embed backfill job (rate-limited). Existing vector math keeps working from DB
  data after un-configuring an LLM; only NEW enrichment stops (queue backlog visible in
  admin). This is deliberate: enrichment dependency, not runtime dependency.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/llmAdapter.md`, `docs/spec/server/infrastructure/llmPresets.md`

### 4.3 Text/media preprocessing (local, free)

Document text extracted locally before LLM (PDF/docx utilities). **Chunk/token budget is
decided by a 4-step chain — never by probing calls** (owner correction 2026-09-16):
(1) admin-set `LLM_MAX_INPUT_CHARS` (T2) wins; (2) else published capability metadata —
free GETs only: `/v1/models` (n_ctx / OpenAI `max_input_tokens`), llama `/props`, ollama
`/api/show`; (3) else the preset manifest's release-measured default (e.g. llama.cpp ub
512; OpenAI-embed 8,191) — release artifacts per §4.15 provenance; (4) a **passive,
downward-only limiter**: if a real request fails with a length-class error, halve that
model's budget from then on (never self-raises; only admin/manual raises). Zero extra
inference calls in the steady state.

Embedding overlength ladder per `LLM_OVERLENGTH_POLICY`: `chunk-pool` (default: split at
**paragraph/heading boundaries first** (fallback: char window) → uniform-stride sample ≤
`LLM_CHUNK_BUDGET` chunks (default 4) → **store every chunk vector** (`embeddings_chunk`,
derived artifact keyed to the chunking profile = part of the model profile key — changing
chunk params means re-chunk, §4.20) → mean+renormalize for the pooled row) → `truncate-head`
→ `metadata_only` (name/mime/date embedded — weak but searchable) → `skip`(+journal note).
**Retrieval scores against chunk vectors (max-over-chunks per node), not the pooled row** —
E12 measured pooled-only hides a mid-document section (0.51 ≈ below the unrelated floor vs
0.67 chunk-max). The pooled row remains canonical for centroid/naming math. NL extraction
(chat) never hierarchical-summarizes; head+stride excerpt only. char→token safety factor
≈1.7 (mixed text, E10) ships as release constant — **it is bge-m3-specific; every model
change re-measures it (Q10).**

**Media chunk ladder (V1/V3 revival, 2026-10-08):** media inputs consume the SAME token
budget by fixed per-modality rates (profile metadata; EG2 measured: image 280 tok default
[70–1120 "soft budget" range], video 140 tok/frame at 1 fps sampling, audio 25 tok/sec;
model window 8,192 shared). Server-side physical batch limits cut through these: a `-ub
512` llama.cpp build 500s above ~20 s of audio / rejects multi-frame video (measured: 60 s
audio → HTTP 500, 60 s video → 5,922 tok rejected), and long audio exceeds the window
regardless (≈327 s cap). The ladder therefore mirrors §4.3 text chunking: fixed windows
(audio ≤ ub/25 s segments; video sampled to ≤ ub/140 frames; image always single) → embed
each segment → store every segment vector (`embeddings_chunk` rows, same profile-key rule —
**media sampling params are part of the chunking profile: changing fps/window segments
means re-embed**) → mean+renormalize pooled row; scoring max-over-segments (same E12
reasoning). Media overlength never degrades to `metadata_only` silently: `source` records
`media_direct` vs the fallback path taken (§4.21).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/llmAdapter.md`, `docs/spec/server/services/aiJobService.md`, `docs/spec/server/store/embeddingsStore.md`, `docs/spec/server/store/embeddingsChunkStore.md`

### 4.4 Merge proposals (the ONLY proposal UI; in-context card)

Nightly (or pair-signal) detection: derived pairs by centroid cosine; stored pairs by
membership set-Jaccard (LLM-free variant, same pipeline). Row
`collection_merge_suggestions(a_id,b_id,score,state pending|merged|dismissed|rejected)`.
UI grammar (researched from Apple Photos / Google Photos / GitHub / Gmail patterns —
proposals live at the object, never in an inbox): one card atop the collection list
(never stacked; `+N more` chip cycles), collapsed 68px one-line:
`"Merge "A" into "B"? · N overlapping files · M after merge"` + overlapping-member
thumbnail strip (strip = expand toggle → ≤300px overlay two-column compare, list not
shifted) + buttons `[Merge(primary)][Keep separate(ghost)][Later(text)]`; `Later` re-raises
once after 2 weeks then sleeps 30d; `Keep separate` = permanent pair suppression;
`Merge` executes immediately (NO extra dialog — the card IS the confirmation) + undo toast
(§4.11 toast system). Zero pending ⇒ zero layout footprint. No sidebar/tree chips for
merges (rejected).
Merge survivor: keep chosen name unless `name_locked`.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/routes/collections.md`, `docs/spec/client/components/file-manager/MergeProposalCard.md`

### 4.5 Seed collection

File context menu `Make a collection like this file` → confirm dialog (~640×560): seed preview,
editable auto name, member sample grid with fade + `plus N more` counter (backend
`GET /api/collections/preview?seedNodeId=` — seed vector vs user's visible candidates,
cosine in JS over TEXT vectors, partial top-K; 10k files ≈ hundreds of ms; skeleton/streaming
if larger) → create as `origin='seed'`, definition = `{seed_ref, θ}` vector rule. Cost:
membership math only, no LLM. Confirm-dialog copy obligation (Q2/§4.7): the dialog states
that the ENTIRE initial set (preview + `plus N more`) is publish-approved as a batch if/when
the collection is shared — approval must not silently cover unseen members.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/routes/collections.md`, `docs/spec/client/components/file-manager/AddToCollectionMenu.md`, `docs/spec/server/services/collectionsService.md`

### 4.6 Search (two-stage: typing filter → server query with name+semantic sections)

- **Typing** (no submit): existing client inline substring filter on the loaded listing —
  unchanged, zero-LLM, no server call.
- **Enter / search-icon**: submits a server query (`POST /api/search`, body `{ query }`)
  returning TWO ordered sections:
  1. `name_matches`: **plain containment, same semantics as the existing client inline
     filter, only across ALL user-visible file_nodes** (ACL-scoped closure/owner logic as
     in `fileService` listing): `lower(name) LIKE lower('%'||:query||'%')` — the `lower()`
     on both sides is mandatory (sqlite LIKE is ASCII-case-folded only). Multi-word queries
     legitimately return few/zero rows; that is the semantic section's job.
     **LLM-free; ships in P0** (T0.11). Response returns ids+names; highlight ranges are
     computed client-side (pure helper; server never returns markup offsets).
     **Ordering/caps (decision 2026-09-22, mirrors `routes/search.md:58,73`):**
     `name_matches` ordered `name` asc, then `node_id` asc, hard cap 200
     (`counts.name_truncated: true` when cut); `semantic` ordered score desc, then
     `node_id` asc, cap 50. Highlights are COSMETIC-ONLY (no correctness contract vs the
     server's dialect-specific matching): the client computes case-insensitive
     all-occurrence ranges of the trimmed query inside the returned `name` (pure helper
     `utils/searchHighlight.js`; its util spec is written at the T0.11 docs step); a row
     whose match cannot be located simply renders unhighlighted.
  2. `semantic`: vector results (P1+, embed-only config) — no highlighting; entries already
     present in section 1 are de-duplicated from section 2's display. Scoring = **segment-
     AND**: split query on whitespace (≤3 segments), per-segment max-over-chunks cosine,
     document score = MIN across segments (E3: composite queries like "enjoyable fantasy movies I watched"
     fail under whole-sentence cosine alone); gated by a **per-query dynamic baseline** —
     score the same query against a random ~500-doc corpus sample; if top results are not
     meaningfully above the sample's spread, return an honestly EMPTY section (kills the
     anisotropy majority-class fallback on nonsense queries, E2v2/E11). No absolute stored
     floors anywhere (PoC §2.5/2.6).
- No results in section 1 → show only section 2, and vice versa; empty semantic ⇒
  **`Save as collection` button hidden** (a saved collection means the semantic part only;
  name-match results are ALWAYS excluded from the collection definition).
- Server response renders in **results mode**: breadcrumb-row header
  `🔍 "query" · N results [Save as collection][✕]` (single button, no dropdown). Typing while in
  results mode re-filters the loaded results inline (same filter component); Enter
  re-queries. NL chat-parser (T3.4, optional later) extends the same header with a
  structured-predicate tab; §4.6 ≠ §4.11 parse grammar alignment note kept.
- Chips of recent queries in same header, each with `⋮` → save.
- Index/perf note: LIKE '%q%' full-scan is fine at personal scale (thousands–tens of
  thousands rows); PG may add `pg_trgm` later as an optional index (not a v1 dependency).
- **Conversational reservation (non-breaking additive, per §4.22)**: responses carry
  `result_ref` — an opaque string = the replay SIGNATURE (hash of normalized
  predicates ∥ vector query ∥ space ∥ sort) that produced them; requests may optionally
  accept `result_ref` (ignored when absent → same behavior as today). MVP emits only;
  interpretation is the future conversational layer's job.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/routes/search.md`, `docs/spec/server/services/searchService.md`, `docs/spec/client/components/file-manager/SearchBarResultsMode.md`, `docs/spec/client/hooks/useSearchResults.md`, `docs/spec/client/hooks/useExplorerSession.md`, `docs/spec/client/components/file-manager/FloatingSearchBar.md`

### 4.7 Collection sharing (live)

- Roles `viewer|editor` (+owner). Viewer: list/preview/download of members; cannot rename,
  cannot mutate membership (editor+ may `Exclude` only what they added, or anything if owner);
  cannot trash anything. Editor: add/remove membership. Publish/unpublish control: owner OR
  editor, viewer forbidden (§12.1). Admin may never be a grantee (operator rule, §3.2).
- Live = membership resolved at read time + `published` gate: in `ask`/`off` collections
  members added AFTER creation (auto-added and stored-added) start `published=false` →
  hidden from shared view; owner sees `N awaiting publish` banner (list-top, same digest surface)
  with batch/individual publish. **Q2 decided: the initial execution's member set of
  `seed`/`search` collections is created `published=true`** (the §4.5/§4.6 confirm dialog
  is the batch approval, incl. unseen remainder — see §4.5 copy obligation); subsequent
  arrivals park as above. `auto` = publish on every add (explicitly enabled mode).
  Publish state for DERIVED members materializes as a stored marker row in
  `collection_items` (the sole exception to derived-no-rows; `stored ∪ derived` dedups by
  node; unpublish flips the flag and never removes genuine owner-added rows).
- Recipient exit = real self-grant revocation, `DELETE /api/collections/:id/grants/me` (Path 1 —
  the original `leave` = per-user hidden flag design is retired; §12.1).
- Cross-leak rule (§3.2) applies: foreign-owned members never rendered into shared views.
- Grants revocation is instant; already-visible metadata cannot be re-taken (documented
  limitation, same stance as journal boundaries).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/services/collectionShareService.md`, `docs/spec/client/components/dialogs/CollectionPropertiesDialog.md`

### 4.8 Digest (top-of-list banner, not notifications)

Per `(user,collection)` visit cursor `collection_digest_cursors(last_visited_at)`, stamped by the
server on the items read ("the read IS the visit"); `last_visited_at` rides the list rows and the
sidebar `new` dot ⇔ null; create seeds the creator's cursor inside the mutation TX (§12.2). Counts
derived at read from `collection_items.created_at` (stored) and definition-evaluation events
(derived: last_member_change_at on collection row). One line `+N / -M / 1 merge · expand`;
expanded = per-entry reason (`why is this here` answers for auto-members come from per-row reason
computed at query time — matched predicate name — NOT a history table).

Contract specs (binding, MUST read before implementing this section): `docs/spec/client/components/file-manager/CollectionsListView.md`

### 4.9 Silent evolution (`origin='system'` only) — triggers, passes, rules

**Trigger config (T2, admin-tunable):** `AI_EVOLUTION_TRIGGER = nightly|upload|both`
(default `both`). **`upload` means BATCH-END, not per-file**: evolution passes fire on a
per-user trailing-edge debounce (`AI_EVOLUTION_DEBOUNCE_S`, default 90) armed at each
upload commit, and/or immediately on a client hint (`uploadComplete: true` sent by
`useFileOperations` when its queue drains; the debounce alone is sufficient — hint is
latency sugar, crash-safe by design). Mechanics: the timer RE-ARMS on each COMMIT, and a
commit only happens after full receipt (multer buffers the whole file) — so a long upload
cannot fire it mid-transfer; N-in-a-batch is unknowable server-side (client may abandon),
hence "last commit + quiet period" is the only crash-safe batch-end test; and the pass is
an idempotent re-scan of DB state, so a mistimed fire wastes compute but can never be
wrong — correctness does not depend on the trigger instant. Rationale: per-upload passes
would multiply clustering/merge/journal cost by file count — the exact cost-bomb this must
avoid. Only passes are batch-end; per-file `ai_jobs` enqueue stays at commit (idempotent, cheap,
needed for dedupe). `upload` mode runs the cheap passes (create/split/merge-candidates);
`nightly` runs ALL incl. archive/purge (time-based by nature — nightly is the backbone,
upload mode can only replace it by also running nightly at least once/day via the
existing scheduler). Same `runEvolutionPass(scope)` function either way; scheduler slot in
`maintenanceScheduler.js`, `lockManager` TX group (precedent `migrationService.js:330-348`).

Inputs: node_activity, likes, embeddings. Passes:

1. **Create**: multi-tier candidate generation (PoC E4 evidence: narrow and broad groups both
   real; naive connected-components REJECTED for chaining, absolute-θ topic gating REJECTED).
   Algorithm = **mutual-kNN seed-expansion** (k≈6, either-side top-k + edge cos from the
   model profile, default 0.82 tight / 0.80 mid / 0.72 loose tiers — tier defaults are
   per-model profile values; EG2 image-space rerun confirms zero cross-class contamination
   at the same tiers (provisional); text-space rerun outstanding — Q10 checklist), preceded by a
   **content_hash dedup pre-pass** (identical-content twins go to the dup path, never form
   clusters). Facet sources (path-subtree purity, like-density) generate
   candidates in parallel; a facet/embedding cluster pair with Jaccard ≥0.8 does NOT double-
   create — the existing collection is definition-promoted instead. Per-tier gates: min
   members ≥8, persistence ≥2wk (waived by likes-density), rate ≤1/week, active-system ≤12
   (tight+mid counted) / broad-tier ≤1 event-class per user, size caps **tight/mid ≤120,
   broad ≤500**, Jaccard ≥0.8 vs existing/tombstone → merge-proposal instead of create.
   No tier-specific lifecycle exemptions (owner decision 2026-09-16 — uniform rules only).
2. **Split**: hot subset within a collection crossing create-gates → NEW SIBLING
   `system` collection (never nested), parent untouched.
3. **Archive**: activity ≤ ε for N consecutive nightly evals (activity = Σ_members w_a of
   NEW usage events in the interval — available from the §3.4 rollup; ε default 0 ⇒ "no
   positive usage for N days") OR members≈0, gated by **min-age grace: system-origin
   collections younger than 14d are never archived** (the former definition-age score
   ingredient, re-homed here 2026-09-22 — §3.4) — **skipped for any pinned collection
   (§4.9b)**. The former exclusion-rate>θ trigger is REMOVED (owner decision 2026-09-16:
   exclusion counts as ownership/touch, hence pins — a pinning act cannot also be an
   archive trigger); exclusion rate stays measured as a generator-quality metric (§4.15).
4. **Purge**: archived > `ARCHIVE_RETENTION_DAYS` → permanent (FK cascade) + tombstone.
   **Q1 decided**: tombstone lifetime defaults to `ARCHIVE_RETENTION_DAYS`; fingerprint =
   normalized definition (schema + core params: θ/path/size — NOT raw centroid values,
   so trivial member drift doesn't slip past) hashed. Both granularities and lifetime are
   measured-then-tuned via §4.15 counters (tombstone-suppressed vs regenerated-anyway).
5. **Merge candidates** → §4.4 rows (this is the only "proposal" output).
6. **Auto-pin** (§4.9b).
   Naming via templateNamer (§4.10). Every act = `action_journal` row(s) via commit API (§4.11).
   All thresholds are T2 hot settings (configRegistry T2/dbOnly precedent
   `configRegistry.js:68`; resolver `configResolver.js:73-163` 5s TTL) — editable from admin
   tuning panel (§4.15) with live impact-count preview. Global switches:
   `AI_EVOLUTION_ENABLED` (pauses acts, keeps rendering), nightly-batch pause, create-pause,
   trigger mode. Kill switch semantics: pause never destroys queued work silently.

**4.9b User-touch auto-pin**: any user _touch_ of a system-origin collection — **membership
add, membership removal (stored-row delete or new exclusion)**, publish toggle, rename,
pin/unpin, grant/share change, accepting a merge as survivor, restore-from-archive — sets
`pinned_by='auto'` (no journal; additive, invisible; reads/views/likes deliberately do NOT
count — activity gravity already covers them). Pinned collections
are exempt from auto-archive/purge forever; `pinned_by='auto'` shows a subtle chip so users
can unpin (unpin = next auto-archive eligible). `origin='user|seed|search'` are never
archived anyway (invariant 3), pin is meaningless for them (column stays NULL).

**4.9c Merge-candidate metric (containment-safe)**: candidates require _set similarity_, not
overlap-asymmetry. Rule on materialized membership sets (capped, e.g. 500 rows/collection;
`collections_centroids` cosine is ONLY a prefilter, never grounds for merge):

- `sizeRatio = min(|A|,|B|)/max(|A|,|B|) ≥ 0.7` AND
- `jaccard = |A∩B|/|A∪B| ≥ 0.7`.
  Explicitly rejected: overlap-coefficient / containment (|A∩B|/min) metrics — they fire on
  subset pairs (Spain ⊂ Europe) which must NOT merge. The (Europe, 2026-trip) near-equal-sets case
  passes both tests and does surface as candidate. Subset pairs with sizeRatio<0.7 may later
  become _hierarchy proposals_ (parent/child grouping) — **not in v1** (§9 rejected list).
  (Validated PoC E7: all six constructed geometries — subset, near-identical jac.82, band
  jac.54, jac.33, two sibling families — classified exactly as intended; the naive
  overlap-coefficient misfires on the subset case, which is why it is banned.)

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/services/evolutionService.md`, `docs/spec/server/infrastructure/maintenanceScheduler.md`, `docs/spec/server/services/collectionsService.md`

### 4.10 Naming templates

Locale-style template strings (server-side module; ko/en both) keyed by creation type:
search → query text verbatim; seed → `{seedFileName} and similar files`; system cluster →
top-2 local derived tags `{tag1} · {tag2} photos`; split → `{parentName} · {diffTag}`;
fallback → `Auto collection N` (system-origin only). `llmNamer` (chat configured) produces the
name for new system creations instead. Template output is final; no post-hoc rename jobs.

**Local derived tags — v1 set (decision 2026-09-22)**: `mime`, `ext`, `month` (calendar
month of node `created_at`), `path` (top-2 ancestor path segments). Computed at the §4.1
commit points; consumed by the templates above and by tag predicates (§3.2 — derived facets
are the ONLY tag predicates, §4.18) and rule-based
suggestions (filename/mime/age). EXIF is REJECTED for v1 (not a tag source).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/services/collectionsService.md`, `docs/spec/server/services/aiJobService.md`

### 4.11 Undo journal (`action_journal`, common infrastructure — NOT ai-prefixed)

Schema §5. Generic `(domain, subject)` opaque key, NO FKs (rows outlive subjects for audit

- restore-after-undo-window reasoning). Writer discipline: domain code MUST go through
  `commitChange(mutation, inverse)` — the only write path (change + journal row in ONE TX +
  `lockManager`; collection repo exposes no other mutators). Journaled collection rows capture
  `subject_label` at commit time — the feed renders it verbatim, never re-resolves (§12.5).
  `chain_seq` monotonic per
  subject: tip-undo = free; non-tip = cascade-confirm listing count of later changes undone
  too. No undo-of-undo: an undone successor still leaves the row tip-eligible (§12.6). Retention: rows survive, `payload` NULLed at expiry (`status=expired`) — audit keeps
  "what happened" without storage growth. Undo does NOT restore: spent LLM cost, already-
  received external exposure (grants snapshot restores future state only), file content
  (trash/versions own that world). Subscribers: v1 collections (all silent/merge/settings-
  adjacent acts); P3 batch worker `_processBulkJob` per-item `(nodeId, old→new path)` inverse
  (AND fix the pre-existing write-only `job.cancelled`: honor it per item); P4 `PUT
/api/admin/config` (domain=settings, key + old value payload). permissions: enum reserved,
  no writer yet (asymmetry note: grant-undo=revoke is exposure-reduction, allowed silently;
  revoke-undo=grant = exposure-expansion → explicit only, rule 2).
  **UI/UX: bottom toast system (user-triggered actions), separate from the appbar job
  progress.** Reuse/extend `useMessage` (global hook) with an action slot: `[icon] Move completed (12 items)  [Undo]`. One toast per COMMAND (never per item); server returns
  `undo: { actionId }` in the mutation response, and batch jobs return it in the terminal
  poll result (T3.5). Journal granularity follows: **one command row** per user action
  (`subject='batch:jobId'` etc.), payload carrying the item-level inverse list — item-level
  rows only when partial-failure reporting demands. Undo executes all inverses,
  fingerprint-guarded per item; mixed results → toast reports `11 undone, 1 skipped (state changed)`.
  Undo availability matrix:
  | Action | Toast | Undo? | Mechanism |
  |---|---|---|---|
  | batch move/copy | ✅ | ✅ | journal `domain=batch` command row (P3.5); copy-undo deletes created root (fingerprint-guarded) |
  | rename (single/batch) | ✅ | ✅ | journal `domain=file` (add to enum); undo=rename-back |
  | file delete→trash | ✅ | ✅ | **NOT journal** — existing trash restore (content world, invariant: trash owns files) |
  | collection create/add/exclude/pin/publish/rename/grant·revoke | ✅ | ✅ | journal `domain=collection` |
  | merge confirm (card) | ✅ | ✅ | journal |
  | cleanup-suggestion accept | ✅ | ✅ | P0: trash-restore (no journal row, §12.5); T3.3: command journal |
  | share link create·revoke (file) | ✅ | ✅ | journal `domain=sharing` |
  | manual collection archive | ✅ | ✅ | journal |
  | **archived→permanent delete, empty-trash(admin)** | ✅ (report only) | ❌ | trash-parity contract: no undo button, no journal inverse |
  | like / visit / sort manipulation | ❌ | — | self-reversing trivial state; toast is noise |
  | migration/batch-cancel completion | ✅ (informational) | ❌ | job domain owns; journal not involved |
  | upload (plain) | ❌ | ❌ | success is self-evident in list; failure toast already exists |
  Additional candidate intro-points found (include): **conflict-resolution overwrite** (undo = versions
  restore when history enabled, else unavailable — degrade silently), **permission-request approve/deny** (undo=revoke, same exposure boundary), **admin GC/cleanup run** (report toast,
  no undo — destructive-by-design, §9 keeps), ~~**admin tag-merge confirm**~~ (retired —
  §4.18 dissolved 2026-10-16: no merge op ever existed and the whole vocabulary layer is gone).
  Cascade confirm dialog (non-tip undo) and `not recoverable` badges remain as designed for the
  30-day dashboard feed (`GET /api/actions`); surfaces: (1) toast (user actions, ≤24h
  undo window honored though rows live 30d), (2) digest banner undo links (system acts,
  ≤24h), (3) dashboard feed (all, 30d, cascade), (4) `__archive__` restore button, (5)
  sidebar `new` dot (cursor-absence rule — §12.2). No toasts for silent system acts — digest/
  feed carry them.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/store/actionJournalStore.md`, `docs/spec/server/routes/actions.md`, `docs/spec/client/hooks/useMessage.md`, `docs/spec/client/components/feedback/UndoToast.md`, `docs/spec/client/hooks/useUndoToast.md`

### 4.12 Feature-degradation matrix + UI states (LLM role-based)

Capability by config state (embed only = mostly full vector features; chat adds naming/NL
extract/parser; none =):

- **None**: manual collections, stored membership, path/tag/like-predicate collections
  (cosine-free rule evaluation; tag predicates = normalized string equality — identical
  behavior in every state, §4.18), server-wide name search (§4.6 name branch), usage/activity
  gravity, archive lifecycle, digests, merge-by-set-Jaccard, exact-dup finder
  (content_hash), rule-based suggestions (filename/mime/age), likes, sharing, journal —
  ALL ship in P0. **Absent: semantic search, seed collection, vector-merge, near-dup, NL
  parser.**
- **embed**: + semantic search, seed, vector merges, near-dup, auto-create (clusters by
  vector), naming templates (system). **absent: chat-only (summaries/tags-from-content,
  NL parse, llmNamer).** (Since 2026-10-14 the embed column is the **built-in default** —
  this column now describes the provisioning-pending/broken state only (offline first boot,
  corrupt files, external override rejected by conformance); chat/vision/asr remain
  opt-in externals. §4.2 built-in engine.)
- UI: `GET /api/settings/public` gains `ai:{embed:bool,chat:bool}` — derived live from the
  current probe state, flips without restart whenever LLM config changes (§4.2 hot
  reconfiguration) (precedent email_enabled
  `settings.js:18-29`). **Regular users: absent, not disabled** (no gray AI affordances).
  **Admin: visible-disabled** — nav item + health-card row (`SystemSettingsContent.js:262-
285` backend health card is the state's home) showing 4 states
  `not_configured|probe_failed(reason)|partial|ok` per role with CTA into
  `/api/admin/config` + `probeLlm` test. Unconfigured errors return
  `serverErrors.ai.notConfigured` (not 404). Partial config: no "unconfigured" filler —
  template names read as normal names (they are final), excerpted summary fields simply
  absent; insufficiency reported only in admin §4.15/§4.16.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/llmAdapter.md`, `docs/spec/client/services/collectionsRepository.md`, `docs/spec/server/services/collectionsService.md`

### 4.13 Vector backend selection (engine-native where supported, JS fallback, never AI-off)

Canonical truth is ALWAYS `embeddings.vector TEXT` (floats serialized, `dim`, model
version) — every index below is a **derived artifact, created/managed by the vectorStore
adapter, never tracked DDL** (symmetric rule for pg shadow table and sqlite vec0 virtual
table). Seam: `domains/ai/vectorStore/` interface `{ upsert(node,vecs[],dim),
neighbors(vec,k,candidates), allVectors(userScope) }` — `upsert` takes the pooled row AND
chunk rows (§4.3 retention); **`neighbors` scores per-node max-over-chunks** and the shadow
index/scan includes `embeddings_chunk` rows (pg: shadow vec0/pgvector tables carry chunks
too; JS: loads chunk rows per query; node ids dedup before k). Exactly two implementations:

| Impl                                                   | When                                                                                          | Behavior                                                                                                                                                                                                                                        | Evidence (PoC)                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Native** (`PgVector` / `SqliteVec` / future engines) | engine vector ops present                                                                     | KNN pushed into SQL: PG = pgvector **≥0.7** (HNSW on, ANN recall contract §4.13c), sqlite = **node:sqlite + sqlite-vec vec0** (flat exact, no ANN yet upstream), future MySQL9/MariaDB/MSSQL2025/Oracle23ai = one adapter or fall through to Js | pg: 0.7ms@60k, filtered 6.2ms recall 50/50; vec0: 17ms exact @20k |
| **JsFallback** (`TextVectorJs`)                        | native ops ABSENT (pgvector not installed, unsupported future engine, extension load failure) | brute-force exact cosine, per-query load (no resident state — §6 gate), O(N·D) latency                                                                                                                                                          | 67ms@60k resident-array benchmark                                 |

**No AI feature is ever disabled for missing vector capability** (policy corrected
2026-09-15): absence degrades to JsFallback, boot unblocked, all features ON. Admin
health card shows `vectorOps=native|fallback_js(degraded)` with hint
(`CREATE EXTENSION vector` ≥0.7 / sqlite-vec binary) — a PERFORMANCE warning, not a
state gate. `REAL/NUMERIC` stay out of tracked DDL (transpiler vocabulary).

Constraints & facts recorded from spike: sqlite path requires the **node:sqlite driver**
(current `sqlite3` npm exposes no extension loading — migration is confined to
`db/sqliteExecutor.js`, seam by design); vec0 PK binding needs BigInt (node:sqlite
numbers bind as double); vec0 + JOIN planner bug → ACL filtering uses **oversample(k·f)
→ SQL filter → adaptive retry** helper (shared code, also valid pre-0.7 pg behavior);
node:sqlite is experimental-flagged on v24 (works) ⇒ **product Node floor: ≥24**.

**4.13c Accuracy contract**: conformance suite asserts per-engine: exact engines =
identical to JS oracle; ANN engines = recall@50 ≥ 0.99 at **ef_search=400 — fixed default,
never ship the library default 100** (measured: external-query recall 0.74@100 → 1.00@400,
cost ~2 ms). Consequence of external-query testing (self-queries flatter the index):
§4.13c is graded with held-out queries only. Cross-engine result-identity is NOT promised
(ANN is approximate); the promise is the recall floor. HNSW shadow dim is bound to active
model (model change → rebuild derived index; TEXT canonical untouched). **MRL-capable
profiles (EG2: 128/256/512/768 truncations) MAY ship a reduced stored dim as a profile
choice — ~3× smaller vectors, ~256d near-lossless, 128d text-only-safe (release-measured);
hard rules: query and corpus share the dim, truncation MUST be followed by L2 renormalization
(slicing breaks unit length — produces plausible-looking scores silently), and the chosen dim
joins the profile key.** hnswlib-node is
REJECTED (§9) — vec0 covers sqlite at all expected product scales as an exact engine
(5.3 ms @5.4k measured); ANN headroom lives on the PG tier by design (docs already
recommend PG for large deployments).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/vectorStore.md`, `docs/spec/server/store/embeddingsStore.md`, `docs/spec/server/store/embeddingsChunkStore.md`, `docs/spec/server/routes/admin.md`

### 4.14 Admin operations dashboard (NON-AI first; extension of existing surfaces)

Existing admin surface audit (evidence): config CRUD+test+sync web actions exist
(`domains/admin/routes/config.js`), health snapshot (`:242`), migration job UI, user mgmt,
GC button (snackbar-only result), `repair-sync`/`perm-delete` endpoints exist but have NO
UI, GC/startup reports console-only, `GET /api/admin/settings` returns raw rows incl.
plaintext secrets (security: dashboard must NOT reuse it for display).
Tier A (already-exists-now-invisible — first PRs): `admin_reports` persistence of GC run
result (`maintenanceScheduler`/`cleanupService`), migration job history, startup fail-safe
orphan/pending scan + cleanup node lists → `GET /api/admin/reports` + render + row-level
repair actions via existing endpoints. Tier B: PG re-probe button, **DB `vectorOps`
status row (native|fallback_js(degraded reason) — §4.13 performance warning, not a
gate)**, email probe (none today, `email.js`), health transition history, config editor shows defaults + fix
CONFIG_DISPLAY_META silent-skip (`SystemConfigEditor.js:360`, whitelist hides new keys —
switch to registry-driven with optional labels). Tier C: no ad-hoc metrics framework —
everything persisted is DB-aggregatable (instances short-lived, logs not a contract).
Locks table + `_schema_migrations` read-only staleness card (diagnose only, no action).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/routes/admin.md`

### 4.15 Admin AI governance panel (tab within mypage admin area)

Pipeline health (queue depth, 24h fail/429 rates, breaker states, failed-jobs table w/
retry/abandon), cost ledger (`ai_usage_daily` per-role rollup; daily budget caps; per-user
top-N), evolution governance (rule hit-rate, survival curves, merge-accept %, gate params
with live impact counts + rollback via settings journal, tombstone-suppressed vs
regenerated-anyway counters §4.9/Q1), model registry (model_id/dim per
role, per-version embedding distribution, **three ai_enrichments lineages — features/caption/
asr model coverage filters for backfill scoping (Q6)** + media-embed coverage (which nodes
carry `media_direct` vectors vs which fell back — V1/V3 rows, backfill scoping),
backfill launcher with rate limit),
degraded-input histogram (overlength stats), kill switches (§4.9). Privacy boundary:
aggregates and ids
only — never file names/queries/contents of other users. **Constants provenance
(2026-09-16 decision, extended 2026-10-08): every numeric constant the AI passes (cos
thresholds, ef_search, char/token safety factor, media token rates/window sizes) AND every
server-shape flag (request format, `--pooling` expectation, task-prefix policy, MRL dim,
quantization/dtype constraint, engine ∈ embedded|remote, lockfile revision) is a RELEASE
ARTIFACT — measured by the project on a dev-owned
reference set and shipped as per-model profile values; there is NO runtime calibration
feature and NO dataset shipped to end users. Panel displays profile values +
`calibrated:false`-style provenance; §9.1 keeps the re-open trigger (corpus drift).
**Server-shape flags split into two silent-failure classes and MUST NOT be conflated:**
(a) SPACE-shaping (pooling, dtype, stored MRL dim) — the same weights produce a
DIFFERENT vector space (EG2 probe: mis-pooling `cls` vs `mean` moved an unrelated-pair
cosine 0.457→0.664, zero errors); (b) INPUT-shaping (request format, task prefixes) — the
space is UNCHANGED but the intended input is not consumed (media silently dropped → the
text vector is returned with HTTP 200; omitted prefix → degraded embedding). Class (a)
re-embeds everything on change; class (b) is caught by probe shape/positive-controls
(§4.23.2), not by re-measuring θ.
Embed-model adoption checklist (profile constants to measure before a model ships): text
near-dup band (θ_dup), unrelated floor/dynamic baseline spread, image/audio/video near-dup
bands, mutual-kNN tier edges, char/token factor, media chunk costs — latency/serving-mode
figures are recorded in the profile as informational fields, never ship gates).**

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/llmPresets.md`, `docs/spec/server/routes/admin.md (panel surface lands with T4.1 docs step)`

### 4.16 User dashboard `Storage`

Nav: `myPageRegistry` entry shape `{id,icon,labelKey,visibility:'all'}` + content
descriptor branch. Blocks: hygiene cards (exact/near dups count + reclaimable GB, trash size

- retention countdown, cleanup suggestions count) → each deep-links to a context where the
  action happens (dashboard is pull-style overview, not an action center — in-context cards remain);
  system-changes feed (journal, 30d, undo buttons); my-collections status (counts,
  grants-received/granted w/ revoke, recent merge/archive facts w/ undo); suggestions list
  (**checkbox rows + `Accept selected (N)` — Q4 decided: checkbox in ALL cases, no per-file/
  threshold variants; checked rows only, accept→trash; command-unit undo §4.11 ships with
  T3.3 — the P0 surface accepts un-journaled, trash-restore is the undo, report toast without
  an Undo button (§12.5)**).
  Capacity sparkline only — no personal-insight prose
  (rejected scope).

Contract specs (binding, MUST read before implementing this section): `docs/spec/client/components/mypage/content/CollectionDashboard.md`, `docs/spec/client/hooks/useMyPageController.md`, `docs/spec/client/pages/MyPage.md`

### 4.17 Cleanup/duplicate suggestions (`file_suggestions`)

Rule variant (LLM-free): filename/temp patterns, stale screenshots, old installers, exact
dups via **content_hash first (T0.9a — cosine 1.0 detection redundant, E2)**. Vector
variant: low-quality picks among near-dup groups at **θ_dup = 0.97** (E2v2: realistic-edit
P10 = 0.977 vs unrelated P99 = 0.471 — separation measured; the earlier 0.98 guess was
near-miss), "30d unopened + low score". θ_dup is a per-profile text-space constant —
EG2 reference-set measured **0.955** (near-dup overall P10 0.9746 vs same-topic P90
0.8105 / unrelated P99 0.7294; separable for near-dup only, topic/unrelated overlap
reproduced from bge-m3). MEDIA θ_dup is FLAG-ONLY, never an auto-pick signal: image
0.94 but same-event photos reach 0.990, audio 0.969 but pink-noise twins reach 0.9988 —
media near-dup proposals are necessarily high-recall/low-precision (§4.17 is already
PROPOSALS + hash-first, so this weakens the vector variant only, not the exact-dup path).
**Short-doc exception: files ≤1 sentence are
excluded from cosine near-dup (edit variants score 0.55 there — E2v2 P01) — hash/shingle
path only.** Always PROPOSALS (file-mutating, rule 2/5), rendered inline (row chip) + in
§4.16. **Q4 decided UX: every suggestion row carries a checkbox; the only accept control is
`Accept selected (N)` (checked rows → trash). Dismiss stays inline per-row; unaccepted
suggestions expire with the retention job — both scoped to PERSISTED rows (T3.3); the P0
suggestions are computed, carrying no id/dismiss/expiry (§12.5).** Undo = command journal row
(checked count = inverse count) — ships with the T3.3 persisted rows; the P0 accept is
un-journaled, trash-restore is the undo (§12.5); no extra confirm dialog — the checkbox IS the
selection confirmation.

Contract specs (binding, MUST read before implementing this section): `docs/spec/client/components/mypage/content/SuggestionsChecklist.md (file_suggestions store/route specs land with the T3.3 docs step)`

### 4.18 Tags: descriptive words only — no vocabulary machinery (dissolved 2026-10-16)

Owner ruling 2026-10-16 closes the last open thread (Q11) by DISSOLUTION. LLM tags
(`ai_enrichments.tags`) are **words that describe a file** — a display facet and text material,
never a controlled vocabulary. Consumers, exhaustively: AI Info chips (P1, display-only —
tag filters/search were never planned), `llmNamer` + `merge-arbiter` inputs (read as text),
regeneration via `features_model_id`/`schema_version` lineage. Nothing else.

What this retires (all measured dead ends on EG2 — PoC §6.5/§6.9):

- **θ_tag vector-matched tag predicates** (was §3.2): semantic expansion belongs to
  document/media-vector collections; tag-string fuzzy re-imported the compressed-band
  problem into rule membership (unrelated tag-pair median .75).
- **θ_lo + `tag_parents` parent hints**: cosine has zero discriminative power at this
  decision (measured reversal: real parents below junk pairs); string-rule replacements
  work but grouping-by-legend was never a product need → feature removed, not re-anchored.
- **`tag_embeddings` cache**: consumers = the two above → table + "E3 tag embed" call site
  retired; physical DDL drop rides the big-bang migration.
- **Vocabulary normalization as an institution**: `ai_tag_raw` survives with a narrowed
  role — storage for LOCAL derived facets (`mime:`/`ext:`/`month:`/`path:`,
  derivedTagsService; kind-prefixed, folded, exact-equality predicates §3.2). LLM tags are
  NOT materialized there; any fold for display/naming counting is a read-time pure
  function, zero state.

The surviving principle from E6c unchanged: **nothing merges tags automatically**; raw
`ai_enrichments.tags` is never rewritten. Gray band = leave alone, forever.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/store/aiTagStore.md`, `docs/spec/server/services/evolutionService.md`

### 4.19 Chat-model roles

Scope rule: **embeddings + set math do the analysis; the chat model legitimately does only
two things — (1) translate between language and machines (NL parse ↔ summary/naming
extraction: these feed the embeddings and predicates), (2) adjudicate genuinely ambiguous
decisions where rules would guess.** Narrating numbers the LLM didn't compute is
fabrication of explanation, not analysis — roles doing that are REMOVED:
~~digest-sentencer~~ (counters are the truth; sentences add plausible nonsense),
~~why-together~~ (cosine has no logic to explain), ~~rerank~~ (compositional/negation
intent is the PARSER's job — decompose to predicates+vector, not a list-patch bandaid),
~~taxonomy-miner~~ (parent-tag inference = co-occurrence stats, rule-computable),
~~definition-tuner~~ (exclusion pressure already drives archive via §4.9 pass 3; silent
LLM rewriting of a live definition is unreviewable churn for marginal gain). KEPT (each
does work rules can't):

| Role                 | Decision it makes                                                                                                        | Why rules can't                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features.extract`   | tags/summary/category per file → ai_enrichments display + naming/adjudication material (§4.18 — not rule or embed input) | core (already elsewhere)                                                                                                                                                        |
| `parse.nl`           | user sentence → shared predicate grammar                                                                                 | core (§4.6/T3.4)                                                                                                                                                                |
| `name`               | templateNamer fallback when chat on                                                                                      | cosmetic but cheap, bounded                                                                                                                                                     |
| `keeper-adjudicator` | which file of a near-dup group to keep (+reason)                                                                         | rules can rank by resolution/date but cannot weigh content meaning (caption/summary exist at this point); reason text rides along free                                          |
| `merge-arbiter`      | borderline pairs (Jaccard in review band 0.55–0.7): merge candidate / keep separate / hierarchy-later                    | set math is by-design blind between "same theme twice" vs "theme + subset"; the card can show its verdict as a prefilled recommendation — final call stays with the user (§4.4) |

**Per-role mechanics (detailed):**

- **`features.extract`** — runs inside the per-file enrichment job (`ai_jobs kind=features`),
  never on request paths. Input: locally-extracted text (doc text, OCR'd image text, video
  captions/transcript per §4.3) clipped by the §4.3 ladder + filename/mime/path/date
  metadata line. Prompt = fixed template, output forced to JSON schema
  `{tags:[{tag,confidence}], summary, category}` ≤ small token budget. Written to
  `ai_enrichments`. Its value: display + the material the naming/adjudication roles read —
  tags are descriptive words, never rule atoms or embed input (§4.18, 2026-10-16); since
  V1/V3 revival caption/transcript are likewise display + adjudicator material — media
  embeds directly, never routed through text as its embedding corpus (§4.21).
  Chat off ⇒ field empty; everything else runs on local derived tags + vectors
  (+ media-direct embeds when the embed role probes media-capable).
- **`parse.nl`** — the only role on a request path, at search submit (batched with query-
  embed, ≤1 call, cached in `query_parses`). Input: query string + the CLOSED predicate
  grammar (enumerated fields, operator list — NO tag-vocabulary injection; tag atoms bind
  derived facets only, §4.18) + the
  session's existing predicate state (field/value level only — see input invariant below).
  Output: predicate JSON (+ optional refined vector-query text). It never sees file data
  and never produces ids — SQL executes the predicates server-side, so hallucinated
  values match nothing (safe-by-construction). Parse failure ⇒ silent fallback to
  vector+name search (§4.6 two-section response unchanged). Contract evolution: output
  may grow delta semantics (add/replace/exclude/`$ref`) for §4.22 conversation —
  **additive fields only, no meaning redefinition**; the single-shot contract above stays
  v1. Input invariant: the LLM receives utterance + predicate-context symbols ONLY —
  never result-set contents, node ids, or permission data (symbols resolve server-side;
  this is the conversational restatement of the never-sees-files rule).
- **`name`** — at collection creation when chat on. Input: structured cluster stats (top
  tags, date range, member count) — no file content. Output: ≤4-word noun phrase,
  schema-validated; collision/rename rules as §4.10. Failure ⇒ templateNamer (the swap is
  lossless by design).
- **`keeper-adjudicator`** — nightly, per near-dup GROUP (input = that group only),
  produced by the T1.7 vector clusters. Reads `ai_enrichments` summaries/captions + ffprobe
  meta for each candidate (bounded group size ≤~10). Output: `keep_id` + per-file reason.
  Value vs rules: resolution/size/date ranking is exactly what rules CAN do — the
  adjudicator exists for content-meaning ties (which of two screenshots/frames of the same
  scene is the one to keep). Chat off ⇒ heuristic fallback (best-ranked kept, reasons
  omitted). Its verdict pre-fills §4.17 suggestion rows; accept stays user-clicked.
- **`merge-arbiter`** — nightly, ONLY for pairs in the review band Jaccard 0.55–0.7
  (§4.9c). Below 0.55 no card; ≥0.7 card without adjudication. Why it exists: set math is
  structurally blind to the difference between _theme+subset_ (Europe/Spain — must NOT
  merge), _theme+duplicate_ (Europe/2026-trip — should merge), and _sibling themes_ (Europe/
  Japan — must not); membership overlap alone can look identical for all three. Input:
  both collection names+top tags+sizes + ≤5 sampled member summaries each (features only).
  Output: verdict ∈ {merge, keep_separate, sibling} + one-line reason, written as
  prefilled recommendation + reason row on the §4.4 card (`sibling` → no card in v1,
  §9). It advises, never acts: user still presses Merge; no arbiter call is ever
  self-executing. Chat off ⇒ band pairs simply get no recommendation (card still appears,
  no preselection). **Input format is load-bearing (E7 PoC): the prompt MUST include the
  symmetric difference — unique-member counts/ratios and samples from each side — feeding
  only shared-sample + overlap ratio makes every pair look "nearly identical" (measured:
  all-merge bias).**

Common invariants for all roles: input = aggregates/derived features, **never raw file
bytes**; output = schema-checked JSON committed by service code (never LLM-written SQL,
never direct DB access); state-changing verdicts are journaled like any other act; every
role has a rule-based fallback (the None column of §4.12 is guaranteed by construction);
budgets/breakers/kill-switches inherited from §4.2/§4.15, cadence from §4.9 trigger config.
**Reasoning policy (E5/E5b/E7b measured): ALL roles default reasoning OFF** — extraction
hit 99.8% JSON validity at 5–10× speed with thinking off, and the earlier "judgment needs
thinking" reading was n=2 noise (arbiter action-level 5/5 both modes). `enable_thinking:false`
where the provider supports it (llama.cpp: chat_template_kwargs — verified); per-model
override `llm_models.reasoning` exists for experiments only, not a plan assumption;
reasoning-effort tiers are exposed only where probing finds support (Gemma4/Hana: none).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/services/aiJobService.md`, `docs/spec/server/infrastructure/llmAdapter.md`, `docs/spec/server/services/searchService.md`

### 4.20 Embed-model roles

The embed model is the substrate, not an analyst: it answers only "where" (a fixed-dim
unit vector), never "what/why". Everything called analysis — search ranking, clustering,
membership, near-dup, merge prefilter, similar-sort — is set math on its outputs. Call
sites (3, deterministic; only #1 is file-proportional; E3 tag embed retired 2026-10-16
with §4.18):

- **E1 file embed** — async, inside `ai_jobs kind=embed`. Input = locally extracted text
  (doc/OCR/caption/transcript) through the §4.3 ladder (text files; media files use E1-M):
  paragraph-aware chunks → store
  **all** chunk vectors (`embeddings_chunk`) + mean+renormalized pooled row
  (`chunk_pool`) | head | `metadata_only` (name/path/date string — same text space, weak
  hits preserved) | skip(+journal note). Skipped entirely on identical `content_hash`
  (determinism within a model version is what makes the `(content_hash,model_id)`
  idempotency rule sufficient). Chunking params are part of the model profile key —
  changing them means re-chunk, never mixed-chunk scoring.
- **E2 query embed** — the ONLY request-path AI call in the system (§4.6; see §4.19
  `parse.nl` chaining for vector-input refinement).
- **E1-M media direct-embed (V1/V3 REVIVED, owner decision 2026-10-08)** — images, video and
  audio bytes go to the SAME embed role, no prefix, producing vectors in the model's one
  shared multimodal space (EG2 probe: wedding video ↔ event photos 0.78–0.79; audio ↔
  transcript summary 0.79–0.85; cross-modal ranking correct on the probe battery). Requires
  probe-verified media capability (§4.23); sampling/chunking per the §4.3 media ladder;
  `source='media_direct'`. When the active embed model lacks media capability, the V2
  caption→E1 fallback of §4.21 applies — never a mixed-space read (§4.21 model-change rule).
- **No calls**: collection centroids = weighted means of stored vectors; seed definitions =
  references to existing vectors. Evolution math is call-free by construction.

Invariants: vectors live in the space of their `llm_models` row — **`model_id` is the
space key** (one embedding model active; cross-`model_id` cosine forbidden — mixing spaces
only ever happens across a model migration, handled by backfill §4.2); with a multimodal
embed model, **cross-MODALITY cosine inside one `model_id` is legal and is the product's
media-search basis** (§4.21) — the retired "cross-space machinery" remains retired: there is
one space per model, media merely enters it directly now; `dim` fixed per
model; TEXT canonical (§4.13); budgets/kill-switches per role like chat. Row-level identity
additions (2026-10-14, refined same day by the EG2 model pin): `engine` + `precision`/
`model_revision` — for **embedded** rows dtype/lock-revision IS identity (a change = new
model_id = re-embed); for **external** rows they are best-effort annotations because a
remote's precision cannot be enforced — what IS enforced at activation is the EG2
conformance gate (§4.23.2), which exists to catch mapping to an entirely DIFFERENT space
(same-dim foreign models), not EG2's own ±.02 quantization noise — tolerated by owner
ruling, so θ constants are single-set for the model.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/llmAdapter.md`, `docs/spec/server/infrastructure/vectorStore.md`, `docs/spec/server/services/aiJobService.md`

### 4.21 Media pipeline (one shared multimodal space; V1/V3 revived — owner decision 2026-10-08)

The 2026-09-16 ruling ("every modality enters the SAME _text_ embedding space", V1 retired)
is REVISED, not erased: it stood while image embedding spaces were provably incomparable to
text space (bge-m3 embeds base64 letters — §2.1). EmbeddingGemma 2 ships one probe-verified
multimodal space where cross-modal cosine works (PoC addendum: img↔photo 0.78, audio↔
transcript-summary 0.79–0.85, re-encode 0.972 band; text↔image ranking correct on the probe
battery). Decisions that SURVIVE the revision: no query fan-out, no per-space centroid pairs,
no score-mixing rules — because there is still exactly ONE space per active model; media now
enters it directly instead of through a generation hop. The pipeline:

- **V0 (free, always)**: ffprobe metadata + filename/path/date → `metadata_only` embed and
  probe JSONB — works with zero LLM.
- **V1 (revived; needs embed role with probe-verified media capability)**: images → direct
  embed (single image, ≤ vision token budget); audio/video → §4.3 media ladder segments +
  pooled/segment rows (`source='media_direct'`). Search-by-content, clustering, near-dup and
  seed-math then see the RAW media, not a generated description.
- **V2 (needs `vision_chat`)**: uniform-stride frame sampling (≤4, local ffmpeg) → VLM
  captions in Korean → `ai_enrichments.caption`. Role changed 2026-10-08: caption is DISPLAY +
  adjudicator/keeper material and the OCR/legibility channel — and the **media embedding
  FALLBACK when V1 capability is absent** (caption text → E1). With a media-capable embed
  model both run; captions no longer _are_ the media's searchable representation.
- **V3 (ASR + direct audio embed; 2026-09-16 field freeze HOLDS)**: audio tracks/files →
  conditional transcript (`transcript` + `asr_model_id`, mandatory escape-prompt) AND, when
  media-capable, a direct audio embedding. **The E13 ban is on GENERATED ATTRIBUTES
  (audio_desc/genre/mood/kind fields) — it is untouched by V1/V3: direct embedding retrieves
  by meaning without inventing labels** ("find my rock tracks" becomes a vector search, not a
  metadata field). Vocal music transcribes _lyrics_ — store as `transcript`, excluded from
  document-content scoring by `media_kind=music`; measured caveat (EG2 battery): thin
  margins on noise-like audio (unrelated floor rises; "노이즈" ranked 2nd in most rows) —
  media results obey the §4.6 dynamic baseline gate, never an absolute θ.
- Image/video/audio near-duplicate: measured directly in media space — EG2 reference set:
  image variant band P10 0.9426 (min 0.9042) but SAME-EVENT photos reach 0.990; audio
  variants P10 0.969 but distinct pink-noise files pair at 0.9988. Consequence encoded:
  media near-dup cosine = recall-oriented FLAG for suggestions only (exact-dup path
  remains hash-first, §2 invariant set unchanged); the old "weaker than a CLIP path"
  acceptance note is obsolete.
- Model change → backfill re-projection in one space (§4.2) covering MEDIA rows too (media
  files without captions become newly embeddable; media-capable→text-only swap must re-project
  media rows back through V2 or drop them — backfill scoping via media-embed coverage, §4.15).

`LLM_MEDIA_PATH` stays deleted; media selection is capability-driven: media-capable embed →
V1, else vision_chat → V2 captions feeding E1, else V0.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/services/aiJobService.md`, `docs/spec/server/infrastructure/llmPresets.md`

### 4.22 Search architecture layers — reference model & conversational extension path

Reference model (all boxes already map to existing plan modules; this section is a boundary
contract, not a new system):

```
File Store (S3/WebDAV)
  → AI Enrichment Layer      (§4.1 hooks, ai_jobs worker T1.3, §4.3 extraction, E1/E3/E4)
  → Metadata / AI Features /
    Embeddings / Activity    (§5 tables)
  → Search Engine            (searchService + vectorStore §4.13 + fileNodesStore ACL joins;
                              SQL name-match, predicates, cosine, merge/dedup)
  → [Conversational Layer]   (FUTURE only: SearchSession · parse.nl · result refs · actions)
  → User
```

Module mapping: Enrichment=§4.1/T1.x; Search Engine=`domains/ai` searchService (docs gate);
Conversational = reserved boundary below — **no tasks added to §7 for it**.

#### SearchSession (concept reservation — zero storage now)

```
SearchSession (concept): accumulated predicates | exclusion predicates | semantic intent
(vector query, rewritable) | referenced result sets ($ref) | sort/pagination | actions
```

- MVP ships only §4.6's `result_ref` emission (opaque signature) + optional request-side
  acceptance. No session table, no chat routes, no P-graph change. Future extension must
  open via these reserved fields only (non-breaking additive — that is the whole point).

#### result_ref = replay, never materialized id-lists

`sig = hash(normalized predicates ∥ vector query ∥ space ∥ sort)`; a follow-up like
"of those…" = `rerun(sig) ∩ new-execution`, resolved **under current ACL at execution time**.

- Why not stored snapshots: an id list freezes past-ACL — a since-revoked file staying
  addressable violates invariant 5/§4.19 (server-side live ACL enforcement) and would
  resurrect purged/trashed nodes; replay re-enforces `fileNodesStore` joins and FK cascades
  for free.
- Trade-off accepted: set drifts between turns (file revoked → drops out). Live behavior is
  the expectation in a file system; stale-but-precise snapshots are the worse error.
- **Q7 decided: always-replay** — no TTL/candidate-set caching variant is adopted even as a
  plan item (session counts make reruns trivially cheap; see rejection note §9).
  `result_ref` stays an OPAQUE string, preserving convertibility if real usage ever proves
  drift painful — but the current decision is replay, not a deferral.
- Cost: rerun is LIKE+cosine (already bounded by §4.13 candidate caps); signature doubles
  as the `query_parses` cache key.

#### Utterance-merge rules (parser classifies; SERVER code decides)

| Utterance                       | Example                          | Interpretation                                               | Result                                                                            |
| ------------------------------- | -------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| new field                       | "and pdf"                        | add                                                          | ∧ predicate                                                                       |
| same field, explicit correction | "last year? no — this year"      | replace                                                      | server substitutes `year` slot                                                    |
| same field, additive            | "and this years too"             | add-multi                                                    | field cardinals fixed in grammar up-front                                         |
| negation, expressible           | "not black"                      | NOT predicate                                                | grammar supports it                                                               |
| negation, not expressible       | —                                | exclusion token                                              | `− set/attr` list                                                                 |
| exclude instruction             | "exclude the similar ones"       | `exclude_similar($ref)`                                      | pairwise sim over rerun set (vectorStore); parser only translated the instruction |
| pronominal ref                  | "of those/those photos/this one" | `$ref` slot (= latest sig, server-injected)                  | —                                                                                 |
| unresolvable                    | —                                | vector fallback: merged original+utterance query re-embedded | structural failure ≠ search failure                                               |

**Symbol boundary** (conversational restatement of §4.19): the LLM manipulates symbols and
grammar fields only; every symbol→node-set resolution, merge, intersection, exclusion and
ACL filter is deterministic SQL/vectorStore code. No result content or node ids ever enter
the prompt; hallucination class = no-match, not wrong-file.

#### Actions on results

`"this one Save as collection"` = existing §4.6 save path accepting `$ref` as the target arg — no
new action vocabulary. **Flattening rule:** a saved collection stores the SNAPSHOT of the
referenced execution (centroid + predicate set from that signature's last run) — replay
chains are never persisted inside definitions (session state is ephemeral; definitions are
durable). Saved semantics = semantic-section portion only (name-match exclusion kept from
§4.6); user confirm dialog applies (invariant 5's counterpart rule 5 in §2).

#### Where the LLM decides / where code decides

| Stage                                           | Owner                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| utterance→intent, delta, vector rewrite         | LLM (`parse.nl`) — the only intervention                                  |
| add/replace/exclude structuring, `$ref` binding | rule table (server)                                                       |
| rerun, intersect, exclude-similar, pagination   | SQL + vectorStore                                                         |
| ACL                                             | `fileNodesStore` final-stage joins — never bypassed (invariant unchanged) |
| ranking/merge across sections                   | deterministic section order + dedup (§4.6)                                |
| actions (save collection etc.)                  | existing domain services + confirm rules                                  |

#### RAG is a DIFFERENT product feature — boundary statement

- File finding = search/retrieval (hybrid: name SQL ∥ predicates ∥ vector; THIS plan).
- Content questions ("what are the termination clauses in this document?") = retrieval + grounded
  generation (RAG) — requires chunk-level embeddings (`doc_chunks`, a new space decision),
  request-path generation (invariant 11 exception family), citation rendering, its own
  degradation column (RAG-off ⇒ file answers only).
- Reserved now: `ai_enrichments.schema_version`+model provenance, E-space discipline, chunking
  would reuse §4.3 extraction pipeline. NOT in any phase task (§9.1).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/routes/search.md`, `docs/spec/server/services/searchService.md`

### 4.23 Provider presets and capability-completeness contract (Q3 decision)

Target reality: open-source distribution means the app cannot know which endpoint model any
installer runs (own env may be llama.cpp-fixed; nobody else's is). Governing rule: **an
offered option is a complete feature bundle or it is not offered** — a feature that is
visible but half-works under the active provider is a defect, not a degradation.

### 4.23.1 Preset manifest

`infrastructure/adapters/llm/presets.js`: per provider/server-family entry (llama.cpp,
Ollama, OpenAI-compatible, TEI-class, …) declaring its EXPECTED capability set
`{text_embed, image_embed, audio_embed, video_embed, chat, vision_chat, asr}` + recommended
budgets + server-shape flags (§4.15 provenance). (`image_embed` was removed 2026-09-16 under
"no product path consumes it"; REVIVED 2026-10-08 — §4.21 V1/V3 consume it; media embed
capabilities live on the `embed` role, probed separately from text.) Adding a provider =
adding a manifest row; core code never branches on provider names.

### 4.23.2 Probe is final authority

Extends §4.21: runtime capability flags = PROBE-VERIFIED capabilities ∩ configured roles.
Declared-but-failing (e.g. an endpoint that embeds base64 images as text — empirically
confirmed against `bge-m3@10.0.0.106:8082`; the inverse: Hana's audio declared but
mis-probed with sine tones) ⇒ capability OFF + admin warning card (declared vs probed).
**Probes MUST use _in-domain_ samples** (real speech, real photos) — an out-of-domain probe
produces false negatives indistinguishable from false capability claims (both error modes
observed this PoC). **Media-embed probes need POSITIVE controls (2026-10-08, llama.cpp EG2
b11459):** `/v1/models` declared `input_modalities:[text,image,audio,video]` while the
endpoint silently ignored top-level media fields (returned the plain-text vector,
cos≈1.0 vs text control, HTTP 200). A media capability probe MUST therefore (a) use the
profile-declared request shape (`content`-wrapper), (b) prove pixels/waveform were consumed:
near-dup self-consistency (image vs re-encode above profile band, image vs base64-as-text
below it) and cross-modal sanity (image vs its VLM caption > image vs unrelated text),
(c) verify server pooling shape matches the profile when `/props` exposes it (mis-pooling =
capability OFF — silently different space, §4.2). Text-embed probes additionally send the
profile's task prefixes; prefixes are part of the request shape, not decoration.
**Model pin — embed endpoints must be EG2 (owner 2026-10-14):** external embed activation
adds a CONFORMANCE pass — structural (dim == 768) + behavioral (fixed reference-kit strings,
median cos to canonical vectors ≥ release-calibrated threshold; llmPresets §2.2).
Endpoint-declared model NAMES are never evidence (any `--alias` string masquerades; own
environment used as the cautionary example): identity is what the endpoint's vectors DO,
not what it is CALLED. Built-in rows are exempt — the lockfile sha256 is the identity.
EG2's own ±0.02 quantization/platform drift is explicitly NOT the gate's target (same-space
noise, owner ruling); the gate exists for mapping to a different space entirely.
User-visible states are only ever `complete-working | absent`, never partial. Distinct from
DB vector capability (§4.13): missing LLM capability removes the
feature (absent), missing DB vector capability only degrades speed (fallback) — never
both ways.

### 4.23.3 Feature ↔ capability map (UI gating source)

Semantic search/seed/auto-create/near-dup ← `text_embed`; media
direct-embed search/clustering/near-dup on raw media ← `image_embed`/`audio_embed`/
`video_embed` (V1/V3, same embed role; absent ⇒ media falls back to V2/caption→E1 or V0,
never mixed-space reads); NL
features/summary/llmNamer ← `chat`; VLM captions (display + adjudicator material + the
media-embed FALLBACK, §4.21) ← `vision_chat`; ASR transcription ← `asr`. Absent capability
⇒ that feature is absent, not degraded — every advertised path is end-to-end functional
under its own preset.

### 4.23.4 chat-only (no embed) is a legal deployment

Entire vector core = §4.12 None-column behavior (manual collections, rules, dups-by-hash,
name search) — no half-AI state exists.

### 4.23.5 Surfaces

(b)-decision 2026-09-17, amended 2026-10-14 — setup wizard gains one OPTIONAL, skippable
"AI" step — **covering chat/vision/asr only: the embed role needs no setup (built-in engine,
§4.2)**; preset
picker → role checkboxes → base-url/key/model inputs → per-role test (`/api/setup/test`
new target `llm`); values are stored as **DB settings rows** (NOT `.env`/envFileWriter —
the hot-apply rule §4.2), so a skipped step costs nothing and a mid-install config is
restart-free. The step also surfaces the embedded-engine provisioning status card — during
the wizard it shows the waiting state ("begins when setup completes"); live per-file download
progress and the ready / caps-off outcome arrive after completion (PLAN §22-5). Full config surface stays in admin
(`/api/admin/config` + test + capability
matrix, where an external embed server may be configured as an OVERRIDE replacing the
built-in); wizard is a shortcut to the same rows. SETUP.md documents preset table;
capability matrix display (per-role probe chips) shared by both surfaces.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/llmPresets.md`, `docs/spec/server/routes/setup.md`, `docs/spec/client/pages/Setup.md`

## 5. Schema (PG-canonical; sqlite via transpiler). Single-file DDL: ALL §5 tables (P0–P4)

live in `server/store/postgresql/ddl/001_initial_normalized_schema.sql`; the numbered chain
resumes at `002_…` only after the platform merge. Dev-DB checksum recovery and the manual
prod migration at the `ai-feature`→`dev` merge/deploy — see PLAN §6 DDL policy.

All: snake*case, TEXT+CHECK enums, `created_at TIMESTAMPTZ DEFAULT NOW()`, indexes
`<table>*<purpose>`.

- `collections(id, owner_id→users, name, name_locked, origin, status, definition JSONB,
publish_mode, pinned, pinned_by CHECK(user|auto) NULL, archived_at, last_member_change_at,
activity_score REAL NOT NULL DEFAULT 0 (§3.4), created_at, updated_at)`; partial-unique
  (owner,name) active.
- `collection_items(collection_id→CASCADE, node_id→CASCADE, added_by→users, published,
created_at, PK(pair))`
- `collection_exclusions(collection_id→CASCADE, node_id→CASCADE, created_at, PK(pair))`
- `collection_grants(collection_id→CASCADE, grantee_id→users→CASCADE, role, granted_by,
created_at, PK(collection,grantee))` — never referenced by file-ACL code.
- `collection_visibility(user_id, collection_id, hidden, PK(pair))` (leave — endpoint retired by
  Path 1 §12.1; the store visibility primitive remains with no API caller at P0)
- `collection_centroids(collection_id→CASCADE, model_id→llm_models, centroid TEXT,
member_count, updated_at, PK(collection_id,model_id))` — model_id is the MODEL-VERSION key
  (a stale-model centroid must never mix into new-space math; §4.20/§4.21 — the V1
  space-pair rationale is retired, the PK survives because model swaps are real)
- `collection_tombstones(owner_id, def_fingerprint, deleted_at, PK(owner,fingerprint))`
- `collection_digest_cursors(user_id, collection_id, last_visited_at, PK(pair))`
- `file_likes(user_id, node_id→CASCADE, created_at, PK(pair))`
- ~~`tag_embeddings(...)`, `tag_parents(...)`~~ — **RETIRED 2026-10-16 (§4.18 dissolution)**;
  definitions linger in 001 until the big-bang migration removes them; NO code may
  reference them
- `ai_tag_raw(node_id→CASCADE, tag, PK(pair))` — materialized LOCAL derived tags only
  (kind-prefixed `mime:`/`ext:`/`month:`/`path:`, folded by derivedTagsService before
  write). LLM tags are NOT stored here (§4.18: never materialized, never normalized
  institutionally; read-time fold is a pure function for display/naming counts)
- `usage_events(id, user_id, node_id→CASCADE, action, created_at)`; idx(node,created),
  (user,created)
- `node_activity(user_id, node_id, opens, downloads, previews, search_hits, last_seen_at,
likes, score REAL NOT NULL DEFAULT 0 (§3.4 item accumulator), updated_at, PK(pair))`
- `action_journal(id, domain CHECK(collection|batch|settings|permissions|tags|file|sharing),
subject TEXT, subject_label TEXT, actor, action, payload JSONB, chain_seq, status
CHECK(applied|undone|expired), created_at, undone_at, expires_at)`;
  UNIQUE(domain,subject,chain_seq); NO FKs.
- `collection_merge_suggestions(id, a_id→CASCADE, b_id→CASCADE, score BIGINT,
state, dismissed_at, rejected_at, arbiter_verdict TEXT NULL, arbiter_reason TEXT NULL,
created_at, UNIQUE(a,b))` (arbiter columns: advisory prefill on the §4.4 card, never
  auto-executes)
- `file_suggestions(id, user_id, node_id, kind, reason JSONB, state, created_at,
expires_at)`
- `admin_reports(id, kind CHECK(gc|migration|failsafe|night_eval|cleanup), status, payload
JSONB, created_at)` — the startup fail-safe scan (`failsafe`) carries a
  `contentHashCompleteness` payload section (`{nullCount, checkedAt}`, T0.1 boot probe);
  row-level repair dispatches via `POST /api/admin/reports/:id/repair`.
- `llm_models(id, role CHECK(embed|chat|vision|asr), provider,
engine CHECK(embedded|remote) default 'remote', base_url_key, model_name,
precision NULL, model_revision NULL,
max_input_chars, chunk_budget, batch_size, reasoning CHECK(on|off) default 'off',
enabled)` — reasoning is an experimental per-model switch only; all roles plan for off
  (E5/E7b); engine/precision/model_revision added 2026-10-14 for the built-in engine
  identity (§4.20) — embedded rows carry base_url_key='' (no URL)
- `embeddings(node_id PK→CASCADE, model_id→llm_models, dim, vector TEXT, source
CHECK(fulltext|chunk_pool|head|metadata_only|media_direct), content_hash, updated_at)`
  (`media_direct` added 2026-10-08 for §4.20 E1-M; segment rows ride `embeddings_chunk`
  like text chunks)
- `embeddings_chunk(node_id→CASCADE, chunk_idx SMALLINT, vector TEXT, model_id→llm_models,
updated_at, PK(node_id,chunk_idx))` — retained per §4.3; search scores max-over-chunks
  (§4.13 seam); derived-cache semantics: dropping rows loses only long-doc recall depth
- `ai_enrichments(node_id PK→CASCADE, features_model_id→llm_models, schema_version INT
default 1, tags JSONB, summary, caption, caption_model_id→llm_models, transcript,
asr_model_id→llm_models, probe JSONB, truncated, media_kind, updated_at)` — Q6 decided:
  **separate lineage per producer family (LLM/VLM/ASR may point at the same model row)**;
  provenance columns decouple DB from any model's output schema (Gemma4 12B et al. binding
  forbidden); consumers interpret JSON **by `schema_version`**, richer keys
  (objects/scene/relations) arrive as v2 rows or a side table at demand time; no v1
  implementation of extended keys.
- `ai_jobs(id, node_id→CASCADE, generation, kind CHECK(embed|features|caption|asr|backfill),
status CHECK(pending|running|done|failed|skipped), attempt, next_retry_at, last_error,
content_hash, created_at, started_at, finished_at, UNIQUE(node,kind,generation))`;
  idx(status,next_retry_at)
- `ai_usage_daily(day TEXT, role, calls, input_chars, cached, degraded, failed_429,
PK(day,role))`
- `query_parses(normalized_query PK, predicates JSONB, vector TEXT NULL, hit_count,
created_at)` — NL cache + E2 query-embed cache; the normalized signature doubles as
  §4.22's `result_ref` key (no separate table)
- `filecache.content_hash` populated in place (column exists, no DDL change).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/store/ (collections/fileLikes/actionJournal/aiJobs/embeddings/embeddingsChunk/aiTag)`, `docs/spec/server/routes/ (collections/search/actions/admin)`

## 9. Rejected during design (do not re-introduce without new evidence)

Personal-insight dashboards for users; definition editor UI; membership storage for derived
collections; proposal-inbox/alarm-center surfaces; merge-without-proposal; nested
collections ("sub-collection" terminology banned); inline like hearts on list rows (context
menu + properties header only); top-level `__liked__` virtual root (Likes is a Collections child
row, §12.4); event-sourced exact digest counts (display-truth approximations, §12.2); subset/parent-child hierarchy proposals in v1 (merge is
same-size-only, §4.9c); auto-archive of user-origin;
hierarchical chat summarization; ORM adoption gate; Redis cache coupling;
clear-all-style bulk destructive admin actions; LLM backfill on model change without
explicit admin trigger; notification/`ask`-centering of evolution; real-time SSE (none in
stack); admin-created collections on behalf of users (Q5 — NO; any future org-wide content
requires a third origin axis + separate visibility model + proposal mechanics as a SET,
which reintroduces conflicts with §2 invariants 3/4 — treat as its own product feature,
not admin impersonation); stored/snapshot `result_ref` replay variants (Q7 — always-replay
decided); hnswlib-node (A-plan decided: node:sqlite+vec0 for sqlite, ANN headroom lives on
the PG tier); AI-off on missing vector capability (superseded 2026-09-15 — now
JsFallback-degrade + admin performance warning, §4.13); PoC-retired 2026-09-16: **audio
attribute generation** (genre/mood/kind/desc — E13 self-contradiction, transcription only
§4.21), ~~**V1 image-embedding path** (single text space, E4c decision)~~ — **REVIVED
2026-10-08 (owner)**: probe-verified multimodal space (EmbeddingGemma 2, PoC addendum)
invalidates the incomparability premise (§4.20 E1-M/§4.21); the audio-attribute-generation
ban and the dynamic-baseline/no-absolute-θ rules SURVIVE the revival**, **absolute-θ topic
gates & stored cosine floors** (E2v2 — relative/dynamic only), **connected-components
clustering** (E4 chaining), **tag cos-merge + co-occurrence evidence gates** (E6c — §4.18
3-step replaces), **tier lifecycle exemptions & purity suppression** (uniform rules only,
A4 decision), **`ef_search=100` defaults** (E11: 0.74 external recall — 400 fixed),
**reasoning-for-judgment assumption\*\* (E7b v2: noise at n=2; all roles off).

### 9.1 Extension points reserved (deferred, NOT rejected — do not implement until trigger)

| Item                                                  | Reserved via                                                                                                         | Revisit trigger                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Conversational UI / multi-turn routes / session table | §4.6 optional `result_ref`/`session_id` fields; §4.22 rules; opaque-string ref type                                  | user demand; or replay drift observed as real complaint (then: session-table swap stays internal)      |
| RAG content-Q&A                                       | invariant 11 exception family; §4.3 extraction pipeline reusable                                                     | becomes a product decision with `doc_chunks` + new embedding-space decision (§4.21 discipline applies) |
| Richer semantic fields (objects/scene/relations)      | `ai_enrichments.schema_version` (v2 rows)                                                                            | vector-fallback success rate measurably poor on such queries                                           |
| Runtime calibration (from release constants)          | profile fields exist (`llm_models.reasoning`, θ provenance §4.15); dev-owned reference set lives outside the product | measured corpus drift (dynamic-baseline alerts firing often) makes the procedure a product need        |

## 10. Open questions

None outstanding (2026-09-15). The 2026-09-29→10-02 P0 rulings (Path 1, Decision B, Ruling B,
cursor/dot, dashboard P0 scope, publish gate) are ledgered in §12. Q1–Q7 resolved and absorbed into their sections: Q1 tombstone
fingerprint/lifetime (§4.9 pass 4, §4.15), Q2 initial-set publish (§4.5/§4.7), Q3 provider
presets & completeness (§4.23), Q4 checkbox suggestions (§4.16/§4.17), Q5 admin-created
collections → rejected (§9), Q6 per-family model lineage (§5 `ai_enrichments`, T1.2 unblocked),
Q7 always-replay (§4.22/§9). Q8 (2026-09-15, PoC-driven) vector backend policy → A-plan:
node:sqlite+sqlite-vec / pgvector≥0.7 native, JS fallback degrade never gate (§4.13).
Q9 (RESOLVED 2026-09-16): multi-vector chunk retention ADOPTED via A1 (§4.3/§4.13);
residual open part = cost/scale calibration (index size, chunk-row bloat) measured during
T1.4 at 100k+ — a sizing study, not a decision. Q10 (NEW): remote-provider adoption requires re-measuring
profile constants on the dev reference set (release-runbook step, not a product feature —
§4.15 provenance). **STATUS 2026-10-08: TRIGGERED → battery run** — text bands/chPerTok/
throughput/E12 + image/audio/video bands + tag vocabulary measured on the dev reference set
(PoC addendum §6.5); llmPresets EG2 row carries the values. Ship-blocked sub-items closed:
text θ_dup 0.955, chPerTok 1.5, recall@20 image-direct 1.000 (vs 0.829 caption path).
Q11 (NEW): **θ_lo absolute-containment rule (parent hints §4.18) not usable on EG2** —
reference-set measurement: containment P10 0.8025 < sibling P90 0.8913 and unrelated tags
P50 0.7527 (band overlap by design of the model's anisotropy, not a harness bug). Options:
percentile/rank re-anchoring, margin-based promotion, or accept 21%-recall θ_lo=0.92.
**OWNER DECISION REQUIRED before T1.8 ships on EG2**; llmPresets thetaLo stays unresolved.
**Q11 CLOSED 2026-10-16 BY DISSOLUTION** — parent hints/θ_lo/θ_tag retired entirely: tags
are descriptive-only (§4.18, PLAN §19); no re-anchoring needed, no label battery needed,
T1.8 withdrawn. The measurements above stand as the evidence trail.
Quantization-cause hypothesis TESTED AND REJECTED (Q8_0 control re-run, 2026-10-08: class
bands moved ≤0.008 vs Q4_K_XL, containment-P10/sibling-P90 gap persists at −0.096) — the
compression is the model's space geometry, not the GGUF precision.
Q12 (REVISED 2026-10-14, same day — EG2 model pin supersedes the per-precision re-check
list): outstanding release items are ① calibrate the **conformance reference kit** threshold
— positives: EG2 across {GGUF q8/q4_K_XL, ONNX q4/q8, fp16}; negatives: **embeddinggemma-1
(768-d twin)** + one further 768-d foreign model; τ ships as a measured artifact (never a
guess); ② q4 long-audio pooling drift observed (informational only — no gate). **Q12① DONE
2026-10-15 (owner: run before P1)** — dev-box battery, canonical = built-in ONNX q4 text
(doc-prefix `title: none | text:`, single-string, unit-norm): positives (median-cos vs
canonical) ONNX q8 0.9857 / GGUF Q4_K_XL GPU llama.cpp 0.9855 / ONNX fp16 0.9858, worst pair
0.967; negatives embeddinggemma-1 twin 0.033 / bge-base-en-v1.5 0.040, max pair 0.100 —
clusters fully separable, no overlap. **τ = 0.90 shipped** — chosen over the 0.51 cluster
midpoint for asymmetric failure cost (false-accept = silent corpus-space contamination;
false-reject = visible, admin-correctable) and mid-band protection against EG2-family
derivatives; margins ≥0.067 accept / ≥0.80 reject. Coverage note: GGUF-q8-server positive
not measured (not served; moot under the single-θ pin ruling) — coverage = engine×precision
bracket; the twin was tested via ONNX. ONNX fp16 measured non-degenerate in-process: the
§4.2 fp16 caution is llama.cpp-compute-specific, not export-specific. Artifact:
`server/infrastructure/adapters/llm/eg2-reference-kit.json` (24 strings + canonical vectors +
sha + full record). Owner
ruling 2026-10-15: the <100 ms query-embed clause is DELETED from §4.2 — the
per-hardware latency verdict item is dropped with it (latency/serving-mode numbers remain
informational profile fields). Precision-specific
θ re-calibration is WITHDRAWN: ±0.02 same-space drift is tolerated by owner ruling, θ
constants are single-set per model. Provisioning stays **boot-blocking with CLI progress
log**; llm_models `engine/precision/model_revision` DDL
additions ride the **big-bang migration at the `ai-feature`→`dev` deploy** (owner is the
sole user — no compat path needed).
New open questions get appended here before/at their named task.

## 12. P0 decision ledger (consolidated from contract specs, 2026-10-02)

> Contract specs (`docs/spec/**`, `docs/features/collections-platform.md`) carry decided/implemented
> state ONLY. The decision process — dated rulings, rationale, rejected alternatives, register/task
> provenance — lives here (design authority) and in PLAN §9–§15 (execution ledger: waves/branches/
> commits, verbatim owner records). Decisions already stated in §2–§9 are not restated — pointers
> only. _amends_ marks body corrections applied when this ledger was compiled.

### 12.1 Sharing & grants (Path 1)

- **Path 1 self-revocation** (owner ruling 2026-09-29, PLAN §10 P-1) _amends_ §3.2/§4.7/§5:
  recipient exit = real grant revocation `DELETE /api/collections/:id/grants/me` (instant, no
  confirm — revoke is exposure REDUCTION, silent per the §4.11 asymmetry); labels unified with the
  file-sharing receiver term (EN "Revoke permission" / KO "권한 반납"); the view-local `hiddenIds`
  hide removed; the original `leave` = per-user hidden-flag design retired (visibility table still
  read by list SQL, `setVisible` retains no route caller at P0). Rationale: a local hide that
  leaves the grant live is a false exit.
- **Publish controls = owner OR editor** (P-4 ruling 2026-09-29) _amends_ §3.2's "shared
  collections only": own collections serialize `granted_role: null` (the owner has no grant row),
  so the manage gate is `{owner, editor} ∪ null`; viewers hidden. The pre-fix `{owner,editor}`-only
  test hid the publish menu from owners (the bug); the pre-P-4 owner-only spec line contradicted
  the owner case — parity with `addItems` was decided by the owner. Fix is CLIENT-side: the wire
  never invents `granted_role:'owner'`. (Code: `MemberRowControls.js` gate, `service.js publishItems`.)
- **Publish route classifies ids against the RAW membership set**, not the grantee-filtered member
  view — editors can flip stored rows invisible to their own listing; the endpoint can never graft
  a foreign node into membership (P-4).
- **Re-grant clears the grantee's hidden state** (2026-09-29): a fresh grant IS intent to show.
  **No separate un-hide endpoint in v1** — re-grant is the sole recovery path; an un-hide UI is
  additive-only if real usage demands.
- **Rule definitions owner-only** (2026-10-01): a rule definition leaks the owner's predicate set;
  grantees never receive it.
- **`preview_items` card payload** (P-3 ruling 2026-09-29; filter _amended_ 2026-10-01): 2×2 card
  previews are built from the already-resolved list rows + one mime field; shared-excluded rows DO
  preview to the OWNER — the former preview-side exclusion "protected nothing and desynced card
  vs list"; grantees never receive those rows at all.
- **404 masquerade, never 403, for non-readable objects** (files-read precedent): collection
  existence is not leaked; journal rows for non-visible subjects 404 likewise (journal ids leak
  nothing about other users' activity).
- **Revoke-undo = re-grant behind an explicit user undo-click** — exposure expansion is never
  silent (§2 rule 2, §4.11 asymmetry); the "already-visible metadata cannot be re-taken" stance is
  unchanged (grant snapshots restore future state only).
- **Admin-as-grantee banned at grant creation** (operator rule, §3.2 pivot) — collections are
  personal surfaces; no grant row may name the admin actor.

### 12.2 Digest cursor & sidebar `new` dot (2026-10-01; Ruling B 2026-10-02)

- **The read IS the visit** (owner ruling 2026-10-01) _amends_ §4.11 surfaces-(5) and completes
  §4.8: the server stamps `collection_digest_cursors.last_visited_at` implicitly on the items read
  (one fetch per open fits it); `last_visited_at` rides the GET / rows (null = never visited); the
  dot ⇔ null for ANY viewer — the old "system-create cue only" wording was wrong.
- **Seed at create, inside the mutation TX** (2026-10-01): create leaves exactly ONE cursor row
  for the creator ⇒ self-created collections never dot; a post-commit seed would leave partial
  state on rollback.
- **Client localStorage visit heuristics retired** (2026-10-01, PLAN §11 FU-5): the
  `created_at > stored-cursor` sidebar heuristic was REMOVED — the server cursor is the dot source.
  (Digest DELTA requests still ride a client-held per-collection visit stamp — `since` — owned by
  the listing host; the two cursors are distinct concerns.)
- **Ruling B** (owner ruling 2026-10-02, PLAN §15 I1): the journaled revoke TX — owner-side revoke
  AND grantee self-revoke — deletes the grantee's cursor row ⇒ re-grant re-dots; undo-of-a-revoke
  restores the grant but NOT the cursor ⇒ undo-revoke re-dots too (owner-accepted boundary).
- **Digest counts are display-truth approximations from live state**; the exact event-sourced
  variant is rejected (§9).

### 12.3 Listing, paging & ordering (Decision B)

- **Decision B** (owner ruling 2026-09-29; verbatim record PLAN §10): member/liked listings ship
  the FULL row set in ONE response; retired `cursor`/`limit` params are IGNORED (never an error);
  `next_cursor` absent from the wire; the load-more button deleted; client display paging is the
  shared `useInfiniteScroll` 50+50 slice over server order. Rationale: fileManager precedent
  (`getChildren` has no LIMIT); the ruling eliminates the whole members-cursor defect class
  (first-unreturned encoding, row-gap at page boundaries) by deleting the mechanism. Wire helpers
  (`encodeCursor`/`decodeCursor`/`clampLimit`) removed — grep-verified no other consumers.
  RETAINED under the ruling: the visit stamp ("the read IS the visit") and the `since` digest.
- **Unpaginated at personal scale**: the collection card list (mirrors §3.1's "≤~20 rows" cluster
  precedent) and the journal feed (cap 200, newest-first, no cursor — mirrors the same stance).
- **`id DESC` tie-break** (RCA 2026-09-23, PLAN §9 E2E batch): every timestamp-ordered listing
  ends in `id DESC` — a plan-dependent row order corrupts cursor-less full-set rendering.
- **`include` tokens select ROW SETS** (RCA 2026-09-23): `include=archived` means the
  ARCHIVED-ONLY set; a `status` default never leaks into the query; archived rows never arrive
  twice.
- Item ordering while `activity_score` is absent/all-zero falls through to timestamps then
  `node_id` asc — behavior normed in §3.4; the T0.3/T0.6 staging behind it is PLAN §9 history.

### 12.4 Likes

- **Surface** (owner ruling 2026-09-29, PLAN §10 P-5): Likes = a Collections-section child row at
  `/files/__collections__/liked`; the earlier top-level `__liked__` virtual root is REJECTED (§9).
- **Separate `/api/file-likes` mount**: likes are per (user, node), not per collection, AND the
  collections router's `/:id` parameterized routes would shadow a `/likes` literal — the mount is
  structurally forced, not stylistic; the router file stays in the collections domain (PLAN §6
  kebab-plural convention).
- **`file_likes.created_at` is insert-only** — no upsert-time bump: no recency ordering exists for
  likes (contrast `recent_files`); ordering, when needed, is `created_at DESC` client-side.
- **Liked-items order contract = `node_id` asc** — no liked-at stamp exists to order by; reads ride
  the house-style per-node loop (no batch node read).
- **Malformed toggle payload reuses the generic invalid code** (`emptyNodeIds`-style precedent):
  the toggle is client-initiated and never guesses a node id.
- **Like = self-reversing state**: no journal row, no undo pointer (§4.11 matrix). The change
  notifier is CO-LOCATED inside `fileLikesRepository` (no `fileLikesNotifier` twin) to keep the
  integration surface minimal.
- **`collection: null` gate (P-5)**: the Liked surface hosts the shared member menu with no
  collection context — membership/publish controls resolve structurally FALSE (gate is
  structural, not role-based).

### 12.5 Dashboard & suggestion accept (A7, P0 scope)

- **A7 + P0 scope** (decision 2026-09-22) _amends_ §4.16/§4.17: P0 ships hygiene READ surfaces +
  computed exact-dup suggestions + ACCEPT only; no LLM/vector blocks. Suggestions are COMPUTED,
  not persisted — persisted `file_suggestions` (ids, dismiss, expiry) rides T3.3; the §4.17
  "expire with the retention job" wording is scoped to the PERSISTED rows (computed rows carry no
  `id`/`expires_at`, render no dismiss control).
- **Accept is NOT journaled at P0** _amends_ §4.11/§4.16/§4.17: journal writers = collections-only
  until P3.5/T3.3; the trash-restore UX IS the undo path; accept returns a report toast WITHOUT an
  Undo button; the command-unit journal row ships with the T3.3 `file_suggestions` route spec.
- **Keep rule = smallest `node_id`** in each dup group — P0 has no keeper-adjudicator (chat role);
  deterministic stability beats cleverness; users re-check siblings via the checkbox list.
  (Heuristic ordering is also the §4.19 "chat off ⇒ fallback" column, correct by construction.)
- **One GET** feeds hygiene cards and the suggestion list (single dup pass, one round trip);
  **`/api/dashboard` is singular** (`/api/search` precedent — a personal surface, not a
  collection); empty storage / missing user root = ZEROS, never 404 (pull-overview stance §4.16).
- **register (a)** (wave-2, PLAN §9): `search_hit` + list-entry-click recording rides a DEDICATED
  `POST /api/search/click` (`action='open'`) — search-result opens are pure client navigation and
  no existing low-frequency endpoint exists to piggyback on; each other list wires its own
  recording point in its owning wave. `open` and `GET /versions/download` are DELIBERATELY not
  recorded.
- **register (b) accepted gap**: NULL `content_hash` rows NEVER form a dup group (NULL ≠ a hash of
  anything — grouping on NULL would invent duplicates); the boot completeness probe + admin repair
  backfill cover the gap until the §4.1 upload/copy/restore write-side population (T1.3) lands.
- **register (d)** (decision 2026-09-23) _amends_ §4.11: the 30 d feed renders `subject_label`
  VERBATIM and never re-resolves (a vanished subject must still render its row) — EVERY
  collection-domain journaled mutator captures the label at commit time (capture table: store spec
  §2.1). Cost = the existing pre-read or exactly one extra `getCollection` (same shape as
  `renameCollection`'s pre-read precedent); a vanished-subject race yields `subject_label null` and
  the row renders with its action label — ACCEPTED.

### 12.6 Journal API & undo UI rulings

- **No undo-of-undo** — the status flip IS the record (§4.11 body amended).
- **Cascade = 409 + re-post with `confirmCascade: true`** — a dedicated `?force` flag and a
  two-phase token were rejected; the dialog counts come straight from `params.laterChanges`, and
  `is_tip` rides each row so the client plans the dialog without a round trip.
- **Actions router deliberately NOT admin-gated**: every mutating endpoint already 403s admin
  requesters (operator rule §3.2), so admin actors have ZERO journal rows — the feed is EMPTY BY
  CONSTRUCTION; usage recording is unchanged by the gate's absence.
- **Undo toast auto-hides at 8 s** (longer than the default to keep the action reachable); the
  ≤ 24 h window governs toast re-show/recovery paths ONLY — the 30 d dashboard feed carries undo
  beyond that horizon.

### 12.7 Search rulings

- **Request bodies camelCase except the documented search exceptions** — `/search/click` posts
  snake `node_id`: a camelCase rename there adds a mapping step with zero benefit (wave-2 Case-A
  defect fixed against this contract).
- **POST (not GET)** although read-only — keeps query strings out of access logs (§4.6 contract).
- **≤ 3 segments is a SCORING bound, not input validation**: longer queries score the first three
  segments and set `semantic_capped_segments`; never rejected.
- **The baseline corpus sample is EXCLUDED from the `result_ref` signature** — execution noise,
  not query identity; replay re-samples.
- **Whole-string containment only — token-AND explicitly NOT used** (§4.6): a multi-word query
  legitimately returns zero name matches; that is the semantic section's job.
- **Name results carry ids+names only** — no type/size fields (listing enrichment is the single
  source); highlights are COSMETIC-only, computed client-side (§4.6).
- **Unavailable semantic section still returns 200 + flag** — §4.12 codes report AI ABSENCE, never
  a missing section of a successful query.
- Results-mode component: named for the plan surface ("results mode"), it is a header+sections
  chrome — NOT a `FloatingSearchBar` input replacement; desktop = breadcrumb-row swap, mobile
  renders above the list (no breadcrumb row exists there); recent queries live in `sessionStorage`
  behind a tiny browser-storage adapter seam (`recentQueriesStorage`), cleared on logout.
- Search-origin save-collection flattening + confirm-dialog copy ride T1.5 (PLAN §9 residuals).

### 12.8 LLM config precedence (2026-10-02, code-confirmed)

- `LLM_*` registry entries are **`dbOnly`**: the resolver reads DB → default and IGNORES env — a
  `.env`-provided `LLM_*` value is NEVER effective; DB (admin surface) is the only config source.
  The earlier §4.2 note ("`.env` remains legal, resolver env>db precedence, `setInEnv` locks the
  editor") predates the dbOnly registry and is superseded (`setInEnv` remains for db-sourced
  non-`dbOnly` keys). Verified against `configRegistry.js` (LLM block `dbOnly: true`) and
  `configResolver.js` (`!entry.dbOnly` env gate).

### 12.9 AI-domain stores, jobs, vectors, tags

- **One repository interface covers the whole `collection*` table cluster** (repository-contract
  rule 1); conformance grouped per table.
- **Merge is the only dual-subject journal writer**: the merge pre-read runs OUTSIDE the
  `commitChange` TX while holding the LOSER's journal subject lock — deadlock-free by
  construction (no other writer locks two subjects).
- **Merge allowed for any owned active pair WITHOUT a pending suggestion row** — a suggestion is a
  hint; its state transition is opportunistic. Suggestion rows order `score desc` (score is the
  §5 scaled ×1000 BIGINT).
- **One create endpoint, additive body fields** (`{name}` manual / `{name,seedNodeId}` seed /
  `{name,semantic}` search snapshot) — shape dispatch, not more routes.
- **Seed preview never blocks on enrichment**: an unembedded seed has no vector basis ⇒ count 0 +
  degraded flag; the dialog says so client-side via the empty result.
- **Rule-evaluation mechanism (P0 as-shipped)**: membership candidates materialize via ID-only
  queries, predicates evaluated in JS; the ACL-joined SQL candidate scan is a TRACKED optimization
  (not shipped — personal scale; revisit when corpus sizes demand); the vector-matched tag variant
  is P1 (T1.8/T2.1) — the cosine-free None-column variant ships first (§4.12). Upload-hook rule
  check + `content_hash`/derived-tag commit-point wiring are callable seams with no wired caller
  until the §4.1 hook task (PLAN register (b)).
- `DELETE /items` carries a JSON body — same channel shape as POST for symmetric batch semantics.
- Grant error codes are thrown by the collections service today; the delegation into
  `collectionShareService` lands with its own task (target contract unchanged).
- **`ai_jobs`**: no delete methods beyond the `node_id` FK cascade — enqueue idempotency makes
  tombstone retention unnecessary; terminal rows are history. Features/caption/asr re-run skip
  compares the PRIOR DONE JOB's stamped `content_hash` (job-row comparison — lineage columns
  record the model, the job row records the content). Retry backoff = plain exponential, NO
  jitter, module constants — a failure-rate knob, not an AI-quality threshold ⇒ not per-model
  profile material.
- **`embeddings`**: the store persists `dim` as given and TRUSTS the caller's modelId — no
  `llm_models` lookup; cross-model comparison is prevented by the modelId READ FILTERS, not by dim
  validation. **`embeddings_chunk`**: replace-only API ⇒ single-model homogeneity per node by
  construction (no per-chunk upsert ON PURPOSE); readers may assume it.
- **vectorStore**: derived shadow-artifact names are FIXED literals (`…_pg` / `…_vec0`) so ops
  runbooks can reference them; vec0 binding asserts BigInt (not double) and skips `id > 2^53`
  sentinel rows with a warning (product ids are sequences far below); `ef_search` is fixed in code
  and NOT a knob — making it tunable invites re-introducing the banned library default (§9).
  Benchmark figures live ONLY in §4.13/§4.13c's evidence columns — cited as justification
  anywhere else they read as runtime-calibration, which §4.15 forbids.
- **Chat params**: send only probe-verified params — unknown params break strict servers (§4.19).
- **`ai_tag_raw` SQL rides the aiTag repository** (no SQL outside repositories). ~~the repo
  parses TEXT → `number[]` ... Tag-parent hint edits are NOT journaled~~ — vector-cache and
  parent-hint clauses removed with §4.18 (2026-10-16).
- **Derived tag values are KIND-PREFIXED** (`mime:`/`ext:`/`month:`/`path:`; T0.9 ruling) — derived
  tags are the ONLY `ai_tag_raw` content (§4.18 dissolution: LLM tags never materialized), and rule
  predicates are self-describing (v1 set + EXIF rejection per §4.10).
- **Nightly usage rollup**: the tick is log-only — NO `admin_reports` row (the §5 kind CHECK enum
  has no rollup kind; §4.14 Tier A persistence is GC-scoped); the read→upsert cycle is
  deliberately NOT one TX — watermark idempotency makes crash-recovery a no-op re-run and the
  ≤ 500-member sums keep the window negligible (§3.4).
- **Preset manifest**: ~~no `image_embed` key anywhere (V1 retired — §9)~~ _amended
  2026-10-08_: media embed capabilities REVIVED (owner, PLAN §16) — §4.21/§9 govern;
  release-pending models ship
  as null values + `pending:true` and are NOT offered in the picker; the release-measurement
  checklist belongs to the release runbook (§10 Q10), not the product spec.

### 12.10 UI polish rulings (P/M/F/A series)

Verbatim owner records live in PLAN §10–§12/§15; the decided states are in the owning specs.
Consolidated rulings: one context-aware sort button, private menu deleted, ephemeral state (P-2);
grid-parity cards — 2×2 previews (§12.1), file-parity click semantics with the chosen "card-local
equivalent" 350 ms double-tap tracker, card menu loses `open`, selection bar = fixed set per
surface (active: Pin/Unpin/Archive; archive view: Restore/Delete — no Rename/Leave/Sharing) (P-3);
member view modes persisted per surface (`collectionMemberViewMode`, default grid; file browse
untouched) (P-4); Likes child row + liked-items endpoint (P-5, §12.4). NO numeric counts anywhere
in sidebar/cards (M-1 + FU-2: member-count line removed — `item_count` stays WIRE-ONLY unrendered;
`archiveCount` badge and its second `mine,archived` fetch removed; ArchiveNode renders
unconditionally — the empty destination is not dead); status chip removed — archive membership is
view-scoped (M-4); card badges top-LEFT corners — autopin = PushPin+AutoAwesome composite (click
unpins), user pin = plain PushPin, received = generic `Share` glyph (`Checkroom`/`FolderShared`
retired on cards; the tree keeps the plain Collections icon — its received-icon swap retired);
menu icons on ALL card-menu items (M-3); like state = theme `like` token (`#FF3E55`), never
`error` — delete-red vs like-pink semantic split documented at the theme (M-5); long names
MIDDLE-truncated with FIXED budgets — menu paper 280 px ⇒ 192 px name budget, seed tile ⇒ 190 px
(`maxWidth="md"` 900 − 2×24 − 3×8 = 828 ⇒ 207 − 2×8), font = the 16 px body1 the theme actually
renders; CSS tail-ellipsis retired; no shared width constant exists — values pinned from the
inline-create row + MyPage Select-paper precedent (M-6/F1); digest banner mounts ONLY when
added/removed > 0 — an all-zero `since` digest is noise (M-7); member/liked sorting like files —
per-surface persisted `collectionMemberSortMode` (default `date_desc`), the FULL row set sorted
client-side BEFORE the infinite-scroll slice, date = membership-added (`serializeItem.created_at`;
revoked → null pins LAST), the collections LIST surface keeps the 5-option server-sort menu (M-8);
breadcrumb title chips — member route `Collections › <name>`, liked route `Collections › Liked`
(home-chip replacement precedent of trash/recent; transient `…` segment while the list loads —
never hides the trail) (M-9); pseudo-tiles — active view = Likes FIRST + Archive LAST, ARCHIVE
view and LIKED surface render NONE ("archive에 likes 아이템이 있으면 안돼", F3 supersedes M-2's
"only the Likes tile" default), tiles excluded from selection/sort/cluster/card-menu AND the
empty-state gate (empty section still shows tiles); archive-view own-card menu renders Restore IN
PLACE of Archive (Rename/pin/Restore/Sharing/Delete) (T0.4 as-built); card empty-preview fallback
glyph = the sidebar Collections glyph, never a file-tree folder icon (2026-10-01 owner ruling).
**Member-state chips → BADGE markers in ALL three member views** (FU-3): `shared_excluded` =
VpnLock (globe+padlock — "member file not delivered to collection viewers"); publish-pending =
composite Public globe + Pending glyph; ONE shared `MemberStateBadges` component, currentColor
inherited; testids `-badge-` replaced `-chip-` everywhere; `sharedExcludedChip` i18n key deleted
(KO-truncated orphan); revoked rows render NEITHER badge (the flag-only chip-era gating leaked the
pending marker onto revoked rows — server fix: revoked stored rows carry `published:false`); the
in-menu not-shared chip STAYS (menu-internal detail, prior owner call); pending warning tone rides
the badge CARRIER (plate bg / inline color, MUI `warning.main`), NEVER the glyphs (FU-4,
2026-10-02 closeout); corner badges inset 8 px (matches the top-right processing-overlay rhythm);
list geometry = overlay on the leading icon column, grid = `CardTile.cornerBadges` slot (M-4
mirror), detail = inline 16 px before the name. `CardTile`/`ResponsiveCardGrid` were extracted
from the FileGrid\* JSX bodies with the original suites kept UNCHANGED as regression anchors (P-3)
— the parity is the contract, the extraction is history.

- TreeRow single-source ruling (PLAN §12, 2026-10-01) _amends_ the §6 client-layering note: the
  collections tree rows share ONE row implementation with the file tree (level-based indent — the
  earlier per-surface `pl:3`/24 px pins retired, one indent idiom); padding equality alone had
  hidden a 24 px icon misalignment (ruling A follow-up); BaseFolderTreeItem name cells
  MIDDLE-truncate (was CSS ellipsis + ResizeObserver detection) and tooltip delay is 300 ms —
  these are the current facts, not deltas.
- `FileDetailRow` keeps the default row memo — a field-only custom comparator was REJECTED (stale
  drag/drop-handler closure risk in the shared renderer).

### 12.11 Client structure & doc conventions

- Hook specs live under `docs/spec/client/hooks/` even when the source is page-local
  (`useRecentFile`/`useFileManager` precedent); `useUndoToast` was WIDENED out of
  `pages/FileManager/hooks/` to global `client/src/hooks/` because the §4.16/§4.17 accept is a
  second, unrelated consumer (MyPage) — a recorded exception to the §6 page-local-hooks convention.
- `docs/spec/client/i18n.md` = the SINGLE en/ko key-group catalog (no per-module docs READMEs
  exist under `docs/spec/client/`); owning specs repeat only their own group.
- `CollectionDashboard` keeps the plan module name while the user-facing surface label is
  `Storage` — name/label divergence intentional.
- `statusChip` registry entries are plain serializable `{ labelKey, tone }` descriptors — no JSX
  in registry data.
- `collectionsRepository` returns server payloads VERBATIM in snake_case (CODING_STYLE Express
  rule makes camelCase an INTERNAL server-boundary convention); reads absorb failures to fallback
  values but hand the mapped error envelope over a side channel — absorption alone cannot let a
  controller show the mapped message; `undoAction` never collapses 409s to null unlike the
  mutation `∥ null` precedent — the toast controller needs the structured cascade payload without
  a second round trip.
- `collectionsNotifier` = ONE coarse, payload-free channel — silent evolution can change anything,
  so per-event typing buys nothing; no push channel exists in the stack (§9) ⇒ subscribers re-read;
  polling stays a refresh-policy concern.
- MergeProposalCard: KO count-particle grammar is solved by a client-side PARTICLE PICKER, EN copy
  phrased without particles; the compare overlay REQUIRES an `overlap_sample` (+ side-unique
  samples) extension of the suggestion payload at its own docs step (the route ships counts only)
  — until shipped, the strip/overlay render skeleton rows.
- CollectionPropertiesDialog: NO Versions tab — collections are not versioned and the tab's
  ABSENCE is the invariant (nothing fills the slot); `Member of` chips and the per-file `AI Info`
  tab belong to `FilePropertiesDialog` (member chips T3.6 / AI tab P1), not this dialog.
- UndoToast's `type='success'` + 8 s timing are owned by its own spec; `useMessage.md` receives
  the matching row in the same PR (allocation: PLAN §8 docs gate).

### 12.12 Spec state-purity gate & lifted narration (2026-10-15)

- The PLAN §8 mechanical sweep is now CODIFIED: `server/__tests__/docsStatePurity.test.js`
  (runs in `npm run test:ci`) — forbidden-pattern net over `docs/spec/**` + `docs/features/**`
  plus a §-pointer resolver (qualified pointers must exist as numbered headings in the named
  file; bare pointers must resolve somewhere); `(target)`/deferral/deliberate markers are
  WARN-tier report-only (target-contract notation, not narration).
- Narration lifted out of specs when the gate was first run (the provenance it carried):
  - `useFolderTreeItemController`: the `path`/`name` props are the legacy string form
    superseded by `node.nodeId` (kept as fallback).
  - `fileNodesStore`: `listSubtreeCacheRows` = the T0.9 AI-hygiene bounded read;
    `summarizeTrashedSubtree` = the T0.10 trash-hygiene card read.
  - `backendHealth`: the AI role slots' probe surface landed with the T1.1 adapter.
  - `aiTagStore`: the `mime:`/`ext:`/`month:`/`path:` kind-prefix vocabulary is the §4.10
    ruling; `replaceRawTags` runs with NO journal because undoing re-derivable enrichment
    would be theater.
  - `aiJobService`: the `(content_hash, modelId)` skip is sufficient because a model version
    is deterministic; `claimNext({ excludeKinds })` parks roles with zero attempt inflation
    so "pause never destroys queued work silently" holds; ASR ships transcript+probe only —
    conservative failure direction (a missed transcript loses data, an invented genre
    poisons the index).
  - `evolutionService`: tag-scope statement re-anchored to local §4.18 (design-doc name
    pointer removed).
  - `derivedTagsService`: stale `aiTagStore §2.4.5` pointers corrected to §2.3 (aiTagStore
    was renumbered by the 2026-10-14 state-purity sweep).
