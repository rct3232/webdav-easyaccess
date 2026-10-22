'use strict';

/**
 * Provisionador do built-in embed engine (T1.0a — llmAdapter.md §2.1,
 * llmPresets.md §2.2/§2.3, bootSequence.md §2 step 8b).
 *
 * Posturas (provider-triggered, PLAN §22):
 *  - Setup mode (setup_complete=false) ⇒ NO attempt: zero bytes, zero egress.
 *  - Configured boot + built-in active ⇒ BLOCKING attempt before listen, with
 *    per-file CLI progress, atomic staging, sha256 verification; failure ⇒
 *    warn-only, embed caps OFF + admin reason, boot continues (never throws).
 *  - Remote embed override active ⇒ DEFERRED — no attempt, no caps-off signal
 *    (absence of weights is the normal state; the role runs on the override).
 *  - Remote override clear ⇒ IN-PLACE run, restart-free: server keeps serving,
 *    the role reports `preparing(phase='provisioning', progress)` during the
 *    run; consumers park and drain once the role flips configured (§22-6).
 *  - Weights present (WEA_MODEL_DIR pre-seed or previously provisioned) ⇒
 *    status 'present': zero download attempts, zero network egress.
 *  - Switching to remote NEVER deletes existing weights.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataDir } = require('../../../utils/paths');

const LOCK_PATH = path.join(__dirname, 'model.lock.json');

/**
 * Weights tree root: `<modelDir>/<repo>/<revision>` — the HF snapshot layout
 * the ONNX client reads directly from disk (embedded-onnx `loadEngine`).
 * A lock WITHOUT repo/revision (test fixtures) falls back to the flat
 * `<modelDir>` form.
 */
function weightsRoot(modelDir, lock) {
  return lock.repo && lock.revision ? path.join(modelDir, lock.repo, lock.revision) : modelDir;
}

function loadLock(lockPath = LOCK_PATH) {
  const raw = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(raw);
  if (!lock.repo || !lock.revision || !lock.dtype) {
    throw new Error('model.lock.json inválido: campos obrigatórios ausentes (repo/revision/dtype)');
  }
  if (!Array.isArray(lock.files) || lock.files.length === 0) {
    throw new Error('model.lock.json inválido: lista de files vazia');
  }
  for (const f of lock.files) {
    if (!f.path || !/^[0-9a-f]{64}$/.test(f.sha256 || '') || !f.size) {
      throw new Error(`model.lock.json inválido: entrada de arquivo incompleta (${f.path || '?'})`);
    }
  }
  return lock;
}

/**
 * Resolves the weights directory: WEA_MODEL_DIR (operator pre-seed) wins;
 * otherwise the default data dir is used.
 */
function resolveModelDir(env = process.env) {
  const envDir = env.WEA_MODEL_DIR;
  if (envDir && String(envDir).trim() !== '') return path.resolve(envDir);
  return path.join(getDataDir(), 'modelos');
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Verifies every lock file exists with matching size and sha256.
 * Missing/truncated/corrupted files ⇒ false (weights not usable).
 */
async function weightsPresent(dir, lock) {
  const root = weightsRoot(dir, lock);
  if (!fs.existsSync(root)) return false;
  for (const f of lock.files) {
    const filePath = path.join(root, f.path);
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size !== f.size) return false;
    const hash = await sha256File(filePath);
    if (hash !== f.sha256) return false;
  }
  return true;
}

/* eslint-disable no-console -- provisionamento emite progresso CLI no boot (idioma de server/index.js) */
function defaultLogger() {
  return {
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
  };
}

/**
 * Default production fetcher: the pinned Hugging Face revision endpoint
 * (`https://huggingface.co/<repo>/resolve/<revision>/<path>`). The `fetcher`
 * runProvision param stays the test seam (fake buffers, sha256-corruption
 * cases); production boot/in-place triggers resolve through this one, so a
 * missing weights dir can actually complete the blocking attempt instead of
 * failing with a null dereference.
 */
