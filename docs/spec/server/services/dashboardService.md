# dashboardService Spec

Target-contract spec (server side of `docs/spec/server/routes/dashboard.md`;
`docs/features/collections-platform.md` §4.16/§4.17).

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Compose the Storage-dashboard read (dups + persisted cleanup suggestions + trash summary): the generator pass materializes `file_suggestions` rows from the hash/vector/rule variants, the read lists the user's pending rows, and the accept-to-trash command journals ONE undoable command row.       |
| Boundaries | No raw SQL (persistence exclusively through `store/fileSuggestionsStore.md`); no LLM — the vector near-dup leg reads precomputed canonical embeddings through `nearDupFinderService`. The accept command writes through `actionJournalStore.commitChange` (the journal's `file`-domain cleanup family). |

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/domains/dashboard/service.js` (composition, accept, dismiss)
- **Rule matchers:** `server/domains/dashboard/suggestionsRules.js` (pure, LLM-free — §2.5)
- **Keeper scorer:** `server/domains/dashboard/keeperScore.js` (pure, LLM-free — §2.5,
  near-dup keeper composite v1)
- **Undo executor:** `server/domains/dashboard/suggestionUndoService.js` (registers the
  `file`-domain undo handler — §2.6)
- **Test files:** `server/domains/dashboard/__tests__/dashboardService.test.js`,
  `__tests__/suggestionsRules.test.js`, `__tests__/keeperScore.test.js`,
  `__tests__/suggestionUndo.test.js`

### 2.2 Main functions

| Function                                   | Returns (camelCase domain object — the ROUTE serializes snake_case)                                                                                                                                                                                                       | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDashboardSummary(userId)`              | `{ duplicates: { groupCount, duplicateCount, reclaimableBytes }, nearDuplicates?: { groupCount, duplicateCount }, suggestions: [{ id, nodeId, kind, path, sizeBytes, reason, createdAt, expiresAt }], trash: { itemCount, totalBytes, oldestDeletedAt, retentionDays } }` | ONE `dupFinderService.findExactDuplicateGroups(userId)` pass feeds `duplicates` (the summary fields); `nearDupFinderService.findNearDuplicateGroups(userId)` feeds the `nearDuplicates` summary block when `available` (when not, the key is OMITTED — absent section, never an error, §4.12). The same two passes plus the rule matchers (§2.5) feed `materializeSuggestions(userId)`, which persists pending rows BEFORE the list read; `suggestions` = the user's `pending` rows with `expires_at` NULL-or-future, enriched with `path`/`sizeBytes` from the subtree read, ordered by kind rank — exact rows first, near-dup rows after, rule rows last — and by row id within the rank. The generator runs under the per-user generate lock (best-effort: lock held ⇒ skip materialize, still list existing rows). NULL-hash rows never surface (consumer-side assertion of the dupFinder guarantee). No user root ⇒ zeros/empty + zero materialized rows. Two consecutive calls on unchanged data return deep-equal results (materialization is idempotent).                                                                   |
| `materializeSuggestions(userId)`           | `{ inserted: number, expired: number }` (internal helper; observable through the GET)                                                                                                                                                                                     | §2.5 generator pass — dedup/idempotency/reconcile contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `acceptSuggestions(userId, user, nodeIds)` | `{ trashed: number[], rejectedNotOwned: number[], skipped: number[], actionId: number \| null }`                                                                                                                                                                          | Validation first (`emptyNodeIds` — §2.7). Per node: `ownerNodeResolver.isOwnerNode(userId, nodeId)` gate (own live node — foreign, unknown, already-trashed all fall to `rejectedNotOwned`, the owner check precedes the trash call); then the files-domain trash core `fileService.deleteNode(nodeId, userId, user)`; a core THROW → `skipped` (per-node isolation, the loop never aborts). After the trash loop, ONE journaled command: `commitChange('file', 'file:suggestion-accept:<userId>:<Date.now()>', { actor: String(userId), action: 'cleanup-accept', subjectLabel }, { inverse: { op: 'restore-from-trash' }, items })` where `items = [{ nodeId, deletedAt, suggestionIds }]` per trashed node (`deletedAt` = the post-trash row read — the undo fingerprint; `suggestionIds` = the pending rows listed pre-flip) and the TX mutation flips those rows `pending → accepted` (`fileSuggestionsStore.flipStatesTx`). Zero trashed nodes ⇒ NO journal row and `actionId: null` (nothing happened; the empty selection never commits an empty command). `result.actionId` surfaces as `undo: { actionId }` at the route. |
| `dismissSuggestion(userId, suggestionId)`  | `{ id, state: 'dismissed' }`                                                                                                                                                                                                                                              | `store/fileSuggestionsStore.md` §2.3 `dismiss`; `changes: 0` → throws `suggestionNotFound` (404 at the route). Non-numeric/≤0 `suggestionId` → throws `invalidSuggestionId` (400). Not journaled (preference flip, not a file mutation).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `resolveTrashRetentionDays()`              | `Promise<number>`                                                                                                                                                                                                                                                         | Same resolution order as gcService Tier 3: `getSharedResolver().getConfig('TRASH_RETENTION_DAYS')` → finite ≥0 wins, else default `30` (`0` = retention off).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `resolveSuggestionRetentionDays()`         | `Promise<number>`                                                                                                                                                                                                                                                         | Same discipline, key `AI_SUGGESTION_RETENTION_DAYS` (T2/dbOnly, default 30): finite ≥0 wins, else 30. `0` = never expire (rows carry `expires_at NULL`); the expiry scheduler run is `retention_off` under 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 2.3 Dependencies

- `domains/ai/dupFinderService` (exact-dup compute reused verbatim — do NOT re-implement
  grouping)
- `domains/ai/nearDupFinderService` (vector near-dup compute reused verbatim —
  `nearDupFinderService.md`; the hash-first exclusion lives THERE, not here)
- `store/fileSuggestionsStore` (persisted rows — the ONLY persistence surface here)
- `store/actionJournalStore` (`commitChange` — accept command rows; the undo executor
  registers through `store/actionJournalStore.registerUndoExecutor`)
- `store/fileNodesStore` → `getUserRootNode`, `listSubtreeCacheRows`,
  `summarizeTrashedSubtree`, `getNodeIncludingTrashed`, `getChildren`, `renameNode`,
  `untrashSubtree`, `renameNodeTx`, `untrashSubtreeTx`
  (`docs/spec/server/store/fileNodesStore.md`)
- `store/aiEnrichmentsStore` → `getByNodeIds` (short-document exception input AND the
  media-probe keeper input — §2.5/§2.5.1)
- `store/usageStore` → `listNodeActivity` (keeper activity factor — §2.5.1)
- `infrastructure/configResolver.getSharedResolver` (retention days)
- `infrastructure/lockManager` (generate lock — §2.5 dedupe)
- `service/composition.getComposition` → `fileService` (trash core),
  `fileNodeService` (undo display paths), `blobStore`/`fileStorageMode` (undo move-back),
  `domains/permissions/policy/ownerNodeResolver` (own-node gate)

### 2.4 Errors & transactions

- Service throws bare string codes (`emptyNodeIds`, `invalidSuggestionId`,
  `suggestionNotFound`) translated by the route-level `ERROR_MAP`; per-node trash failures
  stay outcome lists, never throws (§2.2).
- Per-node deletes run in the trash core's own discipline (no service-level TX — batch
  semantics stay per-node like `batchOperationService.deleteNodesBatch`). The row flips and
  the journal insert land in the `commitChange` TX; the trash itself committed before the
  command row (a command-row insert failure leaves the files trashed — trash-restore stays
  the fallback undo, §4.11).
