/**
 * Unit tests for the AI-platform enums in shared/constants.js.
 *
 * Each enum is pinned twice: the key → value map and the `ALL`/`isValid` pair.
 * The values mirror the TEXT CHECK constraints in
 * `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
 * (`docs/shared-contracts.md` § Shared Constants).
 */
const {
  COLLECTION_ORIGIN,
  COLLECTION_STATUS,
  PUBLISH_MODE,
  GRANT_ROLE,
  JOURNAL_DOMAIN,
  LLM_ROLE,
  MERGE_SUGGESTION_STATE,
  FILE_SUGGESTION_STATE,
} = require('@webdav-easyaccess/shared/constants');

/** Assert an enum has the expected `KEY: value` pairs, `ALL` order and isValid behavior. */
function expectEnum(enumObject, expectedValues, invalidSamples) {
  for (const [key, value] of Object.entries(expectedValues)) {
    expect(enumObject[key]).toBe(value);
  }

  expect(enumObject.ALL).toEqual(Object.values(expectedValues));

  for (const value of Object.values(expectedValues)) {
    expect(enumObject.isValid(value)).toBe(true);
  }

  for (const sample of invalidSamples) {
    expect(enumObject.isValid(sample)).toBe(false);
  }

  expect(enumObject.isValid(null)).toBe(false);
  expect(enumObject.isValid(undefined)).toBe(false);
  expect(enumObject.isValid(123)).toBe(false);
}

describe('shared platform enums', () => {
  it('COLLECTION_ORIGIN matches the collections.origin CHECK', () => {
    expectEnum(
      COLLECTION_ORIGIN,
      {
        SYSTEM: 'system',
        USER: 'user',
        SEED: 'seed',
        SEARCH: 'search',
      },
      ['', 'shared', 'admin']
    );
  });

  it('COLLECTION_STATUS matches the collections.status CHECK', () => {
    expectEnum(COLLECTION_STATUS, { ACTIVE: 'active', ARCHIVED: 'archived' }, [
      'pending',
      'deleted',
    ]);
  });

  it('PUBLISH_MODE matches the collections.publish_mode CHECK', () => {
    expectEnum(PUBLISH_MODE, { ASK: 'ask', OFF: 'off', AUTO: 'auto' }, ['on', 'manual', '']);
  });

  it('GRANT_ROLE matches the collection_grants.role CHECK', () => {
    expectEnum(GRANT_ROLE, { VIEWER: 'viewer', EDITOR: 'editor' }, [
      'owner',
      'read',
      'write',
      'admin',
    ]);
  });

  it('JOURNAL_DOMAIN matches the action_journal.domain CHECK', () => {
    expect(JOURNAL_DOMAIN.TAGS).toBeUndefined();

    expectEnum(
      JOURNAL_DOMAIN,
      {
        COLLECTION: 'collection',
        BATCH: 'batch',
        SETTINGS: 'settings',
        PERMISSIONS: 'permissions',
        FILE: 'file',
        SHARING: 'sharing',
      },
      ['ai', 'trash', 'dashboard', 'tags', '']
    );
  });

  it('LLM_ROLE matches the llm_models.role CHECK', () => {
    expectEnum(LLM_ROLE, { EMBED: 'embed', CHAT: 'chat', VISION: 'vision', ASR: 'asr' }, [
      'rerank',
      'tts',
      '',
    ]);
  });

  it('MERGE_SUGGESTION_STATE matches the collection_merge_suggestions.state CHECK', () => {
    expectEnum(
      MERGE_SUGGESTION_STATE,
      {
        PENDING: 'pending',
        MERGED: 'merged',
        DISMISSED: 'dismissed',
        REJECTED: 'rejected',
      },
      ['accepted', 'expired', 'active', '']
    );
  });

  it('FILE_SUGGESTION_STATE matches the file_suggestions lifecycle', () => {
    expectEnum(
      FILE_SUGGESTION_STATE,
      {
        PENDING: 'pending',
        ACCEPTED: 'accepted',
        DISMISSED: 'dismissed',
        EXPIRED: 'expired',
      },
      ['merged', 'rejected', 'active', '']
    );
  });

  it('keeps the merge and file suggestion state enums distinct', () => {
    expect(MERGE_SUGGESTION_STATE.ALL).not.toEqual(FILE_SUGGESTION_STATE.ALL);
    expect(MERGE_SUGGESTION_STATE.isValid('accepted')).toBe(false);
    expect(FILE_SUGGESTION_STATE.isValid('merged')).toBe(false);
  });
});
