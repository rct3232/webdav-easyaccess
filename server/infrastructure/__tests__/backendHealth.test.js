'use strict';

const { createBackendHealth, getBackendHealth } = require('../backendHealth');

const BACKENDS = ['postgresql', 's3', 'webdav'];

function collectTransitions(tracker) {
  const transitions = [];
  tracker.setOnTransition((backend, change) => transitions.push({ backend, ...change }));
  return transitions;
}

describe('createBackendHealth', () => {
  it('starts every backend as unknown with zero failures', () => {
    const tracker = createBackendHealth();
    for (const backend of BACKENDS) {
      expect(tracker.getHealth()[backend]).toEqual({
        status: 'unknown',
        code: undefined,
        reason: undefined,
        hint: undefined,
        lastCheckedAt: undefined,
        firstFailedAt: undefined,
        consecutiveFailures: 0,
      });
    }
  });

  it('reflects the first report in the backend state', () => {
    const tracker = createBackendHealth();
    const before = Date.now();
    tracker.report('postgresql', {
      ok: false,
      code: 'unreachable',
      reason: 'connection refused',
      hint: 'db.unreachable',
    });

    const health = tracker.getHealth().postgresql;
    expect(health.status).toBe('fail');
    expect(health.code).toBe('unreachable');
    expect(health.reason).toBe('connection refused');
    expect(health.hint).toBe('db.unreachable');
    expect(health.consecutiveFailures).toBe(1);
    expect(health.firstFailedAt).toBeGreaterThanOrEqual(before);
    expect(health.lastCheckedAt).toBeGreaterThanOrEqual(before);

    tracker.report('s3', { ok: true });
    expect(tracker.getHealth().s3.status).toBe('ok');
  });

  it('ok:true after fail flips to ok, clears code/reason/hint and resets failures', () => {
    const tracker = createBackendHealth();
    tracker.report('s3', { ok: false, code: 'auth', reason: 'AccessDenied', hint: 's3.auth' });
    tracker.report('s3', { ok: false, code: 'auth', reason: 'AccessDenied', hint: 's3.auth' });

    const now = Date.now();
    tracker.report('s3', { ok: true });

    const health = tracker.getHealth().s3;
    expect(health.status).toBe('ok');
    expect(health.code).toBeUndefined();
    expect(health.reason).toBeUndefined();
    expect(health.hint).toBeUndefined();
    expect(health.consecutiveFailures).toBe(0);
    expect(health.firstFailedAt).toBeUndefined();
    expect(health.lastCheckedAt).toBeGreaterThanOrEqual(now);
  });

  it('increments consecutiveFailures on each failed report', () => {
    const tracker = createBackendHealth();
    tracker.report('webdav', { ok: false });
    tracker.report('webdav', { ok: false });
    tracker.report('webdav', { ok: false });
    expect(tracker.getHealth().webdav.consecutiveFailures).toBe(3);
  });

  it('sets firstFailedAt on the first failure of a streak and keeps it', () => {
    const tracker = createBackendHealth();
    const first = Date.now();
    tracker.report('postgresql', { ok: false });
    const firstFailedAt = tracker.getHealth().postgresql.firstFailedAt;
    expect(firstFailedAt).toBeGreaterThanOrEqual(first);

    tracker.report('postgresql', { ok: false });
    expect(tracker.getHealth().postgresql.firstFailedAt).toBe(firstFailedAt);

    tracker.report('postgresql', { ok: true });
    expect(tracker.getHealth().postgresql.firstFailedAt).toBeUndefined();
  });

  it('fires the transition callback only on ok<->fail flips', () => {
    const tracker = createBackendHealth();
    const transitions = collectTransitions(tracker);

    tracker.report('postgresql', { ok: false, code: 'unreachable', reason: 'refused' });
    tracker.report('postgresql', { ok: false, code: 'unreachable', reason: 'refused' });
    expect(transitions).toHaveLength(0);

    tracker.report('postgresql', { ok: true });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({
      backend: 'postgresql',
      from: 'fail',
      to: 'ok',
      code: undefined,
      reason: undefined,
      hint: undefined,
    });

    tracker.report('postgresql', { ok: true });
    expect(transitions).toHaveLength(1);

    tracker.report('postgresql', {
      ok: false,
      code: 'auth',
      reason: 'bad credentials',
      hint: 'db.auth',
    });
    expect(transitions).toHaveLength(2);
    expect(transitions[1]).toEqual({
      backend: 'postgresql',
      from: 'ok',
      to: 'fail',
      code: 'auth',
      reason: 'bad credentials',
      hint: 'db.auth',
    });

    tracker.report('postgresql', { ok: false });
    expect(transitions).toHaveLength(2);
  });

  it('reset() returns all backends to unknown', () => {
    const tracker = createBackendHealth();
    tracker.report('postgresql', { ok: false });
    tracker.report('s3', { ok: true });
    tracker.report('webdav', { ok: false });

    tracker.reset();

    for (const backend of BACKENDS) {
      expect(tracker.getHealth()[backend]).toEqual({
        status: 'unknown',
        code: undefined,
        reason: undefined,
        hint: undefined,
        lastCheckedAt: undefined,
        firstFailedAt: undefined,
        consecutiveFailures: 0,
      });
    }
  });

  it('getHealth() returns copies of all tracked keys without cross-contamination', () => {
    const tracker = createBackendHealth();
    tracker.report('postgresql', { ok: false, code: 'unreachable' });

    const health = tracker.getHealth();
    expect(Object.keys(health).sort()).toEqual([
      'ai.chat',
      'ai.embed',
      'postgresql',
      's3',
      'vector',
      'webdav',
    ]);

    health.postgresql.status = 'ok';
    health.postgresql.code = 'cleared';
    health.s3.consecutiveFailures = 99;

    const again = tracker.getHealth();
    expect(again.postgresql.status).toBe('fail');
    expect(again.postgresql.code).toBe('unreachable');
    expect(again.s3.consecutiveFailures).toBe(0);
    expect(health).not.toBe(again);
    expect(health.postgresql).not.toBe(again.postgresql);
  });

  it('ignores unknown backend names silently', () => {
    const tracker = createBackendHealth();
    const transitions = collectTransitions(tracker);

    expect(() => tracker.report('mysql', { ok: false })).not.toThrow();
    expect(() => tracker.report('mongodb', { ok: true })).not.toThrow();
    expect(Object.keys(tracker.getHealth()).sort()).toEqual([
      'ai.chat',
      'ai.embed',
      'postgresql',
      's3',
      'vector',
      'webdav',
    ]);
    expect(transitions).toHaveLength(0);
  });
});

