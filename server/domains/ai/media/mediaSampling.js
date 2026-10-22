'use strict';

/**
 * mediaSampling — local, free media preprocessing for the AI media pipelines
 * (docs/spec/server/services/aiJobService.md §2.4, llmAdapter.md §2.6 MEDIA
 * ladder).
 *
 * Everything here is deterministic and side-effect-free apart from ffmpeg/
 * ffprobe child processes: bytes in, sampled bytes (or PCM samples) out.
 * Every temporary file lives under `os.tmpdir()` in a per-call directory that
 * is removed in a `finally` block — sampled frames and decoded audio are
 * TRANSIENT, never persisted (aiJobService §2.4 caption rule).
 *
 * The ladder arithmetic is pure and exported separately so the pipelines can
 * derive per-profile caps without spawning tools:
 *   - video: 1 fps sampling, uniform stride down to `videoFrameCap()` frames;
 *   - audio: fixed windows of `audioWindowSec()` seconds (model cap 327 s).
 *
 * Tools are injectable (`execFileImpl`) for hermetic tests; the real-ffmpeg
 * tests skip when the binaries are absent.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Operational tool wall clock — not a model-profile value. */
const DEFAULT_TOOL_TIMEOUT_MS = 30000;
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Fixed 1 fps sampling rate for the media ladder (§2.6). */
const VIDEO_FPS = 1;
/** Hard model cap for one audio window in seconds (§4.3/§2.6). */
const MAX_AUDIO_WINDOW_SEC = 327;
/** Audio sample rate the media embedding path expects (mono 16 kHz). */
const AUDIO_SAMPLE_RATE = 16000;

const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/flac': '.flac',
  'audio/ogg': '.ogg',
});

function codeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function extensionForMime(mimeType) {
  const key = String(mimeType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  return MIME_EXTENSIONS[key] || '.bin';
}

/**
 * Run a tool and resolve its stdout as a Buffer (or reject with a typed
 * `mediaToolFailed` error). `execFileImpl` is the test seam.
 */
function runTool(command, args, { execFileImpl, timeoutMs } = {}) {
  const run = execFileImpl || execFile;
  return new Promise((resolve, reject) => {
    run(
      command,
      args,
      {
        encoding: 'buffer',
        maxBuffer: MAX_TOOL_OUTPUT_BYTES,
        timeout: Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TOOL_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr && stderr.length ? `: ${String(stderr).slice(0, 300)}` : '';
          reject(
            Object.assign(codeError('mediaToolFailed', `${command} failed${detail}`), {
              cause: error,
            })
          );
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || ''));
      }
    );
  });
}

/**
 * Materialize `buffer` in a throwaway temp directory, run `fn(inputPath, dir)`,
 * then always remove the directory. Never leaves frames/audio on disk.
 */
