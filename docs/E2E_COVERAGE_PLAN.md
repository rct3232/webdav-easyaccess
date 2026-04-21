# E2E Coverage Plan

## Purpose

This document is the canonical planning and inventory document for browser-level end-to-end coverage in WebDAV EasyAccess.

Use it to:

- track which user-visible flows should be covered by Playwright
- keep E2E scope aligned with product behavior rather than with the current test suite
- separate true browser flows from scenarios that are better covered by route integration, RTL/MSW, or unit tests
- define rollout order and ownership when expanding the `e2e/` suite

This document does **not** replace feature docs, route specs, or test summaries.

## Relationship to Other Docs

Use the following split consistently:

| Document | Role |
|----------|------|
| `docs/TESTING_STRATEGY.md` | Testing principles, layer decisions, mocking policy, and E2E policy rules |
| `docs/E2E_COVERAGE_PLAN.md` (this document) | Canonical E2E flow inventory, rollout order, and ownership map |
| `docs/features/*.md` | Product behavior, domain intent, and feature-specific testing anchors such as selector policy or platform-split guidance |
| `docs/spec/client/**/*.md` | Client runtime/view/controller contracts |
| `docs/spec/server/routes/*.md` | Route-level HTTP behavior and error contracts |
| `client/TEST_SUMMARY.md`, `server/TEST_SUMMARY.md` | Current implemented test state and coverage results |

When these documents differ, treat runtime behavior and the most specific contract doc as the source of truth. If a documentation mismatch affects planning, record it here in the notes column instead of silently inventing a new contract.

## Scope

This document covers **browser-observable** flows that a real user can perform through the app UI:

- public auth routes
- protected routing
- file explorer flows
- share-link flows
- MyPage user/admin flows
- desktop-only and mobile-only interaction differences

This document does **not** attempt to fully catalogue:

- every server-side ACL or error matrix
- every API branch that has no meaningful browser entry point
- internal implementation details

Those scenarios should still be tested, but often outside Playwright.

## Ownership Rules

### Platform ownership

- Keep desktop and mobile E2E flows in separate spec files when the interaction surface differs.
- Do not centralize desktop context-menu interactions and mobile action-sheet interactions behind a single conditional-heavy helper.
- Shared helpers may contain only platform-agnostic seams:
  - login/auth setup
  - deterministic resource naming
  - fixture loading
  - stable item locators such as `data-file-path`
  - common explorer entry seams such as opening the FAB menu or an item's shared "More actions" trigger before platform-specific actions diverge

### Selector policy

- Prefer semantic selectors first.
- Use `data-file-path` for concrete explorer items.
- Use `data-testid` only for documented unstable seams such as FAB roots, icon-only action entries, or dialog fields/buttons whose semantic access is not stable enough for E2E.
- For SpeedDial-style menus, prefer visible `menuitem` names when that accessibility surface is stable in the E2E environment.

### Assertion policy

- Verify user-visible outcomes, not implementation details.
- Prefer navigation result, visible UI state, rendered text, disabled/enabled state, dialog presence, and item visibility over internal request inspection.
- Use request inspection only when the interaction itself is the behavior under test and there is no clearer user-visible anchor.

### Feature-doc anchors

- Use `docs/features/*.md` for feature-specific E2E guidance that other contributors need at the product boundary, such as:
  - selectors that are intentionally stable for that feature
  - desktop/mobile interaction ownership unique to that feature
  - feature-local testing constraints that would be too vague in the global plan
- Do not duplicate the full inventory table, rollout order, or status tracking inside feature docs.
- If a feature has no such special E2E guidance, it is acceptable for that feature doc to link here without adding a dedicated E2E subsection beyond representative testing anchors.

## Test Environment Assumptions

The first coverage pass should assume the current E2E baseline environment:

### Users

| Role | Seed user |
|------|-----------|
| Admin | `admin` / `admin` |
| Standard approved user | `user1` / `user1pass` |
| Secondary approved user | `user2` / `user2pass` |
| Anonymous | no session |

Source: `e2e/fixtures/test-data.ts`

Planning note:

- Auth-related Playwright setup may provision the approved standard-user fixtures through the admin API when a local E2E environment does not actually pre-seed `user1` / `user2`.
- Shared auth helpers should expose an explicit anonymous-session setup path so protected-route redirect checks do not accidentally reuse an authenticated browser state. A fresh browser context is preferred; clearing cookies and storage in the current context is an acceptable fallback when test ergonomics require it.

### File fixtures

