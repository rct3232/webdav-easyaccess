# usageStore Spec

## 1. Overview

| Item      | Description                                                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role      | Usage-signal persistence — `usage_events` (raw, append-only, 90d roll-off) and the `node_activity` per-(user,node) accumulator (`opens/downloads/previews/search_hits/likes` lifetime counts + decaying `score`). §3.4 DEF-25 domain. |
| Precedent | `fileLikesStore` twin (per-user normalized table, stable node_ids, FK CASCADE). The night-night chain (rollup → recompute → retention tail) is sequenced by `maintenanceScheduler` (§3.1) over `usageService`.                          |
| Journal   | NONE. Usage signals are telemetry, not undoable user actions (§4.11 matrix — like/visit/sort manipulation rows have no undo).                                                                                                            |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/usageStore.js` (facade, no SQL)
- **Pure math (item accumulator S_k / lazy decay):** `server/infrastructure/usage/activityScore.js` — the SINGLE source of the §3.4 weights/H semantics consumed by the rollup (via `usageService`) and by future read-time consumers (member ordering lazy decay `S_read = S·2^(−(now−updated_at)/H)`).
- **Service:** `server/infrastructure/usageService.js` — config resolution (T2/dbOnly §3.4 constants), recording-path validation, rollup orchestration, retention roll-off.
- **Interface + factory:** `server/store/repositories/UsageRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/UsageRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/UsageRepository.conformance.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (§5 blocks: `usage_events(id BIGSERIAL, user_id→CASCADE, node_id→CASCADE, action CHECK open|download|preview|search_hit|like, created_at)`; `node_activity(user_id, node_id→CASCADE, opens, downloads, previews, search_hits, last_seen_at, likes, score REAL, updated_at, PK(pair))`).

### 2.2 Main Methods

| Method                     | Signature                                                                          | Description                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insertUsageEvent`         | ({ userId, nodeId, action, at? }) => Promise\<{ changes }\>                        | One raw event row; `at` defaults to now (ISO bind — deterministic for decay tests). FK-enforced on unknown user/node.                                                                                                    |
| `readRollupGroups`         | () => Promise\<rollupGroup[]\>                                                     | Events joined to their existing `node_activity` row, watermark-filtered, grouped by (user_id, node_id) — the rollup's ONLY read. See §2.3.                                                                               |
| `upsertNodeActivity`       | (rows) => Promise\<{ changes }\>                                                   | Batch UPSERT on the PK pair (counts = lifetime totals, score/last_seen_at/updated_at overwritten).                                                                                                                       |
| `deleteUsageEventsOlderThan` | (cutoffMs) => Promise\<{ changes }\>                                             | Retention roll-off (GC-parity): raw events older than the cutoff. Called by the nightly tail ONLY after a successful rollup (no unrolled event is ever deleted — maintenanceScheduler §3.1 ordering).                    |

`rollupGroup = { userId, nodeId, counts: {open, download, preview, search_hit, like}, lastSeenAtMs, prevScore, prevCounts, prevUpdatedAtMs|null }` — domain-shaped (numbers; timestamps normalized to ms epoch by each dialect twin).

### 2.3 Rollup semantics (§3.4 item accumulator)

- **Watermark**: an event belongs to interval k iff `e.created_at >` its row's `node_activity.updated_at` (strict `>` — the previous rollup consumed everything up to that instant). Rows without an accumulator row consume ALL their events (Δt = 0, decay is a no-op on `S=0`).
- **Interval math**: per group, `S_k = S_(k−1)·2^(−Δt/H) + Σ_(new events) w_a` with Δt = `rollup now − prev_updated_at` (clamped ≥ 0), H and `w_a` injected by the service from the T2/dbOnly constants (`AI_USAGE_W_*`, `AI_ACTIVITY_HALF_LIFE_DAYS`). Count columns accumulate LIFETIME totals (prev + new); `last_seen_at = MAX(created_at)` over the consumed events; `updated_at = rollup now`.
- **Timestamp-format safety (sqlite)**: sqlite writes both `CURRENT_TIMESTAMP`-defaulted (`'YYYY-MM-DD HH:MM:SS'`) and bound ISO (`'…T…Z'`) values into TEXT columns; all temporal comparison/aggregation in the sqlite twin goes through `julianday(...)` (parses both formats, UTC-based) — `purgeExpiredTombstones` precedent. All values WRITTEN by this store are bound ISO strings.
- **Idempotency**: re-running the rollup inside the same interval consumes nothing (watermark strict-greater than the freshly stamped `updated_at`), so a forced re-run or a crash-retry never double-counts. Events arriving between the read and the upsert have `created_at > updated_at` and are consumed at the next anchor (at-least-once, ordered before roll-off).
- **Deletion interplay**: FK CASCADE wipes both `usage_events` and `node_activity` rows when the node (or user) is purged — no orphans, no special handling.

### 2.4 Transaction Boundaries

- One statement per call (`usage_events` insert, retention delete). The rollup (`readRollupGroups` → `upsertNodeActivity`) is deliberately NOT one TX: nightly single-instance cadence + watermark idempotency make crash-recovery a no-op re-run, and the ≤500-members sums keep the window negligible.

### 2.5 Error contracts

- Unknown `action` is rejected by the service layer (`usageService.recordEvent`, `usage_actions.invalidAction`-shaped TypeError) — the DDL CHECK remains the last line of defense.
- Unknown user/node → FK error surfaced via `mapDatabaseError`.
- No dialect branching outside the repository twins.

### 2.6 Dependencies

- `storage.getExecutor()` + `UsageRepository` (+ twins), `infrastructure/usage/activityScore.js` (via the service), `configResolver` (service only). No journal/lock dependencies.

### 2.7 Verification Scenarios

- [ ] `insertUsageEvent` round-trips; unknown node → FK rejection; `{ changes: 1 }`
- [ ] Rollup of fresh events → accumulator row with weighted score (e.g. 2×open + 1×download = 5), lifetime counts, `last_seen_at` = latest event, `updated_at` = rollup now
- [ ] Accumulator decay: a pre-existing row with `score=5, updated_at=now−30d` rolls to `2.5 + Σ w_new` (H=30d half-life)
- [ ] Idempotent re-run: second rollup immediately after → no group returned, no changes; a NEW event after `updated_at` is consumed on the next run
- [ ] `deleteUsageEventsOlderThan` removes only rows older than the cutoff (ISO vs `CURRENT_TIMESTAMP` written rows both honored — `julianday` parity)
- [ ] L2 conformance on real sqlite AND real PostgreSQL (`test:ci:pg:adapters`): watermark parity, score decay parity (closeTo), count accumulation, cascade wipe on node purge