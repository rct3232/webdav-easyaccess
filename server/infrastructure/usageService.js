'use strict';

/**
 * usageService — §3.4 usage-signal semantics over usageStore (docs/spec/server/
 * store/usageStore.md §2.1): the recording path (validated insert), the nightly
 * rollup orchestration (watermark groups → item accumulator S_k → upsert) and
 * the raw-event retention roll-off. The §3.1 scheduler chain sequences this
 * service together with the collectionsStore/actionJournalStore tails.
 *
 * Config (T2/dbOnly — §3.4 owner-adjudicated product constants, NOT AI-profile
 * numbers): AI_USAGE_W_* weights, AI_ACTIVITY_HALF_LIFE_DAYS (H), and
 * AI_USAGE_EVENT_RETENTION_DAYS (0 = retention off) are read per-fire (hot).
 * The shipped defaults live in usage/activityScore.js (registry parity test).
 */

const { ITEM_WEIGHTS, HALF_LIFE_DAYS, applyItemAccumulator } = require('./usage/activityScore');

const DEFAULT_EVENT_RETENTION_DAYS = 90;

// Mirrors the usage_events.action CHECK enum (§3.4 usage-signal kinds).
const { USAGE_ACTION } = require('@webdav-easyaccess/shared/constants');
const USAGE_ACTIONS = Object.freeze(USAGE_ACTION.ALL);

/**
 * Factory. All IO through DI seams (usageStore) — tests inject fakes; the
 * default instance resolves the shared configResolver + usageStore lazily.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.usageStore] - store seam (default: store/usageStore).
 * @param {Object} [opts.configResolver] - seam exposing getConfig(key)
 *   (default: the shared configResolver).
 * @param {() => Date|number} [opts.now] - clock seam (tests).
 */
function createUsageService({ usageStore, configResolver, now } = {}) {
  function resolveConfigResolver() {
    if (configResolver) return configResolver;
    // Lazy require: no DB/store boot coupling at require time.
    const { getSharedResolver } = require('./configResolver');
    return getSharedResolver();
  }

  function resolveUsageStore() {
    if (usageStore) return usageStore;
    return require('../store/usageStore');
  }

  function currentTime() {
    const clock = now || (() => new Date());
    return new Date(clock());
  }

  function toPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  async function resolveActivityConfig() {
    const resolver = resolveConfigResolver();
    const read = async (key) => {
      try {
        return await resolver.getConfig(key);
      } catch {
        return undefined;
      }
    };
    const weights = {};
    for (const action of Object.keys(ITEM_WEIGHTS)) {
      weights[action] = toPositiveNumber(
        await read(`AI_USAGE_W_${action.toUpperCase()}`),
        ITEM_WEIGHTS[action]
      );
    }
    const halfLifeDays = toPositiveNumber(await read('AI_ACTIVITY_HALF_LIFE_DAYS'), HALF_LIFE_DAYS);
    return { weights, halfLifeDays };
  }

  /**
   * Recording path (§3.4 usage signals): validates the action enum + ids and
   * appends one raw event. Fire-and-forget at the owning endpoints — errors
   * are the caller's concern (never thrown from the signal path by design).
   * @param {{ userId, nodeId, action, at? }} event
   * @returns {Promise<{ changes: number }>}
   */
  async function recordEvent(event) {
    const { userId, nodeId, action, at } = event || {};
    if (!USAGE_ACTIONS.includes(action)) {
      throw new TypeError(`usage_events action must be one of ${USAGE_ACTIONS.join(', ')}`);
    }
    if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) {
      throw new TypeError('usage_events requires a positive integer userId');
    }
    if (!Number.isInteger(Number(nodeId)) || Number(nodeId) <= 0) {
      throw new TypeError('usage_events requires a positive integer nodeId');
    }
    return resolveUsageStore().insertUsageEvent({
      userId: Number(userId),
      nodeId: Number(nodeId),
      action,
      at: at ? new Date(at).toISOString() : undefined,
    });
  }

  /**
   * Nightly rollup step (§3.4 item accumulator): consume the watermark
   * groups and upsert `node_activity` rows. Does NOT touch
   * `collections.activity_score` — the §3.1 scheduler chain calls
   * `collectionsStore.recomputeActivityScores()` right after this.
   * @param {{ now?: Date }} [opts]
   * @returns {Promise<{ groups: number, changes: number }>}
   */
  async function rollupNodeActivity({ now } = {}) {
    const store = resolveUsageStore();
    const { weights, halfLifeDays } = await resolveActivityConfig();
    const rollupNow = new Date(now ?? currentTime());
    const nowMs = rollupNow.getTime();

    const groups = await store.readRollupGroups();
    const rows = groups.map((group) => {
      const counts = {};
      for (const action of Object.keys(ITEM_WEIGHTS)) {
        counts[action] = (group.prevCounts?.[action] || 0) + (group.counts?.[action] || 0);
      }
      const score = applyItemAccumulator({
        previousScore: group.prevScore,
        previousAtMs: group.prevUpdatedAtMs,
        nowMs,
        counts: group.counts || {},
        weights,
        halfLifeDays,
      });
      return {
        userId: group.userId,
        nodeId: group.nodeId,
        counts,
        lastSeenAtMs: group.lastSeenAtMs,
        score,
        updatedAtMs: nowMs,
      };
    });

    const changes = rows.length > 0 ? (await store.upsertNodeActivity(rows)).changes : 0;
    return { groups: rows.length, changes };
  }

  /**
   * Retention tail (§3.4): raw events roll off at
   * AI_USAGE_EVENT_RETENTION_DAYS (default 90; 0 = retention off). Called by
   * the §3.1 chain AFTER a successful rollup — no unrolled event is deleted.
   * @param {{ now?: Date }} [opts]
   * @returns {Promise<{ changes: number }>}
   */
  async function rollOffExpiredEvents({ now } = {}) {
    const resolver = resolveConfigResolver();
    let retentionDays = DEFAULT_EVENT_RETENTION_DAYS;
    try {
      retentionDays = toPositiveNumber(
        await resolver.getConfig('AI_USAGE_EVENT_RETENTION_DAYS'),
        DEFAULT_EVENT_RETENTION_DAYS
      );
    } catch {
      /* resolver unavailable → shipped default */
    }
    if (retentionDays === 0) return { changes: 0 };

    const rollupNow = new Date(now ?? currentTime());
    const cutoffMs = rollupNow.getTime() - retentionDays * 86400000;
    return resolveUsageStore().deleteUsageEventsOlderThan(cutoffMs);
  }

  return { recordEvent, rollupNodeActivity, rollOffExpiredEvents };
}

/** Shared default instance (production wiring seam). */
let shared = null;
function getUsageService() {
  if (!shared) shared = createUsageService();
  return shared;
}

module.exports = { createUsageService, getUsageService, USAGE_ACTIONS };
