'use strict';

/**
 * AiUsageDailyRepository — domain interface over the provider-traffic
 * counter table `ai_usage_daily` (docs/spec/server/store/aiUsageDailyStore.md).
 * Written by llmAdapter on EVERY provider round-trip incl. cached-hit
 * accounting (§2.9); read by breakerState/budgetStatus and the admin cost
 * ledger (AI_FEATURE_PLAN §4.15). Counters move only on their events and
 * never decrease; a day rollover is a NEW PK row — no reset path exists
 * here (restart survival: history is DB truth).
 *
 * @typedef {Object} AiUsageDailyRow
 * @property {string} day       — caller contract: 'YYYY-MM-DD', persisted verbatim
 * @property {string} role      — llm role (embed|chat|vision|asr)
 * @property {number} calls
 * @property {number} inputChars
 * @property {number} cached
 * @property {number} degraded
 * @property {number} failed429
 *
 * @typedef {Object} AiUsageDailyRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(event: {
 *   day, role, calls?, inputChars?, cached?, degraded?, failed429?
 * }) => Promise<{changes: number}>} recordUsage
 *   Atomic upsert-INCREMENT on the PK pair (share-link counter precedent) —
 *   one statement, no read-modify-write; omitted deltas default 0.
 * @property {(day) => Promise<AiUsageDailyRow[]>} getByDay
 *   Per-role rows of one day, role ASC; unknown day → [].
 * @property {({fromDay, toDay}) => Promise<AiUsageDailyRow[]>} summarizeRange
 *   Per-role SUMs over the inclusive day range (SQL SUM, not store-side
 *   math), role ASC — the 24h fail/429-rate and cost-ledger read.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {AiUsageDailyRepository}
 */
module.exports = function createAiUsageDailyRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createAiUsageDailyRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/AiUsageDailyRepository.sqlite')
      : require('./postgres/AiUsageDailyRepository.postgres');
  return impl(executor);
};
