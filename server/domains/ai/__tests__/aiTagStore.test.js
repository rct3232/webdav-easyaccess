'use strict';

/**
 * aiTagStore facade tests (docs/spec/server/store/aiTagStore.md). The facade is
 * thin dialect dispatch (no SQL): every method must exist, delegate to the
 * active repository and behave through the facade surface — including the
 * batch/raw writers running inside ONE transaction. Plus the spec-level
 * §4.18 assertions (no alias/merge substrate; store owns zero normalization).
 *
 * The exhaustive dual-dialect matrix is the repository L2 conformance suite
 * (`store/repositories/__tests__/AiTagRepository.conformance.test.js`).
 */

const fs = require('fs');
const path = require('path');
const { createTestDatabase, createTestFileNode, dbRun } = require('@server/test-utils');
const aiTagStore = require('@server/store/aiTagStore');

describe('aiTagStore facade', () => {
  let dbCleanup;
  let modelId;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    const res = await dbRun(
      'INSERT INTO llm_models (role, provider, base_url_key, model_name) VALUES (?, ?, ?, ?)',
      ['embed', 'facade-test', 'facade-key', `facade-model-${Date.now()}`]
    );
    modelId = Number(res.lastID ?? res.rows?.[0]);
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('exposes the full spec surface (§2.3/§2.4/§2.4.5)', () => {
    for (const method of [
      'getTagVector',
      'getTagVectors',
      'findTagsWithoutEmbedding',
      'upsertTagVector',
      'upsertTagVectors',
      'deleteByModel',
      'getParent',
      'listParentHints',
      'upsertAutoParent',
      'setAdminParent',
      'deleteParent',
      'listRawTags',
      'listNodeIdsByRawTag',
      'replaceRawTags',
    ]) {
      expect(typeof aiTagStore[method]).toBe('function');
    }
  });

  it('tag_embeddings round-trip through the facade (single + batch writers)', async () => {
    const tag = `facade-sunset-${Date.now()}`;
    expect(await aiTagStore.getTagVector(tag, modelId)).toBeNull();

    await aiTagStore.upsertTagVector(tag, modelId, [0.25, -1.5]);
    expect(await aiTagStore.getTagVector(tag, modelId)).toMatchObject({
      tag,
      modelId,
      dim: 2,
      vector: [0.25, -1.5],
    });

    const batch = await aiTagStore.upsertTagVectors(
      [
        { tag: `${tag}-a`, vector: [1, 2] },
        { tag: `${tag}-b`, vector: [3, 4] },
      ],
      modelId
    );
    expect(batch.inserted).toBe(2);
    expect((await aiTagStore.getTagVectors([`${tag}-a`, `${tag}-b`], modelId)).length).toBe(2);
    expect(await aiTagStore.findTagsWithoutEmbedding([`${tag}-a`, `${tag}-zz`], modelId)).toEqual([
      `${tag}-zz`,
    ]);
    expect((await aiTagStore.deleteByModel(modelId)).changes).toBe(3);
    expect(await aiTagStore.getTagVector(tag, modelId)).toBeNull();
  });

  it('tag_parents lifecycle through the facade', async () => {
    const child = `facade-child-${Date.now()}`;
    await aiTagStore.upsertAutoParent(child, 'auto-parent');
    expect(await aiTagStore.getParent(child)).toMatchObject({ source: 'auto' });

    expect((await aiTagStore.upsertAutoParent(child, 'auto-again')).changes).toBe(1);

    await aiTagStore.setAdminParent(child, 'admin-parent');
    expect((await aiTagStore.upsertAutoParent(child, 'ignored')).changes).toBe(0);
    expect(await aiTagStore.getParent(child)).toMatchObject({
      parent: 'admin-parent',
      source: 'admin',
    });

    expect((await aiTagStore.deleteParent(child)).changes).toBe(1);
    expect(await aiTagStore.getParent(child)).toBeNull();
    expect(Array.isArray(await aiTagStore.listParentHints())).toBe(true);
  });

  it('ai_tag_raw lifecycle through the facade (one TX replace)', async () => {
    const node = await createTestFileNode({ name: `facade-raw-${Date.now()}.txt` });
    await aiTagStore.replaceRawTags(node.nodeId, ['ext:jpg', 'mime:image']);
    expect(await aiTagStore.listRawTags(node.nodeId)).toEqual(['ext:jpg', 'mime:image']);
    expect(await aiTagStore.listNodeIdsByRawTag('ext:jpg')).toContain(Number(node.nodeId));

    await aiTagStore.replaceRawTags(node.nodeId, ['ext:png']);
    expect(await aiTagStore.listRawTags(node.nodeId)).toEqual(['ext:png']);
  });

  it('spec §4.18: the facade applies NO normalization of its own', async () => {
    const spaced = 'facade wasted time';
    const tight = 'facadewastedtime';
    await aiTagStore.upsertTagVector(spaced, modelId, [1]);
    expect(await aiTagStore.getTagVector(tight, modelId)).toBeNull();
    await aiTagStore.deleteByModel(modelId);
  });

  it('spec-level: no tag_aliases/tag_merges table or repository exists (DDL + store chain)', () => {
    const ddl = fs.readFileSync(
      path.join(__dirname, '../../../store/postgresql/ddl/001_initial_normalized_schema.sql'),
      'utf8'
    );
    expect(ddl).not.toMatch(/tag_aliases|tag_merges/i);
    expect(
      fs.existsSync(path.join(__dirname, '../../../store/repositories/TagAliasRepository.js'))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(__dirname, '../../../store/repositories/TagMergeRepository.js'))
    ).toBe(false);
  });

  it('spec-level: the facade itself carries no SQL (PLAN §6 thin-dispatch rule)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../store/aiTagStore.js'), 'utf8');
    expect(source).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE |DELETE FROM)\b/i);
  });
});
