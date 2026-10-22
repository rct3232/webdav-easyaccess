'use strict';

/**
 * Boot wiring for the llmAdapter role seams (llmAdapter.md §2.2/§2.3/§2.5):
 * preset lookup, per-role probe delegation and the FREE published-metadata
 * fetcher (budget-chain step 2). The HTTP tests use a local in-process server;
 * no real provider is contacted.
 */

const http = require('http');

const {
  createBootPresetFor,
  createBootProbeRole,
  createPublishedMetadataFetcher,
} = require('../llmBootWiring');
const { initLlmAdapter, resetLlmAdapter, getLlmAdapter } = require('../llmAdapterRuntime');
const { getPresetByFamilyRole } = require('../adapters/llm/presets');
const { probeLlm } = require('../adapters/llm/probe');
const { createLlmAdapter } = require('../adapters/llm');

jest.mock('../adapters/llm/probe', () => ({ probeLlm: jest.fn() }));

function makeResolver(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    configResolver: {
      async getConfig(key) {
        const value = store.get(key);
        return value === undefined ? undefined : value;
      },
    },
  };
}

async function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

afterEach(() => {
  resetLlmAdapter();
  probeLlm.mockReset();
});

describe('createBootPresetFor', () => {
  it('embed resolves the external llama.cpp row when the remote triple is set', async () => {
    const { configResolver } = makeResolver({
      LLM_EMBED_BASE_URL: 'http://llama.local:8080',
      LLM_EMBED_MODEL: 'embeddinggemma-2',
    });
    const presetFor = createBootPresetFor(configResolver);
    await expect(presetFor('embed')).resolves.toBe(getPresetByFamilyRole('llama.cpp', 'embed'));
  });

  it('embed falls back to the embedded row when the remote triple is absent', async () => {
    const { configResolver } = makeResolver({});
    const presetFor = createBootPresetFor(configResolver);
    await expect(presetFor('embed')).resolves.toBe(getPresetByFamilyRole('embedded', 'embed'));
  });

  it('chat/vision/asr resolve the remote manifest row', async () => {
    const { configResolver } = makeResolver({});
    const presetFor = createBootPresetFor(configResolver);
    for (const role of ['chat', 'vision', 'asr']) {
      await expect(presetFor(role)).resolves.toBe(getPresetByFamilyRole('llama.cpp', role));
    }
  });
});

describe('createBootProbeRole', () => {
  it('delegates the embed probe to the installed adapter', async () => {
    const { configResolver } = makeResolver({});
    const adapter = initLlmAdapter({ configResolver });
    adapter.probeRole = jest.fn(async () => ({ ok: true, role: 'embed', reason: null }));

    const probeRole = createBootProbeRole(configResolver);
    await expect(probeRole({ role: 'embed' })).resolves.toEqual({
      ok: true,
      role: 'embed',
      reason: null,
    });
    expect(adapter.probeRole).toHaveBeenCalledWith('embed');
  });

  it('embed parks when no adapter is installed', async () => {
    const { configResolver } = makeResolver({});
    const probeRole = createBootProbeRole(configResolver);
    await expect(probeRole({ role: 'embed' })).resolves.toMatchObject({
      ok: false,
      role: 'embed',
    });
    expect(getLlmAdapter()).toBeNull();
  });

  it('a configured remote role runs the probe suite with the resolved triple', async () => {
    probeLlm.mockResolvedValue({ ok: true });
    const { configResolver } = makeResolver({
      LLM_CHAT_BASE_URL: 'http://chat.local:8080',
      LLM_CHAT_API_KEY: 'sk-chat',
      LLM_CHAT_MODEL: 'gemma-4-12b-it',
    });
    const probeRole = createBootProbeRole(configResolver);
    await expect(probeRole({ role: 'chat' })).resolves.toEqual({
      ok: true,
      role: 'chat',
      reason: null,
    });
    expect(probeLlm).toHaveBeenCalledWith({
      role: 'chat',
      baseUrl: 'http://chat.local:8080',
      apiKey: 'sk-chat',
      model: 'gemma-4-12b-it',
    });
  });

  it('an unconfigured remote role is skipped without probing', async () => {
    const { configResolver } = makeResolver({ LLM_VISION_MODEL: 'gemma-4-12b-it' });
    const probeRole = createBootProbeRole(configResolver);
    await expect(probeRole({ role: 'vision' })).resolves.toEqual({
      ok: false,
      role: 'vision',
      reason: 'unconfigured',
    });
    expect(probeLlm).not.toHaveBeenCalled();
  });
});

