/**
 * /api/search routes integration tests (P0: name section + §3.4 recording).
 * @see docs/spec/server/routes/search.md
 *
 * The orchestrator (server/index.js) mounts this router at integration time;
 * this suite reproduces the intended mount exactly (after the app-level
 * migrationGate, with setupModeGuardInstance):
 *   app.use('/api/search', setupModeGuardInstance, require('./domains/ai/routes'))
 */
const request = require('supertest');
const express = require('express');

const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermissionByNodeId,
  dbQuery,
} = require('../../../test-utils');
const { createFileNodeService } = require('../../../service/fileNodeService');
const { createFileNodesStore } = require('../../../store/fileNodesStore');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

// The route's searchService resolves the llmAdapter through the runtime
// singleton lazily per request — the mock lets the semantic-leg describe
// install a configured fake adapter (and drop it again).
jest.mock('../../../infrastructure/llmAdapterRuntime', () => {
  let mockCurrent = null;
  return {
    initLlmAdapter: jest.fn(),
    resetLlmAdapter: jest.fn(() => {
      mockCurrent = null;
    }),
    getLlmAdapter: () => mockCurrent,
    __setMockAdapter: (adapter) => {
      mockCurrent = adapter;
    },
  };
});
const llmRuntime = require('../../../infrastructure/llmAdapterRuntime');

let app;
let dbCleanup;
let fileNodeService;

/** Flush the fire-and-forget usage-event writes before asserting on the DB. */
async function flushUsageEvents() {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;

  fileNodeService = createFileNodeService({ fileNodesStore: createFileNodesStore() });

  const setupModeGuard = require('../../../middleware/setupModeGuard');
  app = express();
  app.use(express.json());
  app.use('/api/search', setupModeGuard(), require('../routes'));
  app.use(require('../../../utils/errorHandler').errorHandler);
});

afterAll(async () => {
  await dbCleanup?.();
});

