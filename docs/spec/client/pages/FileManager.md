# FileManager Page Spec

This spec defines the **FileManager page shell** responsibilities and how it composes the **explorer core** (controller hooks + views) together with **product-specific overlays** (share-link mode, virtual collections, and related policies).

It intentionally documents *who owns what*, not file-by-file implementation details for submodules. Detailed contracts belong in the referenced component/hook/service specs.

---

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | `/files/*` |
| Role | Main file browser UI for listing and managing files/folders: CRUD, bulk operations, drag-and-drop upload, sharing overlays, and progress UI. |
| Also used by | `ShareLinkLoader` to render shared directory browsing (share-link mode / limited operations). |

---

## 2. Boundaries (Shell vs Core vs Overlays)

This page is being refactored into explicit layers per `docs/CODING_STYLE.md` ("Client Layering Rules").

### 2.1 Page shell (this spec owns)

The FileManager **page shell** owns:

- Route-level composition and wiring (auth-protected route vs share-link embedding).
- Composing explorer controller hooks and passing prepared props into the FileManager view(s).
- Product-specific overlays for this page (see 2.3).
- Keeping user-visible behavior stable while structure is extracted.

The page shell does **not** own:

- Large derived explorer state (search/sort/display list/view mode) beyond wiring outputs into views.
- Command orchestration (upload/rename/move/copy/delete/download).
- Navigation orchestration (path changes, optimistic updates/rollback).
- Progress state coordination and retry/cancel orchestration.

### 2.2 Explorer core (composed by the shell)

Explorer core is the reusable “file explorer” core for browsing and acting on a directory. It is composed of:

- **Controller hooks** (planned):
  - `docs/spec/client/hooks/useExplorerSession.md` (local explorer session state: view/sort/search/selection-derived state)
  - `docs/spec/client/hooks/useExplorerNavigation.md` (path navigation orchestration and transitions)
  - `docs/spec/client/hooks/useExplorerCommands.md` (file operation orchestration)
  - `docs/spec/client/hooks/useExplorerProgress.md` (progress list + retry/cancel coordination)
  - `docs/spec/client/hooks/useExplorerInteraction.md` (item click/open/context interaction orchestration for explorer content)
  - `docs/spec/client/hooks/useExplorerRefreshIndicator.md` (mobile pull-to-refresh indicator presentation)
- **Product overlay hooks** (planned):
  - `docs/spec/client/hooks/useShareLinkOverlay.md` (share-link add-to-my-permissions and leave-share confirmation flows)
- **Pure view(s)** (planned):
  - `docs/spec/client/components/file-manager/FileManagerView.md` (renders from props only)
- **Gateways/adapters** (planned):
  - `docs/spec/client/services/explorerGateway.md` (IO boundary for listing, operations, and related IO concerns)

Explorer core explicitly does **not** own product overlays such as share-link policy, “virtual collections”, or feature-specific modal flows.

### 2.3 Product-specific overlays (remain in the shell)

The FileManager page shell must continue to own these overlays and policies (until separately specified and extracted):

- **Share-link mode policy**:
  - Limited operations (e.g. no upload/create; download-only bulk operations).
  - Optional login prompt / “add to my permissions” flows when applicable.
- **Virtual collections and product routing state**:
  - Special paths/collections such as `__recent__` and `__shared__` (product-defined).
  - Rules for mapping those collections into explorer inputs and view models.
- **Product dialogs / feature flows** not part of generic explorer:
  - Share dialogs and permission-request flows.
  - Any “add-to-shared” / permission-denied UX that is product-defined.

---

## 3. Implementation Spec (Current + Target Shape)

### 3.1 File paths

- **Source (current)**: `client/src/pages/FileManager/FileManager.js`
- **Test file (current)**: `client/src/pages/__tests__/FileManager.test.js`

### 3.2 Target composition (no UX change)

The end-state after Phase 3 is a small page shell that:

- Derives route context (auth vs share-link mode) and page-level overlay state.
- Calls explorer controller hooks and product overlay hooks in the correct order.
- Renders a pure view (`FileManagerView`) plus product-only dialogs/overlays.

Conceptually:

```
FileManager (page shell)
  -> explorer controllers (session/navigation/commands/progress)
  -> FileManagerView (pure view)
  -> product overlays (share-link mode, virtual collections, share dialogs, etc.)
```

### 3.3 Current dependencies (to be re-homed)

While the current implementation is still monolithic, it uses (directly or indirectly) these roles:

- Auth + routing: `useAuth`, `useNavigate`, route wrappers (e.g. `PrivateRoute` at the router level)
- Explorer/session-ish state: `useFileManager`, `useSelection`
- Commands: `useBulkOperations`, `useFileOperations`
- Dialog orchestration: `useFileManagerDialogs`
- UX + utilities: `useDropToUpload`, `usePullToRefresh`, `useResponsive`, `useInfiniteScroll`, `useMessage`, `useRecentFile`

As extraction proceeds, the page shell should retain only *composition* responsibility; orchestration and derived state move to the relevant explorer controller hooks.

---

## 4. Page Responsibilities (Explicit Allocation)

