# CollectionPropertiesDialog Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Dialog showing collection properties on the FilePropertiesDialog tab-bar idiom (`Info` default, `Versions`-style extra tabs): Info + `AI Info` (definition/provenance, owner-only, capability-gated) + Sharing tab (grants + publish mode). Bottom action bar fixed across tab switches. |
| Used in            | FileManager collections surfaces (card menu Properties/Sharing), CollectionsListView member flow (for the FILE-side variant see §2.6)                                                                                                                                                    |
| Related components | FilePropertiesDialog (tab precedent + UserSelectionMenu; the dirty-close prompt is dialog-local because ConfirmDialog is 2-action)                                                                                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/CollectionPropertiesDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/CollectionPropertiesDialog.test.js`

### 2.2 Props

| Name           | Type                    | Required | Default                    | Description                                                                                                                                                                                                                                 |
| -------------- | ----------------------- | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| open           | boolean                 | Y        | -                          | Dialog open                                                                                                                                                                                                                                 |
| onClose        | function                | Y        | -                          | Close handler; invoked only after a clean close, a Discard choice, or a successful save                                                                                                                                                     |
| collection     | object                  | Y        | -                          | snake_case Collection row (owner rows carry `definition`; grantee rows do not — `routes/collections.md` §2.4). Owner = `granted_role == null` — the wire never invents `'owner'` (§12.1 P-4), so that is the Sharing/AI-Info gate predicate |
| initialTab     | string                  | N        | 'info'                     | `'info' \| 'ai' \| 'sharing'` — card menu `Sharing` opens `sharing` directly                                                                                                                                                                |
| aiFlags        | object                  | N        | `{embed:false,chat:false}` | From `settings/public.ai` (host-provided; gates tabs)                                                                                                                                                                                       |
| onSave         | function                | N        | -                          | `(plan) => Promise<boolean>` — one atomic save through the host (`PUT /:id/properties`); the plan carries only changed top-level fields and changed grant rows. Resolves `true` after a successful save so the dialog can close             |
| grants         | array \| null           | N        | `null`                     | Host-loaded `GET /:id/grants` rows (`{ grantee_id, username, role, created_at }` verbatim); `null` ⇒ not yet loaded (skeleton slot + disabled add trigger). Only consulted on the owner-only Sharing tab                                    |
| shareableUsers | array                   | N        | `[]`                       | Host-prepared `GET /api/users/approved` rows (the server read already excludes the requester and admin users; the picker's derivation excludes already-granted users and any `is_admin` row again)                                          |
| preview        | object \| false \| null | N        | `null`                     | Host-loaded `POST /:id/preview` payload (`{ count, sample, sample_truncated }`); `null` ⇒ loading (skeleton), `false` ⇒ read failed → placeholder (non-fatal)                                                                               |
| seedName       | string \| null          | N        | -                          | Host-resolved seed-reference name (batched `POST /files/metadata` on `definition.seed_ref`); absent ⇒ the AI Info tab omits the seed-reference row                                                                                          |

### 2.3 Draft Model

- **Draft state lives in the dialog parent.** `name`, `publishMode`, `pinned`, and the grant rows are one draft that survives tab switches; no tab owns a private copy.
- The baseline is the snapshot taken when the dialog opens (the `collection` row fields + the first loaded `grants` array). External row refreshes do not overwrite the draft while the dialog is open; the open/reset effect keys on the dialog `open` flag and `collection.collection_id`, never on `collection.name`.
- `dirty` is derived by comparing the draft against the baseline: a trimmed name different from the baseline name (Save is disabled when the draft name is empty), a different publish mode, a different pinned flag, or any grant row added/removed/role-changed.
- **No write happens before Save.** Rename, publish-mode radio, unpin, add-user, role change, and remove only mutate the draft. The client plan sent to `onSave` contains only changed top-level keys and, when grant rows changed, `grants: { upsert: [{ userId, role }], revoke: [userId] }`.
- Save is available from every tab; it sends the whole draft plan regardless of the active tab.
- The footer always ends with the default-text `Close` button; while dirty, an outlined-primary `Save` button is inserted immediately before it so Close never shifts position. Save is disabled while saving or when the draft name is empty.
- Closing through the Close button, Escape, or the backdrop while clean calls `onClose`; while dirty it opens a local three-action confirmation (`Save` / `Discard` / `Cancel`). `Cancel` returns to the dialog with the draft intact, `Discard` closes without saving, and `Save` runs the normal save path. While a save is in flight every close path is blocked.

### 2.4 Tabs

- **Tab bar idiom:** between title and body, `Info` default active; Close fixed at the bottom bar. Switching tabs closes the user picker.
- **`Versions` is NOT offered** — collections are not versioned; nothing fills that slot.
- **Info:** name (inline draft field), origin/status/publish_mode chips read from the DRAFT values, pinned state read from the draft (`pinned_by='auto'` shows the auto-pin chip + unpin CTA; unpin only sets the draft flag), `item_count`, timestamps (`created_at`/`updated_at`/`last_member_change_at`), member sample via `POST /:id/preview` (dry count + `sample` ≤12 + `plus N more` from `count − sample.length`) — owner-only preview call.
- **AI Info:** owner-only, rendered ONLY when `collection.definition.kind` is AI-derived (seed/vector/tag) — **absent, not disabled** for rule/manual collections and for missing capability (regular-user rule — no gray AI affordances). The capability gate is `aiFlags.embed` (embed is the capability that makes a derived membership real — `false` hides the tab for every AI kind). Shows definition facts: kind (localized — never the raw enum), θ (`definition.theta`), seed reference name (`seedName` prop for `definition.seed_ref`, row omitted when the host supplies none), template-vs-LLM naming provenance (`name_locked` state), last member-change time. NO raw vectors, NO model internals (privacy-boundary stance).
- **Sharing:** owner-only (grants routes are owner-scoped; grantee rows simply omit the tab). One `Shared with` list renders `grantsDraft` — host-loaded rows and users added in this session merge into the same list (there is no separate pending list). Each row renders the username, the role as a LOCALIZED, CLICKABLE chip (`permissions.viewer` / `permissions.editor` — never the raw enum, same idiom as the MyPage received-grant chips) and the `created_at` stamp, plus a revoke action labeled `dialogs.revokePermission` (P-1 unified receiver term — EN "Revoke permission"). Clicking the role chip toggles `viewer`/`editor` in the draft; revoke drops the row from the draft. Removing a baseline row and re-adding the same user through the picker restores that user's baseline role.
  Add flow: an `dialogs.addUser` trigger opens `UserSelectionMenu` anchored to it, pinned to the select-user view (the manage view is not offered in the collection context). Candidate filtering reads the DRAFT rows, so a selected user disappears from the candidate list immediately. Choosing a candidate appends a draft row with the baseline role when the user had one, otherwise `viewer`, and closes the menu. The bottom role toggle/caption is not offered — role changes happen on the row chip.
  `publish_mode` radio `ask (default) | off | auto` writes the draft with the publish-mode explanation: `ask` parks new members behind the pending banner; enabling sharing itself stays the explicit act — exposure expansion is always explicit. Footer note: the initial `seed`/`search` member set is created publish-approved as a batch (the create confirm dialog is that approval).

### 2.5 Callback Signatures

| Callback | When invoked                              | Arguments                                                           |
| -------- | ----------------------------------------- | ------------------------------------------------------------------- |
| onClose  | Clean close, Discard, or successful Save  | -                                                                   |
| onSave   | Save (footer or dirty-close confirmation) | `(plan)` — only changed keys; resolves `true` after the host commit |

### 2.6 Dependencies

- **imports:** MUI dialog/tab primitives, useTranslation, formatDate/formatFileSize, UserSelectionMenu; **no** service imports (the host — the `FileManager` shell per `FileManager.md` §7 — performs IO through the `useCollections` gateway seams + `userService` approved-user read, and results flow back via props / `onSave` refresh).

### 2.7 FilePropertiesDialog extensions (collection context — cross-reference)

- `Member of` chips and a per-FILE `AI Info` tab in the collection context are rendered by FilePropertiesDialog (`FilePropertiesDialog.md`), not this dialog: Info tab gains membership chips (`POST /collections/for-nodes` → collection names, click routes to that collection's member view); `AI Info` tab (file `tags/summary/caption` from `ai_enrichments`) renders only when enrichment data exists for the viewer's capability state — absent-not-disabled, and read-only tab subset when opened by a collection grantee who is not the file owner (member-row properties rule).

### 2.8 i18n Keys

- `dialogs.collectionTabInfo` / `collectionTabAi` / `collectionTabSharing`, `dialogs.collectionName`, `dialogs.collectionOrigin`, `dialogs.collectionStatus`, `dialogs.collectionPinnedAuto`, `dialogs.collectionPinnedUser`, `dialogs.collectionPreview` (`plus N more`), `dialogs.collectionPreviewUnavailable`, `dialogs.collectionGrants`, `dialogs.collectionGrantsEmpty`, `dialogs.collectionGrantRoleToggle` (role-chip switch affordance), `dialogs.publishModeAsk|Off|Auto` + `publishMode*Helper` texts + `dialogs.publishModeExposureNote` + `dialogs.collectionPublishInitialNote`, `dialogs.collectionAiInfo*`, `dialogs.collectionUnsavedTitle`, `dialogs.collectionUnsavedMessage`, `dialogs.collectionDiscard`
- REUSED (no new copy invented): `dialogs.revokePermission` (the P-1 unified revoke label — EN "Revoke permission" / KO "권한 반납"), `dialogs.addUser` + `dialogs.noUsersToAdd` (UserSelectionMenu picker), `dialogs.userIdFallback` (picker fallback name), `permissions.viewer` / `permissions.editor` (grant role chips AND their toggle labels), `fileManager.collectionsUserPin` (the pin-row caption), `dialogs.propertiesTitle` (dialog title), `common.close`, `common.save`, `common.saving`, `common.cancel`.
- One summary success toast rides `collections.propertiesSaved`; failures use the hook's mapped server error. No per-grant undo labels are emitted by this dialog.

### 2.9 Verification Scenarios

- [ ] Tab bar renders between title and body; `Info` default; Close fixed across switches.
- [ ] Grantee row (no `definition`) shows Info minus definition facts and NO AI Info/Sharing tabs.
- [ ] `aiFlags.embed=false` + vector definition ⇒ AI Info tab absent (not gray).
- [ ] Rename, publish-mode change, unpin, grant add/remove/role-toggle only mutate the draft: no `onSave` call before Save; Save appears only while dirty.
- [ ] Save from any tab emits one plan with only changed keys (`name`/`publishMode`/`pinned`/`grants`) and closes after a `true` result; a `false` result keeps the dialog open with the draft intact.
- [ ] Info publish chip and pin row read the draft values after a Sharing-tab edit (draft survives tab switches, and switching tabs closes an open picker).
- [ ] Dirty Close/Escape/backdrop shows Save/Discard/Cancel; Cancel keeps the draft, Discard closes without saving, Save commits. Close is blocked while a save is in flight.
- [ ] Sharing list merges added users with loaded grants; role chip toggles viewer/editor; remove drops the row; re-adding a baseline user restores the baseline role; candidates exclude draft rows, admins, and self.
- [ ] Grant rows render the LOCALIZED role chip; the revoke action carries the unified `dialogs.revokePermission` label in BOTH locales (en/ko mirror).
- [ ] `publish_mode` radio reflects the draft, and the exposure-explicit note + initial-batch footer render on the Sharing tab.
- [ ] Preview failure is non-fatal: dialog renders with placeholder (async-fallback precedent).

### 2.10 Edge Cases

- Unknown `initialTab` ⇒ `Info`.
- Publishing while banner count changes server-side: banner is list-owned; dialog never double-renders counts.
- A save plan without changes is never emitted (Save is absent when clean).
- Grants not yet loaded ⇒ skeleton, add trigger disabled, no grant diff in the plan.
