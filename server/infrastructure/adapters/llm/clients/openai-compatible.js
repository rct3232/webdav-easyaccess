'use strict';

/**
 * OpenAI-compatible remote dialect client (llmAdapter.md §2.1/§2.3/§2.6).
 *
 * Covers the llama.cpp/OpenAI-compatible family used by the external EG2
 * embedding row and the chat/vision/asr rows. Transport shaping only:
 *   - text embed/query bodies carry the profile task prefixes;
 *   - media bodies carry NO prefix and ride the profile `requestShape`
 *     (`content-wrapper` for the EG2 external row — top-level media fields are
 *     silently ignored by llama.cpp embed endpoints, llmPresets §2.3);
 *   - chat reasons OFF by default through the llama.cpp
 *     `chat_template_kwargs.enable_thinking=false` switch;
 *   - ASR is multipart `/audio/transcriptions` with the mandatory, fixed
 *     escape prompt (aiJobService.md §2.3).
 *
 * Every provider failure is classified before surfacing (§2.8 taxonomy:
 * transport | rate | config | schema | length). No retries here — retry and
 * breaker policy belong to the adapter core.
 */

const { classifyLlmError } = require('../budget');

const DEFAULT_TIMEOUT_MS = 30_000;
const ESCAPE_PROMPT = 'if there is no actually audible speech, answer none';

function isSet(value) {
  return value !== undefined && value !== null && value !== '';
}

function trimmedBase(baseUrl) {
  return String(baseUrl).replace(/\/+$/, '');
}

function applyPrefix(prefix, text) {
  if (!prefix) return text;
  return `${prefix} ${text}`;
}

function classified(errorClass, reason, message, cause) {
  const err = new Error(message);
  err.class = errorClass;
  err.reason = reason;
  if (cause) err.cause = cause;
  return err;
}

