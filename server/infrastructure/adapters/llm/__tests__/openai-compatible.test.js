'use strict';

/**
 * Remote OpenAI-compatible dialect client (llmAdapter.md §2.3/§2.6, T1.9a).
 *
 * Hermetic: an in-process node:http server captures every request body. No
 * external network. Asserts the request SHAPE the adapter contract depends on:
 * text prefixes on text, NONE on media, data-URL media wrapper, reasoning-off
 * chat kwarg, and the mandatory ASR escape prompt.
 */

const http = require('http');
const { createOpenAiCompatibleClient, ESCAPE_PROMPT } = require('../clients/openai-compatible');
const { findPreset } = require('../presets');

const FIXTURE_DIR = `${__dirname}/fixtures`;
const photo = require('fs').readFileSync(`${FIXTURE_DIR}/photo.jpg`);
const speech = require('fs').readFileSync(`${FIXTURE_DIR}/speech.wav`);
const video = require('fs').readFileSync(`${FIXTURE_DIR}/video.mp4`);

const embedProfile = findPreset('embeddinggemma-2-external').profile;
const chatProfile = findPreset('gemma-4-12b-it').profile;

function startServer(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => handler(req, res, Buffer.concat(chunks)));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function embeddingResponse(rawInput) {
  const input = Array.isArray(rawInput) ? rawInput : [rawInput];
  const rows = input.map((item, index) => {
    const vector = new Array(8).fill(0);
    vector[index % 8] = 1;
    if (item && typeof item === 'object') vector[7] = 0.5;
    return { index, embedding: vector };
  });
  return {
    data: rows.reverse(),
    usage: { prompt_tokens: input.length, total_tokens: input.length },
  };
}

