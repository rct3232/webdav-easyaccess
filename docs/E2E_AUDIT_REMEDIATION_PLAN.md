# E2E Audit Remediation Plan

Status: execution ledger for the audit follow-up.
Baseline: `refactor/e2e-suite-restructure` (post S3-first restructure).

## 1. Objective

Close the valid E2E audit findings without reintroducing project dependencies,
per-project WebDAV containers, or a fixed worker cap.

The corrected audit verdict is:

- P1: migration D-2 settings-copy realism; migration gate/role default coverage;
  exactly-once attempt proof; retrieval first-Enter contract; timeout/latency
  sensitivity; product retry/timeout unit coverage; CI skip semantics; runner
  environment pinning; same-session/undo state preservation.
- P1 (conditional P0): gate/role is P0 only if the WebDAV job is not run by the
  release process.
- P2: debug logs, coverage status vocabulary, WebDAV matrix trade-off, stale
  documentation.

## 2. Decisions

### 2.1 Gate/role coverage

Add a default-S3 gate/role case using **S3 source -> WebDAV destination tarpit**
(a local raw TCP tarpit, not a WebDAV container). Keep the existing
WebDAV-source gate/role cases in the WebDAV job. The WebDAV job remains the
required release gate for real WebDAV-specific regression coverage; the default
S3 gate no longer relies solely on that job for generic gate/role behavior.

### 2.2 Exactly-once

Remove the POST retry from gate setup. A deliberate second POST is allowed to
prove the server returns 409 and that only one job/gate exists. If transport
retry is ever needed, it must use an idempotency key and assert the server job
count, not merely classify the thrown error.

### 2.3 Timeout policy

Separate infrastructure wait budgets from product latency assertions. Do not
use a global timeout increase as the only response to weak-CI load. Keep
per-case budgets only where a scratch boot/restart is the behavior under test.
Add a release command that runs with no retries and fail-on-flaky.

### 2.4 Documentation ownership

- `docs/TESTING_STRATEGY.md`: general principles only. No suite/case/project,
  port, or ID names.
- `docs/TEST_GIT_GUIDE.md`: commands, environment, Docker/band, worktree/CI
  operation only. No suite/case/project, port, or ID names.
- `docs/E2E_COVERAGE_PLAN.md`: canonical suite/project/case/ID/slot/skip and
  backend-coverage mapping.
- `docs/E2E_SUITE_RESTRUCTURE_PLAN.md`: execution history; link to coverage
  plan rather than duplicating canonical inventory.
- Product retry/timeout contracts belong in feature/spec docs.

### 2.5 Skip and runner policy

- CI-required resources absent (WebDAV/PG/AI weights) must fail, not skip.
- `test:e2e` and `test:e2e:core` pin group + backend.
- Mixed `E2E_GROUP=default` + `E2E_BACKEND_MODE=webdav` is rejected.
- Reusing an existing server is explicit opt-in only.
- Same-checkout default/WebDAV parallel runs are unsupported; use separate
  worktrees/bands.
- Destructive seed/bucket operations must not use ambient `WEA_DB_*`/`S3_*`.

### 2.6 State preservation

- Do not use `page.reload()` to bypass migration dialog fetch-queue issues.
- Do not re-open a collapsed tree merely to make an undo-state assertion pass.
- If the product intentionally remounts/collapses the tree, assert that
  observable state explicitly; otherwise fix the product behavior.

## 3. Task graph

| Task   | Objective                                       | Outputs                                                                      | Verification                                  | Deps       |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- | ---------- |
| AUD-D1 | Rewrite TESTING_STRATEGY principles             | generic strategy doc                                                         | grep: no suite/case/project/port/ID; prettier | none       |
| AUD-D2 | Rewrite TEST_GIT_GUIDE runner/environment rules | generic git/run guide                                                        | grep; command list; prettier                  | none       |
| AUD-D3 | Coverage plan canonicalization                  | runtime matrix, caveats, status vocabulary, trade-off, fixed rows            | table consistency; counts                     | none       |
| AUD-D4 | Plan/RCA/product-doc corrections                | corrected plan, health/webdav/PG docs                                        | prettier; spec consistency                    | none       |
| AUD-S1 | Product retry/timeout unit tests and defaults   | MKCOL/health/PG tests; default/negative validation                           | server focused + test:ci                      | none       |
| AUD-E1 | Migration D-2 settings realism                  | actual DB settings seed + key/value assertions; debug logs removed           | targeted migration E2E                        | none       |
| AUD-E2 | Default-S3 gate/role variant                    | S3 source -> WebDAV tarpit case; 202/409/role assertions                     | targeted default E2E                          | E1 helpers |
| AUD-E3 | Exactly-once cleanup                            | no POST retry; second POST 409; one job                                      | targeted WebDAV/default E2E                   | E2         |
| AUD-E4 | Retrieval first-Enter contract                  | request counter; one Enter; no blind 4s; no retry loop                       | targeted retrieval E2E                        | none       |
| AUD-E5 | Runner/CI/env/skip hardening                    | pinned scripts, mixed rejection, reuse opt-in, CI skip fail, release command | `--list`; targeted scripts; grep              | none       |
| AUD-E6 | Same-session/undo restoration                   | remove reload/re-open workarounds; observable waits                          | targeted migration/collections E2E            | E1         |
| AUD-V1 | Integration                                     | merged branches, conflict resolution                                         | full list                                     | D/E/S      |
| AUD-V2 | Full verification                               | E2E/core/WebDAV, server/client/PG/vector, prettier                           | all gates                                     | V1         |

## 4. Workstream split for sub-agents

- **Docs sub-agent**: AUD-D1..D4, docs only.
- **E2E sub-agent A**: AUD-E1, E2, E3, E4, E6 (migration/retrieval/collections specs and helpers).
- **E2E sub-agent B**: AUD-E5 (config/package/skip/runner/timeout) only.
- **Server sub-agent**: AUD-S1 (server code/tests only).
- Main agent: plan, integration, conflict resolution, full gates.

## 5. Acceptance criteria

- `TESTING_STRATEGY.md` and `TEST_GIT_GUIDE.md` contain no concrete
  suite/case/project/port/ID names.
- Coverage plan contains the runtime/project/slot matrix and explicit
  gate/role, settings, exactly-once, retrieval, skip, and WebDAV trade-off
  caveats.
- Migration D-2 seeds real DB settings and compares their values.
- Default S3 group has a gate/role case that proves 202, 409, and role routing
  without a WebDAV container.
- Exactly one migration job is proven; no non-idempotent POST retry.
- Retrieval proves one first-Enter request.
- CI-required resource absence fails; expected skip counts are documented.
- `test:e2e` is pinned to default+S3 and mixed mode is rejected.
- MKCOL/health/PG timeout branches have focused unit tests.
- Same-session resume and undo tree state are asserted without reload/re-open
  masking.
- Full server/client/PG/vector and E2E groups pass.
- Changed files are Prettier-clean.
