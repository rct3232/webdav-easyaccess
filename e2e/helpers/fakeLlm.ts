import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * In-process fake LLM endpoint for the hermetic AI degradation matrix
 * (docs/TESTING_STRATEGY.md AI tiers, T4.3).
 *
 * The Playwright process owns the listener on an ephemeral 127.0.0.1 port; the
 * scratch server reaches it through the pre-boot `settings` rows written by
 * `seedScratchSettings` (`LLM_*` are dbOnly — ambient env never selects a
 * provider). Root and `/v1` aliases are served so either base-URL form works.
 *
 * Contract:
 * - `text-only`: media parts are silently ignored (the known llama.cpp
 *   failure mode) and media-only/empty wrappers return a deterministic
 *   empty-basis vector. `text_embed` still passes; the media positive controls
 *   must fail.
 * - `media-capable`: image/video share the image direction (near-dup + same
 *   space), audio vectors are content-derived (speech vs noise distinct), so
 *   the adapter's positive controls pass.
 * - Conformance: the 24 checked-in EG2 kit strings return the canonical kit
 *   vectors (document/query prefixes tolerated with or without a trailing
 *   space). Ordinary text vectors are deterministic bag-of-words unit vectors
 *   at dim 768 — never constant, so the adapter's non-degeneracy probe and the
 *   semantic baseline gate work.
 * - Chat: `parse-ok` answers the probe with schema-valid JSON;
 *   `parse-invalid` returns non-JSON for the Wave 2 parser-degrade case.
 *   An image-bearing chat request returns the vision caption (V2), and a plain
 *   chat request returns different text.
 *
 * Counters let a suite prove the fake handled the traffic; no real provider is
 * ever configured.
 */

export type FakeLlmMode = 'text-only' | 'media-capable';
export type FakeChatParseMode = 'parse-ok' | 'parse-invalid';

export interface FakeLlmCounters {
  embedCalls: number;
  kitCalls: number;
  mediaCalls: number;
  chatCalls: number;
  visionCalls: number;
}

export interface FakeLlmServer {
  /** Root base URL (`http://127.0.0.1:<ephemeral>`). */
  baseUrl: string;
  counters: FakeLlmCounters;
  resetCounters: () => void;
  setMode: (mode: FakeLlmMode) => void;
  setChatParseMode: (mode: FakeChatParseMode) => void;
  close: () => Promise<void>;
}

const DIM = 768;
const TEXT_SLOTS = DIM - 1; // 0..766; 767 is reserved for the empty basis
const EMPTY_INDEX = DIM - 1;

const DOCUMENT_PREFIX = 'title: none | text:';
const QUERY_PREFIX = 'task: search result | query:';
const KNOWN_PREFIXES = [DOCUMENT_PREFIX, QUERY_PREFIX];

const IMAGE_CAPTION = 'A red bicycle leans against a brick wall in the sunlight.';
const PLAIN_CHAT_ANSWER = JSON.stringify({ tags: ['golden', 'retriever'] });
const INVALID_CHAT_ANSWER = 'this is not schema-valid json';

interface ReferenceKit {
  strings: string[];
  vectors: number[][];
}

function loadReferenceKit(): ReferenceKit {
  const kitPath = path.join(
    process.cwd(),
    'server',
    'infrastructure',
    'adapters',
    'llm',
    'eg2-reference-kit.json'
  );
  const raw = JSON.parse(fs.readFileSync(kitPath, 'utf8')) as {
    strings: string[];
    vectors: string[];
  };
  return {
    strings: raw.strings,
    vectors: raw.vectors.map((b64) => {
      const buffer = Buffer.from(b64, 'base64');
      const floats = new Float32Array(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      );
      return Array.from(floats);
    }),
  };
}

const KIT = loadReferenceKit();
const KIT_INDEX = new Map(KIT.strings.map((text, index) => [text, index]));

