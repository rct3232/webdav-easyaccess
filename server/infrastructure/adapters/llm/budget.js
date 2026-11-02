'use strict';

/**
 * budget.js — error classification, budget chain, passive limiter and circuit
 * breaker for the llmAdapter core (docs/spec/server/infrastructure/
 * llmAdapter.md §2.5, §2.8).
 *
 * Pure/injectable: no I/O, no module-level clock — the adapter injects
 * `now`. Tunables (LLM_BREAKER_THRESHOLD / LLM_BREAKER_COOLDOWN_S) arrive
 * through getter functions so the adapter can keep them hot (T2 dbOnly).
 */

const DEFAULT_BREAKER_THRESHOLD = 5;
const DEFAULT_BREAKER_COOLDOWN_S = 300;

// Transport-class failure fingerprints (§2.8 `transport`: timeout, ECONNRESET,
// 5xx, DNS).
const TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
]);

// §2.8 `length`: 400 token/input-too-long and context-overflow messages.
const LENGTH_MESSAGE =
  /(context length|input too long|maximum context|too many tokens|token limit|with \d+ tokens|longer than|input \(\d+ tokens\)|physical batch size)/i;

/**
 * §2.8 error taxonomy — every provider error is classified before surfacing.
 * A pre-assigned `err.class` is honored (adapter-thrown errors classify
 * themselves); everything else is classified from the error shape and the
 * classification is attached to (and returned as) the error. Unknown errors
 * default to `transport` — the conservative, breaker-relevant reading.
 *
 * Classes: transport | rate | length | schema | config | budget | provisioning
 */
function classifyLlmError(err) {
  if (!err || typeof err !== 'object') {
    const wrapped = new Error(String(err));
    wrapped.class = 'transport';
    return wrapped;
  }
  if (typeof err.class === 'string') return err;

  const status = err.status ?? err.statusCode ?? (err.response ? err.response.status : undefined);
  const message = err.message || '';

  if (status === 429) {
    err.class = 'rate';
    return err;
  }
  if (LENGTH_MESSAGE.test(message)) {
    err.class = 'length';
    return err;
  }
  if (status === 401 || status === 403 || status === 404) {
    err.class = 'config';
    return err;
  }
  if (typeof status === 'number' && status >= 500) {
    err.class = 'transport';
    return err;
  }
  if (err instanceof SyntaxError || err.name === 'SyntaxError') {
    err.class = 'schema';
    return err;
  }
  if (
    TRANSPORT_CODES.has(err.code) ||
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    /timeout|timed out|network/i.test(message)
  ) {
    err.class = 'transport';
    return err;
  }
  if (typeof status === 'number' && status >= 400) {
    err.class = 'config';
    return err;
  }
  err.class = 'transport';
  return err;
}

/**
 * Budget chain steps 1–3 (§2.5) as a pure decision: the admin cap wins, then
 * published capability metadata, then the preset manifest's release-measured
 * default. Step 4 (the passive limiter) is NOT part of this decision — the
 * limiter state combines downward-only on top of the chain result.
 *
 * Non-positive / non-numeric admin values never win (an unset cap resolves to
 * null here — the registry default is undefined, not 0).
 */
function resolveBudget({ adminCap, publishedMetadata, presetDefault } = {}) {
  const admin = Number(adminCap);
  if (Number.isFinite(admin) && admin > 0) return { maxInputChars: admin, source: 'admin' };
  const metadata = Number(publishedMetadata);
  if (Number.isFinite(metadata) && metadata > 0)
    return { maxInputChars: metadata, source: 'metadata' };
  const preset = Number(presetDefault);
  if (Number.isFinite(preset) && preset > 0) return { maxInputChars: preset, source: 'preset' };
  return { maxInputChars: null, source: 'limiter' };
}

/**
 * §2.5 step 4 — the PASSIVE, DOWNWARD-ONLY limiter: a real request that fails
 * with a LENGTH-CLASS error HALVES the model's budget from then on; success
 * never raises it, only admin/manual action does. Per-role in-memory state
 * (resets on reconfig with the rest of the budget/breaker state).
 */
