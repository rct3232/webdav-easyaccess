# AiAdminContent Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Admin AI operations and monitoring surface. Renders the governance blocks of the AI platform in one scrollable column: pipeline health, cost ledger, evolution governance, model registry, text/media coverage, config-backed gates, the unified text+media re-embed launcher, and the settings-journal rollback feed. |
| Used in            | MyPageContentArea (when selectedCategory is `admin-ai`)                                                                                                                                                                                                                                                                |
| Related components | adminService, useAiAdminPanel, ConfirmDialog, SystemSettingsContent (cross-link), backend-health `ai.*` rows                                                                                                                                                                                                           |
| Visibility         | Admin only. The category is absent for non-admins (not disabled).                                                                                                                                                                                                                                                      |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `client/src/components/mypage/content/AiAdminContent.js`
- **Hook:** `client/src/pages/MyPage/hooks/useAiAdminPanel.js`
- **Tests:** `client/src/components/mypage/content/__tests__/AiAdminContent.test.js`,
  `client/src/pages/MyPage/hooks/__tests__/useAiAdminPanel.test.js`

### 2.2 Props

None. The component is zero-prop and uses the shared message context for feedback
(`useMessage`). Cross-links to `admin-settings` use the router directly.

### 2.3 Layout contract (U1)

- One scrollable column. No content-level sub-tabs and no accordions.
- A summary strip at the top anchors each block (`scrollIntoView`): Pipeline, Cost,
  Evolution, Models, Coverage, Gates, Launcher, Journal.
- The kill-switch block is a sticky top area (`position: sticky`, top of the scroll
  container) so pause controls stay reachable while the operator scrolls.
- Section headers carry stable ids (`ai-panel-pipeline`, `ai-panel-cost`,
  `ai-panel-evolution`, `ai-panel-models`, `ai-panel-coverage`, `ai-panel-gates`,
  `ai-panel-launcher`, `ai-panel-journal`).

### 2.4 Data contract (GET /api/admin/ai/summary)

The hook polls the summary endpoint (default 15 s) with an in-flight guard and cleans
the timer up on unmount. The component renders only snake_case fields from the response:

| Block     | Fields rendered                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline  | `generated_at`; queue counts (pending/running/done/failed/skipped/cancelled) + `total`; 24 h failed/finished counts + failure rate; failed jobs table (id/node_id/kind/generation/status/attempt/last_error/created_at/finished_at, capped at 20 rows) with **no actions**; readiness capability rows; breaker states labelled with the server reason.                              |
| Cost      | Today's `ai_usage_daily` per-role ledger (calls/input_chars/cached/degraded/failed_429) and the daily call/token caps. The per-role `degraded` counter is the v1 degraded-input surface; the per-user top-N list is labelled `not instrumented`. Low-value diagnostics are API-only and are not rendered.                                                                           |
| Evolution | Latest `admin_reports(kind='night_eval')` totals and the live pending merge-suggestion count. `evolution.not_instrumented` drives the labels for survival curves, merge-accept series and per-version history.                                                                                                                                                                      |
| Models    | Per-role active row (id/model/engine/provider) + the actual history rows (id/model/engine/provider), and per-active-model profile provenance (`dim`, `calibrated`, `pooling`, `request_shape`, `dtype`, `mrl_dims`, `text_prefixes`). No hardcoded evolution gate is rendered.                                                                                                      |
| Coverage  | `available`/`reason`; text totals (files/embedded/missing/stale) with `by_source`; media totals (media/embedded/missing/stale) with `by_source`/`by_media_kind`/`by_capability`/`by_corpus`. Missing model ⇒ reason-carrying `not instrumented`, never fabricated zeros.                                                                                                            |
| Gates     | Kill switches render as sticky switches. Numeric/text gates render one editor row each with value, source, impact metric and the live impact count returned by the server; a null count is labelled `no data`, an uninstrumented metric is labelled `not instrumented`, and a null kill-switch value renders as `unknown` (not `off`). Save writes through `PUT /api/admin/config`. |
| Launcher  | Text/media/union plan counts, active model id, current per-kind generations (embed/features/caption/asr), availability/reason and `active_jobs`. Preview → one `ConfirmDialog` → `POST /api/admin/ai/reembed`. Progress is read from the polled queue block; there is no parallel progress UI.                                                                                      |
| Journal   | `GET /api/actions?domain=settings` feed (newest first); each applied row offers undo (`POST /api/actions/:id/undo`). The re-embed row's undo cancels pending jobs only. A journal read failure renders an error with retry; it is distinct from the empty-feed state.                                                                                                               |

