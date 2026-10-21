'use strict';

/**
 * Test-scope helper: shapes evaluateCapabilityMatrix entries into compact
 * summaries for cross-row invariant assertions (kept out of the production
 * module — evaluation output stays the §2.2a contract shape).
 */

function matrixSummaries(results) {
  return results.map((entry) => ({
    capability: entry.capability,
    declared: entry.declared,
    probed: entry.probed,
    enabled: entry.enabled,
    note: entry.note,
  }));
}

module.exports = { matrixSummaries };
