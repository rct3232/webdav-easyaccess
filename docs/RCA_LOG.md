# RCA Log — Test-Failure Root Cause Analysis

> **Purpose**: Single dated log for test-failure incidents diagnosed under the mandatory RCA
> procedure (AGENTS.md §3.2). Every failure is classified and recorded here **before** any code
> is changed. Historical entries were removed on 2026-09-02 during consolidation; only new
> incidents are appended below.

## Procedure

1. **Diagnose** before modifying any code — collect the error output and cross-check spec docs.
2. **Classify**:
   - **Case A (Source Error)**: implementation violates spec → **STOP**, ask the user.
   - **Case B (Test Error)**: test misinterprets spec / asserts on internals → fix the test.
   - **Case C (Spec Error)**: spec is undefined or ambiguous → **STOP**, ask the user.
3. **Act** per the classification (do not modify code before classifying).
4. **Record**: append an entry below with date, summary, classification, and action taken.

## Entries

_(No entries yet.)_
