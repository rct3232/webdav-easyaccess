# PLAN.md

## Objective (current workstream)
Cut E2E wall-clock (~23 min on low-spec) without losing the suite's defect net.

Scope principle (user-decided):
- E2E verifies UI correctness only (interaction → user-visible result). Detailed
  behavior lives in unit/integration.
- Environments with a different UI are all exercised (desktop vs mobile = yes;
  s3 vs webdav = same UI, so backend wiring is a server-tier concern).
- Any E2E test creates/asserts only inside a case-owned folder ("assertion-context
  containment") so parallelism never breaks visibility assertions.

Agreed decisions:
- **Option A (mode matrix):** full UI E2E runs once on `s3` (essentials +
  mypage-admin + hermetic included). `webdav` reduces to a thin smoke (chromium
  desktop only; content-integrity nets EXP-012/013, SHARE-011, OVERLAY-011 kept)
  + real-webdav wiring covered at the server tier.
- **Data containment = E2E writing policy** (docs-first): `core-flow.*` converts
  to per-case owned folders; enables intra-project `workers>1`.
- Concurrency is applied only where isolation analysis proves safe.

Prior workstream (DB-interface refactor, D1–D10) completed 2026-09-04 — see git
log (`dev`, `9a1ed90`..`fdaa084`).

## Key Components
- `playwright.config.ts` project matrix (mode x platform; hermetic additive).
- `e2e/` specs + helpers (`files.ts` `buildName`, `setupScratch.ts`, `seedDb.ts`).
- Docs: `docs/TESTING_STRATEGY.md` (E2E policy), `docs/E2E_COVERAGE_PLAN.md`
  (inventory), `docs/TEST_GIT_GUIDE.md` (run rules), `docs/IMPROVEMENT_PLAN.md`.

## Success Criteria
1. s3-full + webdav-smoke provide the same defect net as today's
   webdav-full + s3-full, at roughly half the wall-clock.
2. `core-flow.*` cases own their data; `--workers=1` vs `--workers=2` produce an
   identical passed/skipped set (repeat 3×).
3. Containment policy documented and every E2E edit complies.

## Task dependency graph
```
W0  PLAN.md rewrite + env baseline readiness             ← done now
W1  Baseline measurement (json reporter; s3 core/full)   ← first (before edits)
W7  Docs-first policy: assertion-context containment      (TESTING_STRATEGY +
    E2E_COVERAGE_PLAN 1-line + IMPROVEMENT_PLAN backlog)
W2  Mode matrix: full s3 run; webdav thin smoke project + scripts + docs
W3  (decide) content-integrity 4 nets: stay in webdav smoke (default) vs
    new real-webdav server leg
W4  Containment refactor core-flow.shared/desktop/mobile (workers=1 equal
    first) → fix B2/B3 → intra-project workers=2 verification
W5  Hermetic overlap: distinct scratch ports + webdav restart fix + migration
    bucket ordering → run hermetic beside core
W6  Migration/hermetic depth trim (server suites exist: migrationService,
    metadataMigrationService, migrationJobStore, migrationGate)
W10 Final verify + docs + PLAN close-out
```
W1 before W2/W4. W7 independent → parallel. W2 → W5. W6 independent.
W4 needs W1 gate; W3 optional after W2.

## Blockers found (isolation analysis)
- B1 admin root == fs root; client renders 50 items/listing; root accumulates
  ~47 folders/project → visibility asserts depend on creation order (workers=1).
- B2 auth (registration toggle, pending users) ↔ mypage-admin (.first() picks).
- B3 file-scope beforeAll fixtures re-created per worker (share-public).
- B4 hermetic share :5003; migration empties shared S3 bucket.
- B5 login rate-limit per-IP (20/15min); PG pool max=10.

## Recording
- 2026-09-07: analysis done (duration structure, isolation blockers A/B,
  backend-mode dependence); decisions Option A + containment policy.
- 2026-09-07: **W1 baseline (core s3, essentials)**: 122 executions, 119 pass /
  0 fail / 3 skip (mobile-only). Pure test time ≈ 352s: core-flow.shared 138s,
  share-internal 49s, mypage-user 46s, core-flow.desktop 44s, share-public 35s,
  auth 25s, core-flow.mobile 13s. Full-mode extra = mypage-admin + hermetic
  (boot-heavy) — dominant wall-clock outside essentials.
- 2026-09-07: **W7a docs policy landed** (TESTING_STRATEGY assertion-context
  containment; E2E_COVERAGE_PLAN 1-line; IMPROVEMENT_PLAN DEF-15).
- 2026-09-07: **W2 mode matrix** in progress (s3 = full UI incl. hermetic;
  webdav = smoke desktop).
- 2026-09-07: **W2 done + validated**: config now branches by mode — s3 keeps the
  full desktop/mobile matrix + hermetic; webdav defines `webdav-smoke-setup` +
  `webdav-smoke-desktop` (grep: EXP-00[12458]/EXP-01[23]/SHARE-011/OVERLAY-011).
  --list parity: s3 full 186, s3 core 122 (== W1). Webdav smoke run: 10/10 pass,
  ~23s pure test time (real webdav store incl. content-integrity nets). Docs
  updated docs-first (E2E_COVERAGE_PLAN mode-matrix section, TEST_GIT_GUIDE
  scripts/assumptions).
- 2026-09-07: **W4 (containment refactor core-flow.\*)** next.
- 2026-09-07: **W4 done + verified**:
  - helper `openPrivateWorkspace` (per-test base under `/`, API-created) +
    `createFolderAt` accepts null parent; converted core-flow.shared/desktop/mobile
    (admin-root tests now create/assert inside `/<base>`; EXP-001/012/013 untouched).
  - Full core s3 regression: 122 exec / 119 pass / 0 fail / 3 skip (== W1), pure
    test time 369s.
  - Order-independence: core-flow subset workers=1 vs 2 sets identical —
    desktop 26 (25p/1s), mobile 18 (18p). lint clean (e2e eslint-ignored);
    prettier clean.
  - Remaining for whole-core workers=2: B2 (auth↔mypage-admin cross-file) and
    B3 (share-public file-scope fixtures). Option: split mypage-admin into its
    own post-reset project serialized after each platform core; mark
    share-public serial. Recorded as next step (W4b).
- 2026-09-07: **W4b done** — B3 fixed (share-public describe now `serial` so its
  project-scoped fixture tree is never re-created per worker). Core scripts
  (`test:e2e:core`, `test:e2e:core:s3`) default to `--workers=2`; full runs stay
  `--workers=1`. Full-core s3 at workers=2 run twice: result set identical to the
  w1 baseline both times (122 exec / 119 pass / 0 fail / 3 skip); wall ≈ 4.5 min
  vs ≈ 15.8 min for the w1 run (w1 figure includes cold-boot; treat as indicative).
  B2 (admin) is excluded from core mode; full-mode admin split + hermetic
  port/bucket isolation remain for W5.
- 2026-09-07: **W5 done** — full-mode mypage-admin moved into dedicated
  post-reset projects (`s3-admin-desktop[-setup]`, `s3-admin-mobile[-setup]`) so
  it never overlaps `auth.spec` (B2). Hermetic suites are chained strictly AFTER
  the platform+admin chain and sequentially among themselves (fixed :5003 port;
  migration empties the shared bucket), which keeps full runs safe at workers>1.
  Fixed E2E-ADMIN-008 to scope its success-alert locator (an extra env-setup
  warning banner shares role=alert). Full `test:e2e`/`test:e2e:s3` default to
  `--workers=2`.
- 2026-09-07: **W10 final gate (s3)** — full s3 @ workers=2: 185 expected /
  3 skipped / 0 unexpected / 0 flaky, wall ≈ 9.3 min (platform w2 + admin +
  hermetic sequential). Webdav smoke re-run: 10/10 pass. Core-mode equivalence
  (w1==w2) verified earlier (see W4/W4b).
- 2026-09-07: close-out notes — measured on this machine: full s3 w2 ≈ 9.3 min,
  core s3 w2 ≈ 4.5 min, webdav smoke ≈ 45 s test time (+boot). Full webdav UI
  duplicate retired (Option A). Remaining optional: true hermetic overlap via
  per-project scratch ports + dedicated migration bucket (currently hermetic is
  a sequential tail), and W6 migration/hermetic depth trim (server suites exist).
- 2026-09-07: **W6 reassessed — closed with no net removal**. Measured hermetic
  test time is only ≈ 4 min (231s of 752s); slowest single case ≤ 15 s. The
  migration/setup/admin-config deep DB/.env/blob asserts are the suite's ONLY
  real-webdav / real-config-write coverage — the server tier tests these paths
  exclusively with mocked/fake stores (docs/TESTING_STRATEGY.md), so deleting the
  E2E depth would open a defect-net gap that violates success criterion 1. Poll
  budgets (60-90 s) and 240 s describe timeouts are low-spec safety floors, not
  normal-path costs, so trimming them only raises flake risk. Resolution: keep
  hermetic suites as-is; a real-webdav server leg (W3 option B) would be the
  prerequisite for any future depth move — recorded in IMPROVEMENT_PLAN.
- 2026-09-07 (post-merge): explicit `--workers=N` flags removed from all e2e
  scripts — Playwright now auto-sizes workers to half the logical cores (min 1).
  Core s3 at the auto value (3 workers on this 6-core machine) matches the w1
  baseline exactly (122 exec / 119 pass / 0 fail / 3 skip); wall ≈ 4.1 min.
- 2026-09-07 (fix branch, E2E hardening): each case-owned workspace base folder
  is now deleted via the API in `test.afterEach`
  (`flushPrivateWorkspaceCleanups` in `e2e/helpers/files.ts`), so the admin root
  never accumulates ~40 `workspace-*` folders per run (root-cap drift removed).
  Bare `getByRole('alert')` in E2E-ADMIN-003/004 scoped to the success text
  (same class as the E2E-ADMIN-008 fix). Docs updated docs-first (TESTING_STRATEGY
  + E2E_COVERAGE_PLAN containment lines). Verified: full s3 185 pass / 3 skip /
  0 fail; webdav smoke 10/10 — both equal to baseline.
