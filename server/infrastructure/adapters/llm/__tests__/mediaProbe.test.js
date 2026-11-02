'use strict';

/**
 * Media probes with positive controls (llmAdapter.md §2.4, §5; T1.9a).
 *
 * Hermetic fake OpenAI-compatible servers over node:http:
 *   - `drop`   — HTTP 200 but media parts are silently ignored (the known
 *                llama.cpp failure mode) ⇒ media caps OFF, text_embed ON;
 *   - `shape`  — consumes media ⇒ image/audio/video caps ON;
 *   - vision/asr positive and negative transcript/caption fixtures.
 */

const http = require('http');
const { createLlmAdapter } = require('../index');
const { createOpenAiCompatibleClient } = require('../clients/openai-compatible');
const { findPreset, kit } = require('../presets');
const probeState = require('../probeState');
const { runVisionProbe } = require('../mediaProbe');
const { probeLlm } = require('../probe');

function startServer(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => handler(req, res, Buffer.concat(chunks)));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function hashKey(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function unitVector(key) {
  const vector = new Array(768).fill(0);
  vector[hashKey(key) % 768] = 1;
  return vector;
}

function mediaKey(part, mode) {
  const type = part.type;
  if (mode === 'drop') return 'text:';
  if (type === 'image_url' || type === 'video_url') return 'image';
  if (type === 'input_audio') return `audio:${hashKey(part.input_audio.data)}`;
  return `text:${part.text ?? ''}`;
}

/** Fake embeddings endpoint: canonical conformance kit + text/media vectors. */
function embeddingsHandler(mode, req, res, body) {
  const payload = JSON.parse(body.toString('utf8'));
  if (Array.isArray(payload.input) && payload.input.length === 24) {
    const canonical = kit().vectors;
    return json(res, 200, {
      data: canonical.map((vector, index) => ({
        index,
        embedding: Array.from(vector),
      })),
    });
  }

  // Context-limited endpoint: the full-size base64 text control is rejected
  // exactly like llama.cpp rejects it above the physical batch size.
  const oversizedTextControl = payload.input.some(
    (item) =>
      item &&
      typeof item === 'object' &&
      (item.content || []).some(
        (part) => part.type === 'text' && String(part.text ?? '').length > 10000
      )
  );
  if ((mode === 'usage' || mode === 'usage-less') && oversizedTextControl) {
    return json(res, 500, {
      error: {
        message:
          'input (16315 tokens) is too large to process. increase the physical batch size (current batch size: 512)',
      },
    });
  }

  const rows = payload.input.map((item, index) => {
    let vector;
    if (typeof item === 'string') {
      vector = unitVector(`text:${item}`);
    } else {
      const parts = item.content || [];
      const media = parts.find((part) => part.type !== 'text');
      if (media) {
        vector = unitVector(mediaKey(media, mode));
      } else {
        const textPart = parts.find((part) => part.type === 'text');
        vector = unitVector(`text:${textPart ? textPart.text : ''}`);
      }
    }
    return { index, embedding: vector };
  });
  const response = { data: rows };
  if (mode === 'usage') response.usage = { prompt_tokens: 88 };
  return json(res, 200, response);
}

function buildAdapter(baseUrl, { vision = false, asr = false } = {}) {
  const store = new Map([
    ['LLM_EMBED_BASE_URL', baseUrl],
    ['LLM_EMBED_MODEL', 'embeddinggemma-2'],
    ['LLM_EMBED_API_KEY', 'sk-embed'],
  ]);
  if (vision) {
    store.set('LLM_VISION_BASE_URL', baseUrl);
    store.set('LLM_VISION_MODEL', 'gemma-4-12b-it');
  }
  if (asr) {
    store.set('LLM_ASR_BASE_URL', baseUrl);
    store.set('LLM_ASR_MODEL', 'gemma-4-12b-it');
  }
  const usage = [];
  return createLlmAdapter({
    configResolver: {
      async getConfig(key) {
        return store.get(key);
      },
    },
    presetFor: (role) =>
      role === 'embed' ? findPreset('embeddinggemma-2-external') : findPreset('gemma-4-12b-it'),
    aiUsageDailyStore: {
      async recordUsage(delta) {
        usage.push(delta);
      },
      async getByDay() {
        return [];
      },
    },
    llmModelsStore: {
      async getActiveByRole() {
        return null;
      },
      async upsertModel() {
        return { id: 1 };
      },
    },
    health: { report: () => {} },
    // Probe tests assert the synchronous verdict; never leave a real
    // debounced re-probe timer behind after the fake server closes.
    timers: {
      setTimeout: () => 0,
      clearTimeout: () => {},
    },
  });
}

function capability(name) {
  return probeState.getCapabilityEntries().find((entry) => entry.capability === name);
}

describe('media embed probes — positive controls (silent media-drop detection)', () => {
  beforeEach(() => probeState.reset());

  it('a correctly-shaped endpoint turns image/audio/video caps ON and keeps text_embed ON', async () => {
    const server = await startServer((req, res, body) => {
      if (req.url === '/embeddings') return embeddingsHandler('shape', req, res, body);
      return json(res, 404, {});
    });
    try {
      const adapter = buildAdapter(server.baseUrl);
      const outcome = await adapter.probeRole('embed');
      expect(outcome.ok).toBe(true);
      expect(outcome.media.image_embed.pass).toBe(true);
      expect(outcome.media.audio_embed.pass).toBe(true);
      expect(outcome.media.video_embed.pass).toBe(true);

      expect(capability('text_embed').enabled).toBe(true);
      expect(capability('image_embed').enabled).toBe(true);
      expect(capability('audio_embed').enabled).toBe(true);
      expect(capability('video_embed').enabled).toBe(true);
      expect(probeState.listWarnings()).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('an endpoint that silently drops media fields ⇒ media caps OFF, text_embed ON + warning', async () => {
    const server = await startServer((req, res, body) => {
      if (req.url === '/embeddings') return embeddingsHandler('drop', req, res, body);
      return json(res, 404, {});
    });
    try {
      const adapter = buildAdapter(server.baseUrl);
      const outcome = await adapter.probeRole('embed');
      expect(outcome.ok).toBe(true); // text identity still conforms
      expect(outcome.media.image_embed.pass).toBe(false);

      expect(capability('text_embed').enabled).toBe(true);
      expect(capability('image_embed').enabled).toBe(false);
      expect(capability('audio_embed').enabled).toBe(false);
      expect(capability('video_embed').enabled).toBe(false);

      const warnings = probeState.listWarnings();
      expect(warnings.map((warning) => warning.capability)).toEqual(
        expect.arrayContaining(['image_embed', 'audio_embed', 'video_embed'])
      );
      expect(warnings.find((warning) => warning.capability === 'image_embed')).toMatchObject({
        code: 'probe_failed',
        hint: 'serverErrors.ai.providerProbeFailed',
      });
    } finally {
      await server.close();
    }
  });

  it('usage metadata replaces an oversized base64 control and keeps image/video ON', async () => {
    const requests = [];
    const server = await startServer((req, res, body) => {
      if (req.url === '/embeddings') {
        requests.push(JSON.parse(body.toString('utf8')));
        return embeddingsHandler('usage', req, res, body);
      }
      return json(res, 404, {});
    });
    try {
      const adapter = buildAdapter(server.baseUrl);
      const outcome = await adapter.probeRole('embed');
      expect(outcome.media.image_embed).toMatchObject({
        pass: true,
        measurements: { textControl: 'usage' },
      });
      expect(outcome.media.video_embed).toMatchObject({
        pass: true,
        measurements: { frames: 3 },
      });
      expect(capability('image_embed').enabled).toBe(true);

      const sentOversizedControl = requests.some((payload) =>
        (payload.input || []).some(
          (item) =>
            item &&
            typeof item === 'object' &&
            (item.content || []).some(
              (part) => part.type === 'text' && String(part.text ?? '').length > 10000
            )
        )
      );
      expect(sentOversizedControl).toBe(false);
      const sentVideoUrl = requests.some((payload) =>
        (payload.input || []).some(
          (item) =>
            item &&
            typeof item === 'object' &&
            (item.content || []).some((part) => part.type === 'video_url')
        )
      );
      expect(sentVideoUrl).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('a length-rejected text control is text_control_unavailable, never transport', async () => {
    const server = await startServer((req, res, body) => {
      if (req.url === '/embeddings') return embeddingsHandler('usage-less', req, res, body);
      return json(res, 404, {});
    });
    try {
      const adapter = buildAdapter(server.baseUrl);
      const outcome = await adapter.probeRole('embed');
      expect(outcome.media.image_embed).toMatchObject({
        pass: false,
        reason: 'text_control_unavailable',
      });
      expect(capability('image_embed').enabled).toBe(false);
      expect(capability('video_embed').enabled).toBe(false);
    } finally {
      await server.close();
    }
  });
});

describe('vision/asr probes use real fixtures and positive controls', () => {
  let mode;
  let server;

  beforeEach(async () => {
    mode = 'positive';
    server = await startServer((req, res, body) => {
      if (req.url === '/chat/completions') {
        const payload = JSON.parse(body.toString('utf8'));
        const content = payload.messages[0].content;
        const hasImage =
          Array.isArray(content) && content.some((part) => part.type === 'image_url');
        const text = mode === 'positive' && hasImage ? 'A cloud-filled sky at sunset.' : 'none';
        return json(res, 200, {
          choices: [{ message: { content: text }, finish_reason: 'stop' }],
        });
      }
      if (req.url === '/audio/transcriptions') {
        return json(res, 200, { text: mode === 'positive' ? 'Front Center.' : 'none' });
      }
      return json(res, 404, {});
    });
  });

  afterEach(async () => {
    await server.close();
  });

  function chatClient() {
    return createOpenAiCompatibleClient({
      baseUrl: server.baseUrl,
      model: 'gemma-4-12b-it',
      profile: findPreset('gemma-4-12b-it').profile,
      kwargs: findPreset('gemma-4-12b-it').kwargs,
    });
  }

  it('vision: a real photo produces a non-trivial, image-dependent caption', async () => {
    const client = chatClient();
    const result = await runVisionProbe({
      visionCaption: (...args) => client.visionCaption(...args),
      chat: (...args) => client.chat(...args),
    });
    expect(result.pass).toBe(true);
  });

  it('vision: a text-only response (image ignored) fails the probe', async () => {
    mode = 'negative';
    const client = chatClient();
    const result = await runVisionProbe({
      visionCaption: (...args) => client.visionCaption(...args),
      chat: (...args) => client.chat(...args),
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('vision_caption_too_short');
  });

  it('asr: real speech transcript passes; a non-overlapping transcript fails', async () => {
    const positive = await probeLlm({
      role: 'asr',
      baseUrl: server.baseUrl,
      model: 'gemma-4-12b-it',
      fetchImpl: fetch,
    });
    expect(positive).toMatchObject({ ok: true, role: 'asr' });

    mode = 'negative';
    await expect(
      probeLlm({ role: 'asr', baseUrl: server.baseUrl, model: 'gemma-4-12b-it' })
    ).rejects.toMatchObject({ reason: 'asr_transcript_mismatch' });
  });
});

describe('chat probe uses the runtime structured-output contract', () => {
  it('sends response_format and accepts the raw JSON produced under the schema', async () => {
    const requests = [];
    const server = await startServer((req, res, body) => {
      if (req.url !== '/chat/completions') return json(res, 404, {});
      const payload = JSON.parse(body.toString('utf8'));
      requests.push(payload);
      const content = payload.response_format
        ? '{"tags":["dog","rain"]}'
        : '```json\n{"tags":["dog","rain"]}\n```';
      return json(res, 200, {
        choices: [{ message: { content }, finish_reason: 'stop' }],
      });
    });
    try {
      const result = await probeLlm({
        role: 'chat',
        baseUrl: server.baseUrl,
        model: 'Hana',
      });
      expect(result).toMatchObject({ ok: true, role: 'chat', reason: null });
      expect(requests).toHaveLength(1);
      expect(requests[0].response_format).toMatchObject({ type: 'json_schema' });
    } finally {
      await server.close();
    }
  });
});
