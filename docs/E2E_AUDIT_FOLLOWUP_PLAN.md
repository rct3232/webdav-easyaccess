# E2E Audit Follow-up Plan

Status: execution ledger for the second audit follow-up.
Baseline: `refactor/e2e-suite-restructure` after the first audit remediation.

## 1. Objective

Close the remaining valid audit findings:

- P1-1: decide and enforce the collection-sidebar undo contract without
  platform-specific re-open masking.
- P1-2: make WebDAV a no-retry release gate and document both release commands.
- P2-2: enforce expected skip counts.
- P2-3: block ambient file-backend/WebDAV environment overrides.
- P2-1/P2-4/P2-5: correct historical counts, remove stale docs/comments, and
  restore non-scratch latency sensitivity.

## 2. Product contract decision: P1-1

### Chosen contract: route auto-expand, preserve manual collapse

- When the current route is a collections route (`/__collections__` or a child),
  the Collections section is expanded on first render/remount.
- If the user explicitly collapses the section, that manual `false` state is
  preserved while the route remains unchanged.
- An undo/notifier refresh must not silently change an expanded section to
  collapsed.
- After rename undo on `/files/__collections__`, when the section was expanded
  before the undo:
  - `collections-toggle` exposes `aria-expanded="true"`;
  - `collection-row-<id>` is visible with the restored name;
  - the old renamed row is absent.
- Desktop and mobile assert the same state. Mobile may open the folder-tree
  drawer, but must not click the Collections section toggle after undo.
- If the product owner instead chooses collapse-after-undo, the spec must be
  changed first; the toggle must expose `aria-expanded="false"` on both
  platforms and no test may re-open the section to pass.

## 3. Task graph

| Task | Objective                      | Outputs                                                                         | Verification                                     | Deps                     |
| ---- | ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------ |
| F-D1 | Rewrite follow-up docs         | strategy/git/coverage/spec/stale docs                                           | prettier; generic-doc grep                       | none                     |
| F-P1 | Implement sidebar contract     | `CollectionsSection` aria-expanded; controller route/manual state; unit tests   | RTL/unit tests; targeted collection E2E          | none                     |
| F-E1 | Align collection E2E           | desktop/mobile same post-undo assertions; mobile drawer only                    | targeted COLLECTION-018 at workers 2             | F-P1                     |
| F-G1 | Release/skip/ambient hardening | webdav release commands; skip-count reporter; ambient keys; timeout sensitivity | list/dry runs; ambient rejection; targeted gates | none                     |
| F-C1 | Stale code/comment cleanup     | trash retired ID, minio bucket comment, unused global bucket, MIG-004 wording   | grep; lint/format                                | none                     |
| F-V1 | Integration                    | merge workstreams                                                               | list counts                                      | F-D1/F-P1/F-E1/F-G1/F-C1 |
| F-V2 | Full verification              | default/core/webdav + release + server/client/PG/vector                         | all gates green                                  | F-V1                     |

## 4. Sub-agent split

- **Product/E2E sub-agent**: F-P1, F-E1. Client/folder-tree code, client tests,
  `e2e/collections.spec.ts`.
- **Gate/runner sub-agent**: F-G1. `playwright.config.ts`, `package.json`,
  release/skip reporter, ambient guard, timeout policy, E2E skip helper only.
- **Docs sub-agent**: F-D1. `docs/**` only. No code.
- **Cleanup sub-agent**: F-C1. Stale E2E comments/global setup/minio comment.
- Main: integration, conflict resolution, full verification.

## 5. Acceptance criteria

- Collections section has a real `aria-expanded` state.
- Desktop and mobile both assert expanded + restored row after undo; mobile
  only opens the drawer, never clicks `collections-toggle`.
- Controller unit tests cover route auto-expand, notifier refresh preservation,
  remount, and manual collapse.
- `test:e2e:release:webdav` exists with zero retries and fail-on-flaky; both
  release commands are documented.
- Expected skip counts are enforced (default 6, core 3, WebDAV 0); extra skips
  fail the release gate.
- Ambient `WEA_FILE_STORAGE`/`WEBDAV_*` overrides are rejected.
- Historical WebDAV matrix is recorded as 166 collected / 160 executed, with
  definitions, if baseline evidence confirms it; no ambiguous single count.
- Stale comments/docs and unused global bucket are removed or corrected.
- Global non-scratch expect timeout is reduced toward the 15s baseline while
  scratch boot/restart suites keep explicit budgets.
- Full default/core/WebDAV, release variants, server/client/PG/vector pass.