- The GET materializes through the store facade (single-row inserts + state flips under the
  generate lock) — the read itself holds no transaction.

### 2.5 The generator pass (rule + vector variants)

Candidate sources, in INSERTION order (persisted rows keep it; the list orders by id):

1. **Exact dups** (`kind='exact_dup'`): from the dupFinder pass — members beyond the group's
   smallest node id; `reason = { kind, keep_node_id }`. NULL-hash rows never group
   (`dupFinderService.md` hard rule).
2. **Near dups** (`kind='near_dup'`): from the nearDupFinder pass, ONLY when the vector leg
   is `available`; the keeper is the member with the highest KEEPER COMPOSITE (§2.5.1 —
   ties ⇒ smallest node id), the remaining members are rows;
   `reason = { kind, keep_node_id, score, keep }` (score = the group's best pairwise cosine;
   `keep` = the keeper-exposure block of §2.5.1 — additive, no legacy backfill).
   **Short-document exception:** a member whose `ai_enrichments.summary` exists and holds at
   most one sentence (≤1 non-empty segment under sentence-final punctuation) is EXCLUDED
   from near-dup rows — edit variants of one-line files score low cosine; such files only
   surface through the hash path. A member with no enrichment row is NOT excluded (absence
   of evidence is not evidence of brevity). If exclusion leaves < 2 members the group
   contributes no rows. Keeper selection is unchanged by the exclusion (the keeper is never
   a row).