async function withTempInput(buffer, extension, fn, { tmpRoot } = {}) {
  const root = tmpRoot || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(root, 'wea-media-'));
  try {
    const inputPath = path.join(dir, `input${extension || '.bin'}`);
    fs.writeFileSync(inputPath, buffer);
    return await fn(inputPath, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function normalizeTags(tags) {
  const out = {};
  for (const [key, value] of Object.entries(tags || {})) {
    if (value === undefined || value === null) continue;
    out[String(key).toLowerCase()] = String(value);
  }
  return out;
}

/**
 * ffprobe metadata (V0 floor + `asr` probe persistence).
 *
 * @param {Buffer} buffer media bytes
 * @param {Object} [opts]
 * @param {string} [opts.mimeType] extension hint for the temp file
 * @param {string} [opts.tmpRoot] temp root override (tests)
 * @param {Function} [opts.execFileImpl] tool seam (tests)
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{durationSec: number|null, width: number|null, height: number|null,
 *   streams: Array<Object>, tags: Object}>}
 */
async function ffprobeMedia(buffer, opts = {}) {
  const stdout = await withTempInput(
    buffer,
    extensionForMime(opts.mimeType),
    (inputPath) =>
      runTool(
        'ffprobe',
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
        opts
      ),
    opts
  );

  let payload;
  try {
    payload = JSON.parse(stdout.toString('utf8'));
  } catch (error) {
    throw Object.assign(codeError('mediaProbeFailed', 'ffprobe returned invalid JSON'), {
      cause: error,
    });
  }

  const streams = (Array.isArray(payload.streams) ? payload.streams : []).map((stream) => ({
    index: Number(stream.index),
    codecType: stream.codec_type ?? null,
    codecName: stream.codec_name ?? null,
    width: stream.width != null ? Number(stream.width) : null,
    height: stream.height != null ? Number(stream.height) : null,
    durationSec:
      stream.duration != null && Number.isFinite(Number(stream.duration))
        ? Number(stream.duration)
        : null,
    sampleRate: stream.sample_rate != null ? Number(stream.sample_rate) : null,
    channels: stream.channels != null ? Number(stream.channels) : null,
  }));

  const videoStream = streams.find((stream) => stream.codecType === 'video') || null;
  const formatDuration =
    payload.format && payload.format.duration != null ? Number(payload.format.duration) : NaN;
  const durationSec = Number.isFinite(formatDuration)
    ? formatDuration
    : (videoStream && videoStream.durationSec) || null;

  return {
    durationSec,
    width: videoStream ? videoStream.width : null,
    height: videoStream ? videoStream.height : null,
    streams,
    tags: normalizeTags(payload.format && payload.format.tags),
  };
}

/**
 * Uniform-stride 1 fps frame sampling (§2.6: `≤ cap` frames, deterministic).
 * The stride is derived from the probed duration so a long clip is sampled
 * across its WHOLE length instead of only its head.
 *
 * @param {Buffer} buffer video bytes
 * @param {Object} [opts]
 * @param {number} [opts.maxFrames=4] profile-derived frame cap
 * @param {number} [opts.fps=1]
 * @param {number|null} [opts.durationSec] pre-probed duration (skips ffprobe)
 * @param {number} [opts.maxWidth=512] longest-edge guard for the image path
 * @returns {Promise<Buffer[]>} JPEG frames, transient
 */
async function sampleVideoFrames(buffer, opts = {}) {
  const maxFrames = Math.max(1, Math.floor(Number(opts.maxFrames) || 4));
  const fps = Number(opts.fps) > 0 ? Number(opts.fps) : VIDEO_FPS;
  const maxWidth = Number(opts.maxWidth) > 0 ? Number(opts.maxWidth) : 512;

  let durationSec = Number(opts.durationSec);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    const probe = await ffprobeMedia(buffer, opts);
    durationSec = Number(probe.durationSec);
  }
  const totalFrames =
    Number.isFinite(durationSec) && durationSec > 0
      ? Math.max(1, Math.ceil(durationSec * fps))
      : maxFrames;
  const stride = Math.max(1, Math.ceil(totalFrames / maxFrames));

  return withTempInput(
    buffer,
    extensionForMime(opts.mimeType),
    async (inputPath, dir) => {
      const pattern = path.join(dir, 'frame-%03d.jpg');
      const filter = `fps=${fps},select='not(mod(n\\,${stride}))',scale='min(${maxWidth},iw)':-2`;
      await runTool(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          inputPath,
          '-vf',
          filter,
          '-frames:v',
          String(maxFrames),
          '-q:v',
          '3',
          pattern,
        ],
        opts
      );
      return fs
        .readdirSync(dir)
        .filter((name) => /^frame-\d+\.jpg$/.test(name))
        .sort()
        .map((name) => fs.readFileSync(path.join(dir, name)));
    },
    opts
  );
}

/**
 * Decode any audio container to mono 16 kHz Float32 samples
 * (`ffmpeg -f f32le`). Compressed and WAV inputs take the same path so the
 * embedding client always receives normalized PCM.
 *
 * @param {Buffer} buffer audio bytes
 * @returns {Promise<Float32Array>}
 */
