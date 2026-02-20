# ConflictResolveDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Dialog for conflict resolution during copy/move. Lists conflicting paths and offers Overwrite, Skip, or Cancel. |
| Used in | FileManager (bulk copy/move when conflicts exist) |
| Related components | MUI Dialog, List, conflict list |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ConflictResolveDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/ConflictResolveDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close/cancel handler |
| onResolve | function | Y | - | Resolve handler with 'overwrite' or 'skip' |
| conflicts | array | N | [] | Array of { path, type } |
| operationType | string | N | - | Operation type (copy/move) |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Cancel button | - |
| onResolve | Overwrite or Skip button | ('overwrite' \| 'skip') |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Dialog/List/ListItem/Typography/Box
- **Reference implementation:** `client/src/components/dialogs/ConflictResolveDialog.js`

### 2.5 i18n Keys

- `dialogs.conflictTitle`, `dialogs.conflictMessage`, `dialogs.conflictMergeNote`, `dialogs.conflictSkipNote`, `dialogs.overwrite`, `dialogs.skip`

### 2.6 Conditional Rendering

- conflict.type === 'directory' – FolderIcon, else FileIcon
- Lists conflicts with path basename and full path

### 2.7 Verification Scenarios

- [ ] Renders conflict list
- [ ] onResolve('overwrite'), onResolve('skip')
- [ ] onClose on Cancel

### 2.8 Edge Cases

- Empty conflicts array – list empty
- onResolve('overwrite'/'skip'): 전체 conflicts에 대해 일괄 적용 (개별 선택 아님)
- conflicts 배열 resolve 중 변경: 부모가 immutable로 관리; 변경 시 예측 불가