/** Sniff image mime (PNG magic, JPEG otherwise) for the data URL. */
function imageMime(buffer) {
  if (
    buffer &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  return 'image/jpeg';
}

function mediaMime(mediaType, buffer) {
  if (mediaType === 'image') return imageMime(buffer);
  if (mediaType === 'audio') return 'audio/wav';
  if (mediaType === 'video') return 'video/mp4';
  throw classified('config', 'unsupported_media_type', `unsupported media type '${mediaType}'`);
}

/**
 * The documented `content-wrapper` media item: one content part per buffer,
 * data-URL encoded (llmAdapter.md §2.3 `embedMedia`, §2.6 MEDIA ladder).
 * The part type mirrors the OpenAI content-part vocabulary:
 *   image → image_url, audio → input_audio, video → video_url.
 */
function mediaPart(mediaType, buffer) {
  const mime = mediaMime(mediaType, buffer);
  const url = `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
  if (mediaType === 'image') return { type: 'image_url', image_url: { url } };
  if (mediaType === 'audio') {
    return { type: 'input_audio', input_audio: { data: url, format: 'wav' } };
  }
  return { type: 'video_url', video_url: { url } };
}

/**
 * Create the remote client.
 *
 * @param {object} spec
 * @param {string} spec.baseUrl
 * @param {string} [spec.apiKey]
 * @param {string} spec.model
 * @param {object} [spec.profile] preset profile row (requestShape/textPrefixes/kwargs)
 * @param {Function} [spec.fetchImpl] transport seam (tests)
 */
function createOpenAiCompatibleClient(spec = {}) {
  const { baseUrl, apiKey, model, profile = null, kwargs = null, fetchImpl = null } = spec;
  if (!isSet(baseUrl) || !isSet(model)) {
    throw classified('config', 'incomplete_config', 'remote client requires baseUrl and model');
  }
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  const base = trimmedBase(baseUrl);
  const requestShape = profile?.requestShape ?? 'plain-input';
  const textPrefixes = profile?.textPrefixes ?? null;

  function headers(extra = {}) {
    return {
      ...(isSet(apiKey) ? { authorization: `Bearer ${apiKey}` } : {}),
      ...extra,
    };
  }

  async function postJson(path, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    let response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (err && typeof err.class === 'string') throw err;
      throw classifyLlmError(err);
    }
    if (!response.ok) {
      let text = '';
      try {
        text = await response.text();
      } catch {
        /* body already consumed / empty */
      }
      const err = new Error(
        `${path} HTTP ${response.status}${text ? `: ${String(text).slice(0, 300)}` : ''}`
      );
      err.status = response.status;
      throw classifyLlmError(err);
    }
    return response;
  }

  async function readEmbeddings(response) {
    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw classified('schema', 'invalid_json', 'embedding response is not JSON', err);
    }
    const rows = Array.isArray(payload && payload.data) ? payload.data.slice() : null;
    if (!rows || rows.length === 0) {
      throw classified('schema', 'invalid_embedding_response', 'embedding response has no data');
    }
    rows.sort((a, b) => Number((a && a.index) ?? 0) - Number((b && b.index) ?? 0));
    const vectors = rows.map((row) => {
      if (!row || !Array.isArray(row.embedding) || row.embedding.length === 0) {
        throw classified('schema', 'invalid_embedding_response', 'embedding row is malformed');
      }
      return Float32Array.from(row.embedding);
    });
    const usage = {};
    const promptTokens = Number(payload?.usage?.prompt_tokens);
    const totalTokens = Number(payload?.usage?.total_tokens);
    if (Number.isFinite(promptTokens)) usage.promptTokens = promptTokens;
    if (Number.isFinite(totalTokens)) usage.totalTokens = totalTokens;
    return {
      vectors,
      dim: vectors[0].length,
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
    };
  }

  async function embed(texts, opts = {}) {
    const inputs = (texts || []).map((text) =>
      applyPrefix(textPrefixes?.document ?? null, String(text ?? ''))
    );
    const response = await postJson('/embeddings', { model, input: inputs }, opts);
    return readEmbeddings(response);
  }

  async function embedQuery(text, opts = {}) {
    const input = applyPrefix(textPrefixes?.query ?? null, String(text ?? ''));
    const response = await postJson('/embeddings', { model, input }, opts);
    return readEmbeddings(response);
  }

  /**
   * Direct media embed (V1/V3): one item per buffer, data URLs, NO text prefix.
   * `requestShape` selects the body dialect; only `content-wrapper` is defined
   * for media (the EG2 external row declares it).
   */
  async function embedMedia(buffers, { mediaType, ...opts } = {}) {
    const list = Array.isArray(buffers) ? buffers : [];
    if (requestShape !== 'content-wrapper') {
      throw classified(
        'config',
        'unsupported_media_request_shape',
        `media embedding is not defined for requestShape '${requestShape}'`
      );
    }
    const input = list.map((buffer) => ({ content: [mediaPart(mediaType, buffer)] }));
    const response = await postJson('/embeddings', { model, input }, opts);
    return readEmbeddings(response);
  }

  /**
   * Probe-only TEXT control through the SAME content-wrapper shape. This is
   * what makes a silently media-dropping endpoint observable (§2.4 (b)): the
   * media item and this text item differ only by the content part.
   */
  async function embedWrappedText(text, opts = {}) {
    if (requestShape !== 'content-wrapper') return embed([text], opts);
    const response = await postJson(
      '/embeddings',
      { model, input: [{ content: [{ type: 'text', text: String(text ?? '') }] }] },
      opts
    );
    return readEmbeddings(response);
  }

  async function requestChat(messages, opts = {}) {
    const body = {
      model,
      messages,
      temperature: 0,
      stream: false,
    };
    if (kwargs?.enableThinkingChatTemplateKwarg && opts.reasoning !== true) {
      body.chat_template_kwargs = { enable_thinking: false };
    }
    if (Number.isFinite(opts.maxTokens) && opts.maxTokens > 0) body.max_tokens = opts.maxTokens;
    if (opts.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', schema: opts.schema, strict: true },
      };
    }
    const response = await postJson('/chat/completions', body, opts);
    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw classified('schema', 'invalid_json', 'chat response is not JSON', err);
    }
    const choice = payload?.choices?.[0];
    const rawContent = choice?.message?.content;
    const text =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
          : '';
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (err) {
        if (opts.schema) {
          throw classified('schema', 'invalid_json', 'chat content is not schema-valid JSON', err);
        }
      }
    }
    return {
      json,
      text,
      usage: payload?.usage ?? null,
      truncated: choice?.finish_reason === 'length',
    };
  }

  async function chat(messages, opts = {}) {
    return requestChat(messages, opts);
  }

  async function visionCaption(frames, opts = {}) {
    const parts = [{ type: 'text', text: opts.prompt || 'Describe this image in one sentence.' }];
    for (const frame of frames || []) {
      const url = `data:${imageMime(frame)};base64,${Buffer.from(frame).toString('base64')}`;
      parts.push({ type: 'image_url', image_url: { url } });
    }
    const result = await requestChat([{ role: 'user', content: parts }], {
      ...opts,
      schema: undefined,
    });
    return { text: result.text, usage: result.usage, truncated: result.truncated };
  }

  /**
   * Multipart ASR. The escape prompt is fixed and always present: callers
   * cannot omit it (llmAdapter.md §2.3); a caller prompt is APPENDED, never a
   * replacement.
   */
  async function asrTranscribe(audioBuffer, opts = {}) {
    if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
      throw classified('config', 'multipart_unavailable', 'FormData/Blob are unavailable');
    }
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    form.append('file', blob, opts.filename || 'audio.wav');
    form.append('model', model);
    form.append('response_format', 'json');
    const prompt = isSet(opts.prompt) ? `${ESCAPE_PROMPT}\n${opts.prompt}` : ESCAPE_PROMPT;
    form.append('prompt', prompt);

    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        : undefined;
    let response;
    try {
      response = await doFetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: headers(),
        body: form,
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (err && typeof err.class === 'string') throw err;
      throw classifyLlmError(err);
    }
    if (!response.ok) {
      let text = '';
      try {
        text = await response.text();
      } catch {
        /* empty */
      }
      const err = new Error(
        `/audio/transcriptions HTTP ${response.status}${text ? `: ${String(text).slice(0, 300)}` : ''}`
      );
      err.status = response.status;
      throw classifyLlmError(err);
    }
    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw classified('schema', 'invalid_json', 'transcription response is not JSON', err);
    }
    return { text: String(payload?.text ?? ''), usage: payload?.usage ?? null };
  }

  return {
    spec,
    embed,
    embedQuery,
    embedMedia,
    embedWrappedText,
    chat,
    visionCaption,
    asrTranscribe,
  };
}

module.exports = { createOpenAiCompatibleClient, ESCAPE_PROMPT, applyPrefix };