describe('remote OpenAI-compatible dialect client', () => {
  let server;
  let requests;

  beforeEach(async () => {
    requests = [];
    server = await startServer((req, res, body) => {
      const text = body.toString('utf8');
      requests.push({
        url: req.url,
        headers: req.headers,
        body: text && req.url !== '/audio/transcriptions' ? JSON.parse(text) : null,
        raw: text,
      });
      if (req.url === '/embeddings') {
        json(res, 200, embeddingResponse(JSON.parse(text).input));
      } else if (req.url === '/chat/completions') {
        json(res, 200, {
          choices: [{ message: { content: '{"tags":["rain","dog"]}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        });
      } else if (req.url === '/audio/transcriptions') {
        json(res, 200, { text: 'Front Center.' });
      } else {
        json(res, 404, { error: 'not found' });
      }
    });
  });

  afterEach(async () => {
    await server.close();
  });

  function client(profile = embedProfile) {
    return createOpenAiCompatibleClient({
      baseUrl: server.baseUrl,
      apiKey: 'sk-test',
      model: 'test-model',
      profile,
      kwargs: profile === chatProfile ? findPreset('gemma-4-12b-it').kwargs : null,
    });
  }

  it('embed/embedQuery carry the profile text prefixes; response order is restored by index', async () => {
    const remote = client();
    const out = await remote.embed(['hello', 'world']);
    expect(out.dim).toBe(8);
    expect(out.vectors).toHaveLength(2);
    expect(out.usage).toEqual({ promptTokens: 2, totalTokens: 2 });

    const doc = requests.find((r) => r.url === '/embeddings');
    expect(doc.body.input).toEqual(['title: none | text: hello', 'title: none | text: world']);
    expect(doc.headers.authorization).toBe('Bearer sk-test');

    await remote.embedQuery('find the invoice');
    const query = requests.filter((r) => r.url === '/embeddings')[1];
    expect(query.body.input).toBe('task: search result | query: find the invoice');
  });

  it('embedMedia sends data-URL content-wrapper parts and NO text prefix', async () => {
    const remote = client();

    await remote.embedMedia([photo], { mediaType: 'image' });
    const image = requests.at(-1).body;
    const imagePart = image.input[0].content[0];
    expect(imagePart.type).toBe('image_url');
    expect(imagePart.image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(JSON.stringify(image)).not.toContain('title: none');

    await remote.embedMedia([speech], { mediaType: 'audio' });
    const audio = requests.at(-1).body;
    expect(audio.input[0].content[0].type).toBe('input_audio');
    expect(audio.input[0].content[0].input_audio.data.startsWith('data:audio/wav;base64,')).toBe(
      true
    );

    await remote.embedMedia([video], { mediaType: 'video' });
    const videoBody = requests.at(-1).body;
    expect(videoBody.input[0].content[0].type).toBe('video_url');
    expect(videoBody.input[0].content[0].video_url.url.startsWith('data:video/mp4;base64,')).toBe(
      true
    );
    expect(JSON.stringify(videoBody)).not.toContain('task: search result');
  });

  it('chat reasons OFF by default; schema requests carry a JSON-schema response format', async () => {
    const remote = client(chatProfile);
    const result = await remote.chat([{ role: 'user', content: 'tags?' }], {
      schema: { type: 'object' },
    });
    expect(result.json).toEqual({ tags: ['rain', 'dog'] });
    expect(result.usage).toEqual({ prompt_tokens: 3, completion_tokens: 4 });

    const body = requests.at(-1).body;
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', schema: { type: 'object' }, strict: true },
    });
  });

  it('visionCaption sends the photo as a data-URL image part', async () => {
    const remote = client(chatProfile);
    const result = await remote.visionCaption([photo], { prompt: 'Describe it' });
    expect(result.text).toBeTruthy();
    const content = requests.at(-1).body.messages[0].content;
    expect(content[0]).toEqual({ type: 'text', text: 'Describe it' });
    expect(content[1].type).toBe('image_url');
    expect(content[1].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('asrTranscribe is multipart and ALWAYS carries the escape prompt', async () => {
    const remote = client(chatProfile);
    const result = await remote.asrTranscribe(speech, { escapePrompt: true });
    expect(result.text).toBe('Front Center.');

    const capture = requests.at(-1);
    expect(capture.url).toBe('/audio/transcriptions');
    expect(capture.headers['content-type']).toContain('multipart/form-data');
    expect(capture.raw).toContain('name="file"');
    expect(capture.raw).toContain('audio.wav');
    expect(capture.raw).toContain('name="prompt"');
    expect(capture.raw).toContain(ESCAPE_PROMPT);
    expect(capture.raw).toContain('name="model"');
    expect(capture.raw).toMatch(/name="temperature"\r\n\r\n0/);
  });
});

describe('remote dialect error classification (§2.8)', () => {
  let server;
  let status = 200;
  let body = '{}';

  beforeAll(async () => {
    server = await startServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
  });

  afterAll(async () => {
    await server.close();
  });

  function make() {
    return createOpenAiCompatibleClient({
      baseUrl: server.baseUrl,
      model: 'm',
      profile: embedProfile,
    });
  }

  it('429 ⇒ rate; 500 ⇒ transport; malformed JSON ⇒ schema', async () => {
    status = 429;
    body = '{"error":"slow down"}';
    await expect(make().embed(['x'])).rejects.toMatchObject({ class: 'rate' });

    status = 500;
    body = '{"error":"boom"}';
    await expect(make().embed(['x'])).rejects.toMatchObject({ class: 'transport' });

    status = 200;
    body = '<html>';
    await expect(make().embed(['x'])).rejects.toMatchObject({ class: 'schema' });
  });

  it('a length-class 400 body is classified as length', async () => {
    status = 400;
    body = '{"error":"input too long: maximum context"}';
    await expect(make().embed(['x'])).rejects.toMatchObject({ class: 'length' });
  });

  it('a 500 physical-batch overflow body is classified as length, not transport', async () => {
    status = 500;
    body =
      '{"error":{"message":"input (16315 tokens) is too large to process. increase the physical batch size (current batch size: 512)"}}';
    await expect(make().embed(['x'])).rejects.toMatchObject({ class: 'length' });
  });
});
