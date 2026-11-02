'use strict';

/**
 * Media capability probes with POSITIVE CONTROLS (llmAdapter.md §2.4,
 * AI_FEATURE_PLAN §4.21/§4.23.2).
 *
 * Every sample is real in-domain material shipped under `__tests__/fixtures`
 * (a real photo, its re-encode, a real ALSA speech clip at 16 kHz mono, and a
 * 1 fps clip generated from the photo). Synthetic sine tones are never a pass
 * criterion; noise is used only as the audio NEGATIVE control.
 *
 * Failure isolation: each sub-capability returns its own verdict, so a failed
 * media probe switches ONLY that capability OFF — `text_embed` is published
 * separately by the adapter and never blocked here.
 *
 * Thresholds (provisional release flags, documented in llmPresets §2.3):
 *   - image near-dup (photo vs re-encode): cos ≥ 0.94 (flag-only media band)
 *   - image vs base64-as-text divergence: cos < 0.90 (pixels were consumed)
 *   - image vs empty/control divergence: cos < 0.99 (input-shaping control)
 *   - audio speech vs noise distinctness: cos < 0.85
 *   - video frame-sampled vs image path: cos ≥ 0.75 (same space)
 */

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, '__tests__', 'fixtures');

const IMAGE_NEAR_DUP_FLOOR = 0.94;
const IMAGE_TEXT_DIVERGENCE_MAX = 0.9;
const IMAGE_CONTROL_DIVERGENCE_MAX = 0.99;
const AUDIO_DISTINCT_MAX = 0.85;
const VIDEO_IMAGE_MIN = 0.75;
const VISION_CAPTION_MIN_CHARS = 12;
const ASR_EXPECTED_WORDS = ['front', 'center'];

const FIXTURES = Object.freeze({
  photo: path.join(FIXTURE_DIR, 'photo.jpg'),
  photoReencode: path.join(FIXTURE_DIR, 'photo-reencode.jpg'),
  speech: path.join(FIXTURE_DIR, 'speech.wav'),
  video: path.join(FIXTURE_DIR, 'video.mp4'),
});

function readFixture(key) {
  return fs.readFileSync(FIXTURES[key]);
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

/** Deterministic noise negative control (NEVER a pass criterion, §2.4). */
function makeNoise(length, seed = 12345) {
  const out = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((state / 0x7fffffff) * 2 - 1) * 0.1;
  }
  return out;
}

/** Encode mono Float32 samples as a 16-bit PCM WAV buffer (probe control). */
function encodeWav(samples, sampleRate = 16000) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

