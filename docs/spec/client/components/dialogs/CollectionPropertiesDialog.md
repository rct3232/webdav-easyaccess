# CollectionPropertiesDialog Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Dialog showing collection properties on the FilePropertiesDialog tab-bar idiom (`Info` default, `Versions`-style extra tabs): Info + `AI Info` (definition/provenance, owner-only, capability-gated) + Sharing tab (grants + publish mode). Bottom action bar fixed across tab switches. |
| Used in            | FileManager collections surfaces (card menu Properties/Sharing), CollectionsListView member flow (for the FILE-side variant see §2.6)                                                                                                                                                    |
| Related components | FilePropertiesDialog (tab precedent + UserSelectionMenu, ConfirmDialog, BaseDialog)                                                                                                                                                                                                      |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/CollectionPropertiesDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/CollectionPropertiesDialog.test.js`

### 2.2 Props

| Name           | Type                    | Required | Default                    | Description                                                                                                                                                                                                                                      |
| -------------- | ----------------------- | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| open           | boolean                 | Y        | -                          | Dialog open                                                                                                                                                                                                                                      |
| onClose        | function                | Y        | -                          | Close handler                                                                                                                                                                                                                                    |
| collection     | object                  | Y        | -                          | snake_case Collection row (owner rows carry `definition`; grantee rows do not — `routes/collections.md` §2.4). Owner = `granted_role == null` — the wire never invents `'owner'` (§12.1 P-4), so that is the Sharing/AI-Info gate predicate    |
| initialTab     | string                  | N        | 'info'                     | `'info' \| 'ai' \| 'sharing'` — card menu `Sharing` opens `sharing` directly                                                                                                                                                                     |
| aiFlags        | object                  | N        | `{embed:false,chat:false}` | From `settings/public.ai` (host-provided; gates tabs)                                                                                                                                                                                            |
| onPatch        | function                | N        | -                          | `(patch) => void` — `PUT /:id` (`{ name?, pinned?, publishMode? }`) via host controller                                                                                                                                                         |
| grants         | array \| null           | N        | `null`                     | Host-loaded `GET /:id/grants` rows (`{ grantee_id, username, role, created_at }` verbatim); `null` ⇒ not yet loaded (skeleton slot). Only consulted on the owner-only Sharing tab                                                                |
| shareableUsers | array                   | N        | `[]`                       | Host-prepared `GET /api/users/approved` rows (the server read already excludes the requester and admin users; the picker's derivation excludes already-granted users and any `is_admin` row again)                                              |
| preview        | object \| false \| null | N        | `null`                     | Host-loaded `POST /:id/preview` payload (`{ count, sample, sample_truncated }`); `null` ⇒ loading (skeleton), `false` ⇒ read failed → placeholder (non-fatal)                                                                                   |
| seedName       | string \| null          | N        | -                          | Host-resolved seed-reference name (batched `POST /files/metadata` on `definition.seed_ref`); absent ⇒ the AI Info tab omits the seed-reference row                                                                                                |
| onGrant        | function                | N        | -                          | `(userId, role) => void` — host maps to `POST /:id/grants`; the list updates from the response `grant` row (re-grant replaces the role by `grantee_id`)                                                                                          |
| onRevoke       | function                | N        | -                          | `(granteeId) => void` — host maps to `DELETE /:id/grants?userId=` (instant, no confirm); the row drops by `grantee_id` from the response                                                                                                         |

### 2.3 Tabs

- **Tab bar idiom:** between title and body, `Info` default active; Close fixed at the bottom bar.
- **`Versions` is NOT offered** — collections are not versioned; nothing fills that slot.
- **Info:** name (inline rename → `PUT /:id`, flips `name_locked=true`), origin/status/publish_mode chips, pinned state (`pinned_by='auto'` shows the auto-pin chip + unpin CTA), `item_count`, timestamps (`created_at`/`updated_at`/`last_member_change_at`), member sample via `POST /:id/preview` (dry count + `sample` ≤12 + `plus N more` from `count − sample.length`) — owner-only preview call.
- **AI Info:** owner-only, rendered ONLY when `collection.definition.kind` is AI-derived (seed/vector/tag) — **absent, not disabled** for rule/manual collections and for missing capability (regular-user rule — no gray AI affordances). The capability gate is `aiFlags.embed` (embed is the capability that makes a derived membership real — `false` hides the tab for every AI kind). Shows definition facts: kind (localized — never the raw enum), θ (`definition.theta`), seed reference name (`seedName` prop for `definition.seed_ref`, row omitted when the host supplies none), template-vs-LLM naming provenance (`name_locked` state), last member-change time. NO raw vectors, NO model internals (privacy-boundary stance).
- **Sharing:** owner-only (grants routes are owner-scoped; grantee rows simply omit the tab). Grant list from `GET /:id/grants` (`username`, `role`, `created_at`): each row renders the username, the role as a LOCALIZED chip (`permissions.viewer` / `permissions.editor` — never the raw enum, same idiom as the MyPage received-grant chips) and the `created_at` stamp, plus a revoke action labeled `dialogs.revokePermission` (P-1 unified receiver term — EN "Revoke permission") — revoke is INSTANT, no confirm. Add flow: a role toggle (`viewer` default | `editor`, same localized labels) beside an `dialogs.addUser` trigger; the trigger opens `UserSelectionMenu` anchored to it, PINNED to the select-user view (the manage view is not offered in the collection context — the grant list lives in the tab; the Back entry closes the picker). Choosing a candidate calls `onGrant(userId, role)` and closes the menu; already-granted users never reappear as candidates (the derivation filters them, so a role change goes revoke-then-add). List updates flow back from the mutation responses (`grant` row appended/replaced, `grantee_id` row removed). `publish_mode` radio `ask (default) | off | auto` (PUT) with the publish-mode explanation: `ask` parks new members behind the pending banner; enabling sharing itself stays the explicit act — exposure expansion is always explicit. Footer note: the initial `seed`/`search` member set is created publish-approved as a batch (the create confirm dialog is that approval).

### 2.4 Callback Signatures

| Callback | When invoked                   | Arguments                                                       |
| -------- | ------------------------------ | --------------------------------------------------------------- |
| onClose  | Dialog close                   | -                                                               |
| onPatch  | rename/pin/publish-mode writes | `(patch)` — host maps to gateway + undo toast                  |
| onGrant  | picker selection               | `(userId, role)` — host maps to `POST /:id/grants` + undo toast |
| onRevoke | grant-row revoke               | `(granteeId)` — host maps to `DELETE /:id/grants` + undo toast   |

### 2.5 Dependencies

- **imports:** MUI dialog/tab primitives, useTranslation, formatDate/formatFileSize, UserSelectionMenu; **no** service imports (the host — the `FileManager` shell per `FileManager.md` §7 — performs IO through the `useCollections` gateway seams + `userService` approved-user read, and results flow back via props / `onPatch` refresh).

### 2.6 FilePropertiesDialog extensions (collection context — cross-reference)

- `Member of` chips and a per-FILE `AI Info` tab in the collection context are rendered by FilePropertiesDialog (`FilePropertiesDialog.md`), not this dialog: Info tab gains membership chips (`POST /collections/for-nodes` → collection names, click routes to that collection's member view); `AI Info` tab (file `tags/summary/caption` from `ai_enrichments`) renders only when enrichment data exists for the viewer's capability state — absent-not-disabled, and read-only tab subset when opened by a collection grantee who is not the file owner (member-row properties rule).

### 2.7 i18n Keys

- `dialogs.collectionTabInfo` / `collectionTabAi` / `collectionTabSharing`, `dialogs.collectionName`, `dialogs.collectionOrigin`, `dialogs.collectionStatus`, `dialogs.collectionPinnedAuto`, `dialogs.collectionPinnedUser`, `dialogs.collectionPreview` (`plus N more`), `dialogs.collectionPreviewUnavailable`, `dialogs.collectionGrants`, `dialogs.collectionGrantsEmpty`, `dialogs.collectionGrantRoleTitle` (the add-flow role toggle caption), `dialogs.publishModeAsk|Off|Auto` + `publishMode*Helper` texts + `dialogs.publishModeExposureNote` + `dialogs.collectionPublishInitialNote`, `dialogs.collectionAiInfo*`
- REUSED (no new copy invented): `dialogs.revokePermission` (the P-1 unified revoke label — EN "Revoke permission" / KO "권한 반납"), `dialogs.addUser` + `dialogs.back` + `dialogs.noUsersToAdd` (UserSelectionMenu picker), `dialogs.userIdFallback` (picker fallback name), `permissions.viewer` / `permissions.editor` (grant role chips), `fileManager.collectionsAutoPin` / `collectionsUserPin` (pin chip copy), `dialogs.propertiesTitle` (dialog title), `common.close`. Undo-toast labels ride `collections.undoGrantAdded` / `collections.undoGrantRevoked` (+ the existing `collections.undoPublishModeChanged`).

### 2.8 Verification Scenarios

- [ ] Tab bar renders between title and body; `Info` default; Close fixed across switches.
- [ ] Grantee row (no `definition`) shows Info minus definition facts and NO AI Info/Sharing tabs.
- [ ] `aiFlags.embed=false` + vector definition ⇒ AI Info tab absent (not gray).
- [ ] Rename triggers `onPatch({ name })`; auto-pin chip unpin triggers `onPatch({ pinned: false })`.
- [ ] Grant add/revoke call host seams and list updates from the response; revoke has no confirm (instant).
- [ ] Preview failure is non-fatal: dialog renders with placeholder (async-fallback precedent).
- [ ] Grant rows render the LOCALIZED role chip; the revoke action carries the unified `dialogs.revokePermission` label in BOTH locales (en/ko mirror).
- [ ] The picker lists only ungranted, non-admin, non-self candidates; a selection dispatches `onGrant(userId, role)` with the role-toggle value (default `viewer`).
- [ ] `publish_mode` radio reflects `collection.publish_mode`, a change dispatches `onPatch({ publishMode })`, and the exposure-explicit note + initial-batch footer render on the Sharing tab.

### 2.9 Edge Cases

- Unknown `initialTab` ⇒ `Info`.
- Publishing while banner count changes server-side: banner is list-owned; dialog never double-renders counts.