/** Strip a known profile prefix plus its optional trailing space. */
function stripKnownPrefix(text: string): string {
  for (const prefix of KNOWN_PREFIXES) {
    if (text === prefix) return '';
    if (text.startsWith(prefix)) return text.slice(prefix.length).replace(/^\s+/, '');
  }
  return text;
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function normalize(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

function emptyBasisVector(): number[] {
  const vector = new Array<number>(DIM).fill(0);
  vector[EMPTY_INDEX] = 1;
  return vector;
}

/** Deterministic non-degenerate bag-of-words unit vector. */
function textVector(text: string): number[] {
  const normalized = stripKnownPrefix(text);
  const tokens = normalized.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return emptyBasisVector();
  const vector = new Array<number>(DIM).fill(0);
  for (const token of tokens) vector[hashToken(token) % TEXT_SLOTS] += 1;
  return normalize(vector);
}

let cachedImageVector: number[] | null = null;

/** Image/video direction: the same space for near-dups and frame samples. */
function imageVector(): number[] {
  if (!cachedImageVector) cachedImageVector = textVector(IMAGE_CAPTION);
  return cachedImageVector;
}

/** Content-derived signed vector so distinct audio never collapses. */
function audioVector(buffer: Buffer): number[] {
  const digest = crypto.createHash('sha256').update(buffer).digest();
  const vector = new Array<number>(DIM).fill(0);
  for (let i = 0; i < 32; i++) {
    const index = digest[i] % TEXT_SLOTS;
    vector[index] += (digest[32 + i] & 1) === 1 ? 1 : -1;
  }
  return normalize(vector);
}

function bufferFromDataUrl(value: unknown): Buffer {
  const text = String(value ?? '');
  const comma = text.indexOf(',');
  return comma === -1 ? Buffer.from(text, 'base64') : Buffer.from(text.slice(comma + 1), 'base64');
}

interface ContentPart {
  type?: string;
  text?: string;
  image_url?: { url?: string };
  video_url?: { url?: string };
  input_audio?: { data?: string };
}

interface EmbeddingItem {
  content?: ContentPart[];
}

function mediaParts(item: EmbeddingItem): ContentPart[] {
  const parts = Array.isArray(item?.content) ? item.content : [];
  return parts.filter(
    (part) =>
      part &&
      (part.type === 'image_url' || part.type === 'video_url' || part.type === 'input_audio')
  );
}

function embeddingForInput(item: string | EmbeddingItem, mode: FakeLlmMode): number[] {
  if (typeof item === 'string') {
    const text = stripKnownPrefix(item);
    const kitIndex = KIT_INDEX.get(text);
    if (kitIndex !== undefined) return KIT.vectors[kitIndex];
    return textVector(text);
  }

  const parts = Array.isArray(item?.content) ? item.content : [];
  const media = mediaParts(item);
  if (media.length > 0) {
    if (mode === 'text-only') return emptyBasisVector();
    const part = media[0];
    if (part.type === 'input_audio') return audioVector(bufferFromDataUrl(part.input_audio?.data));
    // image and video share the image/frame space.
    return imageVector();
  }

  const textPart = parts.find((part) => part && part.type === 'text');
  return textVector(String(textPart?.text ?? ''));
}

function requestContainsKit(input: unknown[]): boolean {
  return input.some((item) => {
    if (typeof item !== 'string') return false;
    return KIT_INDEX.has(stripKnownPrefix(item));
  });
}

function messageHasImage(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (part) => part && typeof part === 'object' && (part as ContentPart).type === 'image_url'
  );
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function canonicalPath(rawUrl: string): string {
  const parsed = new URL(rawUrl, 'http://127.0.0.1');
  let pathname = parsed.pathname;
  while (pathname.startsWith('/v1/')) pathname = pathname.slice(3);
  if (pathname === '/v1') pathname = '/';
  return pathname.replace(/\/+$/, '') || '/';
}

export async function createFakeLlmServer(
  options: {
    mode?: FakeLlmMode;
    chatParseMode?: FakeChatParseMode;
    visionCaption?: boolean;
  } = {}
): Promise<FakeLlmServer> {
  let mode = options.mode ?? 'text-only';
  let chatParseMode = options.chatParseMode ?? 'parse-ok';
  const visionCaption = options.visionCaption ?? true;

  const counters: FakeLlmCounters = {
    embedCalls: 0,
    kitCalls: 0,
    mediaCalls: 0,
    chatCalls: 0,
    visionCalls: 0,
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const pathname = canonicalPath(req.url ?? '/');
      const rawBody = Buffer.concat(chunks).toString('utf8');

      if (req.method === 'GET' && pathname === '/props') {
        json(res, 200, {
          pooling: 'mean',
          default_generation_settings: { n_ctx: 8192 },
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/models') {
        json(res, 200, { data: [{ id: 'embeddinggemma-2', n_ctx: 8192 }] });
        return;
      }

      if (req.method === 'POST' && pathname === '/embeddings') {
        let payload: { input?: unknown };
        try {
          payload = JSON.parse(rawBody || '{}');
        } catch {
          json(res, 400, { error: 'invalid json' });
          return;
        }
        const rawInput = payload.input;
        const input = Array.isArray(rawInput) ? rawInput : rawInput === undefined ? [] : [rawInput];
        counters.embedCalls += 1;
        if (requestContainsKit(input)) counters.kitCalls += 1;
        if (
          input.some(
            (item) => typeof item === 'object' && mediaParts(item as EmbeddingItem).length > 0
          )
        ) {
          counters.mediaCalls += 1;
        }
        const data = input.map((item, index) => ({
          index,
          embedding: embeddingForInput(item as string | EmbeddingItem, mode),
        }));
        json(res, 200, { data });
        return;
      }

      if (req.method === 'POST' && pathname === '/chat/completions') {
        let payload: { messages?: Array<{ role?: string; content?: unknown }> };
        try {
          payload = JSON.parse(rawBody || '{}');
        } catch {
          json(res, 400, { error: 'invalid json' });
          return;
        }
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const hasImage = messages.some((message) => messageHasImage(message.content));
        const answer = hasImage && visionCaption ? IMAGE_CAPTION : null;

        if (hasImage) {
          counters.visionCalls += 1;
          if (!visionCaption) {
            json(res, 200, {
              choices: [{ message: { role: 'assistant', content: INVALID_CHAT_ANSWER } }],
            });
            return;
          }
        } else {
          counters.chatCalls += 1;
        }

        json(res, 200, {
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  answer ??
                  (chatParseMode === 'parse-invalid' ? INVALID_CHAT_ANSWER : PLAIN_CHAT_ANSWER),
              },
              finish_reason: 'stop',
            },
          ],
        });
        return;
      }

      json(res, 404, { error: 'not found' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    counters,
    resetCounters: () => {
      counters.embedCalls = 0;
      counters.kitCalls = 0;
      counters.mediaCalls = 0;
      counters.chatCalls = 0;
      counters.visionCalls = 0;
    },
    setMode: (next) => {
      mode = next;
    },
    setChatParseMode: (next) => {
      chatParseMode = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
