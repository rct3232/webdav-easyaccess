'use strict';

const BACKENDS = ['postgresql', 's3', 'webdav'];

// AI LLM role slots (§4.12, admin.md §3.2 P0 plumbing): per-role probe states
// tracked as `ai.<role>` rows. The adapter (T1.1) reports probe outcomes via
// the probeLlm slot; `GET /api/settings/public` derives its live
// `ai: { embed, chat }` flags from these rows (settings.md §2.4).
const AI_ROLE_KEYS = ['ai.embed', 'ai.chat'];

// Vector-engine row (vectorStore.md §1/§2.4): the seam factory reports the
// boot selection here — ok ⇒ native adapter, fail ⇒ JsFallback degraded with
// an install hint. A performance warning, never a feature gate.
const VECTOR_KEY = 'vector';

const TRACKED_KEYS = [...BACKENDS, ...AI_ROLE_KEYS, VECTOR_KEY];

function initialState() {
  return {
    status: 'unknown',
    // Generic non-terminal readiness state (backendHealth.md §2.2/§2.3): set by
    // a `preparing:true` report, cleared by the next ok:true / ok:false report.
    // `phase` names what is preparing ('provisioning', 'index-build', …);
    // `progress` is a short human-readable string ("3/7 files"). Admin display
    // only — the 5-state mapping reads these fields, not the status.
    preparing: undefined,
    phase: undefined,
    progress: undefined,
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
 * restart (D4). Besides the three file/metadata backends it tracks the
 * `ai.embed` / `ai.chat` role slots with the same generic row shape.
 */
function createBackendHealth() {
  const state = new Map(TRACKED_KEYS.map((key) => [key, initialState()]));
  let onTransition = null;

  function snapshot(key) {
    return { ...state.get(key) };
  }

  function fireTransition(key, from, to, next) {
    if (typeof onTransition === 'function') {
      onTransition(key, {
        from,
        to,
        code: next.code,
        reason: next.reason,
        hint: next.hint,
      });
    }
  }

  function report(key, { ok, preparing, phase, progress, code, reason, hint } = {}) {
    if (!state.has(key)) return;

    const current = state.get(key);
    const now = Date.now();

    // Non-terminal readiness update (backendHealth.md §2.3): a preparing report
    // sets/clears the readiness fields and keeps the underlying status. It never
    // fires the transition callback, never counts as a failure, and never
    // touches code/reason/hint beyond clearing them (the row is mid-preparation,
    // any earlier failure diagnosis is stale while preparation runs).
    if (preparing) {
      const next = snapshot(key);
      next.preparing = true;
      next.phase = phase;
      next.progress = progress;
      next.code = undefined;
      next.reason = undefined;
      next.hint = undefined;
      next.lastCheckedAt = now;
      state.set(key, next);
      return;
    }

    if (ok) {
      const from = current.status;
      const next = initialState();
      next.status = 'ok';
      next.lastCheckedAt = now;
      state.set(key, next);
      if (from === 'fail') fireTransition(key, from, next.status, next);
      return;
    }

    const from = current.status;
    const next = snapshot(key);
    // A terminal report replaces the readiness state (§2.3): ok:false carries
    // the outcome, so the preparation fields are cleared here.
    next.preparing = undefined;
    next.phase = undefined;
    next.progress = undefined;
    next.status = 'fail';
    next.code = code;
    next.reason = reason;
    next.hint = hint;
    next.lastCheckedAt = now;
    next.consecutiveFailures = current.consecutiveFailures + 1;
    if (current.firstFailedAt === undefined) next.firstFailedAt = now;
    state.set(key, next);
    if (from === 'ok') fireTransition(key, from, next.status, next);
  }

  function getHealth() {
    const out = {};
    for (const key of TRACKED_KEYS) {
      out[key] = snapshot(key);
    }
    return out;
  }

  function reset() {
    for (const key of TRACKED_KEYS) {
      state.set(key, initialState());
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
