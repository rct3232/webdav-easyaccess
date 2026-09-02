# Coding Style and Patterns

This document describes file naming, import/export conventions, and React/Express patterns used in the WebDAV EasyAccess codebase. Follow these to keep the codebase consistent.

---

## File and Directory Naming

- **Components**: PascalCase, e.g. `FileListItem.js`, `ShareDialog.js`.
- **Hooks**: `useXxx.js`, e.g. `useFileOperations.js`. (Note: `useAuth` is exported from `AuthContext.js`, not a separate file.)
- **Utils and services**: camelCase, e.g. `pathUtils.js`, `fileService.js`.
- **Route files (server)**: lowercase, e.g. `auth.js`, `shareLinks.js`, `permissionRequests.js`.
- **Tests**: Place under `__tests__/` with suffix `.test.js`, e.g. `__tests__/auth.test.js`. See [TEST_GIT_GUIDE.md](TEST_GIT_GUIDE.md) for what to commit.

---

## Import Order

Group imports in this order:

1. React (if applicable)
2. Third-party libraries (e.g. `@mui/material`, `react-i18next`, `express`)
3. Internal modules (alias `@webdav-easyaccess/shared/*` or relative paths)
4. Constants / types

One import per line or logical group. Example (client component):

```javascript
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Typography, Box } from '@mui/material';
import { formatFileSize } from '../../utils/format';
import { getFileIcon } from '../../utils/fileIconUtils';
```

---

## Export Conventions

- **Components and pages**: Prefer `export default` for a single component per file.
- **Utils, hooks, constants**: Prefer named exports (e.g. `export const normalizePath`, `export function validateFileName`). This matches existing patterns in `client/src/utils/pathUtils.js`, `client/src/contexts/AuthContext.js`, and `shared/validation.js`.

---

## React Patterns

- **Context**: Use for app-wide state only (e.g. auth). For other state, prefer props or custom hooks.
- **Custom hooks**: Use the `use` prefix. Return a consistent shape—either an object or a tuple like `[value, setValue]`.
- **Styles**: Define static style objects outside the component to avoid recreating them on every render (see `baseStyles` in `client/src/components/file-manager/FileListItem.js`).

### Hook Placement

Place hooks in the narrowest scope that covers all their consumers. Only widen the scope when a second, unrelated consumer needs the same hook.

| Scope            | Location                                            | When to use                                                                                                                                         |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global           | `client/src/hooks/`                                 | Used by 2+ unrelated pages or components, or genuinely cross-cutting (e.g. `useDragAndDrop`, `useMessage`, `usePullToRefresh`, `useInfiniteScroll`) |
| Page-local       | `client/src/pages/[PageName]/hooks/`                | Exclusively consumed by a single page and its direct sub-components (e.g. `useFileManager`, `useFileOperations`)                                    |
| Dialog-local     | `client/src/components/dialogs/[DialogName]/hooks/` | Exclusively consumed by one dialog component (e.g. `useShareDialog`, `useFolderPicker`)                                                             |
| Component-family | `client/src/components/[family]/hooks/`             | Shared among multiple components in the same folder but not used outside it (e.g. `useFileViewCommon` in `file-manager/hooks/`)                     |

**Decision rule**: start at the narrowest scope; move outward only when a second unrelated consumer appears.

**Test file placement**: co-locate under `hooks/__tests__/` next to the hook file.

```
pages/FileManager/hooks/
  useFileManager.js
  __tests__/
    useFileManager.test.js
```

---

## Client Layering Rules (Mandatory)

The client is organized into explicit layers. Each layer has strict boundaries. Do not cross them.

### Layers and responsibilities

- **Page shell**
  - Composes controller hooks and views.
  - Holds route state and product-specific overlays (e.g. share-link mode, virtual collections like `__recent__`, `__shared__`).
  - Passes prepared props to views; does not render business logic inline.

- **Controller hooks**
  - Orchestrate user flows for a feature (navigation, commands, progress, dialogs).
  - Coordinate gateways/adapters and pure helpers.
  - May own UI-facing state but must not directly access browser globals or storage; use adapters instead.
  - Keep one primary responsibility per hook (split if a hook starts owning unrelated concerns).

- **Gateways / adapters**
  - Isolate IO: HTTP/API clients, WebDAV, storage (localStorage/sessionStorage/IndexedDB), and browser APIs (Clipboard, Filesystem, Navigator, etc.).
  - Provide a narrow interface consumed by controllers and helpers.
  - Are the only layer allowed to touch browser globals or network details.