describe('createPublishedMetadataFetcher (budget step 2)', () => {
  it('reads /v1/models then /props over free GETs and returns the numeric budget', async () => {
    const server = await startServer((req, res) => {
      if (req.url === '/v1/models') {
        json(res, 200, { data: [{ id: 'embeddinggemma-2', meta: { n_ctx: null } }] });
        return;
      }
      if (req.url === '/props') {
        json(res, 200, { default_generation_settings: { n_ctx: 4096 } });
        return;
      }
      json(res, 404, {});
    });
    try {
      const { configResolver } = makeResolver({});
      const fetchPublishedMetadata = createPublishedMetadataFetcher(configResolver);
      const resolved = {
        role: 'embed',
        engine: 'remote',
        baseUrl: server.url,
        model: 'embeddinggemma-2',
        apiKey: 'sk-test',
      };
      await expect(fetchPublishedMetadata('embed', resolved)).resolves.toBe(4096);
      expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        'GET /v1/models',
        'GET /props',
      ]);
    } finally {
      await server.close();
    }
  });

  it('caches by config signature for the TTL (a second call issues no request)', async () => {
    const server = await startServer((req, res) => {
      json(res, 200, { data: [{ id: 'embeddinggemma-2', max_input_tokens: 8192 }] });
    });
    try {
      const { configResolver } = makeResolver({});
      let now = 1_000;
      const fetchPublishedMetadata = createPublishedMetadataFetcher(configResolver, {
        ttlMs: 1000,
        now: () => now,
      });
      const resolved = {
        role: 'embed',
        engine: 'remote',
        baseUrl: server.url,
        model: 'embeddinggemma-2',
      };
      await expect(fetchPublishedMetadata('embed', resolved)).resolves.toBe(8192);
      expect(server.requests).toHaveLength(1);

      now += 500; // inside the TTL
      await expect(fetchPublishedMetadata('embed', resolved)).resolves.toBe(8192);
      expect(server.requests).toHaveLength(1);

      now += 1000; // expired
      await expect(fetchPublishedMetadata('embed', resolved)).resolves.toBe(8192);
      expect(server.requests).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it('resolves null on HTTP errors and transport failures (never throws)', async () => {
    const server = await startServer((req, res) => json(res, 500, { error: 'boom' }));
    try {
      const { configResolver } = makeResolver({});
      const fetchPublishedMetadata = createPublishedMetadataFetcher(configResolver);
      const resolved = {
        role: 'embed',
        engine: 'remote',
        baseUrl: server.url,
        model: 'embeddinggemma-2',
      };
      await expect(fetchPublishedMetadata('embed', resolved)).resolves.toBeNull();

      const rejecting = createPublishedMetadataFetcher(configResolver, {
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
      });
      await expect(rejecting('embed', resolved)).resolves.toBeNull();
    } finally {
      await server.close();
    }
  });

  it('uses /api/show for the ollama family and skips GETs for the embedded engine', async () => {
    const server = await startServer((req, res) => {
      if (req.url.startsWith('/api/show')) {
        json(res, 200, { model_info: { 'llama.context_length': 16384 } });
        return;
      }
      json(res, 404, {});
    });
    try {
      const { configResolver } = makeResolver({});
      const fetchPublishedMetadata = createPublishedMetadataFetcher(configResolver, {
        presetFor: () => ({ family: 'ollama' }),
      });
      const resolved = {
        role: 'chat',
        engine: 'remote',
        baseUrl: server.url,
        model: 'gemma',
      };
      await expect(fetchPublishedMetadata('chat', resolved)).resolves.toBe(16384);
      expect(server.requests.map((r) => r.path)).toEqual(['/api/show?name=gemma']);

      await expect(
        fetchPublishedMetadata('embed', { ...resolved, engine: 'embedded' })
      ).resolves.toBeNull();
      expect(server.requests).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('the injected fetcher feeds the adapter budget chain as source=metadata', async () => {
    const remote = {
      LLM_CHAT_BASE_URL: 'http://chat.local:8080',
      LLM_CHAT_MODEL: 'gemma-4-12b-it',
    };
    const { configResolver } = makeResolver(remote);
    const adapter = createLlmAdapter({
      configResolver,
      presetFor: () => ({ budgets: { maxInputCharsDefault: 3000 } }),
      probeRole: async () => ({ ok: true }),
      fetchPublishedMetadata: async () => 2000,
    });
    await expect(adapter.getBudget('chat')).resolves.toEqual({
      maxInputChars: 2000,
      source: 'metadata',
    });
  });
});
