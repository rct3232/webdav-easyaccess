'use strict';

/**
 * Unit tests for the process-local migration gate
 * (docs/spec/server/infrastructure/migrationGate.md). Uses an isolated
 * createMigrationGate() instance per test; the production shared singleton
 * (getMigrationGate) is covered separately.
 */

const {
  createMigrationGate,
  getMigrationGate,
  MIGRATION_IN_PROGRESS_CODE,
} = require('../migrationGate');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('createMigrationGate', () => {
  it('starts inactive (boot default)', () => {
    const gate = createMigrationGate();
    expect(gate.getStatus()).toEqual({
      active: false,
      type: undefined,
      jobId: undefined,
      startedAt: undefined,
    });
    expect(gate.isActive()).toBe(false);
  });

  describe('set', () => {
    it('transitions to active with type, jobId and an ISO startedAt', () => {
      const gate = createMigrationGate();
      const state = gate.set({ type: 'metadata', jobId: 'job-1' });

      expect(state.active).toBe(true);
      expect(state.type).toBe('metadata');
      expect(state.jobId).toBe('job-1');
      expect(state.startedAt).toEqual(expect.any(String));
      expect(new Date(state.startedAt).toString()).not.toBe('Invalid Date');
      expect(gate.isActive()).toBe(true);
    });

    it('generates a random UUID jobId when none is supplied', () => {
      const gate = createMigrationGate();
      const first = gate.set({ type: 'blobs' });
      expect(first.jobId).toMatch(UUID_RE);
    });

    it('supports both metadata and blobs types', () => {
      const gate = createMigrationGate();
      expect(gate.set({ type: 'metadata', jobId: 'm' }).type).toBe('metadata');
      gate.clear();
      expect(gate.set({ type: 'blobs', jobId: 'b' }).type).toBe('blobs');
    });

    it('throws on a second set while active (one migration at a time)', () => {
      const gate = createMigrationGate();
      gate.set({ type: 'blobs', jobId: 'first' });
      expect(() => gate.set({ type: 'metadata', jobId: 'second' })).toThrow(
        'Migration gate is already active'
      );
      expect(gate.getStatus().jobId).toBe('first');
      expect(gate.isActive()).toBe(true);
    });
  });

  describe('clear', () => {
    it('returns the gate to the inactive boot state', () => {
      const gate = createMigrationGate();
      gate.set({ type: 'blobs', jobId: 'job-1' });
      const state = gate.clear();
      expect(state).toEqual({ active: false, type: undefined, jobId: undefined, startedAt: undefined });
      expect(gate.isActive()).toBe(false);
    });

    it('is a no-op when already inactive', () => {
      const gate = createMigrationGate();
      expect(gate.clear()).toEqual({
        active: false,
        type: undefined,
        jobId: undefined,
        startedAt: undefined,
      });
    });
  });

  describe('reset', () => {
    it('clears an active gate (boot + test hook)', () => {
      const gate = createMigrationGate();
      gate.set({ type: 'metadata', jobId: 'job-1' });
      expect(gate.reset()).toEqual({
        active: false,
        type: undefined,
        jobId: undefined,
        startedAt: undefined,
      });
      expect(gate.isActive()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns a snapshot copy — mutating it does not change the gate', () => {
      const gate = createMigrationGate();
      gate.set({ type: 'blobs', jobId: 'job-1' });
      const snapshot = gate.getStatus();
      snapshot.active = false;
      snapshot.jobId = 'mutated';
      expect(gate.isActive()).toBe(true);
      expect(gate.getStatus().jobId).toBe('job-1');
    });
  });
});

describe('getMigrationGate (shared singleton)', () => {
  it('returns the same instance across calls', () => {
    expect(getMigrationGate()).toBe(getMigrationGate());
  });

  it('starts inactive at boot and is reset by reset()', () => {
    const gate = getMigrationGate();
    gate.reset();
    expect(gate.isActive()).toBe(false);
    gate.set({ type: 'metadata', jobId: 'boot-job' });
    expect(gate.isActive()).toBe(true);
    gate.reset();
    expect(gate.isActive()).toBe(false);
  });

  it('exposes the migrationInProgress error code', () => {
    expect(MIGRATION_IN_PROGRESS_CODE).toBe('migrationInProgress');
  });
});