3. **Rule variants** (LLM-free, filename/temp/pattern rules over the subtree cache rows —
   `suggestionsRules.js`):
   - `kind='temp_pattern'` — name/extension matches the temp family (`.tmp .temp .bak .old
.dmp .chk .part .crdownload .swp .~tmp` extensions, `~$` Office-lock prefix, `temp_`/
     `tmp_` name prefixes). No age requirement. `reason = { kind, pattern: 'temp' }`.
   - `kind='stale_screenshot'` — name matches `^(screen[_ -]?shot|screenshot|snip)` (case
     insensitive) AND `created_at` older than `STALE_SCREENSHOT_DAYS` (module constant,
     default 30). `reason = { kind, pattern: 'screenshot', age_days }`.
   - `kind='old_installer'` — extension in `.exe .msi .msp .dmg .pkg .deb .rpm .apk .AppImage
.iso` AND `created_at` older than `OLD_INSTALLER_DAYS` (module constant, default 90).
     `reason = { kind, pattern: 'installer', age_days }`.

Per-node dedupe: kind priority exact_dup > near_dup > temp_pattern > stale_screenshot >
old_installer — a node contributes AT MOST one candidate per pass; a node that is a keeper
(`keep_node_id`) of an exact/near group in this pass contributes no candidate at all (the
keeper is never listed, all kinds).

### 2.5.1 Near-dup keeper composite (v1)

Exact dups keep the smallest node id (identity — bytes are equal). Near-dup groups use a
quality composite computed by the PURE module `keeperScore.js` (no IO, no clock reads —
the caller passes `nowMs`). Every factor is min-max normalized WITHIN the group; an
all-equal factor scores `0.5` (neutral, no invented preference).

| Factor           | Weight | Raw signal                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity         | 0.45   | `node_activity.score` (30d half-life accumulator) decayed by last-seen recency (`2^(−ageDays/30)`). **30d unopened is a PENALTY, not an exclusion:** `last_seen_at` NULL or older than 30 days multiplies the raw value by `0.25`; a member with no accumulator row is unopened (raw 0).                                          |
| Media Quality    | 0.30   | Image/video MIME with `ai_enrichments.probe` width & height ⇒ `log1p(width*height)`; media without a probe ⇒ `log1p(size_bytes)` fallback. Non-media (documents) are NEUTRAL `0.5` and excluded from the media min-max range. Lossless image/audio MIME (png/tiff/bmp, flac/wav) add `+0.05` after normalization, clamped to `1`. |
| Name Originality | 0.15   | `1 − 0.2 × markerCount`, clamped `0.1..1`; markers: `copy`, `(1)`, `edited`, `export`, `compressed`, `small`, `thumb(nail)`, `preview`, `screenshot`, `temp`/`tmp`, `~$`.                                                                                                                                                         |
| Centrality       | 0.10   | Mean cosine to every OTHER group member, computed from the nearDupFinder `pairScores` (missing pair ⇒ 0), normalized within the group.                                                                                                                                                                                            |

Composite = `0.45·activity + 0.30·quality + 0.15·name + 0.10·centrality`. Keeper = highest
composite; tie ⇒ smallest node id. Single-member factors are all-equal ⇒ neutral.

**Exposure (`reason.keep`, additive on NEW/re-materialized near-dup rows only — no legacy
backfill):**

```
keep: {
  name: string,                 // keeper basename only (never a full path)
  relative_score: number,       // keeper composite 0..1, 3 decimals (group-relative)
  confidence: 'high' | 'medium' | 'low',
  basis: 'activity' | 'resolution' | 'size' | 'name' | 'centrality' | 'mixed' | 'none',
  factors: { activity, quality, name, centrality },   // 0..1, 3 decimals
  unopened_30d: boolean,
  score_version: 'v1'
}
```

