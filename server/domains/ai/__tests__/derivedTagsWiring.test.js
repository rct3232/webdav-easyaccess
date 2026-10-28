'use strict';

/**
 * Derived-tags commit-seam wiring (derivedTagsService.md §1 scope, §2.4).
 *
 * REAL composed hook + REAL upload/copy/restore services: the derived
 * `ai_tag_raw` rows must be written by the post-commit hook itself (nothing is
 * seeded directly) and a `{ type: 'tag' }` predicate must match the fresh
 * upload — including the composed admission point-check, which runs AFTER the
 * derived sync.
 */

const {
  createTestDatabase,
  createAuthenticatedTestUser,
  createUserRootNode,
  dbRun,
} = require('@server/test-utils');
const composition = require('@server/service/composition');
const aiTagStore = require('@server/store/aiTagStore');
const collectionsService = require('@server/domains/collections/service');
const collectionsStore = require('@server/store/collectionsStore');
const derivedTags = require('@server/domains/ai/derivedTags');
const { createInMemoryBlobStore } = require('@testing/mocks/serviceMocks');

describe('derived tags commit-seam wiring (real upload/copy/restore)', () => {
  let dbCleanup;
  let comp;
  let user;
  let blobStore;
  let yearNodeId;
  let seq = 0;
  const stamp = Date.now();

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    blobStore = createInMemoryBlobStore();
    comp = composition.createComposition({ fileStorageMode: 's3', blobStore });

    const auth = await createAuthenticatedTestUser({ username: `derived-wire-${stamp}` });
    user = auth.user;
    const home = await createUserRootNode({ userId: user.id });
    const photos = await comp.fileNodeService.createDirectory(home.nodeId, 'Photos');
    const year = await comp.fileNodeService.createDirectory(photos.id, '2026');
    yearNodeId = year.id;
  });

  afterAll(async () => {
    composition.resetComposition();
    await dbCleanup?.();
  });

  const uniqueName = (filename) => {
    const dot = filename.lastIndexOf('.');
    const suffix = `${stamp}-${(seq += 1)}`;
    return dot <= 0
      ? `${filename}-${suffix}`
      : `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`;
  };

  const upload = (name, content) =>
    comp.uploadService.uploadFile(yearNodeId, uniqueName(name), Buffer.from(content), 'image/jpeg');

  const expectDerivedJpgTags = (tags) => {
    expect(tags).toEqual(
      expect.arrayContaining(['ext:jpg', 'mime:image', 'path:2026', 'path:photos'])
    );
    expect(tags.some((tag) => tag.startsWith('month:'))).toBe(true);
  };

  it('a real upload writes the derived rows; a tag predicate matches and admission sees them', async () => {
    const definition = { kind: 'predicate', any_of: [{ type: 'tag', value: 'EXT:JPG' }] };
    const system = await collectionsStore.createCollection(
      { ownerId: user.id, name: `Jpg rule ${stamp}`, origin: 'system', definition },
      { actor: user.id }
    );

    const uploaded = await upload('photo.jpg', 'derived-upload-content');

    // Derived from the REAL commit hook, not seeded.
    const tags = await aiTagStore.listRawTags(uploaded.nodeId);
    expectDerivedJpgTags(tags);

    // A tag predicate resolves through ai_tag_raw (folded string equality).
    const preview = await collectionsService.preview(user.id, { definition });
    expect(preview.sample.map((item) => item.nodeId)).toContain(uploaded.nodeId);

    // The composed hook admitted the node on the same commit because the
    // derived sync runs before the admission point-check.
    const view = await collectionsService.getItems(user.id, system.id, {});
    const member = view.items.find((item) => item.nodeId === uploaded.nodeId);
    expect(member).toMatchObject({ membership: 'derived', reason: 'tag:EXT:JPG' });
  });

  it('a real copy writes the copied node’s derived rows', async () => {
    const source = await upload('copy-src.jpg', 'copy-source-bytes');
    const copied = await comp.fileService.copyFile(
      source.nodeId,
      yearNodeId,
      uniqueName('copy-dst.jpg'),
      user.id,
      { is_admin: 1 }
    );

    expectDerivedJpgTags(await aiTagStore.listRawTags(copied.copiedNodeId));
  });

  it('a version restore re-affirms the derived rows after they were removed', async () => {
    const uploaded = await upload('restore.jpg', 'restore-v1-content');
    expectDerivedJpgTags(await aiTagStore.listRawTags(uploaded.nodeId));

    await comp.uploadService.overwriteFile(
      uploaded.nodeId,
      Buffer.from('restore-v2-content-longer'),
      'image/jpeg'
    );

    // Remove the rows so the assertion proves the RESTORE hook re-wrote them.
    await dbRun('DELETE FROM ai_tag_raw WHERE node_id = ?', [Number(uploaded.nodeId)]);
    expect(await aiTagStore.listRawTags(uploaded.nodeId)).toEqual([]);

    await comp.versionsService.restoreVersion(user.id, uploaded.nodeId, 1, { is_admin: 1 });

    const restored = await aiTagStore.listRawTags(uploaded.nodeId);
    expect(restored).toEqual(expect.arrayContaining(['ext:jpg', 'path:2026', 'path:photos']));
    const node = await comp.fileNodesStore.getNode(uploaded.nodeId);
    expect(restored).toContain(
      derivedTags
        .computeDerivedTags({ createdAt: node.createdAt })
        .find((tag) => tag.startsWith('month:'))
    );
  });

  it('a derived-tag failure is isolated: the user-facing upload still succeeds', async () => {
    const original = aiTagStore.replaceRawTags;
    aiTagStore.replaceRawTags = jest.fn().mockRejectedValue(new Error('tag store down'));
    try {
      const uploaded = await upload('tagfail.jpg', 'tag-failure-content');
      expect(uploaded.nodeId).toBeDefined();
      expect(await aiTagStore.listRawTags(uploaded.nodeId)).toEqual([]);
    } finally {
      aiTagStore.replaceRawTags = original;
    }
  });
});
