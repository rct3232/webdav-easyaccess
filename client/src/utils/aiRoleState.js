/**
 * Admin 5-state mapping over backend-health tracker rows (T1.1c).
 *
 * Turns a `GET /api/admin/health` `backends['ai.<role>']` row into the admin
 * 5-state display value `not_configured | preparing | probe_failed | partial |
 * ok` (docs/spec/server/infrastructure/llmAdapter.md §2.4). Pure function —
 * no i18n, no fetch, no React — consumed by the admin health card and
 * reusable by the AI governance panel (P4).
 *
 * Mapping precedence (docs/spec/client/utils/aiRoleState.md):
 * 1. `preparing: true` → 'preparing' (readiness fields, never status);
 * 2. `status: 'ok'` with a hint → 'partial' (declared-vs-probed warning);
 * 3. `status: 'ok'` → 'ok';
 * 4. `status: 'fail'` → 'probe_failed' (reason diagnostic attached);
 * 5. otherwise → 'not_configured'.
 * @param {Object|null} row backend-health tracker row (backendHealth.md §2.2)
 * @returns {{ state: string, phase?: string, progress?: string, reason?: string } | null}
 */
export function mapAiRoleState(row) {
  if (row == null) return null;

  if (row.preparing === true) {
    return {
      state: 'preparing',
      phase: row.phase,
      progress: row.progress,
      reason: undefined,
    };
  }
  if (row.status === 'ok') {
    if (row.hint)
      return { state: 'partial', phase: undefined, progress: undefined, reason: undefined };
    return { state: 'ok', phase: undefined, progress: undefined, reason: undefined };
  }
  if (row.status === 'fail') {
    return {
      state: 'probe_failed',
      phase: undefined,
      progress: undefined,
      reason: row.reason,
    };
  }
  return { state: 'not_configured', phase: undefined, progress: undefined, reason: undefined };
}
