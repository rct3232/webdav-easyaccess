# ExternalShareSection Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Section for external share link: create link, expiry options, copy link. Uses createShareLink, getShareLinkUrl. |
| Used in | ShareDialog, ShareTargetDialog |
| Related components | formatDateOnly, getServerErrorDisplay |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ExternalShareSection.js`
- **Test file:** `client/src/components/dialogs/__tests__/ExternalShareSection.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| externalShareLink | string | Y | - | Share link |
| setExternalShareLink | function | Y | - | Set link |
| externalShareLoading | boolean | Y | - | Loading |
| setExternalShareLoading | function | Y | - | Set loading |
| externalShareExpiresInDays | number | N | - | Expiry days |
| setExternalShareExpiresInDays | function | Y | - | Set expiry |
| externalShareUnlimited | boolean | Y | - | Unlimited expiry |
| setExternalShareUnlimited | function | Y | - | Set unlimited |
| linkCopied | boolean | Y | - | Copy feedback |
| setLinkCopied | function | Y | - | Set copied |
| createShareLink | function | Y | - | Create link API |
| getShareLinkUrl | function | Y | - | Get URL |
| filePath | string | N | - | File path |
| fileName | string | N | - | File name |
| onMessage | function | N | - | Message handler |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| createShareLink | Create button | - |
| setLinkCopied | Copy click | (boolean) |
| onMessage | Error/success | - |

### 2.4 Dependencies

- **imports:** formatDateOnly, getServerErrorDisplay, shareLinkService, copyToClipboard (clipboard util)
- **Reference implementation:** `client/src/components/dialogs/ExternalShareSection.js`

### 2.5 i18n Keys

- `share.externalLink`, `share.createLinkFor`, `share.expiresIn`, etc.

### 2.6 Conditional Rendering

- No link: expiry options, create button
- Has link: copy button, expiry display

### 2.7 Verification Scenarios

- [ ] Create link, copy link
- [ ] Expiry options (unlimited, days)
- [ ] Error handling

### 2.8 Edge Cases

- displayName from fileName or path basename