| Fixture | File |
|--------|------|
| Small text | `e2e/fixtures/test-files/test-file.txt` |
| Small image | `e2e/fixtures/test-files/test-image.jpg` |
| PDF | `e2e/fixtures/test-files/test-document.pdf` |

### Naming and locators

- Use deterministic, collision-resistant names based on test title and project name.
- Reuse the current helper patterns in `e2e/helpers/files.ts` for generated file and folder names.
- Reuse `data-file-path` item targeting for explorer assertions.

### Runtime assumptions

- App origin is the local client used by the E2E environment.
- WebDAV and metadata backends are initialized for repeatable test runs.
- The baseline `.env.e2e` setup provides a local WebDAV target and a deterministic admin password.

## Scenario Classification

Each flow row should use the following dimensions.

### Priority

| Value | Meaning |
|-------|---------|
| `P0` | Required for the first meaningful browser safety net |
| `P1` | Strongly recommended after `P0` is stable |
| `P2` | Useful but deferrable or infra-sensitive |

### Recommended layer

| Value | Meaning |
|-------|---------|
| `playwright` | Best verified through full browser E2E |
| `rtl-msw` | Better as client integration with mocked API |
| `supertest` | Better as server route integration |
| `unit` | Better as unit or hook/service-level verification |

### Viewport

| Value | Meaning |
|-------|---------|
| `both` | Same observable flow on desktop and mobile |
| `desktop` | Desktop-specific surface or behavior |
| `mobile` | Mobile-specific surface or behavior |

### Status

| Value | Meaning |
|-------|---------|
| `covered` | Implemented in the current E2E suite |
| `planned` | Accepted target for future implementation |
| `deferred` | Intentionally postponed |
| `non-e2e` | Tracked here but recommended outside Playwright |

Status discipline:

- Keep `covered` reserved for scenarios that already exist in committed Playwright specs.
- Use `planned` for the current expansion wave until the owning spec lands.

## Planned Spec Ownership

This is the target ownership map for future Playwright growth.

| Spec file | Intended ownership |
|-----------|--------------------|
| `e2e/auth.spec.ts` | public auth, protected-route redirects, and login outcomes shared by desktop and mobile projects |
| `e2e/desktop-core-flow.spec.ts` | desktop-only ownership for core explorer CRUD and navigation |
| `e2e/mobile-core-flow.spec.ts` | mobile-only ownership for core explorer CRUD and navigation |
| `e2e/share-public.spec.ts` | public share success/error, add-to-my-permissions, leave-share |
| `e2e/share-internal.spec.ts` | internal permission-request lifecycle, approved-user `__shared__` access, and visible read-only vs write-capable outcomes |
| `e2e/mypage-user.spec.ts` | account, sharing inbox/outbox/share-links, preferences |
| `e2e/mypage-admin.spec.ts` | admin user management and settings flows |
| `e2e/explorer-advanced.desktop.spec.ts` | desktop-only advanced explorer interactions |
| `e2e/explorer-advanced.mobile.spec.ts` | mobile-only advanced explorer interactions |

The desktop/mobile core flow area now lives in `e2e/desktop-core-flow.spec.ts` and `e2e/mobile-core-flow.spec.ts`, replacing the earlier `e2e/desktop-flow.spec.ts` and `e2e/mobile-flow.spec.ts` seed filenames.

## Flow Inventory

### Inventory schema

| Column | Meaning |
|--------|---------|
| `ID` | Stable planning identifier |
| `Domain` | Functional area |
| `Flow` | User-visible scenario |
| `Role` | Primary actor |
| `Entry route` | Main route or browser entry point |
| `Viewport` | `desktop`, `mobile`, or `both` |
| `Preconditions` | Required state/data |
| `Expected outcome` | Observable result |
| `Priority` | `P0`, `P1`, `P2` |
| `Recommended layer` | `playwright`, `rtl-msw`, `supertest`, or `unit` |
| `Planned spec file` | Expected spec ownership |
| `Status` | `covered`, `planned`, `deferred`, or `non-e2e` |
| `Notes` | Mismatch, constraint, or special planning notes |

Current expansion note:

