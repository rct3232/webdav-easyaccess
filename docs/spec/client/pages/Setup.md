# Setup Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route path | `/setup`                                                                                                                                                                                                                                                                                                           |
| Role       | First-run setup wizard. Public page (outside `MainLayout`), shown when the server reports `setup_complete: false`. Walks the operator through metadata, file storage, admin password + JWT, optional settings, apply, and a "Restart required" screen. Unreachable once setup is complete (redirects to `/login`). |

Feature Source-of-Truth: [setup-wizard.md](../../../features/setup-wizard.md).

---

## 2. Implementation Spec

### 2.1 File Path

- **Source (view):** `client/src/pages/Setup/SetupWizardView.js` (pure MUI view)
- **Source (controller hook):** `client/src/pages/Setup/hooks/useSetupWizard.js`
- **Service:** `client/src/services/setupService.js` (see §3)
- **Test files:** `client/src/pages/Setup/__tests__/Setup.test.js`, `client/src/services/__tests__/setupService.test.js`

### 2.2 Hooks Used

- `useSetupWizard` (controller hook)
  - `useNavigate` (redirect to `/login` on post-setup lockout)
  - `useTranslation` (i18n `setup.*` keys)
  - `setupService` (`getSetupStatus`, `testSetup`, `applySetup`)
  - On mount: fetch `getSetupStatus()`; if `setup_complete === true` → redirect to `/login` (covers "user revisits /setup after restart").
- (View) `SetupWizardView` does not call hooks and does not import router modules

### 2.3 Main Child Components

- `SetupWizardView` (pure MUI view) — step container rendered from prepared state + callbacks provided by `useSetupWizard`
- Per-step fields/components: Metadata step, File storage step, Admin + JWT step, Optional step, Apply step, "Restart required" screen

### 2.4 Route Protection

- **No** `PrivateRoute`; public page registered outside `MainLayout`, next to `/login`/`/register` in `client/src/App.js:64-98` (standalone like Login).
- Post-setup lockout: if `setup_complete === true` on mount, the page renders `<Navigate to="/login" replace />` (or equivalent redirect from the hook).
- Login-page redirect: `client/src/pages/Login/hooks/useLoginForm.js` already fetches public settings on mount (`:26-43`); when `setup_complete === false` it navigates to `/setup` with `replace: true`.

### 2.5 Main User Flows

Wizard steps:

1. **Metadata** — choose sqlite (default) or postgresql (host/port/database/user/password/ssl + "Test connection" via `testSetup('postgresql', …)`).
2. **File storage** — choose s3 (bucket/region/access key/secret/endpoint + "Test connection" via `testSetup('s3', …)`) or webdav (url/username/password + "Test connection" via `testSetup('webdav', …)`).
3. **Admin password + JWT** — admin password (username fixed to `admin`, D6); JWT secret client-generated via `crypto.getRandomValues` with a regenerate button; optional expires-in.
4. **Optional** — port, CORS origins, SMTP (host/port/user/password/secure/from).
5. **Apply** — `applySetup(payload)` with the collected `{ metadata, file, admin, jwt, server, email }` blocks.
6. **"Restart required" screen** — shown on `200 { restart_required: true }`; instructs the operator to restart the server. No self re-exec.

Errors surface via `t(errorCode, params)` (existing error-display utility pattern). Invalid field values are shown inline per step.

### 2.6 Integration Test Scenarios

- [ ] Initial render loads status; incomplete state renders the first wizard step
- [ ] Step navigation ① → ② → ③ → ④ → ⑤ in order
- [ ] Connection-test states: pending spinner, success, failure message
- [ ] JWT secret generation and regenerate
- [ ] Apply success → "Restart required" screen rendered
- [ ] `setup_complete: true` on mount → redirect to `/login`
- [ ] Masked prefill values from `status.current` are rendered (secrets shown as masked/blank)
- [ ] Error state display per step

### 2.7 Conditional Rendering

- Status loading: CircularProgress while fetching `getSetupStatus()`
- `setup_complete: true` → redirect to `/login` (post-setup lockout)
- Per-step validation errors inline
- Connection-test pending/success/failure states
- "Restart required" screen after successful apply

---

## 3. Service: setupService Spec

### 3.1 File Path

- **Source:** `client/src/services/setupService.js`
- **Test file:** `client/src/services/__tests__/setupService.test.js`

### 3.2 Main Functions

| Function       | Input                                                         | Return                                          | API called              |
| -------------- | ------------------------------------------------------------- | ----------------------------------------------- | ----------------------- |
| getSetupStatus | `()`                                                          | `Promise<{ setup_complete, missing, current }>` | `GET /api/setup/status` |
| testSetup      | `(target: 'postgresql' \| 's3' \| 'webdav', payload: Object)` | `Promise<{ ok }>`                               | `POST /api/setup/test`  |
| applySetup     | `(payload: Object)`                                           | `Promise<{ restart_required }>`                 | `POST /api/setup/apply` |

Transport: the existing `apiClient` (`client/src/services/apiClient.js`), which delegates to
`httpClient` (`client/src/services/httpClient.js`, `BASE_URL = '/api'` at
`client/src/services/httpClient.js:7`). All three endpoints are public (no auth token).

- `getSetupStatus()` → `GET /setup/status`
- `testSetup(target, payload)` → `POST /setup/test` with body `{ target, ...payload }`
- `applySetup(payload)` → `POST /setup/apply` with body `payload`

### 3.3 Error Handling

- Errors are propagated to `useSetupWizard`; the wizard displays messages via
  `t(errorCode, params)`.
- `403 { errorCode: 'setup.complete' }` from test/apply is surfaced (post-setup lockout
  normally intercepts this first via the mount-time status check).

### 3.4 Verification Scenarios

- [ ] getSetupStatus returns `{ setup_complete, missing, current }`
- [ ] testSetup sends `{ target, ...payload }` and resolves `{ ok }`
- [ ] applySetup sends the apply body and resolves `{ restart_required }`
- [ ] No auth token is attached (public endpoints)

---

## 4. i18n

- New top-level `setup.*` section in `client/src/locales/en.json` and `ko.json` (step titles,
  field labels, buttons, connection-test states, "Restart required" screen).
- `serverErrors` entries for the new codes: `serverErrors.setup.incomplete` and
  `serverErrors.setup.complete` (added to `shared/serverMessageCodes.js`).

## 5. MSW

- `client/src/mocks/handlers.js` gains handlers for `/api/setup/status`, `/api/setup/test`,
  `/api/setup/apply`.
- The existing `/api/settings/public` handler (`client/src/mocks/handlers.js:594-596`) is
  updated to include `setup_complete` in its response shape.
