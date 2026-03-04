# PageHeaderContext Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Supplies title and action slot for MyPage content panel header. Provider is MyPageContentPanel; consumers are content components (AccountContent, SharingContent, PreferencesContent, SystemSettingsContent, UserManagementContent) that call setTitle/setActions to render in the shared header row. |
| Used in | MyPageContentPanel (provider); AccountContent, SharingContent, PreferencesContent, SystemSettingsContent, UserManagementContent (consumers) |
| Related | MyPageContentPanel, MyPage |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/contexts/PageHeaderContext.js`
- **Test file:** `client/src/contexts/__tests__/PageHeaderContext.test.js` (if present; otherwise covered via MyPageContentPanel tests)

### 2.2 Provided Value

| Key | Type | Description |
|-----|------|-------------|
| title | string | Current header title (set by child via setTitle). |
| actions | ReactNode \| null | Optional action buttons or node for the header row (set by child via setActions). |
| setTitle | (val: string \| null \| undefined) => void | Sets the header title; null/undefined treated as ''. |
| setActions | (a: ReactNode \| null) => void | Sets the header actions; null clears. |

### 2.3 Hook

- usePageHeader() – returns the context value; throws if used outside PageHeaderContext.Provider.

### 2.4 Dependencies

- React (createContext, useContext).

### 2.5 Verification Scenarios

- [ ] usePageHeader() inside provider returns object with title, actions, setTitle, setActions.
- [ ] usePageHeader() outside provider throws with message "usePageHeader must be used within a PageHeaderContext.Provider".
- [ ] setTitle/setActions from child update the header row in MyPageContentPanel (integration with panel tests).

### 2.6 Edge Cases

- Initial state: title '', actions null.
