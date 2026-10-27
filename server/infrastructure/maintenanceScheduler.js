'use strict';

/**
 * Startup maintenance hooks + periodic schedules: the GC cron, the fail-safe
 * orphaned-node startup scan and the §3.1 nightly usage rollup (T0.6). All are
 * fire-and-forget; failures are logged, never fatal.
 *
 * Scheduling config:
 *   GC_INTERVAL_MS              - DB-only cron interval in ms (registry dbOnly);
 *                                 0/unset disables scheduling
 *   GC_ORPHAN_TTL_DAYS          - orphan age threshold (consumed by gcService)
 *   AI_NIGHTLY_ANCHOR_HOUR_UTC  - nightly anchor hour, UTC top-of-hour
 *                                 (registry dbOnly, default 3; §3.4)
 *   ARCHIVE_RETENTION_DAYS      - tombstone lifetime (collectionsService §3,
 *                                 evolution pass 4 / Q1)
 *   WEA_SKIP_GC_SCHEDULER       - test seam; any truthy value disables GC scheduling
 *   WEA_SKIP_ROLLUP_SCHEDULER   - test seam; any truthy value disables the
 *                                 nightly usage-rollup schedule (§3.1)
 *   AI_SUGGESTION_EXPIRY_INTERVAL_MS - file-suggestions expiry schedule period
 *                                 (§3.6; 0 = disabled, hot re-read per arm)
 *
 * §4.14 Tier A: each scheduled GC run and the startup fail-safe scan persist
 * an admin_reports row (kind gc / failsafe) via the best-effort writer in
 * server/domains/admin/services/adminReportsService.js — inert until the
 * admin_reports store is wired (T0.8), never fatal. The nightly rollup run is
 * log-only (the §5 admin_reports kind CHECK enum has no rollup kind).
 */
/* eslint-disable no-console -- startup status reporting */

const DAY_MS = 86400000;
const DEFAULT_RETENTION_INTERVAL_MS = DAY_MS;
const DEFAULT_RETENTION_BATCH = 1000;
const RETENTION_LOCK_NAME = 'admin-reports-retention';
const RETENTION_LOCK_TTL_MS = 30 * 60 * 1000;

