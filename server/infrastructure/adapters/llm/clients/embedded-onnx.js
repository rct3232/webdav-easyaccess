'use strict';

/**
 * Embedded ONNX client (T1.0a — llmAdapter.md §2.1 peers, llmPresets.md §2.3).
 *
 * In-process transformers.js client for the built-in embed provider. Lazy
 * require of `@huggingface/transformers` so unit tests and boot paths without
 * provisioned weights never pay the module load. dtype q4 (lockfile), mean
 * pooling attention-mask weighted + L2 normalize — cls pooling mis-shapes the
 * plain-text space silently (§16/§4.2), so pooling is fixed HERE by
 * construction. Text inputs carry the profile task prefixes; media takes no
 * prefix (media riding processor objects is the V1/V3 pipeline's concern).
 *
 * Arithmetic parity: identical to the Q12/δ_base calibration harness
 * (positive control median-cos 1.000000 against eg2-reference-kit.json).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { isEmbedModelDisabled } = require('../provision');

let transformers = null;

function getTransformers() {
  if (!transformers) {
    // Lazy require: avoids loading onnxruntime-node when the engine is unused.
    transformers = require('@huggingface/transformers');
  }
  return transformers;
}

function mediaError(reason, message, cause) {
  const err = new Error(message);
  err.class = 'config';
  err.reason = reason;
  if (cause) err.cause = cause;
  return err;
}
function docPrefix(text) {
  return `title: none | text: ${text}`;
}

function queryPrefix(text) {
  return `task: search result | query: ${text}`;
}

let cachedPipeline = null;
let cachedProcessor = null;

/**
 * Loads tokenizer + model (q4) from the provisioned local weights dir.
 *
 * Uses the ABSOLUTE local path to the revision directory with `env.useFS=true`
 * and remote loading disabled — transformers.js reads the files directly from
 * disk (the exact layout the provisioner installs: `<modelDir>/<repo>/<revision>/…`).
 * This bypasses the hub cache-key layer, whose tokenizer discovery probes
 * remote HEAD requests when only a repo id + revision is given (would break the
 * zero-egress guarantee for air-gapped installs).
 */
async function loadEngine({ modelDir, lock }) {
  if (isEmbedModelDisabled()) {
    throw mediaError('embed_disabled', 'built-in embed model disabled (WEA_SKIP_EMBED_MODEL)');
  }
  if (cachedPipeline) return cachedPipeline;
  const t = getTransformers();
  t.env.useFS = true;
  t.env.allowLocalModels = true;
  t.env.allowRemoteModels = false;

  const localPath = path.join(modelDir, lock.repo, lock.revision);
  const tokenizer = await t.AutoTokenizer.from_pretrained(localPath);
  const model = await t.AutoModel.from_pretrained(localPath, { dtype: lock.dtype });
  cachedPipeline = { tokenizer, model, localPath };
  return cachedPipeline;
}

/**
 * Multimodal processor (`AutoProcessor`) cached alongside the text engine.
 * The sentence-transformer processor maps media to the SAME model input shape
 * as text, so media and documents share one embedding space.
 */
async function loadProcessor({ modelDir, lock }) {
  if (cachedProcessor) return cachedProcessor;
  const { localPath } = await loadEngine({ modelDir, lock });
  const t = getTransformers();
  cachedProcessor = await t.AutoProcessor.from_pretrained(localPath);
  return cachedProcessor;
}

