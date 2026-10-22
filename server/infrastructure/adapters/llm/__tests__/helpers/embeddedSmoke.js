'use strict';

/**
 * Child-process runner for the embedded multimodal smoke test.
 *
 * The real ONNX inference runs OUTSIDE the Jest VM realm: transformers.js
 * validates typed arrays with `instanceof` against the realm's globals, and a
 * typed array created across the VM boundary is rejected. Running this script
 * with plain `node` keeps the model/processor/tensors in one realm while the
 * Jest test only asserts the JSON result.
 */

const path = require('path');
const onnx = require('../../clients/embedded-onnx');
const provisioner = require('../../provision');
const { runEmbedMediaProbes } = require('../../mediaProbe');

const MODEL_DIR = process.env.WEA_MODEL_DIR || path.join('/tmp/opencode', 'delta-base', 'models');
const lock = provisioner.loadLock();

(async () => {
  const results = await runEmbedMediaProbes({
    async embed(texts) {
      const vectors = await onnx.embedDocuments(texts, { modelDir: MODEL_DIR, lock });
      return { vectors, dim: vectors[0] ? vectors[0].length : lock.dim };
    },
    async embedMedia(buffers, opts = {}) {
      const vectors = await onnx.embedMedia(buffers, {
        mediaType: opts.mediaType,
        modelDir: MODEL_DIR,
        lock,
      });
      return { vectors, dim: vectors[0] ? vectors[0].length : lock.dim };
    },
    async embedWrappedText(text) {
      const vector = await onnx.embedControlText(text, { modelDir: MODEL_DIR, lock });
      return { vectors: [vector], dim: vector.length };
    },
  });
  process.stdout.write(JSON.stringify(results));
})().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