function shouldSkip() {
  const skip = (process.env.WEA_SKIP_GC_SCHEDULER || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(skip);
}

function shouldSkipRollup() {
  const skip = (process.env.WEA_SKIP_ROLLUP_SCHEDULER || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(skip);
}

function resolveIntervalMs() {
  // GC_INTERVAL_MS is DB-only (registry dbOnly); the shared resolver was primed
  // with the DB settings at boot (loadAll), so getConfigSync sees the DB row or
  // the built-in default (0 = disabled). Env is intentionally ignored here.
  const { getSharedResolver } = require('./configResolver');
  const raw = Number(getSharedResolver().getConfigSync('GC_INTERVAL_MS'));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Resolve the shared admin-reports writer lazily (DI overrides it in tests).
 * The admin_reports store is wired by T0.8; until then the writer is inert.
 */
function resolveAdminReportsWriter(injected) {
  if (injected) return injected;
  const { getAdminReportsWriter } = require('../domains/admin/services/adminReportsService');
  return getAdminReportsWriter();
}

// Lazy store seams for the §3.1 nightly chain (DI overrides in tests; the
// facades are direct module consumption per the house pattern).
function resolveCollectionsStore(injected) {
  if (injected) return injected;
  return require('../store/collectionsStore');
}

function resolveActionJournalStore(injected) {
  if (injected) return injected;
  return require('../store/actionJournalStore');
}

/**
 * Start the periodic GC schedule.
 * @param {Object} opts
 * @param {Object} opts.gcService - gcService exposing runGcCycle().
 * @param {Object} [opts.adminReportsWriter] - DI seam for the admin_reports writer.
 * @returns {NodeJS.Timeout|null} timer, or null when disabled.
 */
function startGcScheduler({ gcService, adminReportsWriter } = {}) {
  if (shouldSkip() || !gcService) return null;
  const intervalMs = resolveIntervalMs();
  if (!intervalMs) return null;

  return setInterval(() => {
    gcService
      .runGcCycle()
      .then(async (result) => {
        // Persist the run result as an admin_reports row (§4.14 Tier A — no
        // console-only GC reports). Best-effort: never breaks the schedule.
        try {
          const {
            ADMIN_REPORT_KINDS,
            resolveAdminReportStatus,
          } = require('../domains/admin/services/adminReportsService');
          await resolveAdminReportsWriter(adminReportsWriter).writeReport({
            kind: ADMIN_REPORT_KINDS.gc,
            status: resolveAdminReportStatus(result),
            payload: result,
          });
        } catch (err) {
          console.error('Failed to persist GC report:', err.message);
        }
      })
      .catch((err) => {
        console.error('Scheduled GC failed:', err.message);
        // A failed run is still a run: partial row with the error payload.
        resolveAdminReportsWriter(adminReportsWriter)
          .writeReport({
            kind: 'gc',
            status: 'partial',
            payload: { error: err.message },
          })
          .catch(() => {});
      });
  }, intervalMs);
}

/**
 * Run the startup fail-safe scan. Reports orphaned nodes for manual review
 * without taking any destructive action.
 * @param {Object} opts
 * @param {Object} opts.failSafeService - failSafeService exposing runStartupRecovery().
 * @param {Object} [opts.adminReportsWriter] - DI seam for the admin_reports writer.
 * @returns {Promise<Object>} report
 */
async function runStartupFailSafeRecovery({
  failSafeService,
  adminReportsWriter,
  contentHashProbe,
} = {}) {
  if (!failSafeService) {
    return { scanned: 0, resolved: 0, manualReview: [] };
  }

  // T0.1 merged boot section (§2.2.6): the startup row carries the scan report
  // plus the content-hash completeness section. A probe failure is logged and
  // the section omitted — boot never fails.
  const collectSection = async () => {
    try {
      const collect =
        contentHashProbe ||
        (() =>
          require('../domains/admin/services/adminReportsService').collectContentHashCompleteness());
      return await collect();
    } catch (err) {
      console.warn(`content_hash completeness probe skipped: ${err.message}`);
      return null;
    }
  };

  let report;
  try {
    report = await failSafeService.runStartupRecovery();
  } catch (err) {
    console.error('Fail-safe recovery on startup failed:', err.message);
    const failed = { scanned: 0, resolved: 0, manualReview: [], error: err.message };
    const section = await collectSection();
    // A failed scan is still a run: partial row (§4.14 Tier A), best-effort.
    try {
      await resolveAdminReportsWriter(adminReportsWriter).writeReport({
        kind: 'failsafe',
        status: 'partial',
        payload: section ? { ...failed, contentHashCompleteness: section } : failed,
      });
    } catch (reportErr) {
      console.error('Failed to persist fail-safe report:', reportErr.message);
    }
    return failed;
  }
  const section = await collectSection();
  try {
    await resolveAdminReportsWriter(adminReportsWriter).writeReport({
      kind: 'failsafe',
      status: section && section.nullCount !== 0 ? 'partial' : 'ok',
      payload: section ? { ...report, contentHashCompleteness: section } : report,
    });
  } catch (err) {
    // Reporting never breaks the startup hook.
    console.error('Failed to persist fail-safe report:', err.message);
  }
  if (report.scanned > 0) {
    console.warn(
      `\u26A0 Fail-safe recovery: ${report.scanned} orphaned node(s) require manual review`
    );
    console.warn('  Resolve them via POST /api/admin/maintenance/repair-sync');
  } else {
    console.log('Fail-safe recovery: no orphaned nodes found');
  }
  const pending = report.pendingUpload || { scanned: 0 };
  if (pending.scanned > 0) {
    console.warn(
      `\u26A0 Fail-safe recovery: ${pending.scanned} pending_upload node(s) require manual review`
    );
    console.warn('  Resolve them via POST /api/admin/maintenance/repair-sync');
  }
  return report;
}

// ── Nightly schedulers (§3.1/§3.4 — T0.6) ───────────────────────────────────

function resolveRegistryNumber(key, fallback, { integerMin, integerMax } = {}) {
  const { getSharedResolver } = require('./configResolver');
  const raw = Number(getSharedResolver().getConfigSync(key));
  if (!Number.isFinite(raw)) return fallback;
  if (
    integerMin !== undefined &&
    (!Number.isInteger(raw) || raw < integerMin || raw > integerMax)
  ) {
    return fallback;
  }
  return raw;
}

/**
 * Anchor hour for the nightly schedulers (§3.4). AI_NIGHTLY_ANCHOR_HOUR_UTC is
 * DB-only (registry dbOnly, shared resolver primed at boot; env intentionally
 * ignored). Non-integer / out-of-0..23 values fall back to the shipped
 * default 3.
 */
function resolveAnchorHour() {
  return resolveRegistryNumber('AI_NIGHTLY_ANCHOR_HOUR_UTC', 3, {
    integerMin: 0,
    integerMax: 23,
  });
}

/**
 * Ms until the NEXT occurrence of the anchor hour (UTC, top-of-hour), in
 * (0, 24h]. A delay computed as exactly 0 collapses to 24h: boot/re-arm AT the
 * anchor instant waits for the next anchor ("never twice in one day", no hot
 * re-arm). Pure math — exported for unit tests.
 * @param {number} nowMs - ms epoch.
 * @param {number} anchorHour - 0..23 (already validated).
 * @returns {number} delay in ms.
 */
function resolveNightlyDelayMs(nowMs, anchorHour) {
  const date = new Date(nowMs);
  const msOfDay =
    date.getUTCHours() * 3600000 +
    date.getUTCMinutes() * 60000 +
    date.getUTCSeconds() * 1000 +
    date.getUTCMilliseconds();
  const anchorMs = anchorHour * 3600000;
  const delay = (anchorMs - msOfDay + DAY_MS) % DAY_MS;
  return delay === 0 ? DAY_MS : delay;
}

/**
 * Start the nightly usage-rollup schedule (§3.1 — DEF-25). One tick per
 * nightly anchor (§3.4); each tick runs the data-hygiene chain IN ORDER:
 * usageService.rollupNodeActivity() → collectionsStore.recomputeActivityScores()
 * → usageService.rollOffExpiredEvents() → actionJournalStore.expireJournalRows()
 * → collectionsStore.purgeExpiredTombstones(now − ARCHIVE_RETENTION_DAYS).
 * A leg failure aborts the remaining legs (retried next anchor; rollup
 * idempotency makes the retry a no-op for consumed intervals) and never throws
 * out of the timer. Log-only on success.
 *
 * @param {Object} opts
 * @param {Object} opts.usageService - usageService exposing
 *   rollupNodeActivity() and rollOffExpiredEvents().
 * @param {Object} [opts.collectionsStore] - DI seam (default: the facade).
 * @param {Object} [opts.actionJournalStore] - DI seam (default: the facade).
 * @returns {NodeJS.Timeout|null} the first pending timer, or null when disabled.
 */
function startUsageRollupScheduler({ usageService, collectionsStore, actionJournalStore } = {}) {
  if (shouldSkipRollup() || !usageService) return null;

  const resolveCollections = () => resolveCollectionsStore(collectionsStore);
  const resolveJournal = () => resolveActionJournalStore(actionJournalStore);

  const tick = async () => {
    try {
      // §3.1 chain — ordered rollup-before-roll-off so no unrolled event is
      // deleted; any leg failure aborts the remaining legs (next anchor).
      await usageService.rollupNodeActivity();
      const collections = resolveCollections();
      await collections.recomputeActivityScores();
      await usageService.rollOffExpiredEvents();
      const journal = resolveJournal();
      await journal.expireJournalRows();
      const retentionDays = resolveRegistryNumber('ARCHIVE_RETENTION_DAYS', 30);
      await collections.purgeExpiredTombstones(Date.now() - retentionDays * DAY_MS);
    } catch (err) {
      console.error('Scheduled usage rollup failed:', err.message);
    } finally {
      // Re-arm for the next anchor (anchor hour re-read at fire time — hot).
      timer = setTimeout(tick, resolveNightlyDelayMs(Date.now(), resolveAnchorHour()));
    }
  };

  let timer = setTimeout(tick, resolveNightlyDelayMs(Date.now(), resolveAnchorHour()));
  return timer;
}

// ── Evolution nightly slot (§3.2) ───────────────────────────────────────────

function shouldSkipEvolution() {
  const skip = String(process.env.WEA_SKIP_EVOLUTION_SCHEDULER || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(skip);
}

/**
 * Hot kill-switch read (per fire, DB-only registry keys). Unset/invalid ⇒ the
 * shipped default (enabled).
 */
function resolveEvolutionFlag(key) {
  const { getSharedResolver } = require('./configResolver');
  const value = getSharedResolver().getConfigSync(key);
  if (value === undefined || value === null || value === '') return true;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'off', 'no', 'disabled'].includes(normalized)) return false;
  return true;
}

/**
 * Start the evolution nightly backbone slot (§3.2). One tick per nightly
 * anchor calls `evolutionService.runEvolutionPass({ passes: 'full' })` — the
 * full pass guarantees the "nightly at least once/day" invariant even in
 * `upload` trigger mode. `AI_EVOLUTION_ENABLED` / `AI_EVOLUTION_NIGHTLY_ENABLED`
 * are re-read at fire time; a paused tick logs and performs no acts. Failures
 * are logged and never throw out of the timer; every tick re-arms for the next
 * anchor (anchor hour re-read at fire time — hot).
 *
 * @param {Object} opts
 * @param {Object} opts.evolutionService - exposes runEvolutionPass({ users, passes }).
 * @returns {NodeJS.Timeout|null} the first pending timer, or null when disabled.
 */
function startEvolutionScheduler({ evolutionService } = {}) {
  if (shouldSkipEvolution() || !evolutionService) return null;

  const tick = async () => {
    try {
      if (!resolveEvolutionFlag('AI_EVOLUTION_ENABLED')) {
        console.log('[evolution] nightly skipped: AI_EVOLUTION_ENABLED=false');
      } else if (!resolveEvolutionFlag('AI_EVOLUTION_NIGHTLY_ENABLED')) {
        console.log('[evolution] nightly skipped: AI_EVOLUTION_NIGHTLY_ENABLED=false');
      } else {
        await evolutionService.runEvolutionPass({ passes: 'full' });
      }
    } catch (err) {
      console.error('Scheduled evolution pass failed:', err.message);
    } finally {
      timer = setTimeout(tick, resolveNightlyDelayMs(Date.now(), resolveAnchorHour()));
    }
  };

  let timer = setTimeout(tick, resolveNightlyDelayMs(Date.now(), resolveAnchorHour()));
  return timer;
}

// ── Admin-reports retention (§2.2.6 / admin.md §2.2.6) ─────────────────────

function shouldSkipAdminReportsRetention() {
  const skip = (process.env.WEA_SKIP_ADMIN_REPORTS_RETENTION || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(skip);
}

function resolveAdminReportsRetentionIntervalMs() {
  const { getSharedResolver } = require('./configResolver');
  const raw = Number(getSharedResolver().getConfigSync('ADMIN_REPORTS_RETENTION_INTERVAL_MS'));
  if (!Number.isFinite(raw)) return DEFAULT_RETENTION_INTERVAL_MS;
  return raw > 0 ? raw : 0;
}

function resolveAdminReportsRetentionBatch() {
  const { getSharedResolver } = require('./configResolver');
  const raw = Number(getSharedResolver().getConfigSync('ADMIN_REPORTS_RETENTION_BATCH'));
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_RETENTION_BATCH;
}

/**
 * ONE retention pass: delete rows older than ADMIN_REPORTS_RETENTION_DAYS in
 * bounded batches under the cross-replica lock. Append-only writers never call
 * this. Returns `{ deleted, cutoffMs }` or `{ deleted: 0, skipped }` when the
 * policy is off or another replica holds the lock. Throws on DB failures (the
 * scheduler/boot caller logs and retries next interval).
 *
 * @param {Object} [opts]
 * @param {Object} [opts.store] admin_reports store facade
 * @param {() => number} [opts.now] epoch-ms clock seam
 * @param {number} [opts.retentionDays] override (tests); default hot config
 * @param {number} [opts.batchSize] override (tests); default hot config
 * @param {Object} [opts.lockManager] lock seam (tests)
 * @param {Object} [opts.log] logger seam
 * @returns {Promise<{deleted: number, cutoffMs?: number, skipped?: string}>}
 */
async function runAdminReportsRetention({
  store,
  now = Date.now,
  retentionDays,
  batchSize,
  lockManager,
  log,
} = {}) {
  const logger = log || console;
  const days =
    retentionDays === undefined
      ? await require('../domains/admin/services/adminReportsService').resolveAdminReportsRetentionDays()
      : Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return { deleted: 0, skipped: 'retention_off' };

  const batch =
    Number.isInteger(Number(batchSize)) && Number(batchSize) > 0
      ? Number(batchSize)
      : resolveAdminReportsRetentionBatch();
  const clock = Number(now());
  const cutoffMs = (Number.isFinite(clock) ? clock : Date.now()) - days * DAY_MS;
  const reportsStore = store || require('../store/adminReportsStore');

  const locks = lockManager || require('./lockManager');
  let lock = null;
  try {
    try {
      lock = await locks.acquireLock(RETENTION_LOCK_NAME, {
        ttlMs: RETENTION_LOCK_TTL_MS,
        waitMs: 0,
      });
    } catch (err) {
      if (err && err.code === 'LOCK_TIMEOUT') return { deleted: 0, skipped: 'locked' };
      throw err;
    }

    let deleted = 0;
    for (;;) {
      const result = await reportsStore.deleteReportsOlderThan(cutoffMs, { limit: batch });
      const changes = Number(result && result.changes) || 0;
      deleted += changes;
      if (changes < batch) break;
    }
    if (deleted > 0 && typeof logger.log === 'function') {
      logger.log(`[admin-reports-retention] deleted ${deleted} row(s)`);
    }
    return { deleted, cutoffMs };
  } finally {
    if (lock && typeof lock.release === 'function') await lock.release();
  }
}

/**
 * Periodic retention schedule. `null` under the skip seam or interval 0.
 * Re-arms with the hot interval at fire time; failures log and retry.
 */
function startAdminReportsRetentionScheduler({
  store,
  now,
  retentionDays,
  batchSize,
  lockManager,
  log,
  intervalMs,
} = {}) {
  if (shouldSkipAdminReportsRetention()) return null;
  const resolveInterval = () =>
    intervalMs !== undefined && Number.isFinite(Number(intervalMs))
      ? Number(intervalMs)
      : resolveAdminReportsRetentionIntervalMs();
  const initial = resolveInterval();
  if (!initial || initial <= 0) return null;

  let timer = null;
  const tick = async () => {
    try {
      await runAdminReportsRetention({ store, now, retentionDays, batchSize, lockManager, log });
    } catch (err) {
      console.error('Scheduled admin-reports retention failed:', err.message);
    } finally {
      const next = resolveInterval();
      if (next > 0) timer = setTimeout(tick, next);
    }
  };
  timer = setTimeout(tick, initial);
  return timer;
}

// ── File-suggestions expiry (§4.17 retention leg / maintenanceScheduler.md §3.6) ──

const SUGGESTION_EXPIRY_LOCK_NAME = 'file-suggestions-expiry';
const SUGGESTION_EXPIRY_LOCK_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SUGGESTION_EXPIRY_INTERVAL_MS = DAY_MS;
const DEFAULT_SUGGESTION_EXPIRY_BATCH = 1000;

function shouldSkipSuggestionExpiry() {
  const skip = (process.env.WEA_SKIP_SUGGESTION_EXPIRY || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(skip);
}

function resolveSuggestionExpiryIntervalMs() {
  const { getSharedResolver } = require('./configResolver');
  const raw = Number(getSharedResolver().getConfigSync('AI_SUGGESTION_EXPIRY_INTERVAL_MS'));
  if (!Number.isFinite(raw)) return DEFAULT_SUGGESTION_EXPIRY_INTERVAL_MS;
  return raw > 0 ? raw : 0;
}

function resolveSuggestionExpiryBatch() {
  const { getSharedResolver } = require('./configResolver');
  const raw = Number(getSharedResolver().getConfigSync('AI_SUGGESTION_EXPIRY_BATCH'));
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_SUGGESTION_EXPIRY_BATCH;
}

/**
 * ONE expiry pass: flip `pending` file_suggestions rows past `expires_at` to
 * `expired` in bounded batches under the cross-replica lock (rows survive —
 * state flip only, audit-friendly). `expires_at IS NULL` (retention `0`) is
 * exempt. Returns `{ expired, cutoffMs }` or `{ expired: 0, skipped }` when
 * another replica holds the lock. Throws on DB failures (the scheduler/boot
 * caller logs and retries next interval).
 *
 * @param {Object} [opts]
 * @param {Object} [opts.store] fileSuggestionsStore facade
 * @param {() => number} [opts.now] epoch-ms clock seam
 * @param {number} [opts.batchSize] override (tests); default hot config
 * @param {Object} [opts.lockManager] lock seam (tests)
 * @param {Object} [opts.log] logger seam
 * @returns {Promise<{expired: number, cutoffMs?: number, skipped?: string}>}
 */
async function runFileSuggestionsExpiry({
  store,
  now = Date.now,
  batchSize,
  lockManager,
  log,
} = {}) {
  const logger = log || console;
  const batch =
    Number.isInteger(Number(batchSize)) && Number(batchSize) > 0
      ? Number(batchSize)
      : resolveSuggestionExpiryBatch();
  const clock = Number(now());
  const cutoffMs = Number.isFinite(clock) ? clock : Date.now();
  const suggestionsStore = store || require('../store/fileSuggestionsStore');

  const locks = lockManager || require('./lockManager');
  let lock = null;
  try {
    try {
      lock = await locks.acquireLock(SUGGESTION_EXPIRY_LOCK_NAME, {
        ttlMs: SUGGESTION_EXPIRY_LOCK_TTL_MS,
        waitMs: 0,
      });
    } catch (err) {
      if (err && err.code === 'LOCK_TIMEOUT') return { expired: 0, skipped: 'locked' };
      throw err;
    }

    let expired = 0;
    for (;;) {
      const result = await suggestionsStore.expireStale({ now: cutoffMs, limit: batch });
      const changes = Number(result && result.changes) || 0;
      expired += changes;
      if (changes < batch) break;
    }
    if (expired > 0 && typeof logger.log === 'function') {
      logger.log(`[file-suggestions-expiry] expired ${expired} row(s)`);
    }
    return { expired, cutoffMs };
  } finally {
    if (lock && typeof lock.release === 'function') await lock.release();
  }
}

/**
 * Periodic expiry schedule. `null` under the skip seam or interval 0.
 * Re-arms with the hot interval at fire time; failures log and retry.
 */
function startFileSuggestionsExpiryScheduler({
  store,
  now,
  batchSize,
  lockManager,
  log,
  intervalMs,
} = {}) {
  if (shouldSkipSuggestionExpiry()) return null;
  const resolveInterval = () =>
    intervalMs !== undefined && Number.isFinite(Number(intervalMs))
      ? Number(intervalMs)
      : resolveSuggestionExpiryIntervalMs();
  const initial = resolveInterval();
  if (!initial || initial <= 0) return null;

  let timer = null;
  const tick = async () => {
    try {
      await runFileSuggestionsExpiry({ store, now, batchSize, lockManager, log });
    } catch (err) {
      console.error('Scheduled file-suggestions expiry failed:', err.message);
    } finally {
      const next = resolveInterval();
      if (next > 0) timer = setTimeout(tick, next);
    }
  };
  timer = setTimeout(tick, initial);
  return timer;
}

module.exports = {
  startGcScheduler,
  runStartupFailSafeRecovery,
  shouldSkip,
  resolveIntervalMs,
  shouldSkipRollup,
  resolveAnchorHour,
  resolveNightlyDelayMs,
  startUsageRollupScheduler,
  shouldSkipEvolution,
  startEvolutionScheduler,
  shouldSkipAdminReportsRetention,
  resolveAdminReportsRetentionIntervalMs,
  resolveAdminReportsRetentionBatch,
  runAdminReportsRetention,
  startAdminReportsRetentionScheduler,
  shouldSkipSuggestionExpiry,
  resolveSuggestionExpiryIntervalMs,
  resolveSuggestionExpiryBatch,
  runFileSuggestionsExpiry,
  startFileSuggestionsExpiryScheduler,
};