async function createUserWithRoot(tag) {
  const { user, token } = await createAuthenticatedTestUser({
    username: `search-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const root = await fileNodeService.createDirectory(null, user.username);
  return { user, token, root };
}

// ---------------------------------------------------------------------------
// POST /api/search — validation
// ---------------------------------------------------------------------------

describe('POST /api/search validation', () => {
  it('rejects a missing query with 400 search.queryRequired', async () => {
    const { token } = await createUserWithRoot('validate');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.search.queryRequired);
  });

  it('rejects an empty and a whitespace-only query with 400 search.queryRequired', async () => {
    const { token } = await createUserWithRoot('validate-blank');

    for (const query of ['', '   ']) {
      const res = await request(app)
        .post('/api/search')
        .set('Authorization', `Bearer ${token}`)
        .send({ query });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.search.queryRequired);
    }
  });

  it('rejects a query longer than 200 chars with 400 search.queryTooLong', async () => {
    const { token } = await createUserWithRoot('validate-long');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'a'.repeat(201) });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.search.queryTooLong);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/search').send({ query: 'note' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/search — name section semantics
// ---------------------------------------------------------------------------

describe('POST /api/search name section', () => {
  it('matches a mid-string name with different ASCII case (lower() on both sides)', async () => {
    const ctx = await createUserWithRoot('casefold');
    await fileNodeService.createFile(ctx.root.id, 'Fun-MOVIE-notes.pdf');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'movie' });

    expect(res.status).toBe(200);
    expect(res.body.name_matches).toEqual([
      expect.objectContaining({ node_id: expect.any(Number), name: 'Fun-MOVIE-notes.pdf' }),
    ]);
    // rows carry ids+names only — no type/size (search.md §2.4.2)
    expect(Object.keys(res.body.name_matches[0]).sort()).toEqual(['name', 'node_id']);
  });

  it('treats the query as one containment string, not token-AND', async () => {
    const ctx = await createUserWithRoot('tokenand');
    await fileNodeService.createFile(ctx.root.id, 'enjoyable-fantasy-movies.txt');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'fantasy movies' });

    expect(res.status).toBe(200);
    expect(res.body.name_matches).toEqual([]);
  });

  it('orders name asc then node_id asc and reports counts', async () => {
    const ctx = await createUserWithRoot('ordering');
    const second = await fileNodeService.createFile(ctx.root.id, 'zebra-report.txt');
    const first = await fileNodeService.createFile(ctx.root.id, 'alpha-report.txt');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'report' });

    expect(res.status).toBe(200);
    expect(res.body.name_matches.map((row) => row.node_id)).toEqual([first.id, second.id]);
    expect(res.body.counts).toEqual({
      name: 2,
      semantic: 0,
      total: 2,
      name_truncated: false,
    });
  });

  it('caps the name section at 200 rows with counts.name_truncated', async () => {
    const ctx = await createUserWithRoot('cap');
    for (let i = 0; i < 201; i += 1) {
      await fileNodeService.createFile(
        ctx.root.id,
        `capped-report-${String(i).padStart(3, '0')}.txt`
      );
    }

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'capped-report' });

    expect(res.status).toBe(200);
    expect(res.body.name_matches).toHaveLength(200);
    expect(res.body.counts.name).toBe(200);
    expect(res.body.counts.name_truncated).toBe(true);
    // only the RETURNED rows get usage rows — the truncated tail must not
    await flushUsageEvents();
    const { rows: events } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM usage_events WHERE user_id = ? AND action = ?',
      [ctx.user.id, 'search_hit']
    );
    expect(Number(events[0].cnt)).toBe(200);
  }, 30000);
});

// ---------------------------------------------------------------------------
// POST /api/search — ACL scoping
// ---------------------------------------------------------------------------

describe('POST /api/search ACL scoping', () => {
  it('never returns a node the requester cannot read', async () => {
    const ownerCtx = await createUserWithRoot('acl-owner');
    const otherCtx = await createUserWithRoot('acl-other');
    const secret = await fileNodeService.createFile(
      ownerCtx.root.id,
      'private-secret-vacation.jpg'
    );

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${otherCtx.token}`)
      .send({ query: 'vacation' });

    expect(res.status).toBe(200);
    expect(res.body.name_matches).toEqual([]);

    // ...but the owner sees it
    const ownRes = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ownerCtx.token}`)
      .send({ query: 'vacation' });
    expect(ownRes.body.name_matches.map((row) => row.node_id)).toContain(secret.id);
  });

  it('returns granted path subtrees and point-granted nodes', async () => {
    const ownerCtx = await createUserWithRoot('acl-grant-owner');
    const otherCtx = await createUserWithRoot('acl-grant-other');

    const folder = await fileNodeService.createDirectory(ownerCtx.root.id, 'shared-folder');
    const insideFolder = await fileNodeService.createFile(folder.id, 'shared-memo-inside.txt');
    const pointFile = await fileNodeService.createFile(ownerCtx.root.id, 'point-shared-file.txt');
    const hiddenSibling = await fileNodeService.createFile(
      ownerCtx.root.id,
      'not-shared-sibling.txt'
    );

    await grantTestPermissionByNodeId({
      userId: otherCtx.user.id,
      fileNodeId: folder.id,
      permission: 'read',
    });
    await grantTestPermissionByNodeId({
      userId: otherCtx.user.id,
      fileNodeId: pointFile.id,
      permission: 'read',
    });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${otherCtx.token}`)
      .send({ query: 'shared' });

    expect(res.status).toBe(200);
    const ids = res.body.name_matches.map((row) => row.node_id);
    expect(ids).toContain(insideFolder.id);
    expect(ids).toContain(pointFile.id);
    expect(ids).not.toContain(hiddenSibling.id);
  });
});

// ---------------------------------------------------------------------------
// POST /api/search — degradation + result_ref contract
// ---------------------------------------------------------------------------

describe('POST /api/search embed-absent degradation + result_ref', () => {
  it('omits the semantic key and reports the degradation as data (200)', async () => {
    const ctx = await createUserWithRoot('dgr');
    await fileNodeService.createFile(ctx.root.id, 'degrade-notes.md');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'degrade' });

    expect(res.status).toBe(200);
    expect(res.body.semantic).toBeUndefined();
    expect(res.body.semantic_unavailable_reason).toBe('not_configured');
    expect(res.body.name_matches).toHaveLength(1);
    expect(res.body.counts.semantic).toBe(0);
  });

  it('emits a stable result_ref for an identical query and a different one otherwise', async () => {
    const ctx = await createUserWithRoot('refsig');
    await fileNodeService.createFile(ctx.root.id, 'signature-notes.md');

    const first = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'signature' });
    const second = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'signature' });
    const other = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'signature2' });

    expect(first.body.result_ref).toMatch(/^sr1\.[0-9a-f]{16}$/);
    expect(second.body.result_ref).toBe(first.body.result_ref);
    expect(other.body.result_ref).not.toBe(first.body.result_ref);
  });

  it('accepts a request result_ref and ignores it (fresh signature, same shape)', async () => {
    const ctx = await createUserWithRoot('refignore');
    await fileNodeService.createFile(ctx.root.id, 'ignored-ref-notes.md');

    const withRef = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'ignored-ref', result_ref: 'sr1.deadbeefdeadbeef' });
    const withoutRef = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'ignored-ref' });

    expect(withRef.status).toBe(200);
    expect(withoutRef.status).toBe(200);
    expect(withRef.body).toEqual(withoutRef.body);
    expect(withRef.body.result_ref).toBe(withoutRef.body.result_ref);
  });
});

