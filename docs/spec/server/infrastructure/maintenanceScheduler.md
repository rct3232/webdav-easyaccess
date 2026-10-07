# maintenanceScheduler Spec

## 1. Overview

| Item      | Description                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role      | Startup maintenance hooks + periodic schedules: the GC cron and the fail-safe startup scan (current); AI-adjacent nightly one-shots (§3). All schedules are functions in THIS module — new schedulers are never new module files (CODING_STYLE.md Express Patterns). |
| Source    | `server/infrastructure/maintenanceScheduler.js`                                                                                                                                                                                                                      |
| Test file | `server/infrastructure/__tests__/maintenanceScheduler.test.js`                                                                                                                                                                                                       |

---

## 2. Current behavior (implemented)

Startup hooks: optional GC cron scheduling and the fail-safe orphaned-node startup scan.
Both are fire-and-forget; failures are logged, never fatal.

### 2.1 Public exports

| Export                                                                                  | Signature                          | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shouldSkip()`                                                                          | `() => boolean`                    | `WEA_SKIP_GC_SCHEDULER` truthy (`1/true/yes/on`) ⇒ all GC scheduling disabled (test seam).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `resolveIntervalMs()`                                                                   | `() => number`                     | `GC_INTERVAL_MS` via the shared `configResolver.getConfigSync` (DB-only — `dbOnly` registry entry; env intentionally ignored; resolver primed with DB settings at boot). Non-finite or ≤0 ⇒ `0` (disabled).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `startGcScheduler({ gcService })`                                                       | `(opts) => NodeJS.Timeout \| null` | `shouldSkip()` or missing service ⇒ `null`; interval 0 ⇒ `null`; else `setInterval(runGcCycle)` — silent on success, `console.error` on failure (never throws into boot).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `runStartupFailSafeRecovery({ failSafeService, adminReportsWriter, contentHashProbe })` | `async (opts) => report`           | Startup ONE-SHOT: `failSafeService.runStartupRecovery()`; logs orphan count only when non-zero (threshold-gated) + the `pendingUpload` section count with the `repair-sync` pointer (contract: [uploadService.md](../services/uploadService.md) §2.5.1). Also merges the boot completeness section: awaits `contentHashProbe` (default: `adminReportsService.collectContentHashCompleteness`) and writes ONE best-effort `kind='failsafe'` row whose payload carries the scan report plus `contentHashCompleteness` (`status` `partial` when `nullCount > 0` or the count failed, else `ok`); a throwing probe is logged and omitted — boot never fails. Missing service ⇒ empty report; thrown errors ⇒ logged, `{scanned:0,...,error}` returned. |

Startup one-shots are the module's stance: **report-only at boot, never destructive**.
The AI worker's `recoverStaleRunning` one-shot belongs to `aiJobService` startup,
NOT this module — this module only schedules PERIODIC work.

---

## 3. Target additions

Three planned scheduler functions per CODING*STYLE.md Express Patterns (`shouldSkip`/`resolveIntervalMs` seams,
no new module files) plus the evolution/nightly integration points. Existing §2 content
is unchanged; new functions mirror its idioms (per-function `WEA_SKIP*\*` seam, DB-only
interval resolution, log-never-throw).

### 3.1 `startUsageRollupScheduler({ usageService, ... })` — nightly rollup

- Fires once per nightly anchor (§3.4). Chain: `usageService.rollupNodeActivity()`
  (`usage_events` → `node_activity` upserts, applying the item accumulator
  `score ← score·2^(−Δt/H) + Σ w_a` plus the count/`last_seen_at` columns), then
  `collectionsStore.recomputeActivityScores()` (Σ member item scores →
  `collections.activity_score`) and the retention tail: raw
  `usage_events` rolled off at 90d (GC-parity delete), `actionJournalStore.expireJournalRows()`
  (payload NULLed, rows survive — actionJournalStore §2.5 names
  THIS module as its GC caller) and `collectionsStore.purgeExpiredTombstones(cutoff)`
  (lifetime = `ARCHIVE_RETENTION_DAYS`) — one nightly data-hygiene slot, ordered
  rollup-before-roll-off so no unrolled event is deleted.
- Seam: `WEA_SKIP_ROLLUP_SCHEDULER` (truthy ⇒ no schedule; unit tests + hermetic E2E).
- Implementation contract:
  - The tick sequences the five legs IN ORDER (`usageService.rollupNodeActivity()` →
    `collectionsStore.recomputeActivityScores()` → `usageService.rollOffExpiredEvents()`
    → `actionJournalStore.expireJournalRows()` → `collectionsStore.purgeExpiredTombstones(cutoff)`).
    Any leg failure aborts the remaining legs (logged, retried next anchor — idempotent
    re-runs make the retry a no-op for already-consumed intervals).
  - DI: `usageService` is required (missing ⇒ `null`); the store legs are resolved
    lazily (`collectionsStore`, `actionJournalStore` facades) with DI overrides for
    tests, mirroring `resolveAdminReportsWriter`.
  - Rollup config is read per-fire (T2 hot, dbOnly): weights
    `AI_USAGE_W_{OPEN,PREVIEW,DOWNLOAD,SEARCH_HIT,LIKE}` (defaults 1/2/3/1/5) and
    `AI_ACTIVITY_HALF_LIFE_DAYS` (default 30) are resolved by `usageService`
    (product constants — NOT AI-profile numbers); the
    `usage_events` roll-off horizon is `AI_USAGE_EVENT_RETENTION_DAYS` (default `90`,
    `0` = retention off); the tombstone cutoff is now − `ARCHIVE_RETENTION_DAYS`
    (default `30`, key shared with evolution pass 4 per `collectionsService.md` §3).
  - The run does NOT persist an `admin_reports` row (the `kind` CHECK enum has no
    rollup kind): the tick is
    log-only (`console.error` on failure, silent on success, never throws out of the
    timer).
  - The usage-event RECORDING path is `usageService.recordEvent({ userId, nodeId, action })`
    (validation + `usage_events` insert). The recording points (download / preview /
    search-hit / like / list-entry-click endpoints) wire it in their owning waves
    (searchService logs `search_hit` per returned node; like toggle; download/
    preview = files domain) — this module only rolls up.

### 3.2 `startEvolutionScheduler({ evolutionService })` — nightly backbone slot

- Fires once per nightly anchor and calls
  `evolutionService.runEvolutionPass({ passes: 'full' })` (nightly runs ALL
  passes incl. archive/purge; upload-triggered cheap passes are armed by the upload hook
  inside evolutionService and are NOT scheduled here — this slot guarantees the
  "nightly at least once/day" invariant even in `upload` trigger mode).
- Config seam chain (read at FIRE time, T2 hot — [evolutionService](../services/evolutionService.md) §2.2 owns semantics): `AI_EVOLUTION_ENABLED`
  false or `AI_EVOLUTION_NIGHTLY_ENABLED` false ⇒ tick logs `skipped` and returns
  (pause never destroys queued work; journal/digest untouched).
- `AI_EVOLUTION_DEBOUNCE_S` (default 90, T2/dbOnly) governs the per-user upload-batch
  trailing-edge re-arm in evolutionService; the scheduler slot itself is the fixed
  nightly anchor — the two triggers share one `runEvolutionPass` and never double-fire
  (per-user lock group makes a concurrent pair a no-op; lockManager precedent
  `migrationService.js:330-348`).
- Seam: `WEA_SKIP_EVOLUTION_SCHEDULER`.

### 3.3 `startNightlyTagScheduler({ tagService })` — tag-normalization 3-step slot (P1)

- Runs after the evolution slot in the same anchor (ordering matters: create-pass tag
  predicates want fresh parent hints; arbiter wants normalized groups): orthographic
  normalization materialization (`ai_tag_raw`), containment→parent auto rule
  (`upsertAutoParent`, never overwriting admin rows), gray band untouched; then the
  tag-embed batch (`aiTagStore.findTagsWithoutEmbedding` → embed → `upsertTagVectors`) for
  new distinct vocabulary.
- Embed role unconfigured ⇒ normalization + raw materialization still run (they are
  LLM-free steps 1); the vector-matching/parent-cosine legs skip with a logged reason
  (None column of the feature-degradation matrix: normalized string equality remains the search behavior).
- Seam: `WEA_SKIP_TAG_SCHEDULER`.

### 3.4 Nightly anchor resolution

- `resolveNightlyTickCron()`-style helper mirroring `resolveIntervalMs`: interval fixed
  at 24h; the anchor hour comes from `AI_NIGHTLY_ANCHOR_HOUR_UTC` (T2/dbOnly, default 3) — each of §3.1–§3.3 schedules `setTimeout` to the next anchor then re-arms
  (drift-tolerant; a missed tick (sleeping laptop) runs at the next anchor, passes are
  idempotent re-scans so nothing is "wrong", only late).
- All three functions return `null` (disabled) on seam or missing service, exactly like
  `startGcScheduler`.
- Anchor math: `resolveAnchorHour()` reads the dbOnly key via the shared resolver
  sync seam (`getConfigSync`, GC precedent) and falls back to `3` for non-integer or
  out-of-`0..23` values; `resolveNightlyDelayMs(nowMs, anchorHour)` returns the ms to the
  NEXT occurrence of the anchor hour (UTC, top-of-hour) in `(0, 24h]` — a delay computed
  as exactly `0` collapses to `24h` (boot/restarm AT the anchor instant waits for the next
  anchor: "never twice in one day", no hot re-arm). Each scheduler re-arms with the SAME
  resolution (anchor hour re-read at fire time — hot). The returned handle is the
  FIRST pending timer; re-arms replace it internally (fire-and-forget boot wiring never
  cancels; tests use fake timers + `jest.clearAllTimers()`).

### 3.5 Unchanged

`startGcScheduler`, `runStartupFailSafeRecovery`, `shouldSkip`, `resolveIntervalMs` keep
their §2 contracts verbatim; boot wiring (`server/index.js`) gains the three new calls
next to the existing ones, after migrationGate/init like the GC scheduler.

## 4. Verification Scenarios

- [ ] Existing: GC interval 0/unset ⇒ no timer; `WEA_SKIP_GC_SCHEDULER` ⇒ no timer;
      startup fail-safe scan report-only, errors swallowed to `{error}`
- [ ] Each new scheduler returns null under its `WEA_SKIP_*` seam and with the
      injected service absent — same shape as GC
- [ ] Rollup order: events rolled BEFORE the 90d roll-off deletes; a forced
      rollup failure aborts the roll-off (journal-expire/tombstone-purge legs skipped too,
      retried next anchor)
- [ ] `expireJournalRows` run: applied-past-expiry rows NULL payloads, counts
      logged into the nightly report; `undone` rows untouched
- [ ] Evolution slot with `AI_EVOLUTION_ENABLED=false` fires the timer but
      performs zero acts (spy on `runEvolutionPass` not called / called-and-skipped);
      upload-mode DB still gets exactly one FULL pass per day
- [ ] Debounce vs nightly: a pass already running when the anchor fires
      no-ops on the lock (no interleaved double-journal of the same act)
- [ ] Tag slot without embed role: normalization + `ai_tag_raw` update,
      parent-hint/vector legs skipped with log, no throw into the scheduler
- [ ] Anchor math: tick lands within the configured hour; a server restart
      across the anchor executes the pass at the NEXT anchor, never twice in one day
