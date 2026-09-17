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

| Name       | Type     | Required | Default                    | Description                                                                                         |
| ---------- | -------- | -------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| open       | boolean  | Y        | -                          | Dialog open                                                                                         |
| onClose    | function | Y        | -                          | Close handler                                                                                       |
| collection | object   | Y        | -                          | snake_case Collection row (owner rows carry `definition`; grantee rows do not, collections.md §2.4) |
| initialTab | string   | N        | 'info'                     | `'info' \| 'ai' \| 'sharing'` — card menu `Sharing` opens `sharing` directly                        |
| aiFlags    | object   | N        | `{embed:false,chat:false}` | From `settings/public.ai` (host-provided; gates tabs, §4.12)                                        |
| onPatch    | function | N        | -                          | `(patch) => void` — `PUT /:id` (`{ name?, pinned?, publishMode? }`) via host controller             |

### 2.3 Tabs

- **Tab bar idiom:** between title and body, `Info` default active; Close fixed at the bottom bar (DEF-11 precedent).
- **`Versions` is NOT offered** — collections are not versioned. **Decision:** tab presence itself is the invariant statement; nothing fills that slot.
- **Info:** name (inline rename → `PUT /:id`, flips `name_locked=true`), origin/status/publish_mode chips, pinned state (`pinned_by='auto'` shows the auto-pin chip + unpin CTA, §4.9b), `item_count`, timestamps (`created_at`/`updated_at`/`last_member_change_at`), member sample via `POST /:id/preview` (dry count + `sample` ≤12 + `plus N more` from `count − sample.length`) — owner-only preview call.
- **AI Info:** owner-only, rendered ONLY when `collection.definition.kind` is AI-derived (seed/vector/tag) — **absent, not disabled** for rule/manual collections and for missing capability (§4.12 regular-user rule). Shows definition facts: kind, θ (`definition.theta`), seed reference name, template-vs-LLM naming provenance (`name_locked` state), last member-change time. NO raw vectors, NO model internals (privacy boundary §4.15 stance).
- **Sharing:** owner-only (grants routes are owner-scoped; grantee rows simply omit the tab). Grant list from `GET /:id/grants` (`username`, `role`, `created_at`); add via UserSelectionMenu → `POST /:id/grants { userId, role }` (role select `viewer | editor`); revoke per row → `DELETE` (instant, §4.7). `publish_mode` radio `ask (default) | off | auto` (PUT) with the §4.7 explanation: `ask` parks new members behind the pending banner; enabling sharing itself stays the explicit act (invariant 2). Footer note: initial `seed`/`search` member set is pre-approved (Q2).

### 2.4 Callback Signatures

| Callback | When invoked                   | Arguments                                     |
| -------- | ------------------------------ | --------------------------------------------- |
| onClose  | Dialog close                   | -                                             |
| onPatch  | rename/pin/publish-mode writes | `(patch)` — host maps to gateway + undo toast |

### 2.5 Dependencies

- **imports:** MUI dialog/tab primitives, useTranslation, formatDate/formatFileSize, UserSelectionMenu; **no** service imports (host controller performs IO, results flow back via props/`onPatch` refresh).

### 2.6 FilePropertiesDialog extensions (collection context — cross-reference)

- **Decision:** `Member of` chips and a per-FILE `AI Info` tab belong to FilePropertiesDialog, not this dialog: Info tab gains membership chips (`POST /collections/for-nodes` → collection names, click routes to that collection's member view, DEF-25); `AI Info` tab (file `tags/summary/caption` from `ai_features`) renders only when features exist for the viewer's capability state — absent-not-disabled (§4.12), and read-only tab subset when opened by a collection grantee who is not the file owner (§3.2 member-row properties rule). FilePropertiesDialog.md gets the corresponding row at implementation time.

### 2.7 i18n Keys

- `dialogs.collectionTabInfo` / `collectionTabAi` / `collectionTabSharing`, `dialogs.collectionName`, `dialogs.collectionOrigin`, `dialogs.collectionPinnedAuto`, `dialogs.collectionPreview` (`plus N more`), `dialogs.collectionGrants`, `dialogs.collectionGrantAdd`, `dialogs.collectionRevoke`, `dialogs.publishModeAsk|Off|Auto` + helper texts, `dialogs.collectionAiInfo*`

### 2.8 Verification Scenarios

- [ ] Tab bar renders between title and body; `Info` default; Close fixed across switches.
- [ ] Grantee row (no `definition`) shows Info minus definition facts and NO AI Info/Sharing tabs.
- [ ] `aiFlags.embed=false` + vector definition ⇒ AI Info tab absent (not gray).
- [ ] Rename triggers `onPatch({ name })`; auto-pin chip unpin triggers `onPatch({ pinned: false })`.
- [ ] Grant add/revoke call host seams and list updates from the response; revoke has no confirm (instant).
- [ ] Preview failure is non-fatal: dialog renders with placeholder (async-fallback precedent).

### 2.9 Edge Cases

- Unknown `initialTab` ⇒ `Info`.
- Publishing while banner count changes server-side: banner is list-owned; dialog never double-renders counts.