// ---------------------------------------------------------------------------
// §3.4 recording — search_hit
// ---------------------------------------------------------------------------

describe('POST /api/search usage recording (search_hit)', () => {
  it('records exactly one search_hit row per returned node', async () => {
    const ctx = await createUserWithRoot('hits');
    const a = await fileNodeService.createFile(ctx.root.id, 'hit-alpha.txt');
    const b = await fileNodeService.createFile(ctx.root.id, 'hit-beta.txt');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'hit-' });
    expect(res.body.name_matches).toHaveLength(2);

    await flushUsageEvents();
    const { rows: events } = await dbQuery(
      'SELECT node_id, action FROM usage_events WHERE user_id = ? AND action = ?',
      [ctx.user.id, 'search_hit']
    );
    expect(events.map((row) => Number(row.node_id)).sort((x, y) => x - y)).toEqual(
      [a.id, b.id].sort((x, y) => x - y)
    );
  });

  it('records nothing for a query with no results', async () => {
    const ctx = await createUserWithRoot('nohits');

    await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'nothing-matches-this' });

    await flushUsageEvents();
    const { rows: events } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM usage_events WHERE user_id = ? AND action = ?',
      [ctx.user.id, 'search_hit']
    );
    expect(Number(events[0].cnt)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/search/click — §3.4 list-entry-click recording point
// ---------------------------------------------------------------------------

describe('POST /api/search/click', () => {
  it('records one usage_events open row for the requester and node, responds 204', async () => {
    const ctx = await createUserWithRoot('click');
    const node = await fileNodeService.createFile(ctx.root.id, 'clicked-entry.txt');

    const res = await request(app)
      .post('/api/search/click')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ node_id: node.id });

    expect(res.status).toBe(204);
    await flushUsageEvents();
    const { rows: events } = await dbQuery(
      'SELECT action FROM usage_events WHERE user_id = ? AND node_id = ?',
      [ctx.user.id, node.id]
    );
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('open');
  });

  it('rejects a missing/non-positive node_id with 400 clickTargetRequired', async () => {
    const ctx = await createUserWithRoot('click-invalid');

    for (const body of [{}, { node_id: 0 }, { node_id: -3 }, { node_id: 'abc' }]) {
      const res = await request(app)
        .post('/api/search/click')
        .set('Authorization', `Bearer ${ctx.token}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.search.clickTargetRequired);
    }

    await flushUsageEvents();
    const { rows: events } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM usage_events WHERE user_id = ?',
      [ctx.user.id]
    );
    expect(Number(events[0].cnt)).toBe(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/search/click').send({ node_id: 1 });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Wire contract: setup-mode guard
// ---------------------------------------------------------------------------

describe('wire contract invariants', () => {
  it('mount sits behind the setup-mode guard while setup is incomplete', async () => {
    const prevWorker = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    try {
      const res = await request(app).post('/api/search').send({ query: 'note' });
      expect(res.status).toBe(503);
      expect(res.body.errorCode).toBe(SERVER_ERROR_CODES.setup.incomplete);
    } finally {
      process.env.JEST_WORKER_ID = prevWorker;
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/search — the embed leg ran (honest-empty vs omit wire states)
// ---------------------------------------------------------------------------

describe('POST /api/search embed-configured wire states', () => {
  afterEach(() => {
    llmRuntime.__setMockAdapter(null);
  });

  function createRouteFakeAdapter() {
    return {
      roleConfigured: async (role) => role === 'embed',
      embedQuery: async () => ({ vectors: [[1, 0, 0, 0]], dim: 4, modelId: null }),
    };
  }

  it('embed configured ⇒ the semantic key is PRESENT (honest empty) and semantic_capped_segments ships', async () => {
    llmRuntime.__setMockAdapter(createRouteFakeAdapter());
    const ctx = await createUserWithRoot('c1route');
    await fileNodeService.createFile(ctx.root.id, 'route-honest.txt');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'honest route' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.semantic)).toBe(true);
    expect(res.body.semantic).toEqual([]);
    expect(res.body.semantic_unavailable_reason).toBeUndefined();
    expect(res.body.counts.semantic_capped_segments).toBe(false);
    expect(res.body.result_ref).toMatch(/^sr1\.[0-9a-f]{16}$/);
  });

  it('embed absent on the SAME surface ⇒ the semantic key is OMITTED (absent ≠ honestly empty)', async () => {
    const ctx = await createUserWithRoot('c1route-absent');
    await fileNodeService.createFile(ctx.root.id, 'route-absent.txt');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'absent route' });

    expect(res.status).toBe(200);
    expect('semantic' in res.body).toBe(false);
    expect('semantic_capped_segments' in res.body.counts).toBe(false);
    expect(res.body.semantic_unavailable_reason).toBe('not_configured');
  });
});

// ---------------------------------------------------------------------------
// POST /api/search — the NL-parse leg (parse.nl) on the wire
// (searchService.md §2.8, routes/search.md §2.4 — fake chat via the adapter
// seam; the parser E2E case rides the fake-LLM harness.)
// ---------------------------------------------------------------------------

describe('POST /api/search NL-parse wire states', () => {
  afterEach(() => {
    llmRuntime.__setMockAdapter(null);
  });

  function createRouteNlAdapter({ chatOk = false, chatCalls = [] } = {}) {
    const adapter = {
      chatCalls,
      roleConfigured: async (role) => role === 'embed' || (role === 'chat' && chatOk),
      embedQuery: async () => ({ vectors: [[1, 0, 0, 0]], dim: 4, modelId: null }),
    };
    if (chatOk) {
      adapter.chat = async (messages, opts) => {
        chatCalls.push({ messages, opts });
        return {
          json: {
            predicates: [{ type: 'size', min: 1048576 }],
            vector_query: null,
          },
          text: '',
          usage: null,
          truncated: false,
        };
      };
    }
    return adapter;
  }

  it('chat configured + valid parse ⇒ the 200 carries the additive predicates section', async () => {
    llmRuntime.__setMockAdapter(createRouteNlAdapter({ chatOk: true }));
    const ctx = await createUserWithRoot('nlroute');
    await fileNodeService.createFile(ctx.root.id, 'route-nl-big.pdf');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'route nl parse over 1mb' });

    expect(res.status).toBe(200);
    expect(res.body.predicates).toEqual([{ type: 'size', min: 1048576 }]);
    expect(res.body.counts.name_truncated).toBe(false);
    expect(res.body.result_ref).toMatch(/^sr1\.[0-9a-f]{16}$/);
  });

  it('chat-absent vs broken-chat: the 200 BODY IS BYTE-IDENTICAL to the parser-free wire shape', async () => {
    const ctx = await createUserWithRoot('nlbyte');
    await fileNodeService.createFile(ctx.root.id, 'route-nl-byte.txt');

    llmRuntime.__setMockAdapter(createRouteNlAdapter({ chatOk: false }));
    const baseline = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'byte identical nl off' });
    expect(baseline.status).toBe(200);
    expect('predicates' in baseline.body).toBe(false);
    expect(Object.keys(baseline.body)).toEqual([
      'name_matches',
      'semantic',
      'result_ref',
      'counts',
    ]);

    // Same query, chat now CONFIGURED but the model output violates the closed grammar:
    const broken = createRouteNlAdapter({ chatOk: true, chatCalls: [] });
    broken.chat = async (messages, opts) => {
      broken.chatCalls.push({ messages, opts });
      return { json: { predicates: [{ type: 'mime' }] }, text: '', usage: null };
    };
    llmRuntime.__setMockAdapter(broken);
    const degraded = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'byte identical nl off' });

    expect(broken.chatCalls).toHaveLength(1);
    expect(degraded.status).toBe(200);
    expect(degraded.text).toBe(baseline.text);
  });

  it('parse cache hit on the wire ⇒ second identical submit adds zero chat calls', async () => {
    const ctx = await createUserWithRoot('nlhit');
    await fileNodeService.createFile(ctx.root.id, 'route-nl-hit.txt');
    const chatCalls = [];
    llmRuntime.__setMockAdapter(createRouteNlAdapter({ chatOk: true, chatCalls }));

    const first = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'zero chat on replay' });
    expect(first.body.predicates).toEqual([{ type: 'size', min: 1048576 }]);
    expect(chatCalls).toHaveLength(1);

    const again = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'zero chat on replay' });

    expect(again.status).toBe(200);
    expect(chatCalls).toHaveLength(1);
    expect(again.body.predicates).toEqual([{ type: 'size', min: 1048576 }]);
    expect(again.body.result_ref).toBe(first.body.result_ref);
  });

  it('request predicates: a malformed session state never 4xxes (silently stateless parse)', async () => {
    llmRuntime.__setMockAdapter(createRouteNlAdapter({ chatOk: true }));
    const ctx = await createUserWithRoot('nlstate');
    await fileNodeService.createFile(ctx.root.id, 'route-nl-state.txt');

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ query: 'malformed state submit', predicates: 'not-an-array' });

    expect(res.status).toBe(200);
    expect(res.body.predicates).toEqual([{ type: 'size', min: 1048576 }]);
  });
});