### 4.1 Shell-owned responsibilities

- **Route context**:
  - Rendering as `/files/*` (auth-required route composition).
  - Rendering inside share-link flows (no auth required; limited operations policy).
- **Product overlays** (see 2.3).
- **Feature wiring**:
  - Pass view-ready state + callbacks into the view.
  - Decide which dialogs/overlays render for this page context.
  - Inject product policy into explorer interaction/navigation controllers instead of keeping large inline flow handlers in the page body.
  - Prefer grouped sub-view models when passing data into `FileManagerView` rather than flattening dozens of shell/controller outputs into one wide prop surface.
  - Prefer grouped handler bundles as well: item interaction, command flows, progress affordances, and refresh-indicator presentation should not be merged into one flat callback object.
  - Apply the same grouping rule to dialog state: action/context targets, picker state, modal visibility, and dialog file payloads should be separated instead of merged into one flat object.
  - Apply the same grouping rule to explorer session state: control inputs (search/sort/view/menu state) should be distinct from listing/render state (displayed files, thumbnails, infinite scroll, loading).
  - Apply the same grouping rule to selection and action state: selection-model data, bulk capability flags, explorer capabilities, tree refresh state, and transfer/drag state should not be merged into one flat bag.
  - When the shell memoizes grouped handler bundles for the view, callback identities should remain stable unless the observable behavior actually changes. Avoid recreating command callbacks on every render when they are passed through memoized grouped props.

### 4.2 Explorer core responsibilities (owned by extracted modules)

- **Navigation**:
  - Browse folders via path click, breadcrumb navigation, and back navigation.
  - Transition rules when opening folders from list/grid/detail.
- **Session**:
  - Search (client-side filter by name).
  - Sort (name, date, size, type).
  - View mode toggle (list, grid, detail).
  - Selection-derived state that the view consumes.
- **Commands**:
  - Upload, rename, move, copy, delete, download.
  - Conflict resolution entry points for uploads/operations.
- **Progress**:
  - Progress list/drawer state.
  - Retry/cancel entry points and user-visible notifications.

---

## 5. User-Visible Behavior (Contract)

This section captures observable behavior that must remain unchanged as responsibilities are extracted.

### 5.1 Selection behavior

- **Entry/exit**
  - Desktop: single click enters selection mode + selects.
  - Mobile: long-press enters selection mode + selects.
  - Auto-exit when `selectedFiles.size === 0`.
  - Desktop exit can occur when clicking empty space (as implemented today).
- **No checkbox UX requirement**
  - File rows/cards do not require dedicated checkboxes. Selection is interaction-driven and indicated visually.
- **Click semantics**
  - Desktop: single click selects; double click opens folder/preview; Ctrl(or Meta)+click toggles; Shift+click range-selects.
  - Mobile: tap opens folder/preview when not in selection; tap toggles selection when in selection; long-press enters selection.

### 5.2 Context actions

- Per-item “More” opens an action sheet (or context menu) when not in selection mode.
- Context actions include: download, rename, move, copy, share, properties, delete (availability varies by mode/permission).

### 5.3 Drag and drop

- Supports:
  - File-to-folder move (internal DnD).
  - External file upload (drop to upload).
- **DnD overlay scope**
  - When dragging over for upload, the dotted overlay is scoped to the file-view area (list/grid/detail region), not the entire page (header/breadcrumb/controls must remain uncovered).

### 5.4 Share-link mode policy (overlay)

- When in share-link mode:
  - Header and available actions are simplified per current behavior.
  - Upload/create flows are not available.
  - Bulk actions are restricted (download-only).
  - Optional login modal for “add to my permissions” flows remains available as today.

### 5.5 Scroll/overscroll behavior (mobile)

- **Scroll area padding** includes space for fixed-bottom UI (FloatingSearchBar + FAB) plus safe-area inset so the last list item can scroll above fixed UI.
- **Overscroll containment** prevents mobile bounce from shifting header/controls:
  - global `overscroll-behavior: none` and scroll container `overscrollBehaviorY: 'contain'` (as currently implemented).

---

## 6. Verification Scenarios (Observable Outcomes)

These scenarios should stay true throughout extraction steps (verify “what”, not “how”).

- [ ] Initial render shows loading state, then resolves into the correct view once files load.
- [ ] Path navigation updates the visible list/grid/detail content and breadcrumb correctly.
- [ ] Search filters by file name as before (same matching behavior).
- [ ] Sort order matches current behavior for each sort mode.
- [ ] Selection interactions:
  - [ ] Desktop: click / Ctrl(or Meta)+click / Shift+click / double click
  - [ ] Mobile: tap / long-press with correct toggling behavior
  - [ ] Auto-exit on empty selection
  - [ ] Tests do not assume checkboxes for file-row selection UI
- [ ] Context menu/action sheet opens and actions produce the same user-visible outcomes.
- [ ] Upload flow:
  - [ ] Conflict prompt appears when expected
  - [ ] Progress items render and complete/cancel/retry behave the same
- [ ] Share-link mode:
  - [ ] Unauthenticated vs authenticated behaviors match current UX
  - [ ] Restricted operations remain restricted
