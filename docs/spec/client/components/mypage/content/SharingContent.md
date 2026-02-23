# SharingContent Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | List (Inbox requests, Outbox requests, Share links) or Detail view for each sub-item. Multi-item category with List → Detail flow. Hidden for admin users. |
| Used in | MyPageContentArea (when selectedCategory is 'sharing') |
| Related components | ShareDialog (mode share, mode review), shareLinkService, permissionRequestService |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/SharingContent.js`
- **Test file:** `client/src/components/mypage/content/__tests__/SharingContent.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| selectedContentItem | string \| null | Y | - | null = list view; 'inbox', 'outbox', 'links' = detail view |
| onSelectContentItem | function | Y | - | Switch to list or detail |
| user | object | Y | - | Current user |
| onMessage | function | N | - | Message handler for feedback |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onSelectContentItem | List item clicked or Back pressed | (itemId \| null) – 'inbox', 'outbox', 'links', or null |

### 2.4 Dependencies

- **imports:** useTranslation, usePageHeader (PageHeaderContext), ShareDialog, shareLinkService, permissionRequestService, permissionService, formatDate, formatDateOnly, getServerErrorDisplay
- **Header:** Uses `usePageHeader()` to set title based on `selectedContentItem`: null → `mypage.shareManage`, 'inbox' → `mypage.inboxRequests`, 'outbox' → `mypage.outboxRequests`, 'links' → `mypage.links`. No action buttons. Resets on unmount.
- **Reference implementation:** `client/src/pages/MyPage.js` (share manage section, inbox/outbox/links logic)

### 2.5 i18n Keys

- `mypage.shareManage`, `mypage.sharePermissionManage`
- `mypage.inboxRequests`, `mypage.outboxRequests`, `mypage.links` (list labels; count shown via MUI Badge)
- `mypage.noRequestsToShow`, `mypage.noShareLinks`
- `mypage.read`, `mypage.write`, `mypage.pending`, `mypage.approved`, `mypage.rejected`, `mypage.cancelled`
- `mypage.file`, `mypage.folder`, `mypage.requester`, `mypage.owner`, `mypage.messageLabel`, `mypage.review`
- `mypage.permissionApproved`, `mypage.requestRejected`, `mypage.requestCancelled`
- `mypage.linkCopied`, `mypage.linkCopyFail`, `mypage.linkDeleted`, `mypage.linkDeleteFail`, `mypage.linkExtended`, `mypage.linkExtendFail`
- `mypage.expired`, `mypage.expiresAtDate`, `mypage.unlimited`, `mypage.downloadCount`, `mypage.extend7Days`, `mypage.confirmDeleteLink`
- `common.delete`

### 2.6 Conditional Rendering

- **selectedContentItem null:** List view – four items: Share permission manage, Inbox requests (Badge count), Outbox requests (Badge count), Links (Badge count). Each clickable. Labels use `inboxRequests`, `outboxRequests`, `links`; count displayed via MUI Badge.
- **selectedContentItem 'inbox':** Detail – Inbox permission requests (approve, reject, review for folder).
- **selectedContentItem 'outbox':** Detail – Outbox permission requests (cancel).
- **selectedContentItem 'links':** Detail – Share links (copy, extend, delete).

Parent MyPageContentArea passes `onBack` to MyPageContentPanel when in detail mode; Back sets selectedContentItem to null.

### 2.7 Verification Scenarios

- [ ] List view shows Inbox, Outbox, Links with counts
- [ ] Clicking list item calls onSelectContentItem(itemId)
- [ ] Inbox detail: approve, reject, review
- [ ] Outbox detail: cancel
- [ ] Links detail: copy, extend, delete
- [ ] Back returns to list (onSelectContentItem(null))

### 2.8 Edge Cases

- Empty inbox/outbox/links – show "no requests" / "no share links" message.
- API errors – call onMessage with error; keep list/data as-is where appropriate.
- Share links loading – show CircularProgress.
