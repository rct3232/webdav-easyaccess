# AI_FEATURE_PLAN.md — AI-Driven Storage: Design & Behavior Reference

Companion to `PLAN.md` (task graph, conventions §6–§8 there). Task rows reference the
sections below by §number; file:line anchors are verified seams in the current code.

## 1. Purpose & framing

Turn the app from a storage web client into an **AI-driven storage management application**.
Differentiator: backend-agnostic layer (WebDAV remote or S3, sqlite or PG, any LLM provider
incl. fully local Ollama) — competitors are hardware/cloud-locked.

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

- `origin`: `system` (silent generator, split child, tag-materialized) | `user` (manual)
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
  - **Tags are vector-matched, not string-matched**: tag predicates compare
    `cosine(embed(tag_value), embed(query_tag)) ≥ θ_tag` with graded weight. Raw LLM tags
    never collapse to one exact string; near-synonyms partially match. Requires
    `tag_embeddings` cache table (distinct-tag → vector, produced by a cheap batch embed
    job keyed by tag string+model; tag vocabulary cardinality is small). Tag match values
    resolve through orthographic normalization + `tag_parents` hints (§4.18) first.
- `collection_exclusions (collection_id,node_id)`: applies to derived members only
  ("Exclude" on an auto-added file = block for this definition). Exclusion = **touch** →
  auto-pins (§4.9b); its rate is a quality metric for admin/tuning, never an archive
  trigger.
- Member row states, rendered per read (join-time ACL check — precedent
  `domains/recentFiles/service.js enrichRecentEntry`): normal | **revoked** (file existed in
  view, now not readable → gray placeholder row WITHOUT filename/thumbnail; metadata after
  revocation is a leak) | trashed-by-owner (hidden, row kept) | purged (row cascaded away).
