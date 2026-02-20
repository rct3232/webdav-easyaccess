# EmailNotificationMessage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Simple component that renders the email notification message from i18n. |
| Used in | Registration, settings |
| Related components | useTranslation |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/feedback/EmailNotificationMessage.js`
- **Test file:** `client/src/components/feedback/__tests__/EmailNotificationMessage.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| None | - | - | - | No props |

### 2.3 Callback Signatures

None.

### 2.4 Dependencies

- **imports:** useTranslation
- **Reference implementation:** `client/src/components/feedback/EmailNotificationMessage.js`

### 2.5 i18n Keys

- `emailNotification.message`

### 2.6 Conditional Rendering

- Renders t('emailNotification.message')

### 2.7 Verification Scenarios

- [ ] Renders translated message
- [ ] Uses i18n

### 2.8 Edge Cases

- None
