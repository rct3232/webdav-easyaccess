# CollectionPropertiesDialog Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Dialog showing collection properties on the FilePropertiesDialog tab-bar idiom (`정보` default, `버전`-style extra tabs): 정보 + `AI 정보` (definition/provenance, owner-only, capability-gated) + 공유 tab (grants + publish mode). Bottom action bar fixed across tab switches. |
| Used in            | FileManager collections surfaces (card menu `속성`/`공유 설정`), CollectionsListView member flow (for the FILE-side variant see §2.6)                                                                                                                                             |
| Related components | FilePropertiesDialog (tab precedent + UserSelectionMenu, ConfirmDialog, BaseDialog)                                                                                                                                                                                               |

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
| initialTab | string   | N        | 'info'                     | `'info' \| 'ai' \| 'sharing'` — card menu `공유 설정` opens `sharing` directly                      |
| aiFlags    | object   | N        | `{embed:false,chat:false}` | From `settings/public.ai` (host-provided; gates tabs, §4.12)                                        |
| onPatch    | function | N        | -                          | `(patch) => void` — `PUT /:id` (`{ name?, pinned?, publishMode? }`) via host controller             |

### 2.3 Tabs

- **Tab bar idiom:** between title and body, `정보` default active; Close fixed at the bottom bar (DEF-11 precedent).
- **`버전` is NOT offered** — collections are not versioned. **Decision:** tab presence itself is the invariant statement; nothing fills that slot.
- **정보:** name (inline rename → `PUT /:id`, flips `name_locked=true`), origin/status/publish_mode chips, pinned state (`pinned_by='auto'` shows the auto-pin chip + unpin CTA, §4.9b), `item_count`, timestamps (`created_at`/`updated_at`/`last_member_change_at`), member sample via `POST /:id/preview` (dry count + `sample` ≤12 + `이 외 N개` from `count − sample.length`) — owner-only preview call.
- **AI 정보:** owner-only, rendered ONLY when `collection.definition.kind` is AI-derived (seed/vector/tag) — **absent, not disabled** for rule/manual collections and for missing capability (§4.12 regular-user rule). Shows definition facts: kind, θ (`definition.theta`), seed reference name, template-vs-LLM naming provenance (`name_locked` state), last member-change time. NO raw vectors, NO model internals (privacy boundary §4.15 stance).
- **공유 (sharing):** owner-only (grants routes are owner-scoped; grantee rows simply omit the tab). Grant list from `GET /:id/grants` (`username`, `role`, `created_at`); add via UserSelectionMenu → `POST /:id/grants { userId, role }` (role select `viewer | editor`); revoke per row → `DELETE` (instant, §4.7). `publish_mode` radio `ask (default) | off | auto` (PUT) with the §4.7 explanation: `ask` parks new members behind the pending banner; enabling sharing itself stays the explicit act (invariant 2). Footer note: initial `seed`/`search` member set is pre-approved (Q2).

### 2.4 Callback Signatures

| Callback | When invoked                   | Arguments                                     |
| -------- | ------------------------------ | --------------------------------------------- |
| onClose  | Dialog close                   | -                                             |
| onPatch  | rename/pin/publish-mode writes | `(patch)` — host maps to gateway + undo toast |

### 2.5 Dependencies

- **imports:** MUI dialog/tab primitives, useTranslation, formatDate/formatFileSize, UserSelectionMenu; **no** service imports (host controller performs IO, results flow back via props/`onPatch` refresh).

### 2.6 FilePropertiesDialog extensions (collection context — cross-reference)

- **Decision:** `소속 컬렉션` chips and a per-FILE `AI 정보` tab belong to FilePropertiesDialog, not this dialog: 정보 tab gains membership chips (`POST /collections/for-nodes` → collection names, click routes to that collection's member view, DEF-25); `AI 정보` tab (file `tags/summary/caption` from `ai_features`) renders only when features exist for the viewer's capability state — absent-not-disabled (§4.12), and read-only tab subset when opened by a collection grantee who is not the file owner (§3.2 member-row properties rule). FilePropertiesDialog.md gets the corresponding row at implementation time.

### 2.7 i18n Keys

- `dialogs.collectionTabInfo` / `collectionTabAi` / `collectionTabSharing`, `dialogs.collectionName`, `dialogs.collectionOrigin`, `dialogs.collectionPinnedAuto`, `dialogs.collectionPreview` (`이 외 N개`), `dialogs.collectionGrants`, `dialogs.collectionGrantAdd`, `dialogs.collectionRevoke`, `dialogs.publishModeAsk|Off|Auto` + helper texts, `dialogs.collectionAiInfo*`

### 2.8 Verification Scenarios

- [ ] Tab bar renders between title and body; `정보` default; Close fixed across switches.
- [ ] Grantee row (no `definition`) shows 정보 minus definition facts and NO AI 정보/공유 tabs.
- [ ] `aiFlags.embed=false` + vector definition ⇒ AI 정보 tab absent (not gray).
- [ ] Rename triggers `onPatch({ name })`; auto-pin chip unpin triggers `onPatch({ pinned: false })`.
- [ ] Grant add/revoke call host seams and list updates from the response; revoke has no confirm (instant).
- [ ] Preview failure is non-fatal: dialog renders with placeholder (async-fallback precedent).

### 2.9 Edge Cases

- Unknown `initialTab` ⇒ `정보`.
- Publishing while banner count changes server-side: banner is list-owned; dialog never double-renders counts.
