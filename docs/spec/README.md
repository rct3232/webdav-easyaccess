# Spec Documentation

This directory contains design documentation and implementation/unit-test specification guidance. Each document describes the module's role, implementation spec, and verification scenarios for use as reference during implementation.

---

## Format Templates by Type

| Type | Template Path | Purpose |
|------|---------------|---------|
| Client Components | [client/components/_TEMPLATE.md](client/components/_TEMPLATE.md) | Props, callbacks, i18n, conditional rendering |
| Client Hooks | [client/hooks/_TEMPLATE.md](client/hooks/_TEMPLATE.md) | Input/return, dependencies, side effects |
| Client Pages | [client/pages/_TEMPLATE.md](client/pages/_TEMPLATE.md) | Routes, hooks used, child components |
| Client Services | [client/services/_TEMPLATE.md](client/services/_TEMPLATE.md) | API wrapper functions, error handling |
| Client Utils | [client/utils/_TEMPLATE.md](client/utils/_TEMPLATE.md) | Pure function signatures, dependencies |
| Client Contexts | [client/contexts/_TEMPLATE.md](client/contexts/_TEMPLATE.md) | Provided value, hooks, dependencies |
| Server Utils | [server/utils/_TEMPLATE.md](server/utils/_TEMPLATE.md) | Util functions, input/output contracts |
| Server Middleware | [server/middleware/_TEMPLATE.md](server/middleware/_TEMPLATE.md) | Pipeline position, req/res modifications |
| Server Stores | [server/store/_TEMPLATE.md](server/store/_TEMPLATE.md) | Storage methods, paths, dependencies |
| Server Models | [server/models/_TEMPLATE.md](server/models/_TEMPLATE.md) | Static methods, Store dependencies |
| Server Routes | [server/routes/_TEMPLATE.md](server/routes/_TEMPLATE.md) | Endpoints, middleware, request/response |

---

## Implementation Guidelines

- **Implementation:** Follow the **"2. Implementation Spec"** section of each spec document.
- **Testing:** Use the **"Verification scenarios"** section as a guide when writing future unit and integration tests.
- **Contracts:** Keep API and shared contracts in sync with [api.md](../api.md) and [shared-contracts.md](../shared-contracts.md).

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [api.md](../api.md) | REST API endpoint reference |
| [shared-contracts.md](../shared-contracts.md) | Error format, validation return values, constants |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Server architecture, middleware pipeline, storage structure |
| [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) | Unit vs integration, mocking, checklist for new code |

---

## Writing Priority

1. **Core business logic** – File/folder CRUD, permissions, share links, etc.
2. **Base utils and middleware** – pathUtils, errorHandler, requireUser, etc.
3. **Everything else** – Layout, feedback, auxiliary utils
