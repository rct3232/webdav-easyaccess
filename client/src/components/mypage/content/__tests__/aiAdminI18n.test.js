import en from '../../../../locales/en.json';
import ko from '../../../../locales/ko.json';
import {
  AI_ADMIN_EVOLUTION_NOT_INSTRUMENTED,
  AI_ADMIN_IMPACT_METRICS,
  AI_ADMIN_NOT_INSTRUMENTED,
  AI_ADMIN_REASONS,
} from '@webdav-easyaccess/shared/aiAdminContract';

const KEYS = [
  'admin.aiPanel.generatedAt',
  'admin.aiPanel.notInstrumented',
  'admin.aiPanel.notInstrumentedLine',
  'admin.aiPanel.pipeline.queue.total',
  'admin.aiPanel.pipeline.finished24h',
  'admin.aiPanel.pipeline.status',
  'admin.aiPanel.pipeline.createdAt',
  'admin.aiPanel.pipeline.failedJobsLimit',
  'admin.aiPanel.pipeline.breakerReasons.active_observation_required',
  'admin.aiPanel.models.id',
  'admin.aiPanel.models.provider',
  'admin.aiPanel.models.historyRows',
  'admin.aiPanel.models.noHistory',
  'admin.aiPanel.models.textPrefixes',
  'admin.aiPanel.coverage.totalFiles',
  'admin.aiPanel.coverage.totalMedia',
  'admin.aiPanel.coverage.bySource',
  'admin.aiPanel.coverage.byMediaKind',
  'admin.aiPanel.coverage.byCapability',
  'admin.aiPanel.coverage.byCorpus',
  'admin.aiPanel.coverage.capabilityCounts',
  'admin.aiPanel.coverage.corpusCounts',
  'admin.aiPanel.coverage.unavailableReason',
  'admin.aiPanel.gates.impactMetric',
  'admin.aiPanel.gates.impactNoData',
  'admin.aiPanel.gates.impactNotInstrumented',
  'admin.aiPanel.gates.state.on',
  'admin.aiPanel.gates.state.off',
  'admin.aiPanel.gates.state.unknown',
  'admin.aiPanel.launcher.available',
  'admin.aiPanel.launcher.unavailable',
  'admin.aiPanel.launcher.availableYes',
  'admin.aiPanel.launcher.activeJobs',
  'admin.aiPanel.launcher.previewUnavailable',
  'admin.aiPanel.journal.loadFail',
];

function lookup(locale, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), locale);
}

describe('admin AI i18n mirror', () => {
  it.each(KEYS)('%s exists in en and ko', (key) => {
    expect(typeof lookup(en, key)).toBe('string');
    expect(typeof lookup(ko, key)).toBe('string');
    expect(lookup(en, key).length).toBeGreaterThan(0);
    expect(lookup(ko, key).length).toBeGreaterThan(0);
  });

  it.each(AI_ADMIN_NOT_INSTRUMENTED)('not-instrumented label %s exists in both locales', (key) => {
    expect(lookup(en, `admin.aiPanel.notInstrumentedLabels.${key}`)).toBeTruthy();
    expect(lookup(ko, `admin.aiPanel.notInstrumentedLabels.${key}`)).toBeTruthy();
  });

  it.each(Object.values(AI_ADMIN_REASONS))('shared reason %s has both locale labels', (reason) => {
    expect(lookup(en, `admin.aiPanel.reasons.${reason}`)).toBeTruthy();
    expect(lookup(ko, `admin.aiPanel.reasons.${reason}`)).toBeTruthy();
  });

  it.each(AI_ADMIN_IMPACT_METRICS)('impact metric %s has both locale labels', (metric) => {
    expect(lookup(en, `admin.aiPanel.metrics.${metric}`)).toBeTruthy();
    expect(lookup(ko, `admin.aiPanel.metrics.${metric}`)).toBeTruthy();
  });

  it.each(['embed', 'features', 'caption', 'asr'])(
    'launcher generation label %s exists in both locales',
    (kind) => {
      expect(lookup(en, `admin.aiPanel.launcher.generationKinds.${kind}`)).toBeTruthy();
      expect(lookup(ko, `admin.aiPanel.launcher.generationKinds.${kind}`)).toBeTruthy();
    }
  );

  it('evolution not-instrumented entries are a subset of the v1 API list', () => {
    for (const key of AI_ADMIN_EVOLUTION_NOT_INSTRUMENTED) {
      expect(AI_ADMIN_NOT_INSTRUMENTED).toContain(key);
      expect(lookup(en, `admin.aiPanel.notInstrumentedLabels.${key}`)).toBeTruthy();
      expect(lookup(ko, `admin.aiPanel.notInstrumentedLabels.${key}`)).toBeTruthy();
    }
  });

  it('every shared gate key has both locale labels', () => {
    const gateKeys = Object.keys(en.admin.aiPanel.gateKey);
    expect(gateKeys.sort()).toEqual(Object.keys(ko.admin.aiPanel.gateKey).sort());
    expect(gateKeys).toEqual(
      expect.arrayContaining([
        'AI_SEMANTIC_SEARCH_ENABLED',
        'AI_NL_PARSE_ENABLED',
        'AI_EVOLUTION_ENABLED',
        'AI_EVOLUTION_NIGHTLY_ENABLED',
        'AI_EVOLUTION_CREATE_ENABLED',
        'AI_MERGE_SUGGESTIONS_ENABLED',
        'AI_MERGE_ARBITER_ENABLED',
        'AI_EVOLUTION_INACTIVE_DAYS',
        'AI_EVOLUTION_MIN_AGE_DAYS',
        'AI_EVOLUTION_CREATE_RATE_DAYS',
        'AI_ACTIVITY_HALF_LIFE_DAYS',
        'AI_USAGE_EVENT_RETENTION_DAYS',
        'ARCHIVE_RETENTION_DAYS',
        'AI_SUGGESTION_RETENTION_DAYS',
      ])
    );
  });
});