describe('AI role slots (T0.7b — ai.embed / ai.chat, §4.12)', () => {
  it('starts the AI role slots as unknown', () => {
    const tracker = createBackendHealth();
    for (const slot of ['ai.embed', 'ai.chat']) {
      expect(tracker.getHealth()[slot]).toEqual({
        status: 'unknown',
        code: undefined,
        reason: undefined,
        hint: undefined,
        lastCheckedAt: undefined,
        firstFailedAt: undefined,
        consecutiveFailures: 0,
      });
    }
  });

  it('reports ok/fail per role slot independently', () => {
    const tracker = createBackendHealth();
    tracker.report('ai.embed', { ok: true });
    tracker.report('ai.chat', { ok: false, code: 'unknown', reason: 'probe failed' });

    expect(tracker.getHealth()['ai.embed'].status).toBe('ok');
    expect(tracker.getHealth()['ai.chat'].status).toBe('fail');
    expect(tracker.getHealth()['ai.chat'].reason).toBe('probe failed');
    expect(tracker.getHealth()['ai.chat'].consecutiveFailures).toBe(1);
  });

  it('ok:true keeps a partial hint; the next hint-free ok clears it', () => {
    const tracker = createBackendHealth();
    tracker.report('ai.embed', { ok: true, hint: 'serverErrors.ai.providerProbeFailed' });

    expect(tracker.getHealth()['ai.embed']).toMatchObject({
      status: 'ok',
      hint: 'serverErrors.ai.providerProbeFailed',
      consecutiveFailures: 0,
    });
    // code/reason stay cleared on the ok report.
    expect(tracker.getHealth()['ai.embed'].code).toBeUndefined();
    expect(tracker.getHealth()['ai.embed'].reason).toBeUndefined();

    tracker.report('ai.embed', { ok: true });
    expect(tracker.getHealth()['ai.embed'].hint).toBeUndefined();
    expect(tracker.getHealth()['ai.embed'].status).toBe('ok');
  });

  it('an ai.<role> report never flips a backend row and vice versa', () => {
    const tracker = createBackendHealth();
    const transitions = collectTransitions(tracker);

    tracker.report('ai.embed', { ok: true });
    tracker.report('postgresql', { ok: true });
    expect(tracker.getHealth().postgresql.status).toBe('ok');
    expect(tracker.getHealth()['ai.embed'].status).toBe('ok');

    // Only the reported slot flips; transitions fire per key, never cross-key.
    tracker.report('ai.embed', { ok: false, code: 'unknown' });
    expect(tracker.getHealth().postgresql.status).toBe('ok');
    expect(tracker.getHealth()['ai.embed'].status).toBe('fail');
    expect(transitions.map((t) => t.backend)).toEqual(['ai.embed']);
  });

  it('reset() clears the AI role slots too', () => {
    const tracker = createBackendHealth();
    tracker.report('ai.embed', { ok: true });
    tracker.report('ai.chat', { ok: false, code: 'unknown' });

    tracker.reset();

    expect(tracker.getHealth()['ai.embed'].status).toBe('unknown');
    expect(tracker.getHealth()['ai.chat'].status).toBe('unknown');
    expect(tracker.getHealth()['ai.chat'].consecutiveFailures).toBe(0);
  });

  it('ignores unknown ai.<role> names silently', () => {
    const tracker = createBackendHealth();
    expect(() => tracker.report('ai.vision', { ok: true })).not.toThrow();
    expect(tracker.getHealth()['ai.vision']).toBeUndefined();
  });

  it('derives the settings/public ai flags from the slot state (ok ⇒ true)', () => {
    const tracker = createBackendHealth();
    const toFlags = (health) => ({
      embed: health['ai.embed']?.status === 'ok',
      chat: health['ai.chat']?.status === 'ok',
    });

    expect(toFlags(tracker.getHealth())).toEqual({ embed: false, chat: false });
    tracker.report('ai.embed', { ok: true });
    tracker.report('ai.chat', { ok: false, code: 'unknown' });
    expect(toFlags(tracker.getHealth())).toEqual({ embed: true, chat: false });
    tracker.reset();
    expect(toFlags(tracker.getHealth())).toEqual({ embed: false, chat: false });
  });
});

describe('getBackendHealth', () => {
  it('returns the shared singleton instance', () => {
    expect(getBackendHealth()).toBe(getBackendHealth());
  });
});
