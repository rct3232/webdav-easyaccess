'use strict';

/**
 * Process-wide llmAdapter singleton (llmAdapter.md §2.2 — "constructed once
 * by the boot wiring and handed to its consumers"). Same instance idiom as
 * getMigrationGate()/getSharedResolver(): boot initializes, consumers read;
 * tests reset.
 *
 * No lazy construction: getLlmAdapter() returns null before boot init and
 * consumers treat that as the role being unconfigured (they park, never
 * claim-and-fail — aiJobService §2.3 step 4).
 */

let instance = null;

/**
 * Construct and install the adapter.
 *
 * @param {Object} deps createLlmAdapter contract (configResolver required;
 *   health/probeRole/presetFor wired at boot).
 * @returns {Object} the installed adapter.
 */
function initLlmAdapter(deps) {
  const { createLlmAdapter } = require('./adapters/llm');
  instance = createLlmAdapter(deps);
  return instance;
}

/** The installed adapter, or null before boot init. */
function getLlmAdapter() {
  return instance;
}

/** Test seam: drop the installed adapter (the next init rebuilds it). */
function resetLlmAdapter() {
  instance = null;
}

module.exports = { initLlmAdapter, getLlmAdapter, resetLlmAdapter };
