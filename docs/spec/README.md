# Spec Documentation

This directory contains design documentation and implementation/unit-test specification guidance. Each document describes the module's role, implementation spec, and verification scenarios for use as reference during implementation.

---

## Format Templates by Type

| Type              | Template Path                                                     | Purpose                                       |
| ----------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Client Components | [client/components/\_TEMPLATE.md](client/components/_TEMPLATE.md) | Props, callbacks, i18n, conditional rendering |
| Client Hooks      | [client/hooks/\_TEMPLATE.md](client/hooks/_TEMPLATE.md)           | Input/return, dependencies, side effects      |
| Client Pages      | [client/pages/\_TEMPLATE.md](client/pages/_TEMPLATE.md)           | Routes, hooks used, child components          |
| Client Services   | [client/services/\_TEMPLATE.md](client/services/_TEMPLATE.md)     | API wrapper functions, error handling         |
| Client Utils      | [client/utils/\_TEMPLATE.md](client/utils/_TEMPLATE.md)           | Pure function signatures, dependencies        |
| Client Contexts   | [client/contexts/\_TEMPLATE.md](client/contexts/_TEMPLATE.md)     | Provided value, hooks, dependencies           |
| Server Utils      | [server/utils/\_TEMPLATE.md](server/utils/_TEMPLATE.md)           | Util functions, input/output contracts        |
| Server Middleware | [server/middleware/\_TEMPLATE.md](server/middleware/_TEMPLATE.md) | Pipeline position, req/res modifications      |
| Server Stores     | [server/store/\_TEMPLATE.md](server/store/_TEMPLATE.md)           | Storage methods, paths, dependencies          |
| Server Models     | [server/models/\_TEMPLATE.md](server/models/_TEMPLATE.md)         | Static methods, Store dependencies            |
| Server Routes     | [server/routes/\_TEMPLATE.md](server/routes/_TEMPLATE.md)         | Endpoints, middleware, request/response       |

---

## Implementation Guidelines

- **Implementation:** Follow the **"2. Implementation Spec"** section of each spec document.
- **Testing:** Use the **"Verification scenarios"** section as a guide when writing future unit and integration tests.
- **Contracts:** Keep API and shared contracts in sync with [api.md](../api.md) and [shared-contracts.md](../shared-contracts.md).

---

## Responsibility Splits (Mandatory Specs)

When you split a module into multiple responsibilities (for example: page shell + controller hook + gateway + pure helpers + pure view), you **must** update and/or add specs **before** editing source code.

### What is mandatory when splitting

- **Update the original spec**: Narrow the existing spec to the role it will own after the split (and remove claims that move elsewhere).
- **Add one spec per new role**: Each new file or module role introduced by the split must have its own spec using the closest matching template.
- **Keep roles non-overlapping**: If two specs claim ownership of the same behavior, the split is incomplete.

### Role definitions (client)

- **Page shell (page spec)**: Composes features and route state; wires controller hooks into views; owns product-specific overlays for that page.
- **Controller hook (hook spec)**: Orchestrates a user flow and prepares view-ready state; may coordinate multiple helpers/gateways; should not become a new "god hook".
- **Gateway / adapter (service spec)**: Isolates API/storage/browser IO behind replaceable functions; owns request/response mapping and low-level side effects.
- **Pure helper (util spec)**: Pure domain rules and derived state; no network, storage, router, or browser globals.
- **Pure view (component spec)**: Renders from props only; no service imports and no direct IO.

### Minimum content to include in each new spec

- **Role + boundaries**: What it owns and what it explicitly does _not_ own.
- **Public interface**: Props/signatures/return values and error/result shapes.
- **Dependencies**: Which other roles it may call (and which it must not).
- **Side effects**: Only if applicable (typically gateways and some controllers).
- **Verification scenarios**: Observable outcomes to validate behavior ("what", not "how").

---

## Related Documents

| Document                                      | Purpose                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [api.md](../api.md)                           | REST API endpoint reference                                                                |
| [shared-contracts.md](../shared-contracts.md) | Error format, validation return values, constants                                          |
| [ARCHITECTURE.md](../ARCHITECTURE.md)         | System architecture and cross-stack layering boundaries (server flow plus client layering) |
| [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) | Unit vs integration, mocking, checklist for new code                                       |

---

## Writing Priority

1. **Core business logic** – File/folder CRUD, permissions, share links, etc.
2. **Base utils and middleware** – pathUtils, errorHandler, requireUser, etc.
3. **Everything else** – Layout, feedback, auxiliary utils
