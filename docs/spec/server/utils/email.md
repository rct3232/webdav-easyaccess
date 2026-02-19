# email Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Email: initEmailTransporter, sendEmail, sendRegistrationPendingEmail, sendApprovalEmail, etc. Uses nodemailer. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/email.js`
- **Test file:** `server/utils/__tests__/email.test.js`

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| initEmailTransporter | () => object \| null | Init nodemailer |
| sendEmail | (to, subject, htmlContent) => Promise\<object\> | Send mail |
| sendRegistrationPendingEmail | (email, username) => Promise | Pending registration |
| sendApprovalEmail | (email, username) => Promise | Approval notification |
| sendRejectionEmail | (email, username) => Promise | Rejection notification |
| isEmailEnabled | () => boolean | Check if email configured |

### 2.3 Input / Output

- sendEmail returns { success, messageId? } or { success: false, error }
- When not configured: logs to console

### 2.4 Dependencies

- nodemailer
- EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD, EMAIL_FROM_NAME

### 2.5 Mock Targets

- nodemailer.createTransport
- transporter.sendMail
- process.env.EMAIL_*

### 2.6 Verification Scenarios

- [ ] sendEmail when configured
- [ ] Fallback when not configured
- [ ] sendRegistrationPendingEmail, sendApprovalEmail, sendRejectionEmail
- [ ] isEmailEnabled
