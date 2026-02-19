# useFileOperationProgress Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Centralized progress state for move, copy, delete, download, upload. updateProgress to add/update/remove items. Supports fileItems (upload), retryData. |
| Used by components/pages | FileManager, useBulkOperations, useFileOperations |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useFileOperationProgress.js`
- **Test file:** `client/src/hooks/__tests__/useFileOperationProgress.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| None | - | - | - |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| progressItems | array | Current progress items |
| updateProgress | (item) => void | Add/update/remove item |
| clearAllProgress | () => void | Clear all |

### 2.4 Dependencies

- useTranslation
- No services

### 2.5 Side Effects

- State updates only
- progressItem.remove: filter out
- Merge logic: status precedence error > warning > completed

### 2.6 Error Handling

- keepOnError: prevents auto-remove
- retryData stored for retry

### 2.7 Verification Scenarios

- [ ] updateProgress adds/updates/removes
- [ ] remove: true filters item
- [ ] Merge: status precedence
- [ ] fileItems delta merge for upload

### 2.8 Edge Cases

- fileItemsByProgressIdRef for upload batch
- updatedFileItem merge
