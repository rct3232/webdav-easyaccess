'use strict';

/**
 * Wizard-surface projection of the shipped preset manifest (T1.1c —
 * docs/spec/server/routes/setup.md §2.2 GET /api/setup/llm-presets).
 *
 * Serves ONLY the chat/vision/asr-relevant rows: embed is not
 * wizard-configurable (the built-in engine ships with the product; a remote
 * embed override is an admin-only surface, llmPresets.md §2.5). Each row is
 * the public static shape `{ id, family, roles, expected }` — declared
 * expectations only, no probe results (the probe is the authority at test
 * time), no budgets/profiles/kwargs (server-side detail stays server-side).
 */

const { LLM_PRESETS } = require('../../infrastructure/adapters/llm/presets');

const WIZARD_ROLES = ['chat', 'vision', 'asr'];

const WIZARD_EXPECTED_KEYS = ['chat', 'vision_chat', 'asr'];

function wizardPresetRows() {
  return LLM_PRESETS.filter((row) => row.roles.some((role) => WIZARD_ROLES.includes(role))).map(
    (row) => {
      const roles = row.roles.filter((role) => WIZARD_ROLES.includes(role));
      const expected = {};
      for (const key of WIZARD_EXPECTED_KEYS) {
        expected[key] = Boolean(row.expected && row.expected[key]);
      }
      return { id: row.id, family: row.family, roles, expected };
    }
  );
}

module.exports = { wizardPresetRows, WIZARD_ROLES };
