'use strict';

/**
 * aiTagStore facade tests (docs/spec/server/store/aiTagStore.md). The facade is
 * thin dialect dispatch (no SQL): the three surviving methods must exist,
 * delegate to the active repository and behave through the facade surface —
 * the raw writer runs inside ONE transaction (§2.4). Plus the spec §2.6
 * purge-state assertions (PLAN §19: the tag layer is dissolved to
 * descriptive-only — no tag_embeddings/tag_parents surface anywhere in
 * server/ runtime code or in the DDL; the store applies zero normalization).
 *
 * The exhaustive dual-dialect matrix is the repository L2 conformance suite
 * (`store/repositories/__tests__/AiTagRepository.conformance.test.js`).
 */

const fs = require('fs');
const path = require('path');
const { createTestDatabase, createTestFileNode } = require('@server/test-utils');
const aiTagStore = require('@server/store/aiTagStore');

describe('aiTagStore facade', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('exposes exactly the three surviving methods (§2.3 array assert on module.exports)', () => {
    expect(Object.keys(aiTagStore).sort()).toEqual([
      'listNodeIdsByRawTag',
      'listRawTags',
      'replaceRawTags',
    ]);
  });

  it('ai_tag_raw lifecycle through the facade (one TX replace)', async () => {
    const node = await createTestFileNode({ name: `facade-raw-${Date.now()}.txt` });
    await aiTagStore.replaceRawTags(node.nodeId, ['ext:jpg', 'mime:image']);
    expect(await aiTagStore.listRawTags(node.nodeId)).toEqual(['ext:jpg', 'mime:image']);
    expect(await aiTagStore.listNodeIdsByRawTag('ext:jpg')).toContain(Number(node.nodeId));

    await aiTagStore.replaceRawTags(node.nodeId, ['ext:png']);
    expect(await aiTagStore.listRawTags(node.nodeId)).toEqual(['ext:png']);
  });

  it('spec §2.6: the facade applies NO normalization — as-given tags yield two rows', async () => {
    const node = await createTestFileNode({ name: `facade-fold-${Date.now()}.txt` });
    await aiTagStore.replaceRawTags(node.nodeId, ['wasted time', 'wastedtime']);
    expect(await aiTagStore.listRawTags(node.nodeId)).toEqual(['wasted time', 'wastedtime']);
  });

  it('spec-level: no tag_aliases/tag_merges table or repository exists (DDL + store chain)', () => {
    const ddl = fs.readFileSync(
      path.join(__dirname, '../../../store/postgresql/ddl/001_initial_normalized_schema.sql'),
      'utf8'
    );
    expect(ddl).not.toMatch(/tag_aliases|tag_merges/i);
    expect(ddl).not.toMatch(/\btag_embeddings\b|\btag_parents\b/i);
    expect(
      fs.existsSync(path.join(__dirname, '../../../store/repositories/TagAliasRepository.js'))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(__dirname, '../../../store/repositories/TagMergeRepository.js'))
    ).toBe(false);
  });

  it('spec §2.6: no tag_embeddings/tag_parents surface in server/ runtime code', () => {
    const serverRoot = path.join(__dirname, '../../..');
    // The retired tag tables are gone from 001 (§4.18 dissolution). The
    // DDL-parity suites still name them in their explicit absence assertions,
    // so those mentions (plus this file's own assertions) are the only allowed
    // ones outside the DDL source itself.
    const ddlParityExceptions = new Set(
      [
        'store/repositories/__tests__/PlatformSchema.conformance.test.js',
        'infrastructure/__tests__/sqliteSchemaInit.test.js',
        'infrastructure/__tests__/ddlValidation.test.js',
      ].map((file) => path.join(serverRoot, file))
    );
    // This file necessarily names the banned identifiers in its own assertions.
    ddlParityExceptions.add(__filename);

    const jsFiles = fs
      .readdirSync(serverRoot, { recursive: true })
      .filter((file) => file.endsWith('.js'))
      .map((file) => path.join(serverRoot, file));

    expect(jsFiles.length).toBeGreaterThan(0);

    const offenders = [];
    for (const file of jsFiles) {
      if (ddlParityExceptions.has(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (/\b(tag_embeddings|tag_parents|tag_aliases|tag_merges)\b/.test(source)) {
        offenders.push(`table surface: ${path.relative(serverRoot, file)}`);
      }
      if (
        /\b(getTagVector|getTagVectors|findTagsWithoutEmbedding|upsertTagVector|upsertTagVectors|deleteByModel|getParent|listParentHints|upsertAutoParent|setAdminParent|deleteParent)\b/.test(
          source
        )
      ) {
        offenders.push(`dead method surface: ${path.relative(serverRoot, file)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('spec-level: the facade itself carries no SQL (PLAN §6 thin-dispatch rule)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../store/aiTagStore.js'), 'utf8');
    expect(source).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE |DELETE FROM)\b/i);
  });
});