function defaultFetcher() {
  return {
    async fetchBuffer(repo, revision, filePath) {
      const url = `https://huggingface.co/${repo}/resolve/${revision}/${filePath}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HF fetch ${response.status} for ${filePath}`);
      }
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

/**
 * Runs one provisioning attempt: downloads each lock file into an atomic
 * staging dir (temp file + rename into the final tree only after sha256
 * verification), with per-file CLI progress.
 */
async function provisionWeights({ modelDir, lock, fetcher, logger, corruptFile = null }) {
  const download = fetcher || defaultFetcher();
  fs.mkdirSync(modelDir, { recursive: true });
  const root = weightsRoot(modelDir, lock);
  const stagingDir = fs.mkdtempSync(path.join(path.dirname(modelDir), '.staging-'));
  const total = lock.files.length;

  try {
    for (let i = 0; i < total; i++) {
      const file = lock.files[i];
      const progress = `${i}/${total} arquivos`;
      logger.log(`[provisionamento] Baixando ${file.path} (${progress})`);

      let buffer = await download.fetchBuffer(lock.repo, lock.revision, file.path);
      if (corruptFile === file.path) {
        buffer = Buffer.from(buffer);
        buffer[0] = buffer[0] ^ 0xff;
      }

      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      if (hash !== file.sha256) {
        throw new Error(
          `sha256 mismatch em ${file.path} (esperado ${file.sha256}, obtido ${hash})`
        );
      }
      if (buffer.length !== file.size) {
        throw new Error(
          `tamanho divergente em ${file.path} (esperado ${file.size}, obtido ${buffer.length})`
        );
      }

      // atomic: write to staging temp file, then rename into the final tree
      const tmpFile = path.join(stagingDir, `${i}.tmp`);
      fs.writeFileSync(tmpFile, buffer);
      const finalPath = path.join(root, file.path);
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.renameSync(tmpFile, finalPath);
    }
    logger.log(
      `[provisionamento] Concluído: ${total}/${total} arquivos verificados em ${modelDir}`
    );
    return { ok: true };
  } catch (err) {
    logger.error(`[provisionamento] Falha: ${err.message}`);
    return { ok: false, reason: err.message };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Main entry: provider-triggered provisioning (llmAdapter §2.1, llmPresets §2.3,
 * bootSequence §2 step 8b, PLAN §22).
 *
 * @param {Object} params
 * @param {'boot'|'in-place'} params.mode            boot = blocking; in-place = server keeps serving
 * @param {boolean} params.setupComplete             setup_complete flag (false = setup mode ⇒ no attempt)
 * @param {boolean} params.remoteOverrideActive      enabled remote embed override row present
 * @param {string} [params.modelDir]                 weights dir (defaults to WEA_MODEL_DIR / data dir)
 * @param {Object} [params.lock]                     lock override (tests); default = checked-in model.lock.json
 * @param {Object} [params.health]                   backendHealth instance for preparing reports
 * @param {Object} [params.fetcher]                  { fetchBuffer(repo, revision, path) } seam — no real HTTP in tests
 * @param {Object} [params.logger]                   { log, warn, error }
 * @param {string} [params.corruptFile]              test-only: corrupt one fixture file to force sha256 failure
 * @returns {Promise<{status: 'provisioned'|'present'|'skipped-setup'|'skipped-remote'|'failed', reason?: string}>}
 */
async function runProvision(params = {}) {
  const {
    setupComplete = true,
    remoteOverrideActive = false,
    modelDir,
    lock: lockOverride,
    health = null,
    fetcher = null,
    logger = defaultLogger(),
    corruptFile = null,
  } = params;

  const lock = lockOverride || loadLock();

  // Posture 1 (PLAN §22-5): setup mode never downloads — zero bytes, zero egress.
  if (!setupComplete) {
    logger.log(
      '[provisionamento] Setup mode: provisionamento não iniciado (aguarda o próximo boot configurado).'
    );
    return { status: 'skipped-setup' };
  }

  // Posture 2 (PLAN §22-1): remote override active ⇒ deferred, absence is normal,
  // never a caps-off signal. Weights are never deleted.
  if (remoteOverrideActive) {
    logger.log(
      '[provisionamento] Override remoto de embed ativo: provisionamento embutido diferido.'
    );
    return { status: 'skipped-remote' };
  }

  const dir = modelDir || resolveModelDir();
  const key = 'ai.embed';

  // Posture 4 (PLAN §22-3): pre-existing weights ⇒ idempotent no-op, zero egress.
  if (await weightsPresent(dir, lock)) {
    logger.log(`[provisionamento] Pesos já presentes em ${dir} — nenhum download necessário.`);
    if (health) health.report(key, { ok: true });
    return { status: 'present' };
  }

  // Posture 3 (PLAN §22-2/§22-6): while the attempt runs, the role is NOT
  // configured — report preparing so consumers park and drain once configured.
  if (health) {
    health.report(key, {
      preparing: true,
      phase: 'provisioning',
      progress: `0/${lock.files.length} arquivos`,
    });
  }

  const outcome = await provisionWeights({ modelDir: dir, lock, fetcher, logger, corruptFile });

  if (!outcome.ok) {
    // Posture 5 / llmAdapter §2.8 `provisioning` class: warn-only, boot
    // continues / server keeps serving; embed caps OFF + admin reason.
    logger.warn(
      `[provisionamento] Falha no provisionamento: ${outcome.reason} — embed permanece OFF (caps-off).`
    );
    if (health) {
      health.report(key, {
        ok: false,
        code: 'unknown',
        reason: outcome.reason,
        hint: 'ai.provisionFailed',
      });
    }
    return { status: 'failed', reason: outcome.reason };
  }

  if (health) health.report(key, { ok: true });
  return { status: 'provisioned' };
}

module.exports = { loadLock, resolveModelDir, weightsPresent, runProvision };
