# Agent Guidelines

This document defines the mandatory workflows and standards for all agents working on this project.

## 1. General Principles

- **Language**: All documentation, commit messages, and technical communications must be written in English.
- **Source of Truth**: Always refer to `/docs` (spec, features, contracts) before making assumptions about behavior.

## 2. Development Workflow

### 2.1 Docs-First Workflow

**Mandatory before any source code edit.**

1. **Identify**: Explicitly list the spec/feature docs affected.
2. **Read**: Review the identified documents.
3. **Update**: Modify or add spec/feature docs (`docs/spec/`, `docs/features/`) before implementation.
4. **Implement**: Proceed to code changes only after docs are updated.

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
   - Run all unit and integration tests (`npm run test:ci` in both `client/` and `server/`). Only proceed if all pass.
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
3. **Recording**: Log the incident in `docs/fail_log.md`.
