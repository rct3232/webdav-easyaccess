'use strict';

/**
 * Process-local migration gate (PLAN D2-D4, docs/spec/server/infrastructure/
 * migrationGate.md). While a migration runs, every HTTP route except the
 * allow-list returns `503 migrationInProgress`, locking the app into the
 * `/migration` page. The gate state is exposed publicly so the client
 * app-guard and the `/migration` page can poll it.
 */

const crypto = require('crypto');

// i18n error code returned by the gating middleware for non-allow-listed
// requests while the gate is active. The key must be added to
// shared/serverMessageCodes.js and the client locale files by the migration
// router owner (migration.js is owned by another agent).
const MIGRATION_IN_PROGRESS_CODE = 'migrationInProgress';

function inactiveState() {
  return {
    active: false,
    type: undefined,
    jobId: undefined,
    startedAt: undefined,
  };
}

/**
 * Factory — tests get an isolated instance; production uses the shared
 * singleton returned by `getMigrationGate()`.
 */
function createMigrationGate() {
  let state = inactiveState();

  /**
   * Set the gate to active. Rejects (throws) when a migration is already
   * running so a second migration can never be started concurrently.
   */
  function set({ type, jobId } = {}) {
    if (state.active) {
      throw new Error('Migration gate is already active');
    }
    state = {
      active: true,
      type,
      jobId: jobId || crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    };
    return state;
  }

  /**
   * Clear the gate to the inactive boot state. Called when a job reaches a
   * terminal state (completed / failed / cancelled).
   */
  function clear() {
    state = inactiveState();
    return state;
  }

  /** Reset to inactive (boot + test hook). */
  function reset() {
    state = inactiveState();
    return state;
  }

  /** Snapshot for GET /api/migration/status and the gating middleware. */
  function getStatus() {
    return { ...state };
  }

  /** Convenience predicate for route handlers (e.g. start-conflict checks). */
  function isActive() {
    return state.active;
  }

  return { set, clear, reset, getStatus, isActive };
}

let sharedMigrationGate = null;

/**
 * The single gate instance used across the process (boot reset + gating
 * middleware + migration router). Lazily created; no dependency work happens
 * at require time.
 */
function getMigrationGate() {
  if (!sharedMigrationGate) {
    sharedMigrationGate = createMigrationGate();
  }
  return sharedMigrationGate;
}

module.exports = { createMigrationGate, getMigrationGate, MIGRATION_IN_PROGRESS_CODE };