function createLimiter() {
  const budgets = new Map(); // role → number

  function getBudget(role) {
    const b = budgets.get(role);
    return b === undefined ? null : b;
  }

  /**
   * Halve on a length-class failure. When no budget is known yet, half of the
   * failing request's size is the safe starting point (the request that
   * failed was too long — half of it is not).
   */
  function noteLengthFailure(role, failingChars = 0) {
    const current = getBudget(role);
    const base = current === null ? Number(failingChars) || 0 : current;
    const next = Math.floor(base / 2);
    if (current === null || next < current) budgets.set(role, next);
    return getBudget(role);
  }

  function noteSuccess() {
    /* downward-only: success never raises the budget */
  }

  function reset(role) {
    budgets.delete(role);
  }

  return { getBudget, noteLengthFailure, noteSuccess, reset };
}

/**
 * §2.5 circuit breaker (transport class): ≥5 consecutive transport failures
 * ⇒ OPEN for the cooldown, half-open single probe call on expiry; a probe
 * failure re-opens with a FRESH cooldown, a probe success closes. Per-role.
 *
 * `admit` implements the half-open single-probe discipline: in half_open
 * state exactly one in-flight call is admitted (a second concurrent caller
 * short-circuits); the caller MUST settle the probe through recordSuccess /
 * recordFailure.
 */
function createBreaker({ getThreshold, getCooldownS, now = () => Date.now() } = {}) {
  const roles = new Map(); // role → state

  function st(role) {
    let s = roles.get(role);
    if (!s) {
      s = { consecutive: 0, status: 'closed', openedAt: 0, probing: false };
      roles.set(role, s);
    }
    return s;
  }

  /** Snapshot with the lazy open→half_open transition on cooldown expiry. */
  function state(role) {
    const s = st(role);
    if (s.status === 'open') {
      const elapsedS = (now() - s.openedAt) / 1000;
      const cooldownS = getCooldownS ? getCooldownS() : DEFAULT_BREAKER_COOLDOWN_S;
      if (elapsedS >= cooldownS) {
        s.status = 'half_open';
        s.probing = false;
      } else {
        return { status: 'breaker_open', cooldownLeftS: Math.ceil(cooldownS - elapsedS) };
      }
    }
    if (s.status === 'half_open') return { status: 'half_open' };
    return { status: 'ok', consecutiveFailures: s.consecutive };
  }

  /** May a provider call go out right now? Claims the half-open probe slot. */
  function admit(role) {
    const snap = state(role);
    if (snap.status === 'ok') return true;
    if (snap.status === 'half_open') {
      const s = st(role);
      if (s.probing) return false;
      s.probing = true;
      return true;
    }
    return false;
  }

  function recordFailure(role) {
    const s = st(role);
    s.probing = false;
    s.consecutive += 1;
    const threshold = getThreshold ? getThreshold() : DEFAULT_BREAKER_THRESHOLD;
    if (s.status === 'half_open' || s.consecutive >= threshold) {
      s.status = 'open';
      s.openedAt = now();
    }
  }

  function recordSuccess(role) {
    const s = st(role);
    s.probing = false;
    s.consecutive = 0;
    s.status = 'closed';
    s.openedAt = 0;
  }

  function reset(role) {
    const s = st(role);
    s.probing = false;
    s.consecutive = 0;
    s.status = 'closed';
    s.openedAt = 0;
  }

  /** Release the half-open probe slot without a state change. */
  function settleProbe(role) {
    st(role).probing = false;
  }

  return { state, admit, recordFailure, recordSuccess, settleProbe, reset };
}

module.exports = {
  DEFAULT_BREAKER_THRESHOLD,
  DEFAULT_BREAKER_COOLDOWN_S,
  classifyLlmError,
  resolveBudget,
  createLimiter,
  createBreaker,
};