`basis` = the factor with the largest weighted edge of the keeper over the group mean
(quality reads `resolution` when the keeper has a probe, `size` when the fallback applied;
documents contribute no quality edge). No positive edge ⇒ `none`; two factors within `0.005`
of the top edge ⇒ `mixed`. `confidence` from the composite margin over the runner-up:
`≥0.10` high, `≥0.03` medium, else low (`basis: 'none'` is always low).

**Data loading (no N+1):** the pass reads activity with ONE
`usageStore.listNodeActivity(userId, allGroupMemberIds)` call and enrichments with ONE
`aiEnrichmentsStore.getByNodeIds(allGroupMemberIds)` call; name/size/MIME come from the
live subtree rows. The enrichment read is shared with the short-document exception.

**Reason-only refresh:** for an existing PENDING near-dup row whose candidate key is still
current, the stored `reason` is refreshed (same row id, `created_at`, `expires_at`, state) when
keeper/quality inputs changed; unchanged rows are never written. Dismissed rows are left
verbatim.

Materialization semantics (`store/fileSuggestionsStore.md` §2.2/§2.4):

- **Dedupe:** insert ONLY when the user has NO existing row of the same `(node_id, kind)` in
  state `pending`/`dismissed` (`expired` history does not block re-suggestion). An `accepted`
  row of a live current candidate `(node_id, kind)` is RE-PENDED (trash-UI restore without
  the journal undo) instead of duplicated — the original row and id resurface (§2.2).
