# Agent Guidelines

This document defines the mandatory workflows and standards for all agents working on this project.

## 1. General Principles

- **Language**: All documentation, commit messages, and technical communications must be written in English.
- **Source of Truth**: Always refer to `/docs` (spec, features, contracts) before making assumptions about behavior.

### 1.1 Core Reference Documents

**Read the applicable document(s) BEFORE reading code or making changes:**

| Document | Read when... |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Designing any change (new modules/endpoints, layer boundaries, code placement, client/server integration) |
| [docs/CODING_STYLE.md](docs/CODING_STYLE.md) | Writing or refactoring ANY source file (naming, imports, React/Express patterns) |
| [docs/shared-contracts.md](docs/shared-contracts.md) | Changing data formats, error shapes, or constants shared between client/server/tests |
| [docs/api.md](docs/api.md) | Adding or modifying REST API endpoints |
| [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Writing tests or deciding test scope |
| [docs/TEST_GIT_GUIDE.md](docs/TEST_GIT_GUIDE.md) | Running test suites, committing tests, or touching CI/E2E environment |

Rules:

- If your change contradicts a core document, STOP and ask the user.
- If your change makes a core document stale, update that document in the same PR.

## 2. Development Workflow

### 2.1 Implementation Order (Docs-First)

**Mandatory for any feature or bug fix. Never skip or reorder a step.**

1. **Docs**: Identify the affected spec/feature docs and core reference docs (§1.1), review them, and update them (`docs/spec/`, `docs/features/`) before any code change.
2. **Tests**: Write tests from the updated docs before implementation (TDD); they are expected to fail initially.
3. **Code**: Implement following `docs/ARCHITECTURE.md` and `docs/CODING_STYLE.md` until the tests pass.
4. **Verify**: Run the relevant suites (`npm run test:ci`, plus E2E/PG legs per §2.2 when applicable) and confirm all pass before committing.
5. **Track unresolved work** only in `docs/IMPROVEMENT_PLAN.md`; spec/feature docs describe the current implemented/decided state only.

### 2.2 Branching Convention

**Mandatory before any source code edit (non-trivial changes).**

1. **Check existing branches**: Run `git branch` to see if a suitable branch already exists.
2. **Create branch if needed**: If no appropriate branch exists, create one following the naming convention:
   - Format: `<category>/<task-name>` (lowercase, hyphen-separated)
   - Categories: `feature/`, `fix/`, `refactor/`, `test/`, `chore/`
   - Examples: `feature/e2e-test`, `fix/mobile-scroll-fix`, `refactor/auth-middleware`
3. **Switch to the branch**: Work on the created branch, not directly on `main` or `dev`.
4. **Exception (no branch needed)**: Trivial single-commit work — documentation cleanup, simple hotfixes (≤ 1 file, ≤ 10 lines) — may be committed directly without creating a new branch.
5. **Merge to dev after completion**: When work is done on a feature branch:
   - Run all unit and integration tests (`npm run test:ci` in both `client/` and `server/`), plus the E2E specs related to the change. Only proceed if all pass.
   - When the change touches server storage (executor, repositories, schema, migrations), also run the real-PostgreSQL adapter leg: `cd server && npm run test:ci:pg:adapters` (requires the e2e PostgreSQL container: `docker compose -f docker-compose.e2e.yml up -d postgresql-e2e`).
   - Switch to `dev`, merge the feature branch, then delete the feature branch.
   - **Never merge directly to `main`**. The `main` branch is protected by CI/CD pipelines that automatically create PRs; management and review of those PRs is handled by the user.

### 2.3 Commit Message Style

**Mandatory before any commit.**

1. **Context Check**: Run `git log --oneline -20` to match existing style.
2. **Format**: Use Conventional Commits: `<type>: <short description>` (lowercase, imperative mood).
   - Types: `merge:`, `feat:`, `fix:`, `docs:`, `refactor:`, `test:`.
3. **Commit Body Policy**:
   - **Trivial Changes**: ≤ 1 file AND ≤ 10 total lines AND type is `docs`, `test`, `style`, or `chore`. No body required.
   - **Non-Trivial Changes**: MUST include a body with these sections:
     - `Why:` Reason for the change.
     - `What:` Summary of changes (grouped by area).
      - `Impact / verification:` Behavior changes, risks, or test scope.

## 3. Testing & Quality

### 3.1 Testing Principles

- **Verify "What", Not "How"**: Assert on observable outcomes (return values, UI output, API responses), not internal implementation details or private methods.
- **Implementation Analysis**: Analyze the actual implementation before writing tests to avoid hallucinations.
- **Black-Box Approach**: Refactoring implementation should not break tests.

### 3.2 Root Cause Analysis (RCA) on Test Failure

**Stop and diagnose before modifying any code when a test fails.**

1. **Diagnosis**: Collect error output and cross-check with spec docs.
2. **Classification**:
   - **Case A (Source Error)**: Implementation violates spec → **STOP** and ask user.
   - **Case B (Test Error)**: Test misinterprets spec/asserts on internals → **Proceed** to fix test.
   - **Case C (Spec Error)**: Spec is undefined or ambiguous → **STOP** and ask user.
3. **Recording**: Log the incident in `docs/RCA_LOG.md`.
