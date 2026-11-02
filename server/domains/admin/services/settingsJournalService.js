'use strict';

/**
 * settingsJournalService — the `settings`-domain undo journal writer/executor
 * (docs/spec/server/store/actionJournalStore.md, routes/config.md §PUT,
 * routes/admin.md §2.2.7).
 *
 * CURATED non-secret AI governance keys only. A config write and its rollback
 * row commit in one TX (`set-setting` restores the previous DB value or
 * deletes the row when it was unset). The re-embed launcher's inverse
 * (`cancel-ai-jobs`) cancels still-pending ids through the tx-bound queue
 * method. Secrets are never journaled.
 */

const { JOURNAL_DOMAIN } = require('@webdav-easyaccess/shared/constants');
const actionJournalStore = require('../../../store/actionJournalStore');
const settingsStore = require('../../../store/settingsStore');
const aiJobsStore = require('../../../store/aiJobsStore');
const { getSharedResolver } = require('../../../infrastructure/configResolver');

const AI_REEMBED_SUBJECT = 'settings:ai-reembed';

const CURATED_AI_KILL_SWITCH_KEYS = Object.freeze([
  'AI_SEMANTIC_SEARCH_ENABLED',
  'AI_NL_PARSE_ENABLED',
  'AI_EVOLUTION_ENABLED',
  'AI_EVOLUTION_NIGHTLY_ENABLED',
  'AI_EVOLUTION_CREATE_ENABLED',
  'AI_MERGE_SUGGESTIONS_ENABLED',
  'AI_MERGE_ARBITER_ENABLED',
]);

const CURATED_AI_GATE_KEYS = Object.freeze([
  'AI_EVOLUTION_INACTIVE_DAYS',
  'AI_EVOLUTION_MIN_AGE_DAYS',
  'AI_EVOLUTION_CREATE_RATE_DAYS',
  'AI_ACTIVITY_HALF_LIFE_DAYS',
  'AI_USAGE_EVENT_RETENTION_DAYS',
  'ARCHIVE_RETENTION_DAYS',
  'STORAGE_SUGGESTION_RETENTION_DAYS',
]);

const CURATED_AI_SETTING_KEYS = Object.freeze([
  ...CURATED_AI_KILL_SWITCH_KEYS,
  ...CURATED_AI_GATE_KEYS,
]);

const CURATED_SET = new Set(CURATED_AI_SETTING_KEYS);

function isCuratedSettingKey(key) {
  return CURATED_SET.has(String(key));
}

function invalidateSettingCache(key) {
  try {
    const resolver = getSharedResolver();
    if (resolver && typeof resolver.invalidateCache === 'function') {
      resolver.invalidateCache([String(key)]);
    }
  } catch {
    /* resolver absent before boot — the next read resolves from DB anyway */
  }
}

/**
 * Journal + write ONE curated setting. The previous DB value is read inside
 * the commit TX, so the inverse is exact even under a concurrent config write.
 *
 * @param {{ key: string, value: string|number|boolean, actor: string|number }} input
 * @returns {Promise<{ actionId: number, chainSeq: number, previous: string|null }>}
 */
async function commitSettingChange({ key, value, actor }, deps = {}) {
  const journal = deps.journalStore || actionJournalStore;
  const settings = deps.settingsStore || settingsStore;
  const settingKey = String(key);
  if (!isCuratedSettingKey(settingKey)) {
    throw new TypeError(`setting key '${settingKey}' is not journaled`);
  }

  const { id, chainSeq, result } = await journal.commitChange(
    JOURNAL_DOMAIN.SETTINGS,
    `settings:${settingKey}`,
    { actor: String(actor ?? 'system'), action: 'config-update', subjectLabel: settingKey },
    (mutationResult) => ({
      inverse: { op: 'set-setting', key: settingKey, value: mutationResult.previous },
    }),
    async (tx) => {
      const previous = await settings.getTx(tx, settingKey);
      await settings.setTx(tx, settingKey, String(value));
      return { previous };
    }
  );
  return { actionId: id, chainSeq, previous: result.previous };
}

/**
 * Undo executor for the `settings` domain (registered at module load).
 *
 * @param {{ row: Object, tx: Object }} args
 * @returns {Promise<Array<{ applied: boolean, reason?: string }>>}
 */
async function applySettingsInverse({ row, tx }) {
  const inverse = row && row.payload ? row.payload.inverse : null;
  if (!inverse || typeof inverse !== 'object') return [{ applied: false, reason: 'changed' }];

  if (inverse.op === 'set-setting') {
    const key = String(inverse.key || '');
    if (!key) return [{ applied: false, reason: 'changed' }];
    if (inverse.value === null || inverse.value === undefined) {
      await settingsStore.deleteTx(tx, key);
    } else {
      await settingsStore.setTx(tx, key, String(inverse.value));
    }
    invalidateSettingCache(key);
    return [{ applied: true }];
  }

  if (inverse.op === 'cancel-ai-jobs') {
    const jobIds = Array.isArray(inverse.jobIds) ? inverse.jobIds : [];
    if (jobIds.length === 0) return [{ applied: false, reason: 'changed' }];
    const { cancelledIds, skippedIds } = await aiJobsStore.cancelPendingTx(tx, { jobIds });
    const cancelled = new Set(cancelledIds);
    const skipped = new Set(skippedIds);
    return [...new Set(jobIds.map(Number))]
      .filter((id) => Number.isInteger(id) && id > 0)
      .map((id) =>
        cancelled.has(id)
          ? { applied: true }
          : { applied: false, reason: skipped.has(id) ? 'not_pending' : 'changed' }
      );
  }

  return [{ applied: false, reason: 'changed' }];
}

actionJournalStore.registerUndoExecutor(JOURNAL_DOMAIN.SETTINGS, applySettingsInverse);

module.exports = {
  AI_REEMBED_SUBJECT,
  CURATED_AI_KILL_SWITCH_KEYS,
  CURATED_AI_GATE_KEYS,
  CURATED_AI_SETTING_KEYS,
  isCuratedSettingKey,
  commitSettingChange,
  applySettingsInverse,
};