- **Expiry stamp:** `expires_at = now + resolveSuggestionRetentionDays()` (`0` ⇒ `null`).
  Re-materialization never rewrites an existing pending row (id and expiry stay stable;
  dismissing/expiring a row is the user's or the retention job's state, not the generator's).
- **Reconcile:** pending rows whose `(node_id, kind)` is NOT in the current candidate set,
  or whose node left the live set (trashed/deleted/moved out of scope — the subtree read is
  the live oracle), flip to `expired` in the same pass (ids collected from the candidate
  scan already in memory; one `flipStatesTx` call with the executor as caller-owned
  queryable).
- **Concurrency:** the whole pass (dedupe read → inserts → reconcile) runs under
  `lockManager.acquireLock('file-suggestions-generate:' + userId, { waitMs: 0 })`; a held
  lock ⇒ the pass skips (existing rows are listed unchanged).

### 2.6 The `file`-domain undo executor (accept commands)

`domains/dashboard/suggestionUndoService.js` registers the `file`-domain undo executor
(`actionJournalStore.registerUndoExecutor('file', …)`) at module load — the dashboard domain
owns its own inverse family; the actions router dispatches generically. Per-item application
(command-unit rows, mixed results allowed — `store/actionJournalStore.md` §2.4):

For each `payload.items` entry `{ nodeId, deletedAt, suggestionIds }`:

1. **Guards** (any failure ⇒ item SKIPPED `{ applied: false, reason: 'changed' }`, never a
   throw): node exists, `deleted_at` set, `deleted_at` matches the captured `deletedAt`
   fingerprint (normalized to epoch ms), `type='file'`, parent live (or NULL). The
   requester identity is already enforced by the actions router (actor visibility); the
   executor needs no user object (direct store writes, no ACL re-check). One convergence
   exception: when the node is ALREADY live (`deleted_at IS NULL` — a previous attempt
   committed the restore, or the user restored it through the trash UX), the item's
   `suggestionIds` still flip `accepted → pending` (idempotent `flipStatesTx(tx, …)`)
   before the skip is reported, so suggestions and journal status converge on retry.
2. **Collision name** — if a LIVE sibling carries the node's name, compute the restore name
   with the trash-restore suffix idiom (`resolveRestoreName` pattern: `base (2).ext`), else
   keep the name.
3. **Content world first (webdav mode only):** move the blob back from the trash path to the
   display path (final name) BEFORE any DB write (`blobStore.moveBlob`, trash-root ensured).
   When the trash path is already gone (a previous attempt moved it but its DB TX rolled
   back, or the move happened out of band), verify the display-path entry and treat the
   content as already moved — the item continues (idempotent retry); only when NEITHER path
   holds the content is the item skipped. S3 mode: zero physical I/O (stable keys) — no
   remote step.
4. **DB writes:** `renameNodeTx(tx, nodeId, finalName)` (when renamed) then
   `untrashSubtreeTx(tx, [nodeId])` — both on the caller-owned journal TX — then the
   suggestion rows `accepted → pending` via `flipStatesTx(tx, …)`.
5. Outcome `{ applied: true }`.

The node restore/rename, the suggestion flips and the journal `status='undone'` flip run on
the SAME `tx` on BOTH dialects (PG binds the journal client; SQLite joins the open
connection) — there is no autocommitted half-state on either backend. A failure after the
node restore rolls the whole undo back. The WebDAV blob move is outside the DB transaction by
nature; the trash-path-missing/display-path-present check (step 3) together with the
live-node suggestion flip (step 1) makes a retry after a failed attempt converge instead of
stranding the suggestion in `accepted`. Undo never re-inserts rows and never re-trashes.

### 2.7 Validation

`acceptSuggestions` throws `emptyNodeIds` for missing/empty/non-array/over-200 `nodeIds`,
validated BEFORE any work (no trash call, no journal row). `MAX_ACCEPT_BATCH = 200`.

### 2.8 Verification Scenarios

- [ ] 3-hash-group: 2 suggestions (ids after the keep), `keepNodeId` = smallest, `duplicates`
      counts = the dupFinder summary; rows carry stable `id`/`expiresAt` across reads
- [ ] NULL-hash identical twins: zero suggestions, zero duplicate counts (consumer-side of
      the hard rule)
- [ ] Trash subtree: children of a trashed folder counted once each; live files excluded;
      empty trash ⇒ zeros with `oldestDeletedAt: null`
- [ ] Materialize idempotent: two passes insert 0 new rows; a dismissed (node,kind) is never
      re-inserted; an expired history does not block re-suggestion; a new dup adds exactly
      its non-keeper member rows
- [ ] Reconcile: candidate vanishing (keeper flip: keeper trashed by hand) or node trashed
      out-of-band ⇒ the stale pending row flips `expired` on the next read
- [ ] Rule variants: temp/screenshot/installer matchers fire per §2.5 (age boundaries on both
      sides); keepers excluded; priority dedupe holds
- [ ] Near-dup feed: with an active embed model + canonical pooled rows above `θ_dup`,
      `nearDuplicates` present + `near_dup` rows after the exact rows (keeper = highest
      composite, tie smallest node id); hash-twin nodes appear ONLY in exact-dup rows;
      ≤1-sentence enriched members never list `near_dup` rows (a no-enrichment member does
      list); no active model ⇒ no `nearDuplicates` key, no `near_dup` rows, GET still 200
- [ ] Keeper composite: activity penalty (30d-unopened multiplier, never exclusion),
      resolution-vs-size quality, name markers, centrality from `pairScores`, tie ⇒ smallest
      id, missing activity/enrichment inputs; exact dups keep the smallest id and rule rows
      are untouched
- [ ] `reason.keep` shape: `name` basename only, `relative_score`/`factors` group-relative,
      `confidence`, `basis`, `unopened_30d`, `score_version:'v1'`; a legacy pending near-dup
      row without `keep` is not backfilled by a read; a keeper/quality change refreshes
      `reason` only (id/created_at/expires_at/state stable)
- [ ] Accept: own live file → trashed (row `deleted_at` set) + ONE `action_journal` command
      row (`domain='file'`, `action='cleanup-accept'`, items = trashed count) + suggestion
      rows `pending → accepted`; foreign id → `rejectedNotOwned` and the foreign row
      untouched; trashed id → `rejectedNotOwned`; delete-core throw → `skipped`;
      all-rejected call → NO journal row; response `actionId` = the committed row id
- [ ] Validation: `[]`, missing, 201 ids → `emptyNodeIds` before any work
- [ ] Dismiss: pending → dismissed (404 shape via `suggestionNotFound` when `changes: 0`)
- [ ] Undo: trashed nodes live again + rows `accepted → pending` + journal `undone` in ONE
      transaction (node restore/rename and suggestion flips use the journal tx on BOTH
      dialects; a forced failure after the restore rolls everything back — nothing applied);
      fingerprint mismatch (hand-restored node) skipped per item with the rest applied and
      the skipped item's suggestions re-pended so a retry converges; webdav move-back
      asserted through the stubbed blobStore, including the idempotent retry when the trash
      path is already gone but the display path holds the content (s3 mode performs zero
      remote calls)
