# evolutionService Spec

Target-contract spec (`docs/features/collections-platform.md` §4.9 silent evolution, §4.10 naming templates, §4.18 tags, §4.19 (merge-arbiter), §2 invariants 3/4/6/10; CODING_STYLE.md Express Patterns).

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Silent evolution of `origin='system'` collections ONLY (silent evolution never touches `user                                                                                                                                                                                              | seed | search` origins): triggers/debounce, the six passes (create / split / archive / purge / merge-candidates / auto-pin-reconcile), the nightly tag-vocabulary 3-step, and merge-SUGGESTION writing.                                                                                                                                                                                                                                                                                                        |
| Act stance | System acts silently; every act is journaled via `commitChange` with `actor='system'` — the undo journal replaces any proposal inbox; every act carries an inverse. The ONLY proposal output is merge candidates — never an inbox; the UI safety valve is undo + the merge-proposal card. |
| Boundaries | Never touches `origin='user                                                                                                                                                                                                                                                               | seed | search'`rows for create/split/archive/purge (they get ordering gravity only). Never writes`collection_grants`/visibility. Executes OFF request paths and OFF upload commits (batch-end/nightly only). Embedding/analysis MATH is call-free by construction (centroids are means of stored vectors; seeds are references to existing vectors — no provider call ever computes evolution math); the only provider use is the `merge-arbiter` advisory (chat, nightly, ≤1 call/user/day aggregate budget). |

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
  debounce alone is sufficient.
- `upload` mode runs the CHEAP passes only: create / split / merge-candidates. `nightly`
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
`{ perUser: [{ userId, created[], split[], archived[], purged[], mergeCandidates[],
pinned[], arbiterCalls }], report }`; report row persisted as
`admin_reports(kind='night_eval')`. Idempotent full re-scan — safe to
re-run any time; concurrent invocations serialize on the per-user lock group (second
caller no-ops). Inputs: `node_activity`, `file_likes` (via likes store),
`ai_tag_raw`/normalized tags, `embeddings`/`embeddings_chunk` through the vectorStore
seam, `collection_centroids`. Every mutation goes through journaled `collectionsStore`
mutators with `ctx.actor='system'` (digest/feed carry system acts — NO toasts for silent system acts).

### 2.4 Pass 1 — create (multi-tier mutual-kNN, LLM-free)

1. **content_hash dedup pre-pass:** identical-content twins are routed to the exact-dup finder path
   and NEVER form clusters (hash-first; cosine-1.0 detection is
   redundant).
2. **Mutual-kNN seed expansion** over pooled embeddings of the user's corpus (active
   model space only — cross-`model_id` cosine forbidden): k ≈ 6 (profile
   constant); tier edge-cos thresholds from the model profile —
   **tight 0.82 / mid 0.80 / loose 0.72: release-measured profile values** — either-side
   top-k edge acceptance per tier.
3. **Facet sources in parallel:** path-subtree purity, orthogonally normalized tags,
   like-density generate candidates independently. A facet/embedding cluster pair with
   **Jaccard ≥ 0.8** does NOT double-create: the existing collection is
   **definition-promoted** (predicate set widened) instead — promotion, not duplication.
4. **Per-tier gates** (all T2 hot-tunable, admin impact-count preview; shipped
   defaults shown — thresholds are release-measured profile values where θ-shaped,
   product rules where count-shaped):

- min members ≥ 8; persistence ≥ 2 weeks (WAIVED by likes-density fast path — liked clusters skip the persistence gate);
- rate ≤ 1 create/week/user; active-system ≤ 12 (tight+mid counted) / broad tier
  ≤ 1 event-class per user; size caps tight/mid ≤ 120, broad ≤ 500;
- Jaccard ≥ 0.8 vs an existing collection OR vs a TOMBSTONE fingerprint set ⇒
  merge-PROPOSAL (pass 5) instead of create — never silent re-creation of
  tombstoned definitions (tombstones block silent regeneration of the same definition — `isTombstoned` pre-check with
  `collectionsService.fingerprintDefinition`).

5. Create as `origin='system'`, definition = centroid/cluster rule, name via
   templateNamer (llmNamer swap only if chat configured), centroid upserted
   (model-keyed), initial members published per the publish-mode rules (system origin lives in the owner's
   own views; parking applies only once shared — same rule, same store flag).

- **No tier-specific lifecycle exemptions (uniform rules only)** — every created system collection faces identical split/archive/purge.

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
core params: θ / tag-set / path — NOT raw centroid values, so trivial member drift
cannot slip past). Suppression effectiveness is measured, then
tuned, via admin counters: `tombstone-suppressed` vs `regenerated-anyway`.

### 2.8 Pass 5 — merge candidates (containment-safe) + arbiter advisory

- Metric on MATERIALIZED membership sets (capped 500 rows/collection):
  `sizeRatio = min/max ≥ 0.7` AND `jaccard ≥ 0.7`. Centroid cosine is a PREFILTER ONLY —
  never grounds for a suggestion. Overlap-coefficient / containment (|A∩B|/min) metrics
  are BANNED — they fire on subset pairs (Spain ⊂ Europe) which must NOT merge.
- Pair sources: derived pairs by centroid-cosine prefilter→set check; stored pairs by set
  Jaccard directly (LLM-free variant, same pipeline). Scope: `system`↔anything
  the SAME user owns; both must be `active`.