/** Attention-mask-weighted mean pooling + L2 normalize (q4 calibration harness parity). */
function poolNormalize(lastHiddenState, attentionMask) {
  const [B, S, H] = lastHiddenState.dims;
  const mask = attentionMask.data;
  const out = new Float32Array(B * H);
  for (let b = 0; b < B; b++) {
    let n = 0;
    for (let s = 0; s < S; s++) {
      if (Number(mask[b * S + s]) === 0) continue;
      const off = b * S * H + s * H;
      const ob = b * H;
      for (let h = 0; h < H; h++) out[ob + h] += lastHiddenState.data[off + h];
      n++;
    }
    if (n === 0) n = 1;
    const ob = b * H;
    let norm = 0;
    for (let h = 0; h < H; h++) {
      out[ob + h] /= n;
      norm += out[ob + h] * out[ob + h];
    }
    norm = Math.sqrt(norm) || 1;
    for (let h = 0; h < H; h++) out[ob + h] /= norm;
  }
  return { vectors: out, batch: B, dim: H };
}

/**
 * Embeds texts with the document prefix, batched. Returns array of Float32Array
 * (unit-norm, dim from the model — 768).
 */
async function embedDocuments(texts, { modelDir, lock, batchSize = 8 } = {}) {
  const { tokenizer, model } = await loadEngine({ modelDir, lock });
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(docPrefix);
    const enc = await tokenizer(batch, { padding: true, truncation: true });
    const res = await model(enc);
    const { vectors, batch: B, dim } = poolNormalize(res.last_hidden_state, enc.attention_mask);
    for (let b = 0; b < B; b++) out.push(vectors.slice(b * dim, (b + 1) * dim));
  }
  return out;
}

/**
 * Probe-only TEXT control (no prefix) through the text encoder, truncated to a
 * bounded window. Used by the media positive controls to prove that media was
 * consumed instead of being embedded as text.
 */
async function embedControlText(text, { modelDir, lock, maxLength = 512 } = {}) {
  const { tokenizer, model } = await loadEngine({ modelDir, lock });
  const enc = await tokenizer([String(text ?? '')], {
    padding: true,
    truncation: true,
    max_length: maxLength,
  });
  const res = await model(enc);
  const { vectors, dim } = poolNormalize(res.last_hidden_state, enc.attention_mask);
  return vectors.slice(0, dim);
}

/**
 * Embeds a query with the query prefix. Single string in, single vector out.
 */
async function embedQuery(text, { modelDir, lock } = {}) {
  const { tokenizer, model } = await loadEngine({ modelDir, lock });
  const enc = await tokenizer([queryPrefix(text)], { padding: true, truncation: true });
  const res = await model(enc);
  const { vectors, dim } = poolNormalize(res.last_hidden_state, enc.attention_mask);
  return vectors.slice(0, dim);
}

/**
 * Media primitives (llmAdapter.md §2.3 `embedMedia`, §2.6 MEDIA ladder).
 * The processor expands each media item into the model's soft tokens and the
 * text encoder returns the same `sentence_embedding` the text path uses. No
 * text prefix is applied on media.
 */

function sentenceVector(result) {
  const tensor = result && result.sentence_embedding;
  if (!tensor || !tensor.data || tensor.data.length === 0) {
    throw mediaError('invalid_media_embedding', 'model returned no sentence_embedding');
  }
  return Float32Array.from(tensor.data);
}

/** Read a RIFF/WAVE PCM16 buffer → mono Float32Array at 16 kHz. */
function decodeWav(buffer) {
  if (!buffer || buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = buffer.subarray(offset + 8, offset + 8 + size);
    if (id === 'fmt ') fmt = body;
    if (id === 'data') data = body;
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) return null;
  const channels = fmt.readUInt16LE(2);
  const sampleRate = fmt.readUInt32LE(4);
  const bits = fmt.readUInt16LE(14);
  if (bits !== 16 || channels < 1) return null;
  const frames = Math.floor(data.length / (2 * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE((i * channels + c) * 2);
    mono[i] = sum / (channels * 32768);
  }
  return resampleLinear(mono, sampleRate, 16000);
}

function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const frac = position - left;
    out[i] = samples[left] * (1 - frac) + samples[right] * frac;
  }
  return out;
}

/**
 * Decoder/normalizer seam: WAV is decoded in-process; compressed inputs are
 * converted by ffmpeg to mono 16 kHz s16le on stdin/stdout.
 */
