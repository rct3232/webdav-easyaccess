'use strict';

/**
 * Enrichment-hook capability gates (docs/spec/server/services/aiJobService.md
 * §2.2 — decision table). Capability authority is the llmAdapter probe matrix
 * (`evaluateCapabilityMatrix` → `probeState`), never raw config presence: a
 * declared role that was never probed, or whose probe failed, is OFF and its
 * media falls back to the `embed` floor.
 */

const { AI_JOB_KIND } = require('@webdav-easyaccess/shared/constants');
const { createNodeContentHook } = require('../nodeContentHook');
const probeState = require('../../../infrastructure/adapters/llm/probeState');

/** Publish the matrix row the adapter would publish for a probed role. */
function publish(role, capability, { declared = true, probed = true, enabled = false, note } = {}) {
  probeState.setRoleCapability(role, {
    capability,
    declared,
    probed,
    enabled,
    note: note ?? (enabled ? null : probeStateNote(probed)),
  });
}

function probeStateNote(probed) {
  return probed ? 'probe-failed' : 'declared-not-probed';
}

function buildHook(node, options = {}) {
  const enqueued = [];
  const hook = createNodeContentHook({
    aiJobsRepository: {
      async enqueue(nodeId, kind, generation, contentHash) {
        enqueued.push({ nodeId, kind, generation, contentHash });
        return { id: enqueued.length };
      },
    },
    fileNodesStore: {
      async getNode() {
        return node;
      },
    },
    ...options,
  });
  return { hook, enqueued };
}

const kindsOf = (enqueued) => enqueued.map((job) => job.kind);

describe('nodeContentHook capability gates (effective capability set)', () => {
  beforeEach(() => probeState.reset());
  afterAll(() => probeState.reset());

  it('declared-but-not-probed chat ⇒ text node enqueues ONLY embed (no features)', async () => {
    publish('chat', 'chat', { probed: false });
    const { hook, enqueued } = buildHook({ type: 'file', name: 'notes.txt' });

    await hook.onNodeContentCommitted(7, 'hash-7');

    expect(kindsOf(enqueued)).toEqual([AI_JOB_KIND.EMBED]);
  });

  it('declared-but-failed chat ⇒ capability OFF (embed only); a passing probe ⇒ embed + features', async () => {
    publish('chat', 'chat', { probed: true, enabled: false });
    const off = buildHook({ type: 'file', name: 'notes.txt' });
    await off.hook.onNodeContentCommitted(8, 'hash-8');
    expect(kindsOf(off.enqueued)).toEqual([AI_JOB_KIND.EMBED]);

    publish('chat', 'chat', { probed: true, enabled: true });
    const on = buildHook({ type: 'file', name: 'notes.txt' });
    await on.hook.onNodeContentCommitted(9, 'hash-9');
    expect(kindsOf(on.enqueued)).toEqual([AI_JOB_KIND.EMBED, AI_JOB_KIND.FEATURES]);
  });

  it('vision capability OFF ⇒ image/video fall back to the embed floor; ON ⇒ caption', async () => {
    publish('vision', 'vision_chat', { probed: true, enabled: false });
    const off = buildHook({ type: 'file', name: 'photo.jpg' });
    await off.hook.onNodeContentCommitted(10, 'hash-10');
    expect(kindsOf(off.enqueued)).toEqual([AI_JOB_KIND.EMBED]);

    publish('vision', 'vision_chat', { probed: true, enabled: true });
    const on = buildHook({ type: 'file', name: 'photo.jpg' });
    await on.hook.onNodeContentCommitted(11, 'hash-11');
    expect(kindsOf(on.enqueued)).toEqual([AI_JOB_KIND.CAPTION]);
  });

  it('asr capability OFF ⇒ audio falls back to embed; ON ⇒ asr', async () => {
    publish('asr', 'asr', { probed: false });
    const off = buildHook({ type: 'file', name: 'clip.mp3' });
    await off.hook.onNodeContentCommitted(12, 'hash-12');
    expect(kindsOf(off.enqueued)).toEqual([AI_JOB_KIND.EMBED]);

    publish('asr', 'asr', { probed: true, enabled: true });
    const on = buildHook({ type: 'file', name: 'clip.mp3' });
    await on.hook.onNodeContentCommitted(13, 'hash-13');
    expect(kindsOf(on.enqueued)).toEqual([AI_JOB_KIND.ASR]);
  });

  it('a capability absent from the matrix is OFF, never inferred from config presence', async () => {
    // Nothing published: this is the cold state right after boot before the
    // initial probe lands. The hook must not claim vision/asr.
    const image = buildHook({ type: 'file', name: 'shot.png' });
    await image.hook.onNodeContentCommitted(14, 'hash-14');
    expect(kindsOf(image.enqueued)).toEqual([AI_JOB_KIND.EMBED]);

    const audio = buildHook({ type: 'file', name: 'voice.wav' });
    await audio.hook.onNodeContentCommitted(15, 'hash-15');
    expect(kindsOf(audio.enqueued)).toEqual([AI_JOB_KIND.EMBED]);
  });

  it('directories enqueue nothing regardless of capabilities', async () => {
    publish('chat', 'chat', { probed: true, enabled: true });
    const { hook, enqueued } = buildHook({ type: 'directory', name: 'folder' });
    await hook.onNodeContentCommitted(16, 'hash-16');
    expect(enqueued).toEqual([]);
  });

  it('generationFor resolves the current per-kind generation asynchronously', async () => {
    publish('chat', 'chat', { probed: true, enabled: true });
    const seen = [];
    const { hook, enqueued } = buildHook(
      { type: 'file', name: 'notes.txt' },
      {
        generationFor: async (kind) => {
          seen.push(kind);
          return kind === AI_JOB_KIND.FEATURES ? 4 : 3;
        },
      }
    );

    await hook.onNodeContentCommitted(17, 'hash-17');
    expect(seen).toEqual([AI_JOB_KIND.EMBED, AI_JOB_KIND.FEATURES]);
    expect(enqueued.map((job) => job.generation)).toEqual([3, 4]);
  });

  it('a generationFor failure falls back to the local default and still enqueues', async () => {
    const { hook, enqueued } = buildHook(
      { type: 'file', name: 'notes.txt' },
      {
        generation: 7,
        generationFor: async () => {
          throw new Error('settings down');
        },
      }
    );
    await hook.onNodeContentCommitted(18, 'hash-18');
    expect(enqueued).toEqual([
      { nodeId: 18, kind: AI_JOB_KIND.EMBED, generation: 7, contentHash: 'hash-18' },
    ]);
  });
});
