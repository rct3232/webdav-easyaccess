'use strict';

/**
 * derivedTags unit + pipeline tests (docs/spec/server/services/
 * derivedTagsService.md §4.10 v1 set / §4.18 fold / aiTagStore §2.4.5).
 * Deterministic pure-computation cases + real-DB persist/backfill seams.
 */

const {
  createTestDatabase,
  createUserRootNode,
  createTestFileNode,
  createNestedStructure,
  dbQuery,
} = require('@server/test-utils');
const { createFileNodesStore } = require('@server/store/fileNodesStore');
const aiTagStore = require('@server/store/aiTagStore');
const derivedTags = require('@server/domains/ai/derivedTags');

describe('foldTag (§4.18 step 1 pure fold)', () => {
  it('NFKC + whitespace collapse + lowercase; idempotent', () => {
    expect(derivedTags.foldTag('  Wasted   TIME ')).toBe('wasted time');
    expect(derivedTags.foldTag('ⅷ ＰＨＯＴＯ')).toBe('viii photo'); // NFKC compat forms
    expect(derivedTags.foldTag('É')).toBe('é');
    expect(derivedTags.foldTag('ext:JPG')).toBe('ext:jpg');
    const once = derivedTags.foldTag(' Mixed   Case ');
    expect(derivedTags.foldTag(once)).toBe(once);
  });

  it('null/empty/non-string yields null, never an empty-string tag', () => {
    expect(derivedTags.foldTag('')).toBeNull();
    expect(derivedTags.foldTag('   ')).toBeNull();
    expect(derivedTags.foldTag(null)).toBeNull();
    expect(derivedTags.foldTag(undefined)).toBeNull();
    expect(derivedTags.foldTag(42)).toBeNull();
  });
});

describe('computeDerivedTags (§4.10 v1 set — pure, deterministic)', () => {
  it('mime + ext + month + top-2 path in one shot', () => {
    const tags = derivedTags.computeDerivedTags({
      name: 'IMG_0421.JPG',
      createdAt: '2026-09-03T23:30:00.000Z',
      mimeType: 'image/jpeg',
      pathSegments: ['Photos', '2026', 'paris trip'],
    });
    expect(tags).toEqual(['ext:jpg', 'mime:image', 'month:2026-09', 'path:2026', 'path:photos']);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const input = {
      name: 'a.BMP',
      createdAt: new Date('2025-01-15T00:00:00Z'),
      mimeType: 'IMAGE/BMP',
      pathSegments: ['One', 'Two', 'Three', 'Four'],
    };
    const first = derivedTags.computeDerivedTags(input);
    expect(derivedTags.computeDerivedTags(input)).toEqual(first);
    expect(first).toEqual(['ext:bmp', 'mime:image', 'month:2025-01', 'path:one', 'path:two']);
  });

  it('month is the UTC calendar month of created_at', () => {
    expect(
      derivedTags
        .computeDerivedTags({ createdAt: '2026-12-31T23:59:59Z' })
        .includes('month:2026-12')
    ).toBe(true);
    expect(
      derivedTags
        .computeDerivedTags({ createdAt: '2027-01-01T00:00:01Z' })
        .includes('month:2027-01')
    ).toBe(true);
    expect(
      derivedTags.computeDerivedTags({ createdAt: 'garbage' }).some((t) => t.startsWith('month:'))
    ).toBe(false);
    expect(derivedTags.computeDerivedTags({}).some((t) => t.startsWith('month:'))).toBe(false);
  });

  it('ext: trailing-dot extension, alphanumeric only; none when absent/weird', () => {
    const extOf = (name) =>
      derivedTags.computeDerivedTags({ name }).filter((t) => t.startsWith('ext:'));
    expect(extOf('archive.TAR.GZ')).toEqual(['ext:gz']);
    expect(extOf('README')).toEqual([]);
    expect(extOf('weird!')).toEqual([]);
    expect(extOf('dots.')).toEqual([]);
    expect(extOf('a1.b2c3')).toEqual(['ext:b2c3']);
  });

  it('mime: primary type before the slash only; absent mime ⇒ no mime tag', () => {
    expect(derivedTags.computeDerivedTags({ mimeType: 'application/pdf' })).toContain(
      'mime:application'
    );
    expect(derivedTags.computeDerivedTags({ mimeType: 'image' })).toContain('mime:image');
    expect(
      derivedTags.computeDerivedTags({ mimeType: '/weird' }).some((t) => t.startsWith('mime:'))
    ).toBe(false);
    expect(
      derivedTags.computeDerivedTags({ mimeType: null }).some((t) => t.startsWith('mime:'))
    ).toBe(false);
  });

  it('path: the TWO highest segments, folded; fewer folders ⇒ fewer tags; none ⇒ no path tags', () => {
    const pathOf = (segments) =>
      derivedTags
        .computeDerivedTags({ pathSegments: segments })
        .filter((t) => t.startsWith('path:'));
    expect(pathOf(['Travel'])).toEqual(['path:travel']);
    expect(pathOf(['A', 'B', 'C', 'D'])).toEqual(['path:a', 'path:b']);
    expect(pathOf(['Weird  Name', 'ok'])).toEqual(['path:ok', 'path:weird name']);
    expect(pathOf([])).toEqual([]);
    expect(pathOf(null)).toEqual([]);
  });

  it('no metadata at all ⇒ empty set (never throws, never empty tags)', () => {
    expect(derivedTags.computeDerivedTags({})).toEqual([]);
    expect(derivedTags.computeDerivedTags()).toEqual([]);
  });
});

