'use strict';

/**
 * §5 platform-schema L2 conformance (PLAN.md T0.2): every new §5 table
 * (P0–P4, AI included) must exist on the ACTIVE backend — sqlite in the
 * default CI leg, real PostgreSQL under the WEA_TEST_PG_* adapter leg —
 * because createTestDatabase() applies the tracked ddl/ chain on both
 * dialects. Asserts presence on the live catalog plus key column/enum
 * shapes for the tables T0.2 ships repositories for.
 */

const { createTestDatabase, dbQuery, isSqliteBackend } = require('@server/test-utils');

// All §5 tables (AI_FEATURE_PLAN.md §5) + the pre-existing tables that
// 001_initial_normalized_schema.sql has always created.
const EXPECTED_TABLES = [
  // Pre-existing core
  'users',
  'settings',
  'file_nodes',
  'object_map',
  'filecache',
  'node_ancestors',
  'permissions_user_paths',
  'permissions_user_files',
  'permissions_shares',
  'share_links',
  'recent_files',
  'permission_requests',
  'locks',
  // §5 collections platform
  'collections',
  'collection_items',
  'collection_exclusions',
  'collection_grants',
  'collection_visibility',
  'collection_tombstones',
  'collection_digest_cursors',
  'collection_merge_suggestions',
  'file_likes',
  // §5 usage signals + undo journal
  'usage_events',
  'node_activity',
  'action_journal',
  // §5 suggestions + admin reports
  'file_suggestions',
  'admin_reports',
  // §5 AI foundation
  'llm_models',
  'collection_centroids',
  'tag_embeddings',
  'tag_parents',
  'ai_tag_raw',
  'embeddings',
  'embeddings_chunk',
  'ai_features',
  'ai_jobs',
  'ai_usage_daily',
  'query_parses',
];

describe('PlatformSchema conformance (§5 tables)', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  async function listTables() {
    if (isSqliteBackend()) {
      const { rows } = await dbQuery(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      return rows.map((r) => r.name);
    }
    const { rows } = await dbQuery(
      `SELECT table_name AS name
         FROM information_schema.tables
        WHERE table_schema = 'public'`
    );
    return rows.map((r) => r.name);
  }

  async function listColumns(table) {
    if (isSqliteBackend()) {
      const { rows } = await dbQuery(`PRAGMA table_info(${table})`);
      return rows.map((r) => r.name);
    }
    const { rows } = await dbQuery(
      `SELECT column_name AS name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    return rows.map((r) => r.name);
  }

  it('creates every §5 table (P0–P4, AI included) on the active dialect', async () => {
    const tables = await listTables();
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    expect(missing).toEqual([]);
  });

  it('collections carries the §5 column set', async () => {
    const columns = await listColumns('collections');
    for (const column of [
      'id',
      'owner_id',
      'name',
      'name_locked',
      'origin',
      'status',
      'definition',
      'publish_mode',
      'pinned',
      'pinned_by',
      'archived_at',
      'last_member_change_at',
      'activity_score',
      'created_at',
      'updated_at',
    ]) {
      expect(columns).toContain(column);
    }
  });

  it('action_journal carries no FK chain and the subject/chain uniqueness columns', async () => {
    const columns = await listColumns('action_journal');
    for (const column of [
      'id',
      'domain',
      'subject',
      'subject_label',
      'actor',
      'action',
      'payload',
      'chain_seq',
      'status',
      'created_at',
      'undone_at',
      'expires_at',
    ]) {
      expect(columns).toContain(column);
    }
  });

  it('file_likes is the pair-keyed like table', async () => {
    const columns = await listColumns('file_likes');
    expect(columns).toEqual(expect.arrayContaining(['user_id', 'node_id', 'created_at']));
  });

  it('llm_models is declared with its role enum columns before the AI tables read it', async () => {
    const columns = await listColumns('llm_models');
    for (const column of [
      'id',
      'role',
      'provider',
      'base_url_key',
      'model_name',
      'max_input_chars',
      'chunk_budget',
      'batch_size',
      'reasoning',
      'enabled',
      'created_at',
    ]) {
      expect(columns).toContain(column);
    }
  });
});
