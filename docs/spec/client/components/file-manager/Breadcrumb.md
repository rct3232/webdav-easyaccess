# Breadcrumb Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | NodeId breadcrumb: renders the current folder's ancestor chain (`ancestors: [{ nodeId, name }]` fetched via `fileService.getAncestors`, hitting the dedicated `GET /files/ancestors` endpoint) as chips. Shown on all viewports (mobile and desktop). The first chip is the **home chip**, which represents the acting user's own home scope (see 2.6). shareRootPath: share mode (path within share). Optional folder tree toggle. |
| Used in            | FileManager                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Related components | `GET /files/ancestors` ancestor chain (`fileService.getAncestors`), consumed in `useFileManager`                                                                                                                                                                                                                                                                                                                                    |

### 1.1 Home chip semantics (root cause of the home-duplication defect)

- A regular (non-admin) user's home is the top-level `file_nodes` row named after their username
  (`rootNodeId`, see `docs/spec/server/routes/auth.md`). Because that node is a real ancestor of
  any subfolder inside the home, the server ancestor chain includes it as its first entry.
- The home chip **already represents that home scope** (for a non-admin it is exactly the user's
  home node; for an admin it is the filesystem root `/`, which has no DB node).
- Therefore the home chip and the first ancestor entry are the **same location** for a non-admin
  user inside their own home. The breadcrumb MUST render that location only once:
  - **Non-admin inside own home tree**: the ancestor entry whose `nodeId === user.rootNodeId` is
    **not rendered as a chip** (home chip replaces it). Example: inside `docs` of home →
    `Home > docs` (never `Home > {username} > docs`).
  - **Admin** (`rootNodeId` is `null` / no home node): no trimming applies; ancestor chips show
    the real hierarchy under `/` (e.g. `Home > alice > docs` when browsing another account's tree).
  - A non-admin browsing **another account's** folder (shared scope) keeps that account's node
    name in the chain (only the acting user's own `rootNodeId` is ever trimmed).
- Trimming is keyed on **nodeId equality with the acting user's `rootNodeId` and `!is_admin`** —
  never on a name match.

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/Breadcrumb.js`
- **Test file:** `client/src/components/file-manager/__tests__/Breadcrumb.test.js`

### 2.2 Props

| Name                 | Type     | Required | Default | Description                                                                                                                                                                                                                                                                       |
| -------------------- | -------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ancestors            | array    | Y        | -       | Current folder's ancestor chain `[{ nodeId, name }]`, fetched via `fileService.getAncestors` (`GET /files/ancestors`) in `useFileManager`                                                                                                                                         |
| onNodeClick          | function | Y        | -       | Ancestor chip click (by nodeId)                                                                                                                                                                                                                                                   |
| user                 | object   | N        | -       | User                                                                                                                                                                                                                                                                              |
| onToggleFolderTree   | function | N        | -       | Toggle folder tree                                                                                                                                                                                                                                                                |
| isFolderTreeOpen     | boolean  | N        | -       | Tree open                                                                                                                                                                                                                                                                         |
| shareRootPath        | string   | N        | -       | Share root (share mode)                                                                                                                                                                                                                                                           |
| shareRootName        | string   | N        | -       | Share root name                                                                                                                                                                                                                                                                   |
| showFolderTreeToggle | boolean  | N        | -       | Show toggle                                                                                                                                                                                                                                                                       |
| collectionName       | string?  | N        | null    | The collection NAME for the member-route trail — resolved SHELL-side from the existing `useCollections` fetched list matched by `collectionId` (`FileManagerView.md` §3). `null` while the list is still loading ⇒ the transient `…` segment renders (the trail is NEVER hidden). |

### 2.3 Callback Signatures

| Callback           | When invoked        | Arguments |
| ------------------ | ------------------- | --------- |
| onNodeClick        | Ancestor chip click | (nodeId)  |
| onToggleFolderTree | Toggle click        | -         |

### 2.4 Dependencies

- **imports:** the `ancestors` chain comes from the dedicated `fileService.getAncestors` service call (`GET /files/ancestors`), invoked in `useFileManager` and passed via the `ancestors` prop (server builds the chain via the ancestor-chain helper)
- **Reference implementation:** `client/src/components/file-manager/Breadcrumb.js`
- No client-side shared-permission path loading is needed for segment derivation; segment names and nodeIds come from the server-provided ancestor chain.

### 2.5 i18n Keys

- nav.home, nav.recentShort, nav.shared, nav.sharedFolder, nav.folderTreeOpen, nav.folderTreeClose
- nav.collections (Collections chip — SAME key the tree header uses: label parity),
  nav.collectionsLiked (Likes segment — SAME key as the tree LikesNode; EN "Liked" / KO "좋아요")
- nav.collectionsArchive (Archive segment — SAME key as the
  tree ArchiveNode; EN "Archive" / KO "보관함"; STATIC label — the archive surface resolves no
  name from data)

### 2.6 Home chip (leading chip)

- Label: `nav.home` (Home / Home) for **all roles**. The admin chip is no longer a distinct
  "All" label — the admin home scope (filesystem root `/`) is still represented by the home
  chip and must navigate to `/` (`homeClickTarget` = `null` for admins, `user.rootNodeId` for
  non-admins).
- Icon: home icon.
- Ancestor chips: derived from the server ancestor chain **minus** the acting user's own home
  node for a non-admin (see 1.1).

### 2.7 Conditional Rendering

- shareRootPath: segments relative to share root
- **shared**/**recent**: no segments
- Home/shared/recent: special icons
- showFolderTreeToggle: up/down icon
- **Collections surfaces** — home-chip replacement precedent of trash/recent:
  - member route (`currentPath` starts with `/__collections__/collection/`): the home chip becomes
    `Collections` (`nav.collections`, Collections icon, click → `/__collections__`) and ONE
    segment chip renders: the collection NAME (`collectionName`), or the transient `…` while the
    list has not resolved it (never hide the segment). The name chip is the
    current location (click → the member route itself).
  - liked route (`currentPath === '/__collections__/liked'`): home chip `Collections` + segment
    `Liked` (`nav.collectionsLiked` — the SAME key as the tree's LikesNode: label parity, never a
    third wording).
  - archive route (`currentPath === '/__collections__/__archive__'`):
    home chip `Collections` (click → `/__collections__`, the member/liked chain precedent) +
    segment `Archive` (`nav.collectionsArchive` — the SAME key as the tree's ArchiveNode: label
    parity). STATIC label: the archive surface has no per-row name to resolve from data. The
    segment chip points at the current archive route (mirrors the liked chain).
  - The ancestor chain never renders on these virtual routes (overlay fetches no ancestors).

### 2.8 Verification Scenarios

- [ ] Ancestor chain rendered from `ancestors`; chip click navigates by nodeId
- [ ] Non-admin inside own home subfolder: first chip is the home chip (`nav.home`); the
      user's own `rootNodeId`/username ancestor is **not** rendered as a chip
- [ ] Admin browsing any folder: every real ancestor (incl. other accounts' home nodes) renders
      as chips; nothing is trimmed
- [ ] Share mode path parsing
- [ ] Toggle folder tree
- [ ] Member route (`/__collections__/collection/:id`): chips are `Collections › <name>` — the leading chip navigates to `/__collections__`, the name chip to the current route; `collectionName=null` renders the transient `…` segment (never hides the trail).
- [ ] Liked route (`/__collections__/liked`): chips are `Collections › Liked`; both labels come from the SAME i18n keys as the tree rows (tree parity).
- [ ] Archive route (`/__collections__/__archive__`): chips are `Collections › Archive` — the leading chip navigates to `/__collections__`, the Archive chip to the archive route itself; label = `nav.collectionsArchive` (tree parity, static — no name resolution); the generic Home chip NEVER renders on this route.

### 2.9 Edge Cases

- User own folder – no shared segments
- Horizontal scroll for long chains
- Operator rule (admin is a pure operator): the collections/liked/archive crumb variants are unreachable for admin (the `useFileManager` urlView guard resolves admin deep links to home) — hidden by guard; NO redundant admin checks inside the component (avoid-scatter rule).
