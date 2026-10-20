'use strict';

/**
 * Cliente embedded ONNX (T1.0a — llmAdapter.md §2.1 peers, llmPresets.md §2.3).
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

const path = require('path');

let transformers = null;

function getTransformers() {
  if (!transformers) {
    // Lazy require: evita carregar onnxruntime-node quando o engine não é usado.
    transformers = require('@huggingface/transformers');
  }
  return transformers;
}
function docPrefix(text) {
  return `title: none | text: ${text}`;
}

function queryPrefix(text) {
  return `task: search result | query: ${text}`;
}

let cachedPipeline = null;

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
  if (cachedPipeline) return cachedPipeline;
  const t = getTransformers();
  t.env.useFS = true;
  t.env.allowLocalModels = true;
  t.env.allowRemoteModels = false;

  const localPath = path.join(modelDir, lock.repo, lock.revision);
  const tokenizer = await t.AutoTokenizer.from_pretrained(localPath);
  const model = await t.AutoModel.from_pretrained(localPath, { dtype: lock.dtype });
  cachedPipeline = { tokenizer, model };
  return cachedPipeline;
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
 * Embeds a query with the query prefix. Single string in, single vector out.
 */
async function embedQuery(text, { modelDir, lock } = {}) {
  const { tokenizer, model } = await loadEngine({ modelDir, lock });
  const enc = await tokenizer([queryPrefix(text)], { padding: true, truncation: true });
  const res = await model(enc);
  const { vectors, dim } = poolNormalize(res.last_hidden_state, enc.attention_mask);
  return vectors.slice(0, dim);
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
  positiveControl,
  loadEngine,
  docPrefix,
  queryPrefix,
};
