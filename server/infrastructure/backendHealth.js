'use strict';

const BACKENDS = ['postgresql', 's3', 'webdav'];

function initialState() {
  return {
    status: 'unknown',
    code: undefined,
    reason: undefined,
    hint: undefined,
    lastCheckedAt: undefined,
    firstFailedAt: undefined,
    consecutiveFailures: 0,
  };
}

/**
 * In-memory per-backend health tracker (PLAN Phase B, D2/D3/D4).
 *
 * Passive, event-based: callers report success/failure; the tracker records
 * state, fires a transition callback only on OK→FAIL / FAIL→OK, and serves a
 * snapshot for the admin card/banner and public status. State resets on
 * restart (D4).
 */
function createBackendHealth() {
  const state = new Map(BACKENDS.map((backend) => [backend, initialState()]));
  let onTransition = null;

  function snapshot(backend) {
    return { ...state.get(backend) };
  }

  function fireTransition(backend, from, to, next) {
    if (typeof onTransition === 'function') {
      onTransition(backend, {
        from,
        to,
        code: next.code,
        reason: next.reason,
        hint: next.hint,
      });
    }
  }

  function report(backend, { ok, code, reason, hint } = {}) {
    if (!state.has(backend)) return;

    const current = state.get(backend);
    const now = Date.now();

    if (ok) {
      const from = current.status;
      const next = initialState();
      next.status = 'ok';
      next.lastCheckedAt = now;
      state.set(backend, next);
      if (from === 'fail') fireTransition(backend, from, next.status, next);
      return;
    }

    const from = current.status;
    const next = snapshot(backend);
    next.status = 'fail';
    next.code = code;
    next.reason = reason;
    next.hint = hint;
    next.lastCheckedAt = now;
    next.consecutiveFailures = current.consecutiveFailures + 1;
    if (current.firstFailedAt === undefined) next.firstFailedAt = now;
    state.set(backend, next);
    if (from === 'ok') fireTransition(backend, from, next.status, next);
  }

  function getHealth() {
    const out = {};
    for (const backend of BACKENDS) {
      out[backend] = snapshot(backend);
    }
    return out;
  }

  function reset() {
    for (const backend of BACKENDS) {
      state.set(backend, initialState());
    }
  }

  function setOnTransition(cb) {
    onTransition = cb;
  }

  return { report, getHealth, reset, setOnTransition };
}

let sharedBackendHealth = null;

/**
 * The single tracker instance used across the process (boot path and
 * endpoints). Lazily created; no dependency work happens at require time.
 */
function getBackendHealth() {
  if (!sharedBackendHealth) {
    sharedBackendHealth = createBackendHealth();
  }
  return sharedBackendHealth;
}

module.exports = { createBackendHealth, getBackendHealth };