### 2.5 Launcher flow (U3)

1. `Preview` calls `GET /api/admin/ai/reembed/preview` and renders deterministic text
   and media coverage counts plus the union plan count. When `preview.available` is
   false, the panel renders `preview.reason` (`active_run` while the previous launch's
   ids are still pending/running, `model_unavailable` with no active embed model) and
   never the plan counts (no `0/0/0`).
2. `ConfirmDialog` asks once; confirming calls `POST /api/admin/ai/reembed`.
3. Success reports `enqueued` and `generation` only, then refreshes the summary; the
   pipeline-health queue is the only progress surface. `job_ids` stay API-only because
   the server-side journal inverse owns cancel-by-id.
4. A 409 active/model error renders its translated message.
5. The launcher never enqueues without the server-side journal row; the UI has no
   alternate enqueue path.

### 2.6 Gates and kill switches (W6)

- Only keys returned by the server are editable. Hardcoded create/merge thresholds and
  profile fallbacks are never rendered as controls.
- Kill switches save immediately through `updateConfig`; every curated gate/kill-switch
  write is journaled server-side. A null switch value is `unknown` (disabled), never `off`.
- The journal block provides the rollback feed. There is no client-side persistence.
- Null-safe formatting is mandatory: a null/absent scalar renders `—` or the relevant
  `not instrumented`/`no data` label, never `0`. The labels for `not_instrumented` series
  come from the API lists/booleans, not from fixed client copy.

### 2.7 Role split and cross-links (U2)

- The five-state `ai.<role>` warning rows and their probe target stay in
  SystemSettingsContent. This panel shows the fuller operations surface and never
  duplicates the warning-card render.
- The panel offers `Open system settings`; SystemSettingsContent offers
  `Open AI operations`. Both navigate to `/mypage` with `state.category`
  (`admin-settings` / `admin-ai`).
- `Probe AI roles` calls `POST /api/admin/config/test` with `target: 'llm'` and the
  configured role; the server resolves stored credentials, so no secret reaches the
  client payload.

### 2.8 i18n keys

All copy is under `admin.aiPanel.*` (sections, queue labels, cost columns, evolution
totals, model profile flags, coverage labels, gate labels, launcher flow, journal feed,
cross-links, probe feedback) plus the existing `admin.aiState.*` and
`serverErrors.admin.reembed*` mirrors.

### 2.9 Verification Scenarios

- [ ] Renders every block from the summary payload; failed jobs have no retry/abandon
      control and the display-only note is visible.
- [ ] Polls with an in-flight guard: a slow response never overlaps the next tick, and
      unmount clears the interval.
- [ ] Kill switches and gate editors write only server-provided keys; success refreshes
      the summary and the settings journal block.
- [ ] Launcher preview renders text+media counts; one confirm dialog gates the POST; a
      409 active-run error disables the launcher; success points progress at the queue block.
- [ ] Missing series render the API-driven `not instrumented` label and never a fabricated
      value; null scalars render `—`, a null gate impact renders `no data`, and a null kill
      switch renders `unknown`.
- [ ] An unavailable preview renders its reason and no plan counts; a journal read failure
      renders an error with retry, distinct from the empty feed.
- [ ] Cross-links land on `admin-settings` / `admin-ai`; the sidebar row has no status
      chip (the sidebar is a pure view and the controller performs no network reads).
- [ ] Non-admin visibility is enforced by the registry/controller, not by a disabled row.
