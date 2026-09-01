# [PageName] Spec

## 1. Overview

| Item       | Description                  |
| ---------- | ---------------------------- |
| Route path | (e.g. /files, /share/:token) |
| Role       | (Page's role)                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/[PageName].js`
- **Test file:** `client/src/pages/__tests__/[PageName].test.js`

### 2.2 Hooks Used

- useFileManager, useAuth, etc. (list)

### 2.3 Main Child Components

- FileList, FolderTree, dialogs, etc.

### 2.4 Route Protection

- Whether PrivateRoute is used
- Auth required or not

### 2.5 Main User Flows

- Search, sort, selection, bulk operations, etc.

### 2.6 Integration Test Scenarios

Checklist for MSW + RTL integration tests:

- [ ] Initial render on load
- [ ] API calls and UI response per user action
- [ ] Error state display
- [ ] Other flow verification

### 2.7 Conditional Rendering

- Loading state
- Share link mode
- Error state
- Other branches
