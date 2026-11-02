'use strict';

/**
 * Internal per-kind job generations (aiJobService.md §2.2). Settings rows are
 * `AI_GEN_<KIND>`; the launcher bump keeps all four aligned at one next N.
 */

const { createTestDatabase, dbRun } = require('@server/test-utils');
const storage = require('@server/store/storage');
const settingsStore = require('@server/store/settingsStore');
const {
  GENERATION_KINDS,
  generationKey,
  getGeneration,
  getGenerations,
  bumpGenerationsTx,
} = require('../generationSettings');

describe('generationSettings', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  beforeEach(async () => {
    for (const kind of GENERATION_KINDS) {
      await dbRun('DELETE FROM settings WHERE key = ?', [generationKey(kind)]);
    }
  });

  it('defaults every kind to 1 and rejects unknown kinds', async () => {
    await expect(getGenerations()).resolves.toEqual({
      embed: 1,
      features: 1,
      caption: 1,
      asr: 1,
    });
    expect(() => generationKey('backfill')).toThrow(TypeError);
  });

  it('reads persisted counters and normalizes malformed values to the default', async () => {
    await settingsStore.set(generationKey('embed'), '5');
    await settingsStore.set(generationKey('caption'), 'not-a-number');
    await expect(getGeneration('embed')).resolves.toBe(5);
    await expect(getGeneration('caption')).resolves.toBe(1);
  });

  it('bumpGenerationsTx aligns all kinds to one next N and joins the caller TX', async () => {
    await settingsStore.set(generationKey('embed'), '3');
    await settingsStore.set(generationKey('features'), '4');

    const bump = await storage
      .getExecutor()
      .transaction((tx) => bumpGenerationsTx(tx, ['embed', 'features', 'caption', 'asr']));
    expect(bump).toEqual({ embed: 5, features: 5, caption: 5, asr: 5 });
    await expect(getGenerations()).resolves.toEqual({
      embed: 5,
      features: 5,
      caption: 5,
      asr: 5,
    });
  });

  it('a throwing caller TX rolls the bump back', async () => {
    await settingsStore.set(generationKey('embed'), '9');
    await expect(
      storage.getExecutor().transaction(async (tx) => {
        await bumpGenerationsTx(tx, ['embed', 'features']);
        throw new Error('rollback');
      })
    ).rejects.toBeDefined();
    await expect(getGeneration('embed')).resolves.toBe(9);
    await expect(getGeneration('features')).resolves.toBe(1);
  });
});