describe('derivedTags persistence pipeline (real DB via aiTagStore)', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  it('syncNodeDerivedTags writes the folded set; re-run is idempotent; changed input replaces', async () => {
    const node = await createTestFileNode({ name: `sync-${Date.now()}.jpg` });
    const input = {
      nodeId: node.nodeId,
      name: 'photo.JPG',
      createdAt: '2026-05-01T12:00:00Z',
      mimeType: 'image/jpeg',
      pathSegments: [],
    };

    const written = await derivedTags.syncNodeDerivedTags(input);
    expect(written.inserted).toBe(3); // ext:jpg, mime:image, month:2026-05
    expect(await aiTagStore.listRawTags(node.nodeId)).toEqual([
      'ext:jpg',
      'mime:image',
      'month:2026-05',
    ]);

    await derivedTags.syncNodeDerivedTags(input);
    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM ai_tag_raw WHERE node_id = ?', [
      Number(node.nodeId),
    ]);
    expect(Number(rows[0].cnt)).toBe(3);

    await derivedTags.syncNodeDerivedTags({ ...input, name: 'photo.png', mimeType: 'image/png' });
    expect(await aiTagStore.listRawTags(node.nodeId)).toEqual([
      'ext:png',
      'mime:image',
      'month:2026-05',
    ]);
  });

  it('backfillDerivedTagsForUser: own live subtree files only, path below root folded, idempotent', async () => {
    const User = require('@server/models/User');
    const stamp = Date.now();
    const owner = await User.create(`dt-owner-${stamp}`, `dt-owner-${stamp}@t.test`, 'pw', false);
    const root = await createUserRootNode({ userId: owner.id });
    const store = createFileNodesStore();

    // /alice/Photos/2026/sea.jpg  (two-level path tags)
    const { nodeIds } = await createNestedStructure({
      parentId: root.nodeId,
      segments: ['Photos', '2026'],
    });
    const nested = await createTestFileNode({ name: 'sea.jpg', parentId: nodeIds[1] });
    await store.upsertCache(nested.nodeId, 10, 'image/jpeg', null);

    // direct root child: only path segments below root — none
    const shallow = await createTestFileNode({ name: 'note.txt', parentId: root.nodeId });
    await store.upsertCache(shallow.nodeId, 5, 'text/plain', null);

    // directory gets NO tags; another user's file is out of scope
    const other = await User.create(`dt-other-${stamp}`, `dt-other-${stamp}@t.test`, 'pw', false);
    const otherRoot = await createUserRootNode({ userId: other.id });
    const foreign = await createTestFileNode({ name: 'foreign.jpg', parentId: otherRoot.nodeId });
    await store.upsertCache(foreign.nodeId, 1, 'image/jpeg', null);

    const result = await derivedTags.backfillDerivedTagsForUser(owner.id);
    expect(result.nodes).toBe(2);
    expect(result.tagsWritten).toBeGreaterThan(0);

    // Expected month tag derived through the SAME production function as the
    // SUT — representation/timezone-independent (a local String() slice can
    // disagree with production's UTC toISOString() near month boundaries).
    const monthTagOf = async (nodeId) => {
      const row = await store.getNode(nodeId);
      return derivedTags
        .computeDerivedTags({ createdAt: row.createdAt })
        .find((tag) => tag.startsWith('month:'));
    };
    expect(await aiTagStore.listRawTags(nested.nodeId)).toEqual([
      'ext:jpg',
      'mime:image',
      await monthTagOf(nested.nodeId),
      'path:2026',
      'path:photos',
    ]);
    expect(await aiTagStore.listRawTags(shallow.nodeId)).toEqual([
      'ext:txt',
      'mime:text',
      await monthTagOf(shallow.nodeId),
    ]);
    expect(await aiTagStore.listRawTags(nodeIds[0])).toEqual([]);
    expect(await aiTagStore.listRawTags(foreign.nodeId)).toEqual([]);

    // idempotent re-run: same row count, no duplicates
    const before = await dbQuery('SELECT COUNT(*) AS cnt FROM ai_tag_raw');
    const second = await derivedTags.backfillDerivedTagsForUser(owner.id);
    expect(second.nodes).toBe(2);
    const after = await dbQuery('SELECT COUNT(*) AS cnt FROM ai_tag_raw');
    expect(Number(after.rows[0].cnt)).toBe(Number(before.rows[0].cnt));
  });
});