- Foreign members (files the collection owner doesn't own) in a LIVE-SHARED view are
  **excluded from rendering** with an `Not owner's file — not shared` chip in the owner's view
  (cross-leak rule; §4.7). Ownership follows the `permissionPolicy.js` convention — an admin
  owns the whole tree — so an ADMIN-owned collection has NO foreign members: its rows never
  render `shared_excluded`/publish-pending markers and its publish path is real.
  Adding foreign files to collections is otherwise allowed (rule:
  you may only add what you can read).
- Member-row controls (context menu & multi-select) — file-mutating items (move/copy/rename/
  delete) are DELIBERATELY ABSENT; collection is a view, not a workspace. Present:
  exclude | publish on/off (shared collections only) | download (if file ACL allows) |
  `Reveal original location` (route the user to the file's real location where normal menus apply) |
  properties (read-only tab subset for non-owners) | like toggle.
  Multi-select adds: batch exclude (stored→delete rows; system→insert exclusions), batch
  publish, `Add to another collection` (membership copy). No batch delete — by rule.
- Collection-card context menu by origin: user/system: rename(→`name_locked=true`), pin,
  archive, share settings, delete(archived only). viewer(received): open, `Leave` (hide,
  local), no mutations.

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
  surfaces as error); budget breakers/daily counters reset. `.env`-provided `LLM_*` remains
  legal (resolver env>db precedence) but locks the editor (`setInEnv`), so DB is the
  recommended surface. Contrast recorded: **native vector capability (§4.13) is
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
- **No LLM call on request paths** except semantic-search query-embed (must be <100ms class
  model; results cached). Nightly evolution ≈ ≤1 chat call/user/day with aggregate-only
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
≈1.7 (mixed text, E10) ships as release constant.

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

- Roles `viewer|editor` (+owner). Viewer: list/preview/download of members, cannot rename/
  remove-others'-adds? (editor+ may `Exclude` only what they added or if owner), cannot trash
  anything. Editor: add/remove membership.
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
- `leave` for recipients = per-user hidden flag.
- Cross-leak rule (§3.2) applies: foreign-owned members never rendered into shared views.
- Grants revocation is instant; already-visible metadata cannot be re-taken (documented
  limitation, same stance as journal boundaries).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/services/collectionShareService.md`, `docs/spec/client/components/dialogs/CollectionPropertiesDialog.md`

### 4.8 Digest (top-of-list banner, not notifications)

Per `(user,collection)` visit cursor `collection_digest_cursors(last_visited_at)`; counts
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

Inputs: node_activity, likes, tags(ortho-normalized; §4.18), embeddings. Passes:

1. **Create**: multi-tier candidate generation (PoC E4 evidence: narrow and broad groups both
   real; naive connected-components REJECTED for chaining, absolute-θ topic gating REJECTED).
   Algorithm = **mutual-kNN seed-expansion** (k≈6, either-side top-k + edge cos from the
   model profile, default 0.82 tight / 0.80 mid / 0.72 loose tiers), preceded by a
   **content_hash dedup pre-pass** (identical-content twins go to the dup path, never form
   clusters). Facet sources (path-subtree purity, normalized tags, like-density) generate
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
   normalized definition (schema + core params: θ/tag-set/path — NOT raw centroid values,
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
commit points; consumed by the templates above, tag predicates (§4.12) and rule-based
suggestions (filename/mime/age). EXIF is REJECTED for v1 (not a tag source).

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/services/collectionsService.md`, `docs/spec/server/services/aiJobService.md`

### 4.11 Undo journal (`action_journal`, common infrastructure — NOT ai-prefixed)

Schema §5. Generic `(domain, subject)` opaque key, NO FKs (rows outlive subjects for audit

- restore-after-undo-window reasoning). Writer discipline: domain code MUST go through
  `commitChange(mutation, inverse)` — the only write path (change + journal row in ONE TX +
  `lockManager`; collection repo exposes no other mutators). `chain_seq` monotonic per
  subject: tip-undo = free; non-tip = cascade-confirm listing count of later changes undone
  too. Retention: rows survive, `payload` NULLed at expiry (`status=expired`) — audit keeps
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
  | merge confirm (card), cleanup-suggestion accept | ✅ | ✅ | journal / trash restore |
  | share link create·revoke (file) | ✅ | ✅ | journal `domain=sharing` |
  | manual collection archive | ✅ | ✅ | journal |
  | **archived→permanent delete, empty-trash(admin)** | ✅ (report only) | ❌ | trash-parity contract: no undo button, no journal inverse |
  | like / visit / sort manipulation | ❌ | — | self-reversing trivial state; toast is noise |
  | migration/batch-cancel completion | ✅ (informational) | ❌ | job domain owns; journal not involved |
  | upload (plain) | ❌ | ❌ | success is self-evident in list; failure toast already exists |
  Additional candidate intro-points found (include): **conflict-resolution overwrite** (undo = versions
  restore when history enabled, else unavailable — degrade silently), **permission-request approve/deny** (undo=revoke, same exposure boundary), **admin GC/cleanup run** (report toast,
  no undo — destructive-by-design, §9 keeps), ~~**admin tag-merge confirm**~~ (retired — §4.18
  has no merge op; parent hints are display-only, no confirm/undo surface).
  Cascade confirm dialog (non-tip undo) and `not recoverable` badges remain as designed for the
  30-day dashboard feed (`GET /api/actions`); surfaces: (1) toast (user actions, ≤24h
  undo window honored though rows live 30d), (2) digest banner undo links (system acts,
  ≤24h), (3) dashboard feed (all, 30d, cascade), (4) `__archive__` restore button, (5)
  sidebar `new` dot (system-create cue only). No toasts for silent system acts — digest/
  feed carry them.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/store/actionJournalStore.md`, `docs/spec/server/routes/actions.md`, `docs/spec/client/hooks/useMessage.md`, `docs/spec/client/components/feedback/UndoToast.md`, `docs/spec/client/hooks/useUndoToast.md`

### 4.12 Feature-degradation matrix + UI states (LLM role-based)

Capability by config state (embed only = mostly full vector features; chat adds naming/NL
extract/parser; none =):

- **None**: manual collections, stored membership, path/tag/like-predicate collections
  (cosine-free rule evaluation; tag predicates = normalized string equality, §4.18
  vector-matching/parent-hint machinery dormant), server-wide name search (§4.6 name branch), usage/activity
  gravity, archive lifecycle, digests, merge-by-set-Jaccard, exact-dup finder
  (content_hash), rule-based suggestions (filename/mime/age), likes, sharing, journal —
  ALL ship in P0. **Absent: semantic search, seed collection, vector-merge, near-dup, NL
  parser, tag normalization pass.**
- **embed**: + semantic search, seed, vector merges, near-dup, auto-create (clusters by
  vector), naming templates (system). **absent: chat-only (summaries/tags-from-content,
  NL parse, llmNamer).**
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
model (model change → rebuild derived index; TEXT canonical untouched). hnswlib-node is
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
role, per-version embedding distribution, **three ai_features lineages — features/caption/
asr model coverage filters for backfill scoping (Q6)**, backfill launcher with rate limit),
degraded-input histogram (overlength stats), kill switches (§4.9). Privacy boundary:
aggregates and ids
only — never file names/queries/contents of other users. **Constants provenance
(2026-09-16 decision): every numeric constant the AI passes (cos thresholds, ef_search,
char/token safety factor) is a RELEASE ARTIFACT — measured by the project on a dev-owned
reference set and shipped as per-model profile values; there is NO runtime calibration
feature and NO dataset shipped to end users. Panel displays profile values +
`calibrated:false`-style provenance; §9.1 keeps the re-open trigger (corpus drift).**

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/llmPresets.md`, `docs/spec/server/routes/admin.md (panel surface lands with T4.1 docs step)`

### 4.16 User dashboard `Storage`

Nav: `myPageRegistry` entry shape `{id,icon,labelKey,visibility:'all'}` + content
descriptor branch. Blocks: hygiene cards (exact/near dups count + reclaimable GB, trash size

- retention countdown, cleanup suggestions count) → each deep-links to a context where the
  action happens (dashboard is pull-style overview, not an action center — in-context cards remain);
  system-changes feed (journal, 30d, undo buttons); my-collections status (counts,
  grants-received/granted w/ revoke, recent merge/archive facts w/ undo); suggestions list
  (**checkbox rows + `Accept selected (N)` — Q4 decided: checkbox in ALL cases, no per-file/
  threshold variants; checked rows only, accept→trash, command-unit undo §4.11**).
  Capacity sparkline only — no personal-insight prose
  (rejected scope).

Contract specs (binding, MUST read before implementing this section): `docs/spec/client/components/mypage/content/CollectionDashboard.md`, `docs/spec/client/hooks/useMyPageController.md`, `docs/spec/client/pages/MyPage.md`

### 4.17 Cleanup/duplicate suggestions (`file_suggestions`)

Rule variant (LLM-free): filename/temp patterns, stale screenshots, old installers, exact
dups via **content_hash first (T0.9a — cosine 1.0 detection redundant, E2)**. Vector
variant: low-quality picks among near-dup groups at **θ_dup = 0.97** (E2v2: realistic-edit
P10 = 0.977 vs unrelated P99 = 0.471 — separation measured; the earlier 0.98 guess was
near-miss), "30d unopened + low score". **Short-doc exception: files ≤1 sentence are
excluded from cosine near-dup (edit variants score 0.55 there — E2v2 P01) — hash/shingle
path only.** Always PROPOSALS (file-mutating, rule 2/5), rendered inline (row chip) + in
§4.16. **Q4 decided UX: every suggestion row carries a checkbox; the only accept control is
`Accept selected (N)` (checked rows → trash). Dismiss stays inline per-row; unaccepted suggestions
expire with the retention job.** Undo = command journal row (checked count = inverse
count); no extra confirm dialog — the checkbox IS the selection confirmation.

Contract specs (binding, MUST read before implementing this section): `docs/spec/client/components/mypage/content/SuggestionsChecklist.md (file_suggestions store/route specs land with the T3.3 docs step)`

### 4.18 Tag vocabulary: normalization, hierarchy hints, no merging

PoC E6c (1,115 tagged docs, 1,271 distinct tags) dissolved the original "merge similar
tags" design: high-cosine pairs are overwhelmingly (a) **spelling/spacing variants**
(`"wasted time" vs "wastedtime" (spacing variant)`, cos .98+, 13/16 of the .97+ band) and (b) **containment pairs** which
are hypernym relations, not synonyms (merge would destroy distinction); doc co-occurrence
proved uninformative at scale. The 3-step replacement, all non-destructive:

1. **Orthographic normalization at read time** — NFKC + whitespace/case fold resolves
   spacing variants deterministically (a pure function, zero tables); `ai_tag_raw` stores
   the normalized grouping aid.
2. **Containment → parent hints** — `tag_parents(child PK, parent, source(auto|admin),
created_at)`: rule `containment ∧ cos ≥ profile θ_lo(0.75)` maps e.g.
   `actor casting → casting`. **Display/grouping hint only — never rewrites raw tags, never
   merges**; a wrong parent costs one odd group row, so no labeling audit gates this feature
   (owner scope decision). Admin may view/edit `tag_parents`.
3. **Gray band = leave alone.** No cos-θ alias merge, no co-occurrence k gate, no
   merge-ratio cap — those instruments are retired with the operation they governed.

Search never depended on any of it: tag predicates match by `tag_embeddings` vector
similarity (§3.2) — fuzzy matching is the retrieval layer's job, which is why consolidating
the vocabulary was always display-scoped.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/store/aiTagStore.md`, `docs/spec/server/services/evolutionService.md`

### 4.19 Chat-model roles

Scope rule: **embeddings + set math do the analysis; the chat model legitimately does only
two things — (1) translate between language and machines (NL parse ↔ tag/summary/naming
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

| Role                 | Decision it makes                                                                                     | Why rules can't                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features.extract`   | tags/summary/category per file → feeds embeddings input & predicates                                  | core (already elsewhere)                                                                                                                                                        |
| `parse.nl`           | user sentence → shared predicate grammar                                                              | core (§4.6/T3.4)                                                                                                                                                                |
| `name`               | templateNamer fallback when chat on                                                                   | cosmetic but cheap, bounded                                                                                                                                                     |
| `keeper-adjudicator` | which file of a near-dup group to keep (+reason)                                                      | rules can rank by resolution/date but cannot weigh content meaning (caption/summary exist at this point); reason text rides along free                                          |
| `merge-arbiter`      | borderline pairs (Jaccard in review band 0.55–0.7): merge candidate / keep separate / hierarchy-later | set math is by-design blind between "same theme twice" vs "theme + subset"; the card can show its verdict as a prefilled recommendation — final call stays with the user (§4.4) |

**Per-role mechanics (detailed):**

- **`features.extract`** — runs inside the per-file enrichment job (`ai_jobs kind=features`),
  never on request paths. Input: locally-extracted text (doc text, OCR'd image text, video
  captions/transcript per §4.3) clipped by the §4.3 ladder + filename/mime/path/date
  metadata line. Prompt = fixed template, output forced to JSON schema
  `{tags:[{tag,confidence}], summary, category}` ≤ small token budget. Written to
  `ai_features`. Its value is being the **supplier**: tags feed predicate/tag-collection
  machinery, summary/caption become the embedding input corpus for media, and the material
  the two adjudicators read. Chat off ⇒ field empty; everything else runs on local tags +
  vectors.
- **`parse.nl`** — the only role on a request path, at search submit (batched with query-
  embed, ≤1 call, cached in `query_parses`). Input: query string + the CLOSED predicate
  grammar (enumerated fields, operator list, current tag vocabulary ≤ bounded) + the
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
  produced by the T1.7 vector clusters. Reads `ai_features` summaries/captions + ffprobe
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
sites (4, deterministic; only #1 is file-proportional):

- **E1 file embed** — async, inside `ai_jobs kind=embed`. Input = locally extracted text
  (doc/OCR/caption/transcript) through the §4.3 ladder: paragraph-aware chunks → store
  **all** chunk vectors (`embeddings_chunk`) + mean+renormalized pooled row
  (`chunk_pool`) | head | `metadata_only` (name/path/date string — same text space, weak
  hits preserved) | skip(+journal note). Skipped entirely on identical `content_hash`
  (determinism within a model version is what makes the `(content_hash,model_id)`
  idempotency rule sufficient). Chunking params are part of the model profile key —
  changing them means re-chunk, never mixed-chunk scoring.
- **E2 query embed** — the ONLY request-path AI call in the system (§4.6; see §4.19
  `parse.nl` chaining for vector-input refinement).
- **E3 tag embed** — batch on new distinct vocabulary (`tag_embeddings`; tiny cardinality).
- **No frame/image embedding call (V1 retired, 2026-09-16)** — ALL modalities route through
  text: images/video-frames → VLM captions → E1; audio → ASR transcript → E1. Single text
  space; cross-space cosine machinery is gone (§4.21).
- **No calls**: collection centroids = weighted means of stored vectors; seed definitions =
  references to existing vectors. Evolution math is call-free by construction.

Invariants: vectors live in the space of their `llm_models` row — **`model_id` is the
space key** (one embedding model active; cross-`model_id` cosine forbidden — mixing spaces
only ever happens across a model migration, handled by backfill §4.2); `dim` fixed per
model; TEXT canonical (§4.13); budgets/kill-switches per role like chat.

Contract specs (binding, MUST read before implementing this section): `docs/spec/server/infrastructure/llmAdapter.md`, `docs/spec/server/infrastructure/vectorStore.md`, `docs/spec/server/services/aiJobService.md`

### 4.21 Media pipeline (text space only; V1 retired)

Owner decision 2026-09-16: **every modality enters the SAME text embedding space** — no
image-embedder geometry, no query fan-out, no per-space centroid pairs, no score-mixing
rules. The pipeline:

- **V0 (free, always)**: ffprobe metadata + filename/path/date → `metadata_only` embed and
  probe JSONB — works with zero LLM.
- **V2 (needs `vision_chat` capability)**: uniform-stride frame sampling (≤4, local ffmpeg)
  → VLM captions in Korean → caption text feeds BOTH `ai_features.caption` and E1
  (caption→embed). Default media path when vision is configured.
- **V3 = ASR TRANSCRIPTION ONLY (2026-09-16 scope freeze, E13 evidence)**: audio tracks /
  audio files → conditional transcript (`transcript` + `asr_model_id`) with the mandatory
  escape-prompt ("if not actually audible, say none") and ffprobe metadata. **No
  audio_desc / genre / mood / kind fields ship in v1** — measured: schema-forced
  description invented instruments for non-music audio, and even open prompts
  contradicted themselves across runs on the same file; failure direction must stay
  conservative (a missed transcript loses data, an invented genre poisons the index).
  Vocal music transcribes _lyrics_ — store as `transcript`, excluded from
  document-content scoring by `media_kind=music`.
- Image/video near-duplicate = caption/feature vector distance (weaker against reencode/trim
  variants than a CLIP path would have been — accepted trade for single-space simplicity).
- Model change → backfill re-projection in one space (§4.2), no fan-out machinery.

`LLM_MEDIA_PATH` and its tier options are deleted; media selection is now purely
capability-driven: vision_chat present → captions, else V0.

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
- Reserved now: `ai_features.schema_version`+model provenance, E-space discipline, chunking
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
`{text_embed, chat, vision_chat, asr}` + recommended budgets (`image_embed` removed
2026-09-16 — no product path consumes it, §4.21). Adding a provider = adding a manifest
row; core code never branches on provider names.

### 4.23.2 Probe is final authority

Extends §4.21: runtime capability flags = PROBE-VERIFIED capabilities ∩ configured roles.
Declared-but-failing (e.g. an endpoint that embeds base64 images as text — empirically
confirmed against `bge-m3@10.0.0.106:8082`; the inverse: Hana's audio declared but
mis-probed with sine tones) ⇒ capability OFF + admin warning card (declared vs probed).
**Probes MUST use in-domain samples** (real speech, real photos) — an out-of-domain probe
produces false negatives indistinguishable from false capability claims (both error modes
observed this PoC). User-visible states are only ever `complete-working | absent`, never
partial. Distinct from DB vector capability (§4.13): missing LLM capability removes the
feature (absent), missing DB vector capability only degrades speed (fallback) — never
both ways.

### 4.23.3 Feature ↔ capability map (UI gating source)

Semantic search/seed/auto-create/near-dup/`tag_embeddings` matching ← `text_embed`; NL
features/summary/llmNamer ← `chat`; VLM captions (the ONLY media intelligence beyond
ffprobe, §4.21) ← `vision_chat`; ASR transcription ← `asr`. Absent capability ⇒ that
feature is absent, not degraded — every advertised path is end-to-end functional under
its own preset.

### 4.23.4 chat-only (no embed) is a legal deployment

Entire vector core = §4.12 None-column behavior (manual collections, rules, dups-by-hash,
name search) — no half-AI state exists.

### 4.23.5 Surfaces

(b)-decision 2026-09-17 — setup wizard gains one OPTIONAL, skippable "AI" step: preset
picker → role checkboxes → base-url/key/model inputs → per-role test (`/api/setup/test`
new target `llm`); values are stored as **DB settings rows** (NOT `.env`/envFileWriter —
the hot-apply rule §4.2), so a skipped step costs nothing and a mid-install config is
restart-free. Full config surface stays in admin (`/api/admin/config` + test + capability
matrix); wizard is a shortcut to the same rows. SETUP.md documents preset table;
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
- `collection_visibility(user_id, collection_id, hidden, PK(pair))` (leave)
- `collection_centroids(collection_id→CASCADE, model_id→llm_models, centroid TEXT,
member_count, updated_at, PK(collection_id,model_id))` — model_id is the MODEL-VERSION key
  (a stale-model centroid must never mix into new-space math; §4.20/§4.21 — the V1
  space-pair rationale is retired, the PK survives because model swaps are real)
- `collection_tombstones(owner_id, def_fingerprint, deleted_at, PK(owner,fingerprint))`
- `collection_digest_cursors(user_id, collection_id, last_visited_at, PK(pair))`
- `file_likes(user_id, node_id→CASCADE, created_at, PK(pair))`
- `tag_embeddings(tag TEXT, model_id→llm_models, vector TEXT, updated_at, PK(tag,model_id))`
  (provider-global vocabulary table; no user scoping)
- `tag_parents(child TEXT PK, parent TEXT, source CHECK(auto|admin), created_at)` —
  display/grouping hint ONLY (§4.18; no alias-merge table exists)
- `ai_tag_raw(node_id→CASCADE, tag, PK(pair))` — normalized (ortho-folded) tag view for
  grouping/predicates (raw stays in `ai_features.tags`; normalization is read-time pure
  function, this table stores the materialized grouping aid for scale)
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
- `llm_models(id, role CHECK(embed|chat|vision|asr), provider, base_url_key, model_name,
max_input_chars, chunk_budget, batch_size, reasoning CHECK(on|off) default 'off',
enabled)` — reasoning is an experimental per-model switch only; all roles plan for off
  (E5/E7b)
- `embeddings(node_id PK→CASCADE, model_id→llm_models, dim, vector TEXT, source
CHECK(fulltext|chunk_pool|head|metadata_only), content_hash, updated_at)` (frames: V1
  retired §4.21)
- `embeddings_chunk(node_id→CASCADE, chunk_idx SMALLINT, vector TEXT, model_id→llm_models,
updated_at, PK(node_id,chunk_idx))` — retained per §4.3; search scores max-over-chunks
  (§4.13 seam); derived-cache semantics: dropping rows loses only long-doc recall depth
- `ai_features(node_id PK→CASCADE, features_model_id→llm_models, schema_version INT
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
menu + properties header only); subset/parent-child hierarchy proposals in v1 (merge is
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
§4.21), **V1 image-embedding path** (single text space, E4c decision), **absolute-θ topic
gates & stored cosine floors** (E2v2 — relative/dynamic only), **connected-components
clustering** (E4 chaining), **tag cos-merge + co-occurrence evidence gates** (E6c — §4.18
3-step replaces), **tier lifecycle exemptions & purity suppression** (uniform rules only,
A4 decision), **`ef_search=100` defaults** (E11: 0.74 external recall — 400 fixed),
**reasoning-for-judgment assumption** (E7b v2: noise at n=2; all roles off).

### 9.1 Extension points reserved (deferred, NOT rejected — do not implement until trigger)

| Item                                                  | Reserved via                                                                                                         | Revisit trigger                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Conversational UI / multi-turn routes / session table | §4.6 optional `result_ref`/`session_id` fields; §4.22 rules; opaque-string ref type                                  | user demand; or replay drift observed as real complaint (then: session-table swap stays internal)      |
| RAG content-Q&A                                       | invariant 11 exception family; §4.3 extraction pipeline reusable                                                     | becomes a product decision with `doc_chunks` + new embedding-space decision (§4.21 discipline applies) |
| Richer semantic fields (objects/scene/relations)      | `ai_features.schema_version` (v2 rows)                                                                               | vector-fallback success rate measurably poor on such queries                                           |
| Runtime calibration (from release constants)          | profile fields exist (`llm_models.reasoning`, θ provenance §4.15); dev-owned reference set lives outside the product | measured corpus drift (dynamic-baseline alerts firing often) makes the procedure a product need        |

## 10. Open questions

None outstanding (2026-09-15). Q1–Q7 resolved and absorbed into their sections: Q1 tombstone
fingerprint/lifetime (§4.9 pass 4, §4.15), Q2 initial-set publish (§4.5/§4.7), Q3 provider
presets & completeness (§4.23), Q4 checkbox suggestions (§4.16/§4.17), Q5 admin-created
collections → rejected (§9), Q6 per-family model lineage (§5 `ai_features`, T1.2 unblocked),
Q7 always-replay (§4.22/§9). Q8 (2026-09-15, PoC-driven) vector backend policy → A-plan:
node:sqlite+sqlite-vec / pgvector≥0.7 native, JS fallback degrade never gate (§4.13).
Q9 (RESOLVED 2026-09-16): multi-vector chunk retention ADOPTED via A1 (§4.3/§4.13);
residual open part = cost/scale calibration (index size, chunk-row bloat) measured during
T1.4 at 100k+ — a sizing study, not a decision. Q10 (NEW): remote-provider adoption requires re-measuring
profile constants on the dev reference set (release-runbook step, not a product feature —
§4.15 provenance).
New open questions get appended here before/at their named task.