function wavMonoSamples(buffer) {
  if (!buffer || buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
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
  if (!fmt || !data || fmt.readUInt16LE(14) !== 16) return null;
  const channels = fmt.readUInt16LE(2);
  const frames = Math.floor(data.length / (2 * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = data.readInt16LE(i * channels * 2) / 32768;
  return out;
}

function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstVector(result) {
  if (!result || !Array.isArray(result.vectors) || !result.vectors[0]) {
    throw new Error('embedding probe returned no vector');
  }
  return result.vectors[0];
}

function failure(capability, reason, measurements = {}) {
  return { capability, pass: false, reason, measurements };
}

function success(capability, measurements = {}) {
  return { capability, pass: true, reason: null, measurements };
}

/**
 * Image / audio / video sub-probes. `embed` and `embedMedia` are role-client
 * methods; `embedWrappedText` is the optional same-wrapper TEXT control that
 * catches a media-dropping endpoint.
 */
async function runEmbedMediaProbes({
  embed,
  embedMedia,
  embedWrappedText = null,
  captionImage = null,
} = {}) {
  const results = {};

  // ── image_embed ──────────────────────────────────────────────────────────
  try {
    const photo = await embedMedia([readFixture('photo')], { mediaType: 'image' });
    const reencode = await embedMedia([readFixture('photoReencode')], {
      mediaType: 'image',
    });
    const photoVector = firstVector(photo);
    const reencodeVector = firstVector(reencode);
    const nearDup = cosine(photoVector, reencodeVector);

    const textControl = embedWrappedText
      ? await embedWrappedText(readFixture('photo').toString('base64'))
      : await embed([readFixture('photo').toString('base64')]);
    const textCos = cosine(photoVector, firstVector(textControl));

    const emptyControl = embedWrappedText ? await embedWrappedText('') : await embed(['']);
    const emptyCos = cosine(photoVector, firstVector(emptyControl));

    const measurements = { nearDup, textCos, emptyCos };
    if (nearDup < IMAGE_NEAR_DUP_FLOOR) {
      results.image_embed = failure('image_embed', 'image_near_dup', measurements);
    } else if (textCos >= IMAGE_TEXT_DIVERGENCE_MAX) {
      results.image_embed = failure('image_embed', 'image_text_not_divergent', measurements);
    } else if (emptyCos >= IMAGE_CONTROL_DIVERGENCE_MAX) {
      results.image_embed = failure('image_embed', 'image_input_ignored', measurements);
    } else {
      let captionOk = true;
      if (typeof captionImage === 'function') {
        try {
          const caption = await captionImage([readFixture('photo')]);
          const captionCos = cosine(photoVector, firstVector(await embed([caption.text])));
          const unrelatedCos = cosine(
            photoVector,
            firstVector(await embed(['a quarterly financial spreadsheet']))
          );
          measurements.captionCos = captionCos;
          measurements.unrelatedCos = unrelatedCos;
          captionOk = captionCos > unrelatedCos;
        } catch {
          captionOk = false;
        }
      }
      results.image_embed = captionOk
        ? success('image_embed', measurements)
        : failure('image_embed', 'image_caption_mismatch', measurements);
    }
  } catch (err) {
    results.image_embed = failure(
      'image_embed',
      err?.reason || err?.class || 'image_probe_failed',
      {
        error: err?.message || String(err),
      }
    );
  }

  // ── audio_embed ──────────────────────────────────────────────────────────
  try {
    const speechBuffer = readFixture('speech');
    const speech = await embedMedia([speechBuffer], { mediaType: 'audio' });
    const speechSamples = wavMonoSamples(speechBuffer) || new Float32Array(16000);
    const noiseSamples = makeNoise(speechSamples.length);
    const noise = await embedMedia([encodeWav(noiseSamples)], { mediaType: 'audio' });
    const distinct = cosine(firstVector(speech), firstVector(noise));
    const measurements = { distinct };
    results.audio_embed =
      distinct < AUDIO_DISTINCT_MAX
        ? success('audio_embed', measurements)
        : failure('audio_embed', 'audio_not_distinct', measurements);
  } catch (err) {
    results.audio_embed = failure(
      'audio_embed',
      err?.reason || err?.class || 'audio_probe_failed',
      {
        error: err?.message || String(err),
      }
    );
  }

  // ── video_embed ──────────────────────────────────────────────────────────
  try {
    // Video rides the image/frame path; an image probe that failed its
    // positive controls cannot certify the video path either.
    if (!results.image_embed || !results.image_embed.pass) {
      throw Object.assign(new Error('image positive controls failed'), {
        reason: 'image_probe_failed',
      });
    }
    const photo = await embedMedia([readFixture('photo')], { mediaType: 'image' });
    const video = await embedMedia([readFixture('video')], { mediaType: 'video' });
    const sameSpace = cosine(firstVector(photo), firstVector(video));
    const measurements = { sameSpace };
    results.video_embed =
      sameSpace >= VIDEO_IMAGE_MIN
        ? success('video_embed', measurements)
        : failure('video_embed', 'video_image_space_mismatch', measurements);
  } catch (err) {
    results.video_embed = failure(
      'video_embed',
      err?.reason || err?.class || 'video_probe_failed',
      {
        error: err?.message || String(err),
      }
    );
  }

  return results;
}

/**
 * `vision_chat` positive control: a REAL photo must produce a non-trivial
 * caption that differs from the same request without the image (an endpoint
 * that embeds base64 as text cannot satisfy the difference check).
 */
async function runVisionProbe({ visionCaption, chat } = {}) {
  try {
    const prompt = 'Describe the main content of this photo in English.';
    const withImage = await visionCaption([readFixture('photo')], { prompt });
    const imageText = String(withImage?.text ?? '');
    const withoutImage = await chat([{ role: 'user', content: prompt }], {});
    const plainText = String(withoutImage?.text ?? '');
    const normalized = normalizeText(imageText);
    const measurements = { length: normalized.length };
    if (normalized.length < VISION_CAPTION_MIN_CHARS) {
      return failure('vision_chat', 'vision_caption_too_short', measurements);
    }
    if (normalized === normalizeText(plainText)) {
      return failure('vision_chat', 'vision_image_ignored', measurements);
    }
    return success('vision_chat', measurements);
  } catch (err) {
    return failure('vision_chat', err?.reason || err?.class || 'vision_probe_failed', {
      error: err?.message || String(err),
    });
  }
}

/**
 * `asr` positive control: the real ALSA "Front Center" speech clip must
 * transcribe to text overlapping the expected words. Noise-only probes are
 * banned as pass criteria (§2.4).
 */
async function runAsrProbe({ asrTranscribe } = {}) {
  try {
    const result = await asrTranscribe(readFixture('speech'), { escapePrompt: true });
    const transcript = normalizeText(result?.text);
    const matched = ASR_EXPECTED_WORDS.filter((word) => transcript.split(' ').includes(word));
    const measurements = { transcript, matched };
    return matched.length > 0
      ? success('asr', measurements)
      : failure('asr', 'asr_transcript_mismatch', measurements);
  } catch (err) {
    return failure('asr', err?.reason || err?.class || 'asr_probe_failed', {
      error: err?.message || String(err),
    });
  }
}

module.exports = {
  FIXTURES,
  FIXTURE_DIR,
  IMAGE_NEAR_DUP_FLOOR,
  IMAGE_TEXT_DIVERGENCE_MAX,
  IMAGE_CONTROL_DIVERGENCE_MAX,
  AUDIO_DISTINCT_MAX,
  VIDEO_IMAGE_MIN,
  VISION_CAPTION_MIN_CHARS,
  ASR_EXPECTED_WORDS,
  readFixture,
  cosine,
  makeNoise,
  encodeWav,
  normalizeText,
  runEmbedMediaProbes,
  runVisionProbe,
  runAsrProbe,
};
