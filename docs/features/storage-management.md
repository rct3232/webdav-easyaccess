# Storage Management

Permanent product-level description of the user `Storage` surface and its cleanup
proposals. Data shapes, endpoints, and component contracts live in the specs below, not
here.

Canonical contract sources: `docs/spec/server/routes/storage.md`,
`docs/spec/server/services/storageService.md`,
`docs/spec/server/store/storageSuggestionsStore.md`,
`docs/spec/server/store/storageUsageSnapshotsStore.md`,
`docs/spec/server/infrastructure/maintenanceScheduler.md`, and the client specs under
`docs/spec/client/**`.

---

## 1. Storage dashboard

A MyPage section: hygiene cards (duplicates + reclaimable space, trash + retention
countdown, suggestion count) deep-linking into the action context — a pull-overview, not an
action center; a 30-day system-changes feed with undo; collections status (grants, merges,
archives with undo); and the suggestions checklist — every row carries a checkbox, and the
only accept control is `Accept selected (N)` (checked → trash, command-unit undo; no
per-file or threshold-specific variants).

Storage usage is two reads in one: the current logical-storage breakdown (live + trash +
retained object history; `total_bytes` is their sum) and a sparkline series. The series is
per-user logical storage usage written daily to `storage_usage_snapshots` (live + trash +
all active/history object versions); version history is S3-mode only, so WebDAV graphs
current+trash bytes and reports no version-history support. A NULL counted size marks the
current read incomplete and its total a lower bound; there are no quota or capacity fields.
No series data ⇒ the sparkline is omitted, never fabricated. An empty storage renders
zeros, never an error.

Non-admin-only: the Storage surface is a personal-storage surface — every `/api/storage`
route is server-gated 403 (`serverErrors.storage.forbidden`) for the ADMIN actor, and the
MyPage section never renders for admins.

## 2. Cleanup and duplicate suggestions

Always **proposals** (they mutate files), shown as row chips and in the Storage checklist.
Rule variant (LLM-free): temp patterns, stale screenshots, old installers, exact duplicates
by content fingerprint **first** (cosine-1.0 detection is redundant). Vector variant:
near-duplicate groups at the ACTIVE embed model's profile `θ_dup` (EG2 reference set 0.955
— `docs/spec/server/infrastructure/llmPresets.md` §2.3; hash-twin members are excluded
from the vector pass entirely), with keeper selection by an LLM-free quality composite v1
among the grouped members (activity 0.45 / media quality 0.30 / name originality 0.15 /
centrality 0.10, each normalized within the group; 30-days-unopened is a 0.25 activity
penalty, never an exclusion; `docs/spec/server/services/storageService.md` §2.5.1);
**short-document exception** — sentence-or-less files skip similarity near-dup and use the
hash path. Dismiss is per row; unaccepted expire with retention; accepting is checked →
trash as one undoable command — the checkbox _is_ the confirmation.

Accepted suggestions move files to trash only; the command journal restores them through
the generic undo route. The journal row stays generic `file`-domain state.