- The current E2E expansion wave targets `e2e/share-public.spec.ts` after completing the `desktop-flow`/`mobile-flow` rename to `desktop-core-flow`/`mobile-core-flow`.
- `e2e/auth.spec.ts` now owns the committed browser coverage for `E2E-AUTH-001` to `E2E-AUTH-006`.
- The rows for `E2E-EXP-002`, `E2E-EXP-003`, and `E2E-EXP-008` are now covered in the desktop/mobile core flow specs.
- The rows for `E2E-SHARE-001` through `E2E-SHARE-008` are now `covered` in `e2e/share-public.spec.ts`; `E2E-SHARE-009` stays `planned` and `E2E-SHARE-010` stays `deferred`.
- Internal user-to-user sharing plus `__shared__` coverage is reserved for `e2e/share-internal.spec.ts`, because those journeys cross explorer entry, MyPage request management, and granted-access outcomes.
- `__recent__` rows stay with the platform-owned explorer advanced specs because they are explorer-visible virtual-collection behaviors rather than MyPage-only flows.
- Root Playwright project ownership is handled in `playwright.config.ts`, which uses a shared `baseURL`, `e2e/global-setup.ts`, and `e2e/global-teardown.ts`, and assigns desktop/mobile ownership through project-level `testMatch`.
- Platform-agnostic explorer menu helpers live in `e2e/helpers/explorer.ts`; desktop-only context-menu behavior and mobile-only action-sheet behavior should stay in their owning specs.

### Auth and protected routing

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-AUTH-001 | Auth | Redirect unauthenticated user from `/files` to `/login` | anonymous | `/files` | both | no session | login page is shown | P0 | playwright | `e2e/auth.spec.ts` | covered | Protected-route baseline |
| E2E-AUTH-002 | Auth | Redirect unauthenticated user from `/mypage` to `/login` | anonymous | `/mypage` | both | no session | login page is shown | P0 | playwright | `e2e/auth.spec.ts` | covered | Protected-route baseline |
| E2E-AUTH-003 | Auth | Login page loads and renders form | anonymous | `/login` | both | public settings reachable | username/password inputs visible | P0 | playwright | `e2e/auth.spec.ts` | covered | |
| E2E-AUTH-004 | Auth | Successful admin login lands in explorer | admin | `/login` | both | seeded admin exists | browser navigates to `/files...` and explorer UI is visible | P0 | playwright | `e2e/auth.spec.ts` | covered | Covered in `e2e/auth.spec.ts`; legacy smoke remains in the seed desktop/mobile flow specs until the ownership move is completed |
| E2E-AUTH-005 | Auth | Successful standard-user login lands in user-owned explorer path | approved user | `/login` | both | seeded approved user exists | browser navigates to `/files/<username>` or equivalent home path | P0 | playwright | `e2e/auth.spec.ts` | covered | Distinct from admin landing |
| E2E-AUTH-006 | Auth | Invalid credentials show login failure | anonymous | `/login` | both | invalid password or username | visible login error | P0 | playwright | `e2e/auth.spec.ts` | covered | |
| E2E-AUTH-007 | Auth | Pending account login shows warning | pending user | `/login` | both | pending user fixture available | visible pending approval message | P1 | playwright | `e2e/auth.spec.ts` | covered | May need deterministic fixture setup |
| E2E-AUTH-008 | Auth | Rejected account login shows rejection error | rejected user | `/login` | both | rejected user fixture available | visible rejected message | P1 | playwright | `e2e/auth.spec.ts` | covered | May need deterministic fixture setup |
| E2E-AUTH-009 | Auth | Register page availability follows public settings | anonymous | `/login` or `/register` | both | registration enabled/disabled variant | register affordance is shown or hidden accordingly | P0 | playwright | `e2e/auth.spec.ts` | covered | |
| E2E-AUTH-010 | Auth | Registration success with pending approval shows success state instead of explorer navigation | anonymous | `/register` | both | registration enabled, pending policy path available | success UI is shown and user stays out of protected explorer | P0 | playwright | `e2e/auth.spec.ts` | covered | |