async function decodeAudioToMono16k(buffer, opts = {}) {
  const stdout = await withTempInput(
    buffer,
    extensionForMime(opts.mimeType),
    (inputPath) =>
      runTool(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          inputPath,
          '-f',
          'f32le',
          '-ac',
          '1',
          '-ar',
          String(AUDIO_SAMPLE_RATE),
          'pipe:1',
        ],
        opts
      ),
    opts
  );
  const samples = new Float32Array(Math.floor(stdout.length / 4));
  for (let i = 0; i < samples.length; i++) samples[i] = stdout.readFloatLE(i * 4);
  return samples;
}

/** Fixed-size PCM windows: the audio segment set of the media ladder. */
function audioWindows(samples, { windowSec } = {}) {
  const list = samples || new Float32Array(0);
  const seconds =
    Number(windowSec) > 0
      ? Math.min(Number(windowSec), MAX_AUDIO_WINDOW_SEC)
      : MAX_AUDIO_WINDOW_SEC;
  const windowSamples = Math.max(1, Math.round(seconds * AUDIO_SAMPLE_RATE));
  const out = [];
  for (let start = 0; start < list.length; start += windowSamples) {
    out.push(list.slice(start, Math.min(list.length, start + windowSamples)));
  }
  return out;
}

/** Mono 16 kHz PCM16 WAV — the wire form of one audio segment. */
function encodeWavMono16k(samples) {
  const frames = samples ? samples.length : 0;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  buffer.writeUInt32LE(AUDIO_SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

/**
 * Video frame cap for one embed call: `budgetTokens / mediaTokenCost.videoFrame`
 * (embedded provider: the model window; remote: the server budget from the
 * profile chain — llmAdapter §2.5/§2.6).
 */
function videoFrameCap({ budgetTokens, mediaTokenCost } = {}) {
  const perFrame = Number(mediaTokenCost && mediaTokenCost.videoFrame);
  const budget = Number(budgetTokens);
  if (!Number.isFinite(perFrame) || perFrame <= 0) return 1;
  if (!Number.isFinite(budget) || budget <= 0) return 1;
  return Math.max(1, Math.floor(budget / perFrame));
}

/**
 * Audio window length for one embed call: `min(budget / audioPerSec, 327 s)`.
 */
function audioWindowSec({ budgetTokens, mediaTokenCost } = {}) {
  const perSec = Number(mediaTokenCost && mediaTokenCost.audioPerSec);
  const budget = Number(budgetTokens);
  if (!Number.isFinite(perSec) || perSec <= 0) return MAX_AUDIO_WINDOW_SEC;
  if (!Number.isFinite(budget) || budget <= 0) return MAX_AUDIO_WINDOW_SEC;
  return Math.min(budget / perSec, MAX_AUDIO_WINDOW_SEC);
}

const MUSIC_TAG_KEYS = Object.freeze(['artist', 'album', 'genre', 'composer', 'track']);
const SPOKEN_GENRE = /speech|spoken|audiobook|podcast|lecture|sermon|interview/i;

/**
 * `media_kind` from METADATA only (aiJobService §2.4 asr rule): an explicit
 * `media_kind` tag, a musical genre tag, or artist/album/composer/track
 * container tags mark the file as `music`; everything else is null. No
 * generated genre/mood/kind fields exist anywhere in the pipeline.
 *
 * @returns {'music'|null}
 */
function detectMediaKind(probe) {
  const tags = normalizeTags(probe && probe.tags);
  const explicit = String(tags.media_kind || tags.media_kind_tag || '').toLowerCase();
  if (explicit === 'music') return 'music';
  if (tags.genre && !SPOKEN_GENRE.test(tags.genre)) return 'music';
  if (MUSIC_TAG_KEYS.some((key) => key !== 'genre' && tags[key])) return 'music';
  return null;
}

module.exports = {
  DEFAULT_TOOL_TIMEOUT_MS,
  VIDEO_FPS,
  MAX_AUDIO_WINDOW_SEC,
  AUDIO_SAMPLE_RATE,
  extensionForMime,
  ffprobeMedia,
  sampleVideoFrames,
  decodeAudioToMono16k,
  audioWindows,
  encodeWavMono16k,
  videoFrameCap,
  audioWindowSec,
  detectMediaKind,
};