function decodeAudioToMono16k(buffer) {
  const wav = decodeWav(buffer);
  if (wav) return wav;
  try {
    const raw = execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-f',
        's16le',
        '-ac',
        '1',
        '-ar',
        '16000',
        'pipe:1',
      ],
      { input: buffer, maxBuffer: 64 * 1024 * 1024 }
    );
    const frames = Math.floor(raw.length / 2);
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) out[i] = raw.readInt16LE(i * 2) / 32768;
    return out;
  } catch (err) {
    throw mediaError('audio_decode_failed', 'unable to decode audio to mono 16 kHz', err);
  }
}

/** Local 1 fps video frame sampling (embedded provider — no server `ub` wall). */
function extractVideoFrames(buffer, { fps = 1, maxFrames = 8 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wea-video-'));
  try {
    const input = path.join(dir, 'input.bin');
    fs.writeFileSync(input, buffer);
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        input,
        '-vf',
        `fps=${fps},scale='min(512,iw)':-2`,
        '-frames:v',
        String(maxFrames),
        path.join(dir, 'frame-%03d.jpg'),
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );
    return fs
      .readdirSync(dir)
      .filter((name) => /^frame-\d+\.jpg$/.test(name))
      .sort()
      .map((name) => fs.readFileSync(path.join(dir, name)));
  } catch (err) {
    throw mediaError('video_decode_failed', 'unable to sample video frames', err);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Embeds media buffers (one vector per buffer) in the model's shared space.
 * `mediaType` ∈ image | audio | video. Video buffers are sampled at 1 fps and
 * ride the image/frame path (`processor(null, frames)`).
 *
 * @returns {Promise<Float32Array[]>} unit-norm sentence embeddings
 */
async function embedMedia(buffers, { mediaType, modelDir, lock } = {}) {
  const { model } = await loadEngine({ modelDir, lock });
  const processor = await loadProcessor({ modelDir, lock });
  const t = getTransformers();
  const list = Array.isArray(buffers) ? buffers : [];
  const out = [];

  for (const buffer of list) {
    let inputs;
    if (mediaType === 'image') {
      const image = await t.RawImage.fromBlob(new Blob([buffer]));
      inputs = await processor(null, image);
    } else if (mediaType === 'audio') {
      const audio = decodeAudioToMono16k(buffer);
      inputs = await processor(null, null, audio);
    } else if (mediaType === 'video') {
      const frames = extractVideoFrames(buffer);
      if (frames.length === 0) {
        throw mediaError('video_no_frames', 'video sampling produced no frames');
      }
      const images = await Promise.all(
        frames.map((frame) => t.RawImage.fromBlob(new Blob([frame])))
      );
      inputs = await processor(null, images);
    } else {
      throw mediaError('unsupported_media_type', `unsupported media type '${mediaType}'`);
    }
    const result = await model(inputs);
    out.push(sentenceVector(result));
  }
  return out;
}

/** Positive control: median cosine of kit strings against the stored canonical vectors. */
async function positiveControl({ modelDir, lock, kitPath }) {
  const kit = JSON.parse(require('fs').readFileSync(kitPath, 'utf8'));
  const got = await embedDocuments(kit.strings, { modelDir, lock, batchSize: 8 });
  const stored = kit.vectors.map((b64) => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  });
  const cos = got.map((v, i) => {
    let d = 0;
    for (let h = 0; h < v.length; h++) d += v[h] * stored[i][h];
    return d;
  });
  const sorted = cos.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { median, min: Math.min(...cos), dim: got[0].length };
}

module.exports = {
  embedDocuments,
  embedQuery,
  embedControlText,
  embedMedia,
  positiveControl,
  loadEngine,
  loadProcessor,
  decodeAudioToMono16k,
  extractVideoFrames,
  docPrefix,
  queryPrefix,
};