### Explorer core and CRUD

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-EXP-001 | Explorer | Explorer loads after login | admin | `/files` | both | authenticated session | explorer shell and FAB are visible | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Existing smoke lives in the renamed desktop/mobile core flow specs |
| E2E-EXP-002 | Explorer | Direct route entry loads a nested folder path | admin | `/files/<path>` | both | target path exists | nested folder contents are visible | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Direct path entry is asserted in both platform-owned core flow specs |
| E2E-EXP-003 | Explorer | Breadcrumb navigation changes current folder | admin | `/files/*` | both | at least one nested folder exists | visible contents update to selected breadcrumb path | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Breadcrumb chip navigation is asserted in both platform-owned core flow specs |
| E2E-EXP-004 | Explorer | Create folder from FAB | admin | `/files` | both | writable current path | created folder appears in explorer | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Existing smoke |
| E2E-EXP-005 | Explorer | Upload file from dialog | admin | `/files` | both | writable current path | uploaded file appears in explorer | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Existing smoke |
| E2E-EXP-006 | Explorer | Rename item from platform-specific actions | admin | `/files` | both | existing file or folder | renamed item appears and old item disappears | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Desktop/mobile interaction entry differs |
| E2E-EXP-007 | Explorer | Delete item from platform-specific actions | admin | `/files` | both | existing file or folder | item disappears after confirm | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Desktop/mobile interaction entry differs |
| E2E-EXP-008 | Explorer | Open previewable file | admin | `/files` | both | previewable file exists | preview dialog opens | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Preview action and dialog visibility are asserted in both platform-owned core flow specs |
| E2E-EXP-009 | Explorer | View mode switch changes visible layout | admin | `/files` | both | list contains visible items | list/grid/detail layout changes | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts`, `e2e/explorer-advanced.mobile.spec.ts` | covered | |
| E2E-EXP-010 | Explorer | Sort mode changes displayed order | admin | `/files` | both | sortable list with distinct ordering | visible ordering changes | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts`, `e2e/explorer-advanced.mobile.spec.ts` | covered | |
| E2E-EXP-011 | Explorer | Search filters current listing | admin | `/files` | both | list contains multiple distinct names | non-matching items disappear or matching items remain only | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts`, `e2e/explorer-advanced.mobile.spec.ts` | covered | |

### Bulk operations and progress

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-BULK-001 | Bulk | Enter selection mode and show bulk toolbar | admin | `/files` | both | list contains selectable items | bulk action toolbar becomes visible | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | |
| E2E-BULK-002 | Bulk | Move selected items to another folder | admin | `/files` | both | at least two items and a valid destination folder exist | items appear in destination and disappear from source | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Wait for the job-backed operation to reach a visible completed state before asserting destination contents. |
| E2E-BULK-003 | Bulk | Copy selected items to another folder | admin | `/files` | both | at least one item and a valid destination folder exist | copied item appears in destination while source remains | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | Wait for the job-backed operation to reach a visible completed state before asserting destination contents. |
| E2E-BULK-004 | Bulk | Delete selected items | admin | `/files` | both | selected items exist | items disappear after confirm | P0 | playwright | `e2e/desktop-core-flow.spec.ts`, `e2e/mobile-core-flow.spec.ts` | covered | |
| E2E-BULK-005 | Bulk | Desktop multi-download is available | admin | `/files` | desktop | multiple items selected | download action is enabled | P0 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | covered | Browser download assertion may need minimal smoke only |
| E2E-BULK-006 | Bulk | Mobile multi-download is disabled | admin | `/files` | mobile | multiple items selected | download action is visibly disabled | P0 | playwright | `e2e/explorer-advanced.mobile.spec.ts` | covered | Product rule is client-side |
| E2E-BULK-007 | Bulk | Conflict resolution dialog appears when move/copy would collide | admin | `/files` | both | conflicting destination already exists | conflict dialog is shown | P0 | playwright | `e2e/explorer-advanced.desktop.spec.ts`, `e2e/explorer-advanced.mobile.spec.ts` | covered | |
| E2E-BULK-008 | Bulk | Long-running operation exposes progress UI | admin | `/files` | both | operation long enough to surface progress | progress chip or drawer becomes visible | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts`, `e2e/explorer-advanced.mobile.spec.ts` | planned | Infra-sensitive |
| E2E-BULK-009 | Bulk | Cancel bulk operation from progress UI | admin | `/files` | both | cancellable long-running operation exists | UI reflects cancelled state | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts`, `e2e/explorer-advanced.mobile.spec.ts` | deferred | High flake risk compared with API coverage |

### Public share and share-link mode

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-SHARE-001 | Share | Invalid or expired share token shows error state | anonymous | `/share/:token` | both | invalid or expired token | share error UI is shown | P0 | playwright | `e2e/share-public.spec.ts` | covered | Current implementation behavior should win if docs drift |
| E2E-SHARE-002 | Share | Directory share loads read-only explorer view | anonymous | `/share/:token` | both | valid directory share link exists | shared explorer renders with restricted actions | P0 | playwright | `e2e/share-public.spec.ts` | covered | |
| E2E-SHARE-003 | Share | Single-file share loads full-screen preview view | anonymous | `/share/:token` | both | valid single-file share link exists | single-file preview UI renders | P0 | playwright | `e2e/share-public.spec.ts` | covered | |
| E2E-SHARE-004 | Share | Anonymous user can open login flow from shared directory | anonymous | `/share/:token` | both | valid directory share link exists | login dialog opens | P0 | playwright | `e2e/share-public.spec.ts` | covered | |
| E2E-SHARE-005 | Share | Logged-in user can add shared content to own permissions | approved user | `/share/:token` | both | valid directory share link exists, user logged in | add-to-my-permissions confirmation flow succeeds | P0 | playwright | `e2e/share-public.spec.ts` | covered | |
| E2E-SHARE-006 | Share | Successful add-to-my-permissions transitions to regular `/files` path | approved user | `/share/:token` | both | add-to-my-permissions succeeds | browser ends in normal explorer route with access | P0 | playwright | `e2e/share-public.spec.ts` | covered | |
| E2E-SHARE-007 | Share | Leaving share scope requires confirmation | approved user | `/share/:token` | both | user is inside shared directory explorer | leave-share confirm appears, then regular explorer opens on confirm | P0 | playwright | `e2e/share-public.spec.ts` | covered | |
| E2E-SHARE-008 | Share | Share mode hides or disables write actions | anonymous or approved user | `/share/:token` | both | valid directory share link exists | upload/create/rename/delete/share actions are absent or disabled | P0 | playwright | `e2e/share-public.spec.ts` | covered | |
| E2E-SHARE-009 | Share | Shared directory still allows file preview | anonymous or approved user | `/share/:token` | both | previewable file exists inside shared scope | preview dialog opens from shared explorer | P1 | playwright | `e2e/share-public.spec.ts` | covered | |
| E2E-SHARE-010 | Share | Logged-in user opening a single-file share remains in preview/download-only mode | approved user | `/share/:token` | both | valid single-file share link exists and user already has a session | single-file view renders preview/download only and does not expose directory-share-only actions | P2 | playwright | `e2e/share-public.spec.ts` | deferred | Candidate guardrail while single-file share intentionally omits login and add-to-my-permissions actions |

### Internal sharing and virtual collections

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-OVERLAY-001 | Virtual collection | Approved user can enter `__shared__` from the explorer tree | approved user | `/files` | both | non-admin has at least one shared folder or file permission | browser navigates into the shared collection and visible shared entries render | P0 | playwright | `e2e/share-internal.spec.ts` | planned | Distinct from public share-link browsing |
| E2E-OVERLAY-002 | Virtual collection | Approved user can navigate from `__shared__` root into a nested shared folder | approved user | `/files/__shared__` | both | shared folder permission exists | visible folder contents change to the selected shared path | P0 | playwright | `e2e/share-internal.spec.ts` | planned | Browser-visible counterpart to shared tree expansion/navigation behavior |
| E2E-OVERLAY-003 | Internal share | Request access to another user's content from protected UI | approved user | `/files/*` | both | requestable target exists and requester lacks direct permission | request success UI appears and the request becomes visible in outbox/inbox surfaces | P0 | playwright | `e2e/share-internal.spec.ts` | covered | Covers request creation, not the full permission matrix |
| E2E-OVERLAY-004 | Internal share | Owner approves a pending request and requester can open the shared content | approved user | `/mypage` then `/files/__shared__` | both | pending request exists between requester and owner | approval UI updates and requester can browse the newly shared target | P0 | playwright | `e2e/share-internal.spec.ts` | covered | End-to-end request -> approve -> access journey |
| E2E-OVERLAY-005 | Internal share | Owner rejects a pending request and requester stays blocked from the target | approved user | `/mypage` | both | pending request exists between requester and owner | rejection UI updates and requester still lacks usable explorer access | P1 | playwright | `e2e/share-internal.spec.ts` | covered | Browser scope is visible blocked access, not server permission internals |
| E2E-OVERLAY-006 | Internal share | Shared target remains read-only when the granted permission is read | approved user | `/files/__shared__` | both | shared target exists with read-only permission | browsing works but write actions are absent or disabled | P0 | playwright | `e2e/share-internal.spec.ts` | planned | Visible capability difference only |
| E2E-OVERLAY-007 | Internal share | Shared target exposes write-capable actions when the granted permission is write | approved user | `/files/__shared__` | both | shared target exists with write permission | create/upload/rename/delete affordances are available | P1 | playwright | `e2e/share-internal.spec.ts` | covered | Complements read-only outcome without duplicating ACL matrix |
| E2E-OVERLAY-008 | Virtual collection | Approved user can enter `__recent__` and see recent entries | approved user | `/files` | both | recent entries exist | browser navigates into the recent collection and the entries render with recent metadata | P0 | playwright | `e2e/explorer-advanced.desktop.spec.ts`, `e2e/explorer-advanced.mobile.spec.ts` | planned | Keep deeper recent-sync rules in lower layers |
| E2E-OVERLAY-009 | Virtual collection | Recent entry can reopen a previewable item from `__recent__` | approved user | `/files/__recent__` | both | recent list contains a previewable file | preview opens from the recent entry without leaving the browser in a broken state | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts`, `e2e/explorer-advanced.mobile.spec.ts` | planned | Representative preview and recovery smoke |
| E2E-OVERLAY-010 | Virtual collection | Stale recent entry is removed or recovered with visible UI feedback | approved user | `/files/__recent__` | both | recent list contains a stale or moved entry | item is cleaned up or rerouted visibly and the list no longer presents a broken stale target | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts`, `e2e/explorer-advanced.mobile.spec.ts` | planned | Keep repository/notifier synchronization branches in RTL/unit |

### MyPage user flows

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-MYPAGE-001 | MyPage user | Authenticated user can open MyPage | approved user | `/mypage` | both | authenticated session | MyPage shell renders | P0 | playwright | `e2e/mypage-user.spec.ts` | covered | |
| E2E-MYPAGE-002 | MyPage user | Close button returns user to file area | approved user | `/mypage` | both | authenticated session | browser returns to `/files...` | P0 | playwright | `e2e/mypage-user.spec.ts` | covered | |
| E2E-MYPAGE-003 | MyPage user | Logout clears session | approved user | `/mypage` | both | authenticated session | protected routes redirect back to login | P0 | playwright | `e2e/mypage-user.spec.ts` | covered | |
| E2E-MYPAGE-004 | MyPage user | Email update succeeds | approved user | `/mypage` | both | authenticated session | success UI appears and updated email is reflected | P0 | playwright | `e2e/mypage-user.spec.ts` | planned | |
| E2E-MYPAGE-005 | MyPage user | Password change invalidates current session | approved user | `/mypage` | both | authenticated session | user must log in again after password change flow completes | P0 | playwright | `e2e/mypage-user.spec.ts` | planned | |
| E2E-MYPAGE-006 | MyPage user | Sharing inbox approve flow works | approved user | `/mypage` | both | pending permission request exists in inbox | request status changes and UI updates | P0 | playwright | `e2e/mypage-user.spec.ts` | planned | |
| E2E-MYPAGE-007 | MyPage user | Sharing inbox reject flow works | approved user | `/mypage` | both | pending permission request exists in inbox | request status changes and UI updates | P0 | playwright | `e2e/mypage-user.spec.ts` | planned | |
| E2E-MYPAGE-008 | MyPage user | Sharing outbox cancel flow works | approved user | `/mypage` | both | pending outgoing request exists | request is removed or status changes to cancelled | P0 | playwright | `e2e/mypage-user.spec.ts` | planned | |
| E2E-MYPAGE-009 | MyPage user | Share links list supports copy/extend/delete | approved user | `/mypage` | both | existing share link exists | list actions succeed and UI updates | P0 | playwright | `e2e/mypage-user.spec.ts` | planned | |
| E2E-MYPAGE-010 | MyPage user | Language selection updates visible UI text | approved user | `/mypage` | both | authenticated session | visible translated UI changes after language switch | P1 | playwright | `e2e/mypage-user.spec.ts` | planned | |
| E2E-MYPAGE-011 | MyPage user | Mobile menu button opens and closes the category drawer | approved user | `/mypage` | mobile | authenticated session | drawer visibility toggles and current content stays stable until a category is chosen | P1 | playwright | `e2e/mypage-user.spec.ts` | covered | Browser-visible mobile shell contract |
| E2E-MYPAGE-012 | MyPage user | Selecting a category from the mobile drawer closes it and updates content | approved user | `/mypage` | mobile | authenticated session | chosen category content renders and drawer closes | P1 | playwright | `e2e/mypage-user.spec.ts` | covered | Applies to the prepared user-visible categories for the current role |

### MyPage admin flows

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-ADMIN-001 | MyPage admin | `/admin` redirects to admin MyPage category | admin | `/admin` | both | authenticated admin session | admin-focused MyPage content is shown | P0 | playwright | `e2e/mypage-admin.spec.ts` | planned | |
| E2E-ADMIN-002 | MyPage admin | Admin sees user-management and system-settings categories | admin | `/mypage` | both | authenticated admin session | admin categories are visible and sharing category is hidden | P0 | playwright | `e2e/mypage-admin.spec.ts` | planned | |
| E2E-ADMIN-003 | MyPage admin | Approve pending signup | admin | `/mypage` | both | pending user exists | user moves out of pending state and UI updates | P0 | playwright | `e2e/mypage-admin.spec.ts` | planned | |
| E2E-ADMIN-004 | MyPage admin | Reject pending signup | admin | `/mypage` | both | pending user exists | user is rejected and UI updates | P0 | playwright | `e2e/mypage-admin.spec.ts` | planned | |
| E2E-ADMIN-005 | MyPage admin | Create user from admin UI | admin | `/mypage` | both | authenticated admin session | new user appears in admin user list | P0 | playwright | `e2e/mypage-admin.spec.ts` | planned | |
| E2E-ADMIN-006 | MyPage admin | Delete standard user from admin UI | admin | `/mypage` | both | deletable standard user exists | user disappears from admin list | P0 | playwright | `e2e/mypage-admin.spec.ts` | planned | |
| E2E-ADMIN-007 | MyPage admin | Toggle registration-related settings | admin | `/mypage` | both | authenticated admin session | settings save succeeds and the next public auth visit reflects the new state | P0 | playwright | `e2e/mypage-admin.spec.ts` | planned | |
| E2E-ADMIN-008 | MyPage admin | Cleanup actions show confirmation and completion feedback | admin | `/mypage` | both | authenticated admin session | cleanup flow completes with visible result | P1 | playwright | `e2e/mypage-admin.spec.ts` | planned | |

### Desktop-only advanced interactions

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-DESKTOP-001 | Desktop explorer | Double-click opens folder or preview | admin | `/files` | desktop | visible item exists | double-click opens target instead of only selecting it | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | covered | |
| E2E-DESKTOP-002 | Desktop explorer | Ctrl/Meta-click toggles multi-selection | admin | `/files` | desktop | at least two items exist | selection set updates as expected | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | covered | |
| E2E-DESKTOP-003 | Desktop explorer | Shift-click performs range selection | admin | `/files` | desktop | at least three items exist | contiguous visible selection range is created | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | covered | |
| E2E-DESKTOP-004 | Desktop explorer | Clicking empty area exits selection mode | admin | `/files` | desktop | selection mode active | selection mode is cleared | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | covered | |
| E2E-DESKTOP-005 | Desktop explorer | Context menu opens per-item actions | admin | `/files` | desktop | item exists | desktop context menu is visible and actionable | P1 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | covered | |
| E2E-DESKTOP-006 | Desktop explorer | External drag-and-drop upload works | admin | `/files` | desktop | writable path and local fixture file | dropped file appears in explorer | P2 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | deferred | More fragile than dialog upload |
| E2E-DESKTOP-007 | Desktop explorer | Internal drag-and-drop move works | admin | `/files` | desktop | movable item and valid destination exist | moved item appears at destination | P2 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | deferred | More fragile than picker-based move |
| E2E-DESKTOP-008 | Desktop explorer | Dragging onto a no-write target shows denied/no-drop feedback and leaves items unchanged | approved user | `/files` | desktop | draggable source and visible target without write permission | target is not highlighted as droppable, no successful drop state appears, and denial feedback is shown if drop is attempted | P2 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | deferred | Candidate browser smoke only; full permission matrix stays outside Playwright |
| E2E-DESKTOP-009 | Desktop explorer | Dragging onto the same parent or same path behaves as a no-op | admin or approved user | `/files` | desktop | draggable source and a visible no-op target | no drop overlay or action occurs and the listing remains unchanged | P2 | playwright | `e2e/explorer-advanced.desktop.spec.ts` | deferred | Candidate UX guardrail for no-op handling |

### Mobile-only advanced interactions

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-MOBILE-001 | Mobile explorer | Long-press enters selection mode | admin | `/files` | mobile | visible item exists | selection mode starts and item is selected | P1 | playwright | `e2e/explorer-advanced.mobile.spec.ts` | covered | |
| E2E-MOBILE-002 | Mobile explorer | Action sheet opens from more button | admin | `/files` | mobile | visible item exists | mobile action sheet is visible | P1 | playwright | `e2e/explorer-advanced.mobile.spec.ts` | planned | |
| E2E-MOBILE-003 | Mobile explorer | Breadcrumb toggle opens and closes folder tree section | admin | `/files` | mobile | authenticated session | folder tree collapse opens and closes | P1 | playwright | `e2e/explorer-advanced.mobile.spec.ts` | covered | |
| E2E-MOBILE-004 | Mobile explorer | Pull-to-refresh reloads current folder | admin | `/files` | mobile | refreshable list and enough vertical scroll area | refresh indicator appears and list reload completes | P2 | playwright | `e2e/explorer-advanced.mobile.spec.ts` | deferred | Gesture sensitivity may be flaky |

### User-facing negative or boundary flows

| ID | Domain | Flow | Role | Entry route | Viewport | Preconditions | Expected outcome | Priority | Recommended layer | Planned spec file | Status | Notes |
|----|--------|------|------|-------------|----------|---------------|------------------|----------|-------------------|-------------------|--------|-------|
| E2E-NEG-001 | Negative | Read-only or forbidden actions surface user-visible denial | approved user | `/files` | both | user can reach a read-only target | UI blocks or reports denied action | P1 | playwright | `e2e/share-public.spec.ts` or dedicated negative spec | planned | Keep browser scope limited to visible denial, not full ACL matrix |
| E2E-NEG-002 | Negative | `/.wea` remains inaccessible to non-admin users | approved user | browser entry that can expose target | both | non-admin session | reserved metadata path is not exposed as a usable path | P2 | supertest | none | non-e2e | Better as server integration |
| E2E-NEG-003 | Negative | Full direct read/direct write permission matrix | multiple | API-level scenarios | both | controlled ACL fixtures | all allow/deny branches match contract | P2 | supertest | none | non-e2e | Too broad for browser E2E |
| E2E-NEG-004 | Negative | Login rate-limit branches and `Retry-After` behavior | anonymous | `/login` | both | deterministic repeated failed attempts | rate-limit contract is correct | P2 | supertest | none | non-e2e | Browser E2E adds little value over route integration |
| E2E-NEG-005 | Negative | Token refresh retry-once behavior | authenticated user | protected routes | both | expiring access token and refresh token orchestration | session retry behavior matches contract | P2 | rtl-msw | none | non-e2e | Better isolated in client integration tests |

## Rollout Order

Use the following staged order when expanding browser coverage:

1. `P0` auth and protected-route baseline
2. `P0` desktop and mobile explorer CRUD beyond the current smoke tests
3. `P0` bulk move/copy/delete and mobile download restriction
4. `P0` public share success/error flows
5. `P0` internal sharing lifecycle and approved-user `__shared__` access
6. `P0` `__recent__` entry flows plus remaining MyPage user account/sharing coverage
7. `P0` MyPage admin flows
8. `P1` advanced desktop/mobile interactions, including MyPage mobile drawer coverage
9. `P2` infra-sensitive gestures, denied/no-op drag-and-drop smoke, and deferred single-file logged-in share guardrails

### Wave Gating (Later Waves)
To keep regressions contained, Playwright runs only the earlier `P0` expansion waves by default.
MyPage admin flows (Wave 7) and the P1/P2 follow-up coverage (Waves 8-9) are gated behind `E2E_LATER_WAVES=1`.

Practical rule:
- First get the green signal for `e2e/share-public.spec.ts` (public share P0) and the bulk P0 scenarios in the desktop/mobile core flow specs.
- Then run `E2E_LATER_WAVES=1 npm run test:e2e` to enable Wave 7+ coverage.

## Out of Scope for Playwright-First Coverage

Track these areas in lower-level tests even if they appear in the inventory above as `non-e2e`:

- full ACL allow/deny matrix
- login rate-limiting headers and counters
- access-token refresh retry semantics
- upload `overwrite` and `skip` branch matrix
- batch worker partial-success internals
- ZIP progress response details and skip summaries
- video preview ticket expiry behavior
- thumbnail token/signing behavior
- ACL inheritance and non-inheritance matrices beyond representative visible denial or capability smoke
- recent-files API synchronization details
- low-level drag gesture/cursor permutations beyond representative denied/no-op smoke coverage
- maintenance and cleanup endpoint result shapes beyond user-facing smoke coverage

## Known Planning Notes

- Share-link expiry semantics have drifted across docs in the past. Plan browser assertions around the visible expired/not-found UI state rather than baking in an inconsistent intermediate assumption.
- Some permission-management behaviors are better defined by implementation and route specs than by older feature prose. Where those drift, use the current route behavior for test planning and update docs alongside implementation work.
- The first implementation wave should prefer deterministic dialogs and navigation outcomes over timing-sensitive gestures.

## Maintenance Rules

- Update this document whenever product behavior adds, removes, or re-scopes a browser-visible flow.
- When adding a new flow, assign a stable `ID`, `Priority`, `Recommended layer`, and `Planned spec file`.
- If a planned flow is intentionally postponed, move it to `deferred` and record the reason in `Notes`.
- Do not use this document as a duplicate feature spec. Keep detailed behavior in feature/spec docs and keep this file focused on planning and coverage ownership.
- When a new feature introduces selector policy or platform-specific interaction rules that are meaningful at the feature boundary, add those rules to the owning `docs/features/*.md` file and keep this document as the canonical inventory/ownership source.