- `upsertMergeSuggestion(aId,bId,score)` (pair normalized, UNIQUE(a,b) conflict keeps the
  existing row + its state); `score` = jaccard×1000 (scaled int).
- Suppression state machine: `rejected` pair ⇒ never re-suggested (permanent,
  `Keep separate`); `dismissed` (`Later`) ⇒ re-raised ONCE after 2 weeks, then sleeps 30d
  (this pass owns the timing — the API never does); re-raise updates `score` and resets
  `pending`.
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

### 2.10 Nightly tag-vocabulary 3-step

Runs in the nightly slot (after create needs tag predicates; before merge prefilter):

1. **Orthographic normalization** — NFKC + whitespace/case fold, a read-time PURE
   function materialized into `ai_tag_raw` (grouping aid; raw stays in `ai_features.tags`).
2. **Containment → parent hints** — rule `containment ∧ cos ≥ θ_lo` (θ_lo = 0.75 profile
   default — **release-measured value**) writes `upsertAutoParent(child,parent)` —
   which structurally NEVER overwrites an `admin` row (aiTagStore §2.4). Display/grouping
   hint only: no rewrite, no merge (a wrong parent costs one odd group row — admin may view/edit `tag_parents`).
3. **Gray band = leave alone.** No alias merge, no co-occurrence gate, no merge-ratio
   cap. No
   confirm/undo surface exists for hints (parent edits are re-editable rows, not
   journal acts).

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
| tier edge-cos 0.82/0.80/0.72, k≈6, θ_lo 0.75, δ/θ shapes                                        | profile | **release-measured profile values** (release artifacts — no runtime calibration; re-open trigger: measured corpus drift) |
| min 8 / ≤1-wk / ≤12 active / caps 120·500 / band 0.55–0.7 / ratio·jaccard 0.7                   | fixed   | product rules                                                                                                            |

## 4. Dependencies

- `collectionsStore` (journaled mutators + centroids/tombstones/suggestions),
  `actionJournalStore` (via commitChange), `fileNodesStore`, likes/activity stores,
  `aiTagStore`, `embeddingsStore`
- `vectorStore` seam (neighbors for kNN/cosines), `domains/ai/llmAdapter` — ONLY the
  merge-arbiter + llmNamer chat paths; capability absence degrades to LLM-free variants
  (set-Jaccard merge, template names) with identical output shapes — capability absence degrades features, never disables them
- `maintenanceScheduler` nightly slot; `templateNamer`;
  `collectionsService.fingerprintDefinition`
- Forbidden: any request-path invocation, any grant write, any file-node mutation.

## 5. Verification Scenarios

- [ ] Debounce: 5 upload commits 10s apart ⇒ exactly ONE cheap pass ~90s after the LAST
      commit; a mistimed re-fire produces zero new acts (idempotent re-scan assert)
- [ ] `uploadComplete` hint fires immediately; trigger `nightly` ignores upload arms
- [ ] Pass-1: content_hash twins never cluster; mutual-kNN yields tight∪mid∪broad at the
      three tiers; connected-components chaining absent (regression fixture)
- [ ] Facet/cluster Jaccard ≥0.8 pair ⇒ definition-PROMOTION on the existing row, zero
      new collections
- [ ] Gate matrix: <8 members / <2wk persistence / rate cap / ≤12 active / size caps each
      block creation; likes-density waives persistence only
- [ ] Tombstoned definition ⇒ create suppressed + counters observable; drifted member
      set (same normalized definition) still suppresses (fingerprint ignores raw centroid)
- [ ] Split creates a SIBLING; parent definition/membership byte-identical before/after
- [ ] Archive: inactive system row archived; PINNED (user or auto) row never archived;
      uniform across tiers (fixture proves broad tier archives too); no exclusion-rate
      trigger exists (high-exclusion + active row survives)
- [ ] Purge: archived past retention → row+cascade gone, tombstone present, journal rows
      purged; `user|seed|search` origins NEVER archived/purged by any pass (silent evolution is system-origin only)
- [ ] Merge candidates: subset pair (sizeRatio < 0.7) never suggested (geometry
      fixtures — Spain ⊂ Europe); near-identical pair suggested; rejected pair terminal;
      dismissed re-raised once at +2wk and sleeps after
- [ ] Arbiter: chat on + band 0.55–0.7 ⇒ recommendation on the card; request body
      contains symmetric-difference samples; chat off ⇒ same card, verdict NULL; card
      without user click NEVER merges (arbiter self-execution grep/test ban)
- [ ] Auto-pin reconcile: each touch type (per §2.9) pins a system row (`pinned_by='auto'`,
      no journal row for the pin); read/view/like touches do NOT pin; user-origin rows
      keep NULL; nightly reconcile clears any illegal non-system auto-pin
- [ ] Tag pass: spacing variants grouped via `ai_tag_raw`; containment pair gains an auto
      parent; admin parent survives auto re-runs; gray-band pair gains NOTHING; no
      tag-merge/alias artifact exists anywhere (schema grep)
- [ ] Every act journaled `actor='system'` (undoable via digest/feed ≤24h — actions
      feed), zero toast-side effects, `admin_reports(kind='night_eval')` written
- [ ] Kill switches: global pause stops ALL acts but leaves suggestions/rendering intact;
      create-pause leaves split/merge-candidates running; nothing deletes queued work
