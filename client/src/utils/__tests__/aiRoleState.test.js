/**
 * aiRoleState tests — the admin 5-state mapping over backend-health tracker
 * rows (llmAdapter.md §2.4). Exhaustive mapping, ordered precedence.
 * @see docs/spec/client/utils/aiRoleState.md
 */
import { mapAiRoleState } from '../aiRoleState';

describe('mapAiRoleState', () => {
  it('maps null/undefined rows to null (caller skips the row)', () => {
    expect(mapAiRoleState(null)).toBeNull();
    expect(mapAiRoleState(undefined)).toBeNull();
  });

  it('preparing wins over everything (readiness fields, not status)', () => {
    expect(mapAiRoleState({ status: 'unknown', preparing: true, phase: 'provisioning' })).toEqual({
      state: 'preparing',
      phase: 'provisioning',
      progress: undefined,
      reason: undefined,
    });
    expect(
      mapAiRoleState({ status: 'unknown', preparing: true, phase: 'provisioning', progress: '3/7 files' })
    ).toEqual({
      state: 'preparing',
      phase: 'provisioning',
      progress: '3/7 files',
      reason: undefined,
    });
  });

  it('ok with a hint is partial (declared-vs-probed warning rides the hint)', () => {
    expect(mapAiRoleState({ status: 'ok', hint: 'ai.declaredNotProbed' })).toEqual({
      state: 'partial',
      phase: undefined,
      progress: undefined,
      reason: undefined,
    });
  });

  it('ok without a hint is ok', () => {
    expect(mapAiRoleState({ status: 'ok' })).toEqual({
      state: 'ok',
      phase: undefined,
      progress: undefined,
      reason: undefined,
    });
  });

  it('fail is probe_failed and carries the reason diagnostic', () => {
    expect(mapAiRoleState({ status: 'fail', reason: 'model unreachable' })).toEqual({
      state: 'probe_failed',
      phase: undefined,
      progress: undefined,
      reason: 'model unreachable',
    });
  });

  it('unknown status is not_configured', () => {
    expect(mapAiRoleState({ status: 'unknown' })).toEqual({
      state: 'not_configured',
      phase: undefined,
      progress: undefined,
      reason: undefined,
    });
    expect(mapAiRoleState({})).toMatchObject({ state: 'not_configured' });
  });
});