- **Pure helpers (domain utilities)**
  - Pure, deterministic logic: deriving state, building view models, validating inputs, composing messages.
  - No side effects, no IO, no time, no randomness.
  - Easily unit-testable.

- **Pure views (presentational components)**
  - Render from props only; no service or gateway imports.
  - No router, storage, or browser-global access.
  - May call local event callbacks provided via props.

### Hard constraints

- Pure views MUST NOT import:
  - Services, gateways/adapters, storage utilities, router hooks, or browser globals.
- Controller hooks MUST route all IO through gateways/adapters; never call `fetch`, `localStorage`, `window.*`, or WebDAV SDKs directly.
- Gateways/adapters MUST NOT import React or UI modules.
- Pure helpers MUST be side-effect-free; no `Date.now()`, `Math.random()`, or IO.
- Do not let a single controller hook accumulate unrelated responsibilities (e.g., navigation + permissions + storage). Split instead.

### Adapter guidelines

- Hide browser specifics behind small, replaceable modules (e.g., `authTokenStore`, `httpClient`, `clipboardAdapter`).
- Keep interfaces stable and easy to mock in tests.
- Surface errors as typed results or normalized exceptions expected by controllers.

### Anti-patterns (disallowed)

- Importing services/gateways in pure view components.
- Mixing router hooks, storage access, and network calls inside a single controller without an adapter.
- Embedding long domain rules or permission trees inside views or dialogs.
- Redesigning behavior while extracting structure without first updating specs.

### Verification checklist for PRs touching client code

- Does each file clearly belong to one layer (shell, controller, gateway/adapter, helper, view)?
- Do views only receive prepared props and callbacks (no service/router/storage imports)?
- Do controllers delegate IO to adapters and heavy logic to pure helpers?
- Are browser APIs and storage calls confined to adapters?
- Do specs in `docs/spec/client/**` reflect any new or changed responsibilities?

Refer to feature and spec documents for module-level contracts before implementation.

---

## Express Patterns

- **API JSON response field names**: Use `snake_case` (e.g. `requester_id`, `owner_id`, `created_at`, `is_admin`) for consistency with store/DB schema. Error response fields `errorCode`, `params`, `details` remain unchanged per [shared-contracts.md](shared-contracts.md).
- **Route handlers**: Wrap async handlers with `asyncHandler` from `server/utils/errorHandler.js` so thrown errors are passed to the error handler middleware.
- **Errors**: The global `errorHandler` formats responses. In route code, throw errors with `status`, `errorCode`, and optionally `params` for i18n. See [shared-contracts.md](shared-contracts.md) for the error response format.
- **Auth and user**: After `authenticateToken`, `req.user.id` is set. After `requireUser`, `req.user.full` contains the loaded user. Route payloads use nodeId-based fields (`nodeId`, `parentNodeId`, `destinationParentNodeId`); path strings are not accepted in request bodies, and display paths are resolved server-side (do not read `req.path` for payload data).
- **Shared usage**: Use `@webdav-easyaccess/shared/constants`, `shared/serverMessageCodes`, and `shared/validation` for cross-stack consistency.

---

## Shared Module Usage

- **Use `@webdav-easyaccess/shared/*` for**: constants, validation helpers, and server message/error codes. Both client and server may depend on these.
- **Do not put** client-only or server-only logic in `shared`; keep it in `client/src` or `server` respectively.

---

## Tooling

- **ESLint**: A single root `eslint.config.js` (flat config, ESLint 8) covers all workspaces
  (`server/`, `shared/`, `client/`). It enforces `eslint:recommended` plus `eqeqeq` (smart),
  `no-unused-vars`, and React rules (`react/prop-types` off, `react-hooks/exhaustive-deps` warn).
  Run `npm run lint` at the repo root; `npm run lint:ci` enforces zero warnings for CI.
- **Prettier**: Root `.prettierrc` (semi, singleQuote, printWidth 100, 2-space) formats the
  whole repo. Run `npm run format:check` / `npm run format` before committing. Lint and
  Prettier are wired via `eslint-config-prettier` so they do not conflict.
- **Exceptions**: For a lint exception, add a comment explaining why (prefer a rule-specific
  `eslint-disable-next-line <rule>`; use a bare `eslint-disable-next-line` only when the rule
  is not available to the CRA production build).
