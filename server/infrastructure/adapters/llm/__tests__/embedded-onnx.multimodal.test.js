'use strict';

/**
 * Embedded multimodal smoke test (T1.9a). Slow (local ONNX inference), so it
 * is NOT part of the default CI path: it runs only when
 * `WEA_LLM_EMBEDDED_SMOKE=1` AND provisioned weights are present.
 *
 * The real inference runs in a child `node` process (helpers/embeddedSmoke.js):
 * transformers.js checks tensor data with cross-realm `instanceof`, which
 * rejects typed arrays created across the Jest VM boundary. The test asserts
 * the child's JSON result (image/audio/video positive controls).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const provisioner = require('../provision');

const MODEL_DIR = process.env.WEA_MODEL_DIR || '/tmp/opencode/delta-base/models';
const lock = provisioner.loadLock();
const modelPath = lock ? path.join(MODEL_DIR, lock.repo, lock.revision) : null;
const enabled = process.env.WEA_LLM_EMBEDDED_SMOKE === '1' && modelPath && fs.existsSync(modelPath);

const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe('embedded ONNX multimodal path (real weights)', () => {
  jest.setTimeout(120_000);

  it('image/audio/video positive controls pass with the local fixtures', () => {
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, 'helpers', 'embeddedSmoke.js')],
      {
        env: { ...process.env, WEA_MODEL_DIR: MODEL_DIR },
        timeout: 110_000,
        maxBuffer: 8 * 1024 * 1024,
      }
    );
    const results = JSON.parse(out.toString('utf8'));

    expect(results.image_embed).toMatchObject({ pass: true });
    expect(results.audio_embed).toMatchObject({ pass: true });
    expect(results.video_embed).toMatchObject({ pass: true });
    expect(results.image_embed.measurements.nearDup).toBeGreaterThanOrEqual(0.94);
    expect(results.audio_embed.measurements.distinct).toBeLessThan(0.85);
    expect(results.video_embed.measurements.sameSpace).toBeGreaterThanOrEqual(0.75);
  });
});
