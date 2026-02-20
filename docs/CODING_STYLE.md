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

---

## Express Patterns

- **API JSON response field names**: Use `snake_case` (e.g. `requester_id`, `owner_id`, `created_at`, `is_admin`) for consistency with store/DB schema. Error response fields `errorCode`, `params`, `details` remain unchanged per [shared-contracts.md](shared-contracts.md).
- **Route handlers**: Wrap async handlers with `asyncHandler` from `server/utils/errorHandler.js` so thrown errors are passed to the error handler middleware.
- **Errors**: The global `errorHandler` formats responses. In route code, throw errors with `status`, `errorCode`, and optionally `params` for i18n. See [shared-contracts.md](shared-contracts.md) for the error response format.
- **Auth and user**: After `authenticateToken`, `req.user.id` is set. After `requireUser`, `req.user.full` contains the loaded user. Use `normalizePathParam` for path inputs; then use `req.query.path`, `req.body.path`, or other normalized body/query params as documented (not `req.path`, which is the URL path).
- **Shared usage**: Use `@webdav-easyaccess/shared/constants`, `shared/serverMessageCodes`, and `shared/validation` for cross-stack consistency.

---

## Shared Module Usage

- **Use `@webdav-easyaccess/shared/*` for**: constants, validation helpers, and server message/error codes. Both client and server may depend on these.
- **Do not put** client-only or server-only logic in `shared`; keep it in `client/src` or `server` respectively.

---

## Tooling

- **ESLint**: The client uses `eslint-config-react-app` (see `client/package.json`). Follow the configured rules; if you need an exception, add a comment explaining why.
