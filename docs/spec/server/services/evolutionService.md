# evolutionService Spec

Target-contract spec (`docs/features/collections-platform.md` §4.9 silent evolution, §4.10 naming templates, §4.18 tags, §4.19 (merge-arbiter), §2 invariants 3/4/6/10; CODING_STYLE.md Express Patterns).

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Silent evolution for definition-driven collections: create/split/archive/purge are `origin='system'`-only; reconcile materializes membership for `system\|seed\|search` definitions. Owns triggers/debounce, the passes (create, reconcile, split, archive, purge, merge-candidates, auto-pin-reconcile), and merge-SUGGESTION writing. No nightly tag pass exists (§2.10).                                                                                                                                                                                                                                                                                       |
| Act stance | System acts silently; every act is journaled via `commitChange` with `actor='system'` — the undo journal replaces any proposal inbox; every act carries an inverse. The ONLY proposal output is merge candidates — never an inbox; the UI safety valve is undo + the merge-proposal card.                                                                                                                                                                                                                                                                                                                                                                         |
| Boundaries | Create/split/archive/purge never touch `origin='user'`, `seed`, or `search` rows; reconcile materializes membership only for definition-driven collections (`system`, `seed`, `search`) and never touches manual `origin='user'` rows. Never writes `collection_grants`/visibility. Executes OFF request paths and OFF upload commits (batch-end/nightly only). Embedding/analysis MATH is call-free by construction (centroids are means of stored vectors; seeds are references to existing vectors — no provider call ever computes evolution math); the only provider use is the `merge-arbiter` advisory (chat, nightly, ≤1 call/user/day aggregate budget). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/collections/evolutionService.js`
- **Test file:** `server/domains/collections/__tests__/evolutionService.test.js`
  (fake vectorStore + fixture corpora; capability-absence legs run the LLM-free variants)

### 2.2 Triggers + batch-end debounce

- `AI_EVOLUTION_TRIGGER = nightly | upload | both` (default `both`, T2/dbOnly hot).
- **`upload` means BATCH-END, not per-file.** Mechanism: per-user trailing-edge debounce
  timer armed at each upload commit — `armUploadTrigger(userId)` is the ONLY new call
  added to the upload-commit hook (the `ai_jobs` per-file enqueue itself stays at commit;
  idempotent, cheap, needed for dedupe — passes are what debounce).
- Constant: `AI_EVOLUTION_DEBOUNCE_S` (default 90, T2/dbOnly). The timer RE-ARMS on
  each commit; a commit only happens after full receipt (multer buffers whole file), so
  a long upload cannot fire it mid-transfer. N-in-a-batch is unknowable server-side
  (client may abandon) ⇒ "last commit + quiet period" is the only crash-safe batch-end
  test; the pass is an idempotent re-scan of DB state, so a mistimed fire wastes
  compute but can never be WRONG — correctness never depends on the trigger instant.
- Client hint `uploadComplete: true` (sent by `useFileOperations` when its queue
  drains) fires the pass immediately — latency sugar, crash-safe by design; the
  debounce alone is sufficient. Server surface: `POST /api/collections/evolution/hint`
  (routes/collections.md §2.4) arms the per-user timer with `immediate: true`; a
  concurrent hint while a pass is queued/running coalesces (202 `scheduled:false`).
- `upload` mode runs the CHEAP passes only: create / reconcile / split /
  merge-candidates. `nightly`
  runs ALL passes including archive/purge (time-based by nature — nightly is the
  backbone; `upload`-only mode must still run nightly ≥ once/day via the scheduler slot
  in [maintenanceScheduler](../infrastructure/maintenanceScheduler.md), lockManager TX
  group, precedent `migrationService.js:330-348`).
- Kill switches (all T2/dbOnly, checked PER PASS, pause never destroys queued work
  silently): `AI_EVOLUTION_ENABLED` (global — pauses acts, rendering unaffected),
  `AI_EVOLUTION_NIGHTLY_ENABLED` (nightly-batch pause), `AI_EVOLUTION_CREATE_ENABLED`
  (create-pause; split inherits it), `AI_MERGE_SUGGESTIONS_ENABLED`.

### 2.3 `runEvolutionPass(scope)` — the single entry

`runEvolutionPass({ users = [all-with-content], passes = 'cheap' | 'full' })` →
`{ perUser: [{ userId, created: { created[], promoted, suppressed }, reconciled[], split[],
archived[], purged[], mergeCandidates[], pinned[], arbiterCalls }], report }`; report row
persisted as `admin_reports(kind='night_eval')`. Idempotent full re-scan — safe to
re-run any time; concurrent invocations serialize on the per-user lock group (second
caller no-ops). Inputs: `node_activity`, `file_likes` (via likes store),
pooled `embeddings` (active model space), and `collection_centroids`.
Membership is materialized: the pass writes the add/remove diff through the journaled
`collectionsStore` item mutators (`source='system'`, matched `reason`, publish state per
mode) with `ctx.actor='system'`; the read path never evaluates definitions. Digest/feed
carry system acts — NO toasts for silent system acts. The `night_eval` report totals
include `created`, `create_promoted` and `create_suppressed`.

The **cheap** leg runs create, reconcile, split and merge-candidates; the **full** leg
adds archive and purge plus the auto-pin reconcile. Create runs after reconcile, so a
new collection's initial batch is not re-scored by the same pass. `runCreatePass(userId)`
is also callable directly; it is gated by `AI_EVOLUTION_ENABLED` and
`AI_EVOLUTION_CREATE_ENABLED` and returns `{ created: [], promoted: 0, suppressed: 0 }`
when either gate is off or no active embed model exists.

### 2.4 Pass 1 — create (multi-tier mutual-kNN + facets, LLM-free)

1. **Corpus.** Requires the active embed model (`llmModelsStore.getActiveByRole('embed')`);
   none ⇒ empty result, zero writes. Candidates are pooled `embeddings` rows of that model
   intersected with the requester's visible live file ids (own-root subtree + path/point
   grants). Rows of another `model_id` never participate.
2. **content_hash dedup pre-pass.** Non-null `filecache.content_hash` groups (falling back
   to the pooled row's `content_hash`) keep exactly their lowest node id; every other twin
   is removed from clustering. NULL hashes pass through unchanged. Twins never form
   clusters.
3. **Mutual-kNN tiers.** k = 6. For each tier, an edge survives when at least one endpoint
   ranks the other inside its top-k neighbors at/above that tier's cosine (`profile.edgeCos`
   of the active model; fallbacks tight 0.82 / mid 0.80 / loose 0.72). Connected components
   of those edges are the cluster candidates; components are not built by transitive cosine
   chaining beyond the either-side top-k rule. Each candidate carries
   `{ tier, event_class, memberIds }` where `event_class` is the dominant top-level
   directory beneath the user root (`root` for root-level files).
4. **Facet candidates** (deterministic, no LLM):
   - **path-subtree purity** — a non-root directory with at least 8 eligible embedded
     direct-child files whose direct files are at least 80% of that directory's eligible
     embedded subtree. Members are those direct files.
   - **like density** — a non-root directory subtree with at least 8 eligible liked files
     and `liked / eligible subtree ≥ 0.5`. Members are the liked files.
     Facets are generated after clusters and are processed path-first, then like-density.
5. **Cross-tier dedupe.** A lower-tier component whose Jaccard against an already selected
   component is ≥ 0.8 is dropped (tight precedes mid precedes loose), so the same member
   set never creates two collections. Creation order is tight, mid, loose, path facets,
   like-density facets; within a source larger sets precede smaller sets, ties by lowest
   node id.
6. **No-duplicate promotion.** Before any gate, a candidate whose Jaccard against an ACTIVE
   collection's materialized member set is ≥ 0.8 is NOT created: the pass counts it as
   `promoted` and leaves the existing definition and membership untouched. Promotion never
   widens a definition silently. The `promoted` count (including facet/cluster pairs and
   repeat passes over the same corpus) is reported per user.
7. **Tombstone suppression.** A candidate whose normalized definition fingerprint
   (`fingerprintDefinition`) matches an `owner` tombstone is never created and counts as
   `suppressed`.
8. **Gates** (product rules unless noted):
   - members ≥ 8; size ≤ tier cap (tight 120, mid 120, loose 500) — over-cap candidates are
     blocked, never truncated;
   - persistence: the oldest member file's `created_at` is ≥ 14 days old. WAIVED when the
     candidate has ≥ 8 liked members and a liked/member density ≥ 0.5, and always waived
     for a like-density facet;
   - rate: at most one system create per user per `AI_EVOLUTION_CREATE_RATE_DAYS` window
     (`0` disables the gate). The window is checked against every system-origin collection
     the user owns, and a successful create closes the window for the rest of the pass;
   - active count: at most 12 ACTIVE system tight/mid collections per user; broad (loose)
     at most one per `event_class` per user;
   - tombstone and overlap checks above run before these gates.
9. **Definition + creation.** The definition is a self-centroid system rule:
   `{ kind: 'centroid', centroid_ref: null, theta: tier edge cosine, tier, event_class }`.
   `centroid_ref: null` means the OWNING collection's `collection_centroids` row for the
   active model (see [collectionsService](collectionsService.md) §2.3); reconcile, the
   upload hook and previews resolve it with the collection id. Creation uses the journaled
   `collectionsStore.createCollection` with `origin='system'`, `publish_mode='ask'` and
   `ctx.actor='system'`; the name comes from `templateNamer` (`llmNamer` only while the
   chat role is configured, falling back losslessly) with top-2 local derived tags, unique
   among active names. After create, the centroid is upserted as the mean of the member
   pooled vectors keyed by the active model, and the initial member batch is materialized
   in ONE journaled command with `source='system'`, the matched `reason`
   (`similar` / `path:<prefix>` / `like:<prefix>`) and `published=true` — the initial
   batch is the discovery snapshot. Later rule additions follow `publish_mode`.
10. **Lifecycle uniformity.** No tier-specific lifecycle exemptions; every created system
    collection faces the same split/archive/purge rules.

### 2.4-bis Reconcile pass — materialized membership diff

Runs for every ACTIVE definition-driven collection (system, seed, search). Manual
`origin='user'` rows without a definition are never reconciled.

1. Load the stored member set and the definition's candidate set (§2.3). Membership
   scoring uses **pooled** embeddings of the active model space (seed reference,
   centroid reference) plus predicate atoms; `vectorStore.neighbors` is not used.
2. Apply exclusions, then the hysteresis diff:
   - stored member: keep while `score ≥ θ_out`; remove below it;
   - non-member: add while `score ≥ θ_in`;
   - predicate atoms are boolean (match ⇒ keep/add, no match ⇒ remove/skip);
   - a member whose pooled vector is missing or belongs to another model is KEPT
     (no churn on enrichment gaps); a non-member without a vector is not added.
3. Write the diff through the journaled item mutators with `actor='system'`:
   additions carry `source='system'`, the matched `reason`, and `published` from
   `publish_mode`; automatic removals delete the row only — they MUST NOT insert an
   exclusion, so a later score above `θ_in` can re-admit the node. User `Exclude` is the
   exclusion path. `touchMemberChange` runs inside the same command; no-op when the diff
   is empty.
4. Reads never run this pass. Membership stays fixed between runs.

**Membership caps:** create gates bound new system collections; reconcile does not
evict long-standing members merely to hit a cap.

### 2.5 Pass 2 — split

Hot subset WITHIN a collection (activity + likes density) that independently crosses the
pass-1 create gates ⇒ create a NEW SIBLING `system` collection; parent definition and
membership are UNTOUCHED (never nested — sub-collection terminology/structure is banned).
Journal = create command + note on the parent's digest.

### 2.6 Pass 3 — archive (uniform, no tier exemptions)

`active ∧ origin='system'` and (activity ≤ ε for N consecutive nightly evals OR members ≈ 0) ⇒ `archiveCollection` (journaled, `actor='system'`). activity = Σ_members w_a of NEW
usage events in the eval interval (the `node_activity` nightly rollup supplies it) — ε default 0 ⇒ "no positive
usage for N days". ε/N and the **min-age grace (default 14d: system-origin collections
younger than 14d are never archived — definition-age is a `node_activity` rollup input)**
are T2 hot constants (defaults shipped, admin-displayed —
**tuning values measured via admin counters**; not AI-profile numbers). **SKIPPED for pinned
collections** (`pinned=true`, whether `pinned_by='user'|'auto'`). **Exclusion rate
is NEVER an archive trigger** (exclusion = touch ⇒ pin) — it stays a generator-QUALITY
metric in the admin counters only.

### 2.7 Pass 4 — purge + tombstone fingerprint

`archived` rows older than `ARCHIVE_RETENTION_DAYS` ⇒
`deleteCollectionPermanent(id, { defFingerprint: fingerprintDefinition(definition) })`
(FK cascade + tombstone + journal purge in ONE TX — permanent delete-from-archive is unrecoverable, soft-delete parity
with trash). Tombstone lifetime defaults to `ARCHIVE_RETENTION_DAYS`; EXPIRY CLEANUP
of tombstones is the nightly rollup GC slot's job (`purgeExpiredTombstones` —
[maintenanceScheduler](../infrastructure/maintenanceScheduler.md) §3.1; aiJobsStore-style
"GC calls" attribution), NOT this pass. Fingerprint = NORMALIZED definition (schema +
core params: θ / path / size — NOT raw centroid values, so trivial member drift
cannot slip past). Suppression effectiveness is measured, then
tuned, via admin counters: `tombstone-suppressed` vs `regenerated-anyway`.

### 2.8 Pass 5 — merge candidates (containment-safe) + arbiter advisory

- Metric on MATERIALIZED membership sets (capped 500 rows/collection):
  `sizeRatio = min/max ≥ 0.7` AND `jaccard ≥ 0.7`. Centroid cosine is a PREFILTER ONLY —
  never grounds for a suggestion. Overlap-coefficient / containment (|A∩B|/min) metrics
  are BANNED — they fire on subset pairs (Spain ⊂ Europe) which must NOT merge.
- Pair sources: centroid-cosine prefilter → materialized-set check, and set-Jaccard
  directly (LLM-free variant, same pipeline). Scope: `system`↔anything
  the SAME user owns; both must be `active`.
- `upsertMergeSuggestion(aId,bId,score)` (pair normalized, UNIQUE(a,b) conflict keeps the
  existing row + its state); `score` = jaccard×1000 (scaled int).
- Suppression state machine: `rejected` pair ⇒ never re-suggested (permanent,
  `Keep separate`); `dismissed` (`Later`) increments `dismiss_count` and stamps
  `dismissed_at`. This pass re-raises (`dismissed → pending`, score refreshed) when the
  row is due: `dismiss_count = 1` ⇒ `dismissed_at + 14d`; `dismiss_count ≥ 2` ⇒
  `dismissed_at + 30d`. Re-raise preserves the count, so subsequent dismissals keep the
  30-day cadence. The API never owns this timing.
- **Review band 0.55–0.7**: below 0.55 no card; ≥0.7 card WITHOUT adjudication;
  band pairs, when chat configured, get the **`merge-arbiter`** pass: input = both names
- top tags + sizes + ≤5 sampled member summaries each AND — load-bearing — the
  SYMMETRIC DIFFERENCE (unique-member counts/ratios + samples from each side — feeding only shared-sample + overlap ratio makes every pair look "nearly identical"). Output
  `{verdict ∈ merge|keep_separate|sibling, reason}` written as prefilled recommendation
  on the suggestion row (additive columns; read by
  [collectionsService](collectionsService.md) §2.9). `sibling` ⇒ no card in v1.
  **It advises, never acts** — no arbiter call is self-executing; chat off ⇒ band pairs
  get no recommendation (card still appears, no preselection). Budget: the nightly
  aggregate ≈ ≤1 chat call/user/day — arbiter calls are batched into one
  structured multi-output per user, reasoning OFF.

### 2.9 Pass 6 — auto-pin touch taxonomy reconcile

Pinning itself happens at the TOUCH (store-embedded `setAutoPin` inside the journaled
TX — membership add, membership removal via stored-row delete OR new exclusion, publish
toggle, rename, pin/unpin, grant/share change, accepting a merge as survivor,
restore-from-archive). Pass 6 is the nightly RECONCILE (idempotent): (a) asserts
`pinned_by='auto'` only on `origin='system'` rows (NULL elsewhere — pin is meaningless
for user|seed|search, which silent evolution never archives); (b) never downgrades
`pinned_by='user'` (an explicit user pin wins over the auto chip); (c) emits no journal
rows (the pin itself is journal-less, additive and invisible — pinned collections are exempt from auto-archive/purge forever; `pinned_by='auto'` shows a subtle chip so users can unpin). Reads/views/likes
deliberately do NOT count as touches (activity gravity covers them).

### 2.10 No nightly tag pass (numbering kept)

Evolution performs NO tag work: no materialization, no normalization pass, no hints, no
vector cache (§4.18). `ai_tag_raw` has exactly one writer —
derivedTagsService at commit points; the definition engine reads it string-equality only.

### 2.11 Centroid maintenance

After create/split/merge/purge writes: `upsertCentroid(collectionId, activeModelId,
weighted-mean-of-stored-pooled-vectors, memberCount)` — call-free math; stale-model centroids never mix (model-keyed PK; model change ⇒ rebuild pass
driven by backfill completion). `deleteCentroids` on purge/merge loser.

## 3. Configuration summary (T2/dbOnly hot; configRegistry T2 precedent)

| Key                                                                                             | Default | Class                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `AI_EVOLUTION_ENABLED`                                                                          | `true`  | global kill switch                                                                                                       |
| `AI_EVOLUTION_TRIGGER`                                                                          | `both`  | trigger mode                                                                                                             |
| `AI_EVOLUTION_DEBOUNCE_S`                                                                       | `90`    | batch-end debounce                                                                                                       |
| `AI_EVOLUTION_NIGHTLY_ENABLED` / `AI_EVOLUTION_CREATE_ENABLED` / `AI_MERGE_SUGGESTIONS_ENABLED` | `true`  | per-surface pauses                                                                                                       |
| `AI_EVOLUTION_INACTIVE_DAYS`                                                                    | `30`    | archive gate: no positive member activity for this window (ε = 0)                                                        |
| `AI_EVOLUTION_MIN_AGE_DAYS`                                                                     | `14`    | archive grace for system-origin collections                                                                              |
| `AI_EVOLUTION_CREATE_RATE_DAYS`                                                                 | `7`     | max one system create per user per window                                                                                |
| membership hysteresis offsets                                                                   | profile | `membershipHysteresis.inDelta/outDelta` around `definition.theta`; absent finite values fall back to no band             |
| tier edge-cos 0.82/0.80/0.72, k≈6, δ/θ shapes                                                   | profile | **release-measured profile values** (release artifacts — no runtime calibration; re-open trigger: measured corpus drift) |
| min 8 / ≤1-wk / ≤12 active / caps 120·500 / band 0.55–0.7 / ratio·jaccard 0.7                   | fixed   | product rules                                                                                                            |

## 4. Dependencies

- `collectionsStore` (journaled mutators + materialized items/centroids/tombstones/
  suggestions), `actionJournalStore` (via commitChange), `fileNodesStore`,
  likes/activity stores, `aiTagStore`, `embeddingsStore` (pooled rows — membership math)
- `collection_centroids` (model-keyed centroid prefilter); `vectorStore` is NOT a
  membership/grouping scorer (it serves retrieval consumers)
- `domains/ai/llmAdapter` — ONLY the merge-arbiter + llmNamer chat paths; capability
  absence degrades to LLM-free variants (set-Jaccard merge, template names) with
  identical output shapes — capability absence degrades features, never disables them
- `maintenanceScheduler` nightly slot; `templateNamer`;
  `collectionsService.fingerprintDefinition`
- Forbidden: any request-path invocation, any grant write, any file-node mutation.

## 5. Verification Scenarios

- [ ] Debounce: 5 upload commits 10s apart ⇒ exactly ONE cheap pass ~90s after the LAST
      commit; a mistimed re-fire produces zero new acts (idempotent re-scan assert)
- [ ] `uploadComplete` hint fires immediately; trigger `nightly` ignores upload arms;
      two concurrent hints coalesce to one pass (`scheduled:false` on the second)
- [ ] Pass-1: content_hash twins never cluster; mutual-kNN yields tight∪mid∪broad at the
      three tiers; connected-components chaining absent (regression fixture)
- [ ] Facet/cluster or repeat-pass Jaccard ≥0.8 pair ⇒ `promoted` count increments, zero
      new collections, the existing definition and member set are byte-identical
- [ ] Gate matrix: <8 members / over-cap size / <2wk persistence / rate cap / ≤12 active
      tight+mid / broad one-per-event-class each block creation; ≥8 liked members at
      density ≥0.5 waive persistence only
- [ ] Facets: path purity requires ≥8 direct embedded files at ≥80% of the eligible
      subtree; like density requires ≥8 liked files at ≥50% of the eligible subtree
- [ ] Persistence: a cluster whose oldest member is younger than 14 days is blocked; the
      same cluster after aging creates; a like-density facet is never persistence-blocked
- [ ] Tombstoned definition ⇒ create suppressed + counters observable; drifted member
      set (same normalized definition) still suppresses (fingerprint ignores raw centroid)
- [ ] Self-centroid: a created system definition (`centroid_ref: null`) resolves the
      owning collection's centroid in reconcile/upload/preview; without a collection id it
      admits nothing
- [ ] Reconcile: two reads between passes return the same materialized set; an addition
      inside the pass writes `source='system'` + matched `reason`; a removal below
      `theta_out` deletes the row and inserts NO exclusion (re-entry above `theta_in`
      remains possible)
- [ ] Reconcile hysteresis: a stored member with `theta_out ≤ score < theta_in` survives;
      a non-member in the same band is not admitted; predicate collections add/remove on
      boolean match
- [ ] Reconcile covers system/seed/search definitions and never adds/removes manual
      `origin='user'` rows; a missing pooled vector keeps an existing member
- [ ] Create: initial cluster rows are materialized `source='system'`, `published=true`;
      later additions park per `publish_mode`
- [ ] Split creates a SIBLING; parent definition/membership byte-identical before/after
- [ ] Archive: inactive system row archived; PINNED (user or auto) row never archived;
      uniform across tiers (fixture proves broad tier archives too); no exclusion-rate
      trigger exists (high-exclusion + active row survives)
- [ ] Purge: archived past retention → row+cascade gone, tombstone present, journal rows
      purged; `user|seed|search` origins NEVER archived/purged by any pass (silent evolution is system-origin only)
- [ ] Merge candidates: subset pair (sizeRatio < 0.7) never suggested (geometry
      fixtures — Spain ⊂ Europe); near-identical pair suggested; rejected pair terminal;
      first dismiss re-raised at +14d, second dismiss at +30d (count preserved)
- [ ] Arbiter: chat on + band 0.55–0.7 ⇒ recommendation on the card; request body
      contains symmetric-difference samples; chat off ⇒ same card, verdict NULL; card
      without user click NEVER merges (arbiter self-execution grep/test ban)
- [ ] Auto-pin reconcile: each touch type (per §2.9) pins a system row (`pinned_by='auto'`,
      no journal row for the pin); read/view/like touches do NOT pin; user-origin rows
      keep NULL; nightly reconcile clears any illegal non-system auto-pin
- [ ] No tag pass: evolution writes nothing to `ai_tag_raw` (the only derived-facet writer is
      derivedTagsService); no `tag_parents`/`tag_embeddings` reference exists in any
      evolution code path (grep)
- [ ] Every act journaled `actor='system'` (undoable via digest/feed ≤24h — actions
      feed), zero toast-side effects, `admin_reports(kind='night_eval')` written
- [ ] Kill switches: global pause stops ALL acts but leaves suggestions/rendering intact;
      create-pause leaves split/merge-candidates running; nothing deletes queued work
