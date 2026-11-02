'use strict';

/**
 * mediaSampling tests (aiJobService.md §2.4, llmAdapter.md §2.6 MEDIA ladder).
 *
 * Pure ladder arithmetic always runs; the ffmpeg/ffprobe legs use the
 * committed D2 fixtures and skip cleanly when the binaries are absent.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { FIXTURES, readFixture } = require('../../../../infrastructure/adapters/llm/mediaProbe');
const {
  ffprobeMedia,
  sampleVideoFrames,
  decodeAudioToMono16k,
  audioWindows,
  encodeWavMono16k,
  videoFrameCap,
  audioWindowSec,
  detectMediaKind,
  AUDIO_SAMPLE_RATE,
  MAX_AUDIO_WINDOW_SEC,
} = require('../mediaSampling');

function toolAvailable(command) {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore' });
  return result.status === 0;
}

const FFMPEG = toolAvailable('ffmpeg');
const FFPROBE = toolAvailable('ffprobe');
const mediaTools = FFMPEG && FFPROBE ? describe : describe.skip;

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wea-media-test-'));
}

describe('mediaSampling ladder arithmetic (pure)', () => {
  it('videoFrameCap divides the budget by mediaTokenCost.videoFrame (≥1)', () => {
    expect(videoFrameCap({ budgetTokens: 8192, mediaTokenCost: { videoFrame: 140 } })).toBe(58);
    expect(videoFrameCap({ budgetTokens: 512, mediaTokenCost: { videoFrame: 140 } })).toBe(3);
    expect(videoFrameCap({ budgetTokens: 10, mediaTokenCost: { videoFrame: 140 } })).toBe(1);
    expect(videoFrameCap({ budgetTokens: 8192, mediaTokenCost: null })).toBe(1);
    expect(videoFrameCap({})).toBe(1);
  });

  it('audioWindowSec = min(budget / audioPerSec, 327 s)', () => {
    expect(audioWindowSec({ budgetTokens: 8192, mediaTokenCost: { audioPerSec: 25 } })).toBe(
      MAX_AUDIO_WINDOW_SEC
    );
    expect(audioWindowSec({ budgetTokens: 512, mediaTokenCost: { audioPerSec: 25 } })).toBe(20.48);
    expect(audioWindowSec({ budgetTokens: 0, mediaTokenCost: { audioPerSec: 25 } })).toBe(
      MAX_AUDIO_WINDOW_SEC
    );
  });

  it('audioWindows slices at fixed offsets and keeps the short tail', () => {
    const samples = new Float32Array(AUDIO_SAMPLE_RATE * 2 + 100);
    for (let i = 0; i < samples.length; i++) samples[i] = i % 100;

    const windows = audioWindows(samples, { windowSec: 1 });
    expect(windows).toHaveLength(3);
    expect(windows[0]).toHaveLength(AUDIO_SAMPLE_RATE);
    expect(windows[1][0]).toBe(samples[AUDIO_SAMPLE_RATE]);
    expect(windows[2]).toHaveLength(100);
    expect(audioWindows(new Float32Array(0), { windowSec: 1 })).toEqual([]);
  });

  it('encodeWavMono16k emits a mono 16 kHz PCM16 RIFF header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const wav = encodeWavMono16k(samples);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(AUDIO_SAMPLE_RATE);
    expect(wav.readUInt16LE(34)).toBe(16); // bits
    expect(wav.length).toBe(44 + samples.length * 2);
  });

  it('detectMediaKind reads metadata tags only (explicit kind, musical genre, artist/album)', () => {
    expect(detectMediaKind({ tags: { media_kind: 'music' } })).toBe('music');
    expect(detectMediaKind({ tags: { artist: 'Someone' } })).toBe('music');
    expect(detectMediaKind({ tags: { Album: 'Record' } })).toBe('music');
    expect(detectMediaKind({ tags: { genre: 'Ambient' } })).toBe('music');
    expect(detectMediaKind({ tags: { genre: 'Speech' } })).toBeNull();
    expect(detectMediaKind({ tags: { genre: 'Podcast' } })).toBeNull();
    expect(detectMediaKind({ tags: { encoder: 'Lavf' } })).toBeNull();
    expect(detectMediaKind(null)).toBeNull();
  });
});

mediaTools('mediaSampling ffmpeg/ffprobe legs (D2 fixtures)', () => {
  it('ffprobeMedia reports duration/geometry/streams/tags for the video fixture', async () => {
    const probe = await ffprobeMedia(readFixture('video'), { mimeType: 'video/mp4' });
    expect(probe.durationSec).toBeGreaterThan(0);
    expect(probe.width).toBeGreaterThan(0);
    expect(probe.height).toBeGreaterThan(0);
    expect(probe.streams.some((stream) => stream.codecType === 'video')).toBe(true);
    expect(probe.tags).toHaveProperty('encoder');
  });

  it('ffprobeMedia probes the audio fixture and detectMediaKind stays null for a plain clip', async () => {
    const probe = await ffprobeMedia(readFixture('speech'), { mimeType: 'audio/wav' });
    expect(probe.durationSec).toBeCloseTo(1.428, 1);
    expect(probe.streams.some((stream) => stream.codecType === 'audio')).toBe(true);
    expect(detectMediaKind(probe)).toBeNull();
  });

  it('sampleVideoFrames returns JPEG buffers capped by maxFrames', async () => {
    const frames = await sampleVideoFrames(readFixture('video'), {
      maxFrames: 2,
      mimeType: 'video/mp4',
    });
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(Buffer.isBuffer(frame)).toBe(true);
      expect(frame.subarray(0, 2).toString('hex')).toBe('ffd8'); // JPEG SOI
    }
  });

  it('sampleVideoFrames applies a uniform stride over a longer clip', async () => {
    const tmpRoot = makeTmpRoot();
    const longVideo = path.join(tmpRoot, 'long.mp4');
    try {
      const generated = spawnSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-loop',
          '1',
          '-i',
          FIXTURES.photo,
          '-t',
          '10',
          '-r',
          '1',
          '-pix_fmt',
          'yuv420p',
          '-y',
          longVideo,
        ],
        { stdio: 'ignore' }
      );
      expect(generated.status).toBe(0);
      const buffer = fs.readFileSync(longVideo);
      const frames = await sampleVideoFrames(buffer, {
        maxFrames: 3,
        mimeType: 'video/mp4',
        tmpRoot,
      });
      // 10 s at 1 fps, stride ceil(10/3)=4 ⇒ frames at n=0,4,8 (3 frames).
      expect(frames).toHaveLength(3);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('decodeAudioToMono16k yields mono 16 kHz Float32 samples', async () => {
    const samples = await decodeAudioToMono16k(readFixture('speech'), { mimeType: 'audio/wav' });
    expect(samples).toBeInstanceOf(Float32Array);
    expect(samples.length).toBe(Math.round(1.428 * AUDIO_SAMPLE_RATE));
    expect(samples.some((value) => value !== 0)).toBe(true);
  });

  it('audioWindows over the decoded fixture yields the model-cap window count', async () => {
    const samples = await decodeAudioToMono16k(readFixture('speech'), { mimeType: 'audio/wav' });
    const windows = audioWindows(samples, {
      windowSec: audioWindowSec({
        budgetTokens: 8192,
        mediaTokenCost: { audioPerSec: 25 },
      }),
    });
    expect(windows).toHaveLength(1); // 1.428 s < 327 s window
  });

  it('leaves no temp workspace behind, success or failure', async () => {
    const tmpRoot = makeTmpRoot();
    try {
      await ffprobeMedia(readFixture('photo'), { mimeType: 'image/jpeg', tmpRoot });
      await sampleVideoFrames(readFixture('video'), { maxFrames: 1, tmpRoot });
      await expect(
        ffprobeMedia(Buffer.from('not media'), { mimeType: 'video/mp4', tmpRoot })
      ).rejects.toMatchObject({ code: 'mediaToolFailed' });
      await expect(
        decodeAudioToMono16k(Buffer.from('not audio'), { tmpRoot })
      ).rejects.toMatchObject({ code: 'mediaToolFailed' });
      expect(fs.readdirSync(tmpRoot)).toEqual([]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
