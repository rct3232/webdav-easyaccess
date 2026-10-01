# AI Collections Platform

This document is the permanent product-level description of the AI-driven collections platform:
what users and operators see, what the system promises, and which behavior decisions are settled.
Data shapes, endpoints, and component contracts belong to the specs below, not to this one.

**Status**: contract decided.

Canonical contract sources: the route, store, service, and infrastructure specs under
`docs/spec/server/**` and the client specs under `docs/spec/client/**` for the collections, search,
actions, sharing, AI-job, embedding, tag, LLM-adapter, preset, and vector-store surfaces; plus
`docs/shared-contracts.md` and `docs/api.md`.

---

## 1. Purpose and framing

The app evolves into an **AI-driven storage management application**; the differentiator is
backend-agnosticism (WebDAV or S3, SQLite or PostgreSQL, any LLM provider including fully local
ones). One positioning fact shapes everything: **the LLM is an enrichment dependency, never a
render dependency.** The collections platform is complete and useful with zero LLM configured; AI's
absence removes speed or convenience, never the product.

## 2. Core invariants

Settled decisions, each with rationale; not relitigated per feature.

1. **View by collection, mutate by file.** Grants give list, preview, and download only; file
   rename/move/delete never goes through a collection, and sharing never touches the file-ACL
   system.
2. **Exposure expansion is always explicit.** No automation ever shares anything — the only consent
   prompt allowed inside the silent model.
3. **Silent evolution is system-origin only.** Other origins lack the re-derivability that
   justifies silent deletion; ordering gravity only.
4. **The undo journal replaces proposal inboxes.** System acts silently with journaled inverses;
   undo, not pre-approval, is the safety valve. Sole exception: merging is proposed in an
   in-context card (§4.4), never a notifications center.
5. **User-triggered destructive/change actions get one confirmation dialog; system actions none,
   but are always journaled.** Collection removal is archive → delete, trash parity.
6. **Membership is derived, not stored — except manual.** The view is stored ∪ derived −
   exclusions, so trash, purge, and permission changes propagate for free.
7. **Naming is template-first.** The template namer is default and final; the LLM namer names only
   new creations once chat is configured, never renaming locked names.
8. **No new in-memory cache state.** AI and collection state is database-backed by design,
   CI-enforced.
9. **Likes are per-file, viewer-scoped.** The heart shows the viewer's own like; other users' like
   states, counts, and aggregates are never displayed.
10. **Permanent delete-from-archive is unrecoverable** (trash parity); journal rows cascade-purge
    except one system-origin tombstone blocking silent regeneration of the same definition for its
    retention window.
11. **No LLM call blocks a request** except user-initiated interactive roles (query-embedding, NL
    parser, future Q&A), each with mandatory cache, kill switch, and no-LLM fallback (§4.22);
    enrichment, adjudication, naming, and arbiters never do, and vision request-path calls are
    banned.

## 3. Domain model and lifecycles

### 3.1 Collection

Origins: **system** (silent generator, split child, tag-materialized), **user** (manual), **seed**
("collect similar"), **search** (saved semantic query). Lifecycle: active → archived (auto by
activity gates, or manual, one confirmation) → restore, or permanent delete (one confirmation,
offered only on cards inside the archive); past retention, archived rows purge automatically —
trash parity.

The sidebar carries a `__collections__` virtual node one level deep (members are never tree-walked)
and `__archive__`, a virtual child auto-containing archived collections; received collections join
the same activity-sorted list with an icon chip. The publish mode — ask (default) / off / auto —
governs only members entering a live-shared view (§4.7); enabling sharing itself is always the
explicit act. Names are unique per owner among active collections.

List cards are grid-parity tiles (P-3): a 2×2 preview of the four most-recently-added members
occupies the file card's media area — file icon immediately, swapped to a thumbnail through the
same batched thumbnail mechanism, no filename labels; revoked/shared-excluded members never
surface (`preview_items` is built from the already-resolved member view, zero extra queries).
Micro-polish M-1/M-4 (2026-09-30): the card footer shows the collection name ONLY — the member
count and the `archived` status chip are gone (archive membership is view-scoped); instead the
media area carries top-left corner badges (translucent circular, 16px): received collections a
`FolderShared` glyph (tree-parity icon — `Checkroom` retired; tooltip "shared with me"), and
auto-pinned collections a `PushPin` BUTTON whose click unpins (keeps the gravity exemption —
§4.9).
Click semantics match files: single click enters selection (single-select), double click opens
the collection; on mobile tap opens and long-press starts selection. The card menu is mutations
only (no Open); the toolbar selection bar shows a fixed count-independent set by surface —
active view: Pin · Unpin · Archive, archive view: Restore · Delete permanently — executed by
looping the existing per-collection calls (per-item failures tolerated, journal/undo per
collection, permanent delete keeps the batched 2-step confirm).

### 3.2 Members

Manual membership is stored; removing a member never trashes the file. Derived membership evaluates
the definition (path/tag/like/date/size predicates, optionally seed or centroid similarity) with no
stored rows; a soft view-count boost moves only borderline members and ordering, under
enter-above/leave-below hysteresis. Tag predicates match by vector, not string, with normalized
string equality as the no-embedder fallback (§4.18). Exclusions ("Exclude") block derived adds;
excluding is a touch, hence auto-pins (§4.9), and its rate is an admin quality metric, never an
archive trigger.

Member rows render per read with a live permission check: normal; revoked (gray placeholder, no
name/thumbnail — metadata after revocation would leak); trashed-by-owner (hidden); purged (gone).
Foreign-owned files never render in live-shared views (cross-leak rule; `Not owner's file — not shared`
chip in the owner's view), though adding them stays allowed — you may add what you can read.
Member-row controls omit move/copy/rename/delete — a collection is a view, not a workspace —
offering exclude, publish (shared only), download (per file ACL), `Reveal original location`, read-only
properties, and like; multi-select adds batch exclude/publish and add-to-another-collection, never
batch delete. Card menus: user/system — rename (locks the name), pin, archive, share settings,
delete (archived only); received — open and `Revoke permission` (a real self-grant
revocation, instant — §4.7 Path 1; the former recipient-local `Leave` hide is retired).

### 3.3 Like

Per-file, per-user; context menu (list and member rows share one state) plus properties-header
toggle; no inline hearts (rejected, density). Feeds the activity score, the split hot set, and a
liked-cluster fast path.

**Landing (P-5, owner ruling 2026-09-29):** the Likes view is a **static child row of the
Collections sidebar section** (`/files/__collections__/liked`, the ArchiveNode precedent — the
earlier top-level `__liked__` virtual-root shape is REJECTED). Opening it lists the viewer's liked
files through the SAME member-view machinery (shared `FileList`/`FileGrid`/`FileDetail` via the
`toMemberRow` adapter, grid default under the per-surface `likedViewMode` key, no sort button,
`MemberRowControls` menu without Exclude/publish — download/reveal/properties/unlike) backed by the
new `GET /api/file-likes/items` endpoint (`routes/fileLikes.md` §2.4.2): `node_id` asc ordering
(no liked-at stamp exists), unreadable likes render as `state:'revoked'` placeholders, trashed
likes hidden, ONE full-fetch response (Decision B, 2026-09-29 — server cursor paging retired;
display slices 50+50 client-side via `useInfiniteScroll`). Likes survive trash and permission loss
(store invariant) — the listing resolves current state per read, never the write-time state.

### 3.4 Usage signals

Recorded only for low-frequency actions (open, download, preview, search hit, like), never on
listings; a nightly rollup feeds the activity score; raw events age out after 90 days.

## 4. Behavior areas

### 4.1 Upload to enrichment

Uploads on either backend, copies, and restores schedule enrichment fire-and-forget after the
commit, idempotently — retries of identical content never re-pay the cost. Enrichment re-reads from
the storage layer, never an upload buffer, and new files get their content fingerprint recorded at
the same point.

### 4.2 LLM configuration behavior

Role-based clients (embed, chat, optional vision, ASR) are admin-configured and fully **hot**:
changes apply without restart — unlike the boot-owned metadata and blob backends — because the LLM
is an enrichment dependency. No enable flag exists: role presence decides candidacy, probes decide
truth (§4.23). On change, roles re-probe shortly (plus an admin test), health and public AI flags
update live, workers adopt at the next job, query-embedding at the next request, and mid-switch
failures degrade silently (§4.12), never as errors. Input limits come from the §4.3 chain, never
probing calls; overlength degrades with a flag; daily caps pause a role, visible to admin. A model
change triggers **no automatic backfill**: stored vectors keep serving, only new enrichment stops;
re-embedding is an admin-launched, rate-limited job.

### 4.3 Preprocessing and budget

Text is extracted locally, free, before any LLM sees it. The chunk/token budget is a four-step
chain, never probing calls: admin limit → endpoint-published metadata (free queries) → the preset's
**release-measured default** → a passive, downward-only limiter (a length failure halves that
budget; only a human raises it back). The overlength ladder: chunk (paragraph/heading split; each
sampled chunk stored plus a mean-normalized pooled row) → truncate head → metadata-only (weak but
searchable) → skip with a journal note. Chunking parameters are model identity — changing them
means re-chunking, never mixed scoring — and retrieval scores the per-file maximum over chunk
vectors (pooled-only scoring hides mid-document sections) while the pooled row stays canonical for
centroid and naming math. Chat extraction never summarizes hierarchically, and the char-to-token
factor is a release constant.

### 4.4 Merge proposals (the only proposal UI)

Detection runs nightly or on pair signals: derived pairs by centroid similarity, stored pairs by
membership overlap (LLM-free, same pipeline). Proposals live at the object, never in an inbox: one
card atop the collection list, never stacked (an `+N more` chip cycles; zero pending = zero layout
footprint), collapsed to a 68px line —
`"Merge "A" into "B"? · N overlapping files · M after merge"` — with a thumbnail strip that
expands into a two-column compare overlay. `Merge` executes immediately — **the card is the
confirmation** — with an undo toast; `Keep separate` suppresses the pair permanently; `Later`
re-raises once after two weeks, then sleeps 30 days; no sidebar/tree badges (rejected). The
survivor keeps its chosen name unless locked; an arbiter verdict may pre-select the card (§4.19),
but the user decides.

### 4.5 Seed collection

`Make a collection like this file` opens a confirm dialog: seed preview, editable auto-name, and a sample
grid with fade and `plus N more` counter — vector math only, no LLM cost. It creates a seed-origin
collection: "similar to this file" with a threshold. The dialog must state that the **entire**
initial set — preview plus unseen remainder — is publish-approved as a batch if the collection is
ever shared.

### 4.6 Search

Typing keeps the inline client substring filter (no server call, no LLM). Submitting returns two
ordered sections. **Name matches**: the inline filter's containment semantics across all
user-visible files, case-insensitive, highlights computed client-side, shipping without any LLM.
**Semantic** (de-duped against section 1): scored segment-AND — a few whitespace segments, each by
best-chunk similarity, the document score the minimum across segments — and gated by a per-query
dynamic baseline against a random corpus sample: unless the top hits clearly win, the section is
honestly empty. No absolute stored floors exist anywhere.

An empty semantic section hides `Save as collection` (saved collections are semantic content only;
name matches never enter definitions); empty sections do not render. Results mode replaces the
breadcrumb row (`🔍 "query" · N results [Save as collection][✕]`): typing re-filters loaded results,
Enter re-queries, recent queries are saveable chips. Responses carry an opaque **result reference**
(§4.22) and may receive one back — today ignored.

### 4.7 Collection sharing

Viewer: list/preview/download, no rename/trash, excludes own adds only (unless owner); editor: ±
membership. Shared views resolve **live**, with a publish gate: in ask/off collections,
post-creation adds start unpublished and hidden, and the owner sees a `N awaiting publish` banner with
batch or individual publish; auto publishes every add, explicitly chosen. Decided: the initial set
of seed and saved-search collections is created **published** — the §4.5/§4.6 confirm dialog is
that batch approval, unseen remainder included. A derived member's publish state stores as a marker
(the one exception to derived-no-rows); unpublishing never removes owner-added rows. The
viewer-side `Revoke permission` card action is an actual self-grant revocation
(`DELETE /:id/grants/me`, instant, no confirm — the owner may trivially re-grant; former
recipient-local `Leave` hide superseded, 2026-09-29 owner ruling); foreign-owned members never
render in shared views; revocation is instant, though already-seen metadata cannot be re-taken.

### 4.8 Digest

A top-of-list banner from a visit cursor — `+N / -M / 1 merge · expand` — expanding to per-entry
reasons; the `why is this here` answer names the matched predicate, computed at query time, not from a
history table.

### 4.9 Silent evolution (system-origin only)

Trigger: nightly, upload, or both (admin setting, default). "Upload" means **batch end, not per
file**: a debounce re-arms on each commit and commits follow full receipt, so the quiet period
after the last commit is the only crash-safe batch-end test; passes are idempotent re-scans, so a
mistimed fire wastes compute but can never be wrong. Upload mode runs the cheap passes; nightly
runs everything (archive/purge are time-based — nightly is the backbone). Passes:

1. **Create — multi-tier generation.** Narrow and broad groups are both real; connected-components
   clustering and absolute-threshold gating are rejected. Mutual-kNN seed expansion with
   tight/mid/loose edge thresholds (per-model release-measured profile values), after an
   identical-content dedup pre-pass; parallel facet sources (path purity, tags, like density)
   promote existing definitions instead of double-creating. Per-tier gates: minimum size, two-week
   persistence (waived by like density), weekly rate, active-system cap, tier size caps; heavy
   overlap with an existing or tombstoned definition yields a merge proposal instead. **No tier
   gets a lifecycle exemption — uniform rules only.**
2. **Split**: a hot subset crossing create gates becomes a **sibling** system collection — never
   nested.
3. **Archive**: activity under floor for N days, or ≈0 members — never for pinned collections; the
   exclusion-rate trigger is **removed** (exclusion pins, and a pinning act cannot also archive),
   the rate staying a quality metric.
4. **Purge**: past retention → permanent, plus a tombstone (lifetime = retention) fingerprinted on
   the **normalized definition**, not raw centroids, so drift cannot slip past.
5. **Merge candidates** → §4.4 cards, the only proposal output.
6. **Auto-pin**: any user touch (add/remove membership, publish, rename, pin, share change,
   merge-survivor acceptance, restore) invisibly pins, with an unpin chip; reads/views/likes do not
   count; pinned collections escape auto-archive/purge forever; other origins never auto-archive.

Names via §4.10; acts journaled (§4.11); thresholds are hot admin settings with live impact
previews (§4.15); pauses stop acts without destroying queued work. The **merge metric is
containment-safe**: on bounded materialized sets, size ratio ≥ 0.7 **and** Jaccard ≥ 0.7, with
centroid similarity prefiltering only; containment/overlap metrics are rejected because they fire
on subset pairs (`Spain ⊂ Europe`, must not merge) while near-equal pairs (`Europe`, `2026-trip`)
pass. Hierarchy proposals are deferred, not in v1.

### 4.10 Naming templates

Locale templates by creation type (ko/en): search → query verbatim; seed →
`{seedFileName} and similar files`; system cluster → `{tag1} · {tag2} photos` (top-2 tags); split →
`{parentName} · {diffTag}`; fallback `Auto collection N`. With chat configured, the LLM namer names new
system creations instead (statistics only). Template output is final — no post-hoc rename jobs.

### 4.11 Undo journal and toast UX

The journal is common infrastructure, not AI-only: journaled mutations go through one commit path
writing change, inverse, and row atomically under the platform lock. Tip-undo is free; non-tip undo
confirms the cascade of later changes; payloads expire while rows persist for audit. Undo never
restores spent LLM cost, already-received exposure, or file content (trash/versions own files).
Writers: collections, the batch worker (item inverses, honoring cancellation), and admin settings.
Permission writes are reserved: undoing a grant (exposure down) may be silent, undoing a revocation
(exposure up) is explicit-only.

**Toasts**: bottom, for user-triggered actions (app-bar keeps job progress), one per command —
`[icon] Move completed (12 items) [Undo]`. Undo handles ride responses and batch jobs'
terminal poll result; item inverses run fingerprint-guarded, mixed outcomes reported honestly
(`11 undone, 1 skipped (state changed since)`). Surfaces: toast (≤ 24 h; rows live 30 days), digest undo
links, the 30-day feed with cascade, the archive `restore` button, a sidebar `new` dot; silent system
acts never toast.

| Action                                                             | Toast   | Undo                       |
| ------------------------------------------------------------------ | ------- | -------------------------- |
| move/copy; rename; collection CRUD/publish; merge; accept; archive | yes     | journal                    |
| share-link create/cancel; request approve/reject                   | yes     | undo = revoke              |
| conflict-resolution overwrite                                      | yes     | version restore            |
| file delete → trash                                                | yes     | trash restore, not journal |
| permanent delete; empty trash; GC runs                             | report  | never (trash parity)       |
| like/visit/sort; upload; job completion                            | no/info | none; trivial              |

### 4.12 Feature-degradation matrix

**No LLM**: manual and rule-predicate collections (cosine-free; string-equal tags), server-wide
name search, activity gravity, archive lifecycle, digests, set-overlap merges, exact-duplicate
finder (content fingerprint), rule suggestions, likes, sharing, journal — all present; semantic
search, seed collections, vector merges, near-dup, NL parsing, tag normalization — **absent**.
**Embedder**: adds those five, auto-create from clusters, and template naming. **Chat**: adds
content features, NL parsing, and LLM naming.

For regular users an unavailable feature is **absent, not disabled** — no grayed-out AI affordances
exist. For admins it is **visible-disabled**: a nav item plus a per-role health card
(`not_configured | probe_failed (reason) | partial | ok`) with configuration and test entry points;
unconfigured endpoints answer "not configured", never a misleading 404. Partial configuration shows
no filler — template names read as ordinary names and missing fields stay absent — and
insufficiency is admin-visible only.

### 4.13 Vector backend behavior

Stored vectors are canonical; every index is an adapter-managed derived artifact, never tracked
schema. Native paths: PostgreSQL + vector extension ≥ 0.7 (HNSW), or SQLite + its vector extension
(exact); everything else runs the brute-force **JS fallback** (per-query, chunk-aware). **No AI
feature is ever disabled for missing vector capability** — absence degrades speed only, boot
proceeds, all features stay on, and admin sees `native | fallback_js (degraded)` with an install
hint: a warning, not a gate. Accuracy: exact engines match the JS oracle; ANN engines must reach
recall ≥ 0.99 at top-50 with the scan-exploration parameter **fixed at 400** (the default 100
measured far too low externally), graded with held-out queries only. Cross-engine identity is not
promised; the recall floor is. Model changes rebuild indexes only.

### 4.14 Admin operations dashboard (non-AI first)

Existing surfaces are extended, not replaced: GC results, migration history, and startup fail-safe
orphan/pending scans become persisted reports with row-level repairs on existing endpoints; later
waves add database/email/vector-ops probes and a registry-aware config editor. No ad-hoc metrics
framework — logs are not a contract; locks and schema staleness get a read-only diagnostic card.
Raw settings listings (plaintext secrets) never drive display — masked, purpose-built views only.

### 4.15 Admin AI governance panel

An admin tab: pipeline health (queue, failure/rate-limit rates, breakers, failed jobs with
retry/abandon); cost ledger (per-role daily rollup, caps, per-user top-N); evolution governance
(hit rates, survival curves, merge-accept rate, gate parameters with live impact counts and
journaled rollback, tombstone counters); model registry (per-role model/dimension, per-version
distribution, backfill launcher across the feature/caption/transcript lineages); degraded-input
histogram; kill switches. Privacy: aggregates and identifiers only — never users' names, queries,
or contents. **Constants provenance**: every numeric AI constant is a **release artifact measured
by the project on its own reference set**, shipped per model profile and displayed with provenance
— there is no runtime calibration and no dataset ships to end users; measured corpus drift is the
reserved re-open trigger.

### 4.16 User dashboard `Storage`

A MyPage section: hygiene cards (duplicates + reclaimable space, trash + retention countdown,
suggestion count) deep-linking into the action context — a pull-overview, not an action center; a
30-day system-changes feed with undo; collections status (grants, merges, archives with undo); and
the suggestions checklist — every row carries a checkbox, and the only accept control is
`Accept selected (N)` (checked → trash, command-unit undo per §4.11; no per-file or threshold-specific
variants). Capacity sparkline only; insight prose is rejected scope.

### 4.17 Cleanup and duplicate suggestions

Always **proposals** (they mutate files), shown as row chips and in the §4.16 checklist. Rule
variant (LLM-free): temp patterns, stale screenshots, old installers, exact duplicates by content
fingerprint **first** (so cosine-1.0 detection is redundant). Vector variant: keeper among
near-duplicate groups at the measured **0.97** (edit variants sit just above, unrelated far below;
0.98 was a near-miss), plus "30 days unopened, low score"; **short-document exception** —
sentence-or-less files skip similarity near-dup and use the hash path. Dismiss is per row;
unaccepted expire with retention; accepting is checked → trash as one undoable command — the
checkbox _is_ the confirmation.

### 4.18 Tag vocabulary: normalization, hierarchy hints, no merging

Measurement dissolved "merge similar tags": high-similarity pairs are spacing/spelling variants,
containment pairs are hypernyms (merging would destroy the distinction), and co-occurrence proved
uninformative. The replacement is three non-destructive steps: (1) **read-time orthographic
normalization** — case/whitespace/Unicode folding groups variants; (2) **containment + similarity →
parent hints** (`actor casting → casting`; rule or admin) — display/grouping only, raw tags never
rewritten, nothing merged, no audit gate a wrong hint costs one odd group; (3) **the gray band left
alone** — alias merges and co-occurrence gates retired with their operation. Search is independent:
tag predicates match by vector (§3.2).

### 4.19 Chat-model roles

Embeddings and set math do the analysis; chat legitimately only translates between language and
machines and arbitrates genuinely ambiguous decisions. Narrating roles were removed (digest
sentences, why-together, reranking, taxonomy mining, definition tuning — each narrates or rewrites
what rules already answer). Kept roles:

- **Feature extraction** — tags/summary/category per file, in the enrichment job, forced JSON out;
  supplies the media embedding corpus and the adjudicators' material; empty without chat.
- **NL parse** — sentence → shared predicate grammar; the only request-path chat role, one cached
  call batched with query-embedding; it sees grammar and session state, never file data or ids, so
  hallucinations match nothing; failure falls back silently to name+vector search.
- **Name** — names new system creations when chat is on; statistics in, validated short phrase out;
  failure falls back to the template (lossless swap).
- **Keeper adjudicator** — nightly per bounded near-duplicate group, settles content-meaning ties
  rules cannot rank; without chat, a heuristic keep; pre-fills §4.17 rows — accept stays
  user-clicked.
- **Merge arbiter** — the 0.55–0.7 review band of §4.9 only, recommending merge / keep-separate /
  sibling as a pre-selection on the §4.4 card; **it advises, never acts**. Its prompt must carry
  the **symmetric difference** (unique-member counts and per-side samples), because shared samples
  plus overlap alone measured an all-merge bias.

All roles take aggregate inputs only, return schema-checked JSON committed by service code, journal
their verdicts, and keep a rule fallback (guaranteeing the no-LLM column). **Reasoning defaults off
for every chat role** — measured: 99.8% validity at 5–10× speed without thinking; overrides are
experimental only.

### 4.20 Embedding-model roles

The embed model answers "where", never "what" — all analytics are set math on its vectors. Three
call sites, only the first file-proportional: **file embedding** (async; skipped on an identical
content fingerprint within the same model version), **query embedding** (the system's only
request-path AI call), **tag embedding** (batch, small vocabulary). No image/frame embedding exists
(§4.21 retired it); no calls at all for centroids or seeds — evolution math is call-free. The model
is the space key: one active embedding model, cross-model comparison forbidden except across an
admin-triggered migration; dimension fixed per model.

### 4.21 Media pipeline (single text space)

Decided: **every modality enters the same text embedding space** — no image-embedder geometry, no
fan-out, no score mixing — purely capability-driven. **V0** (free, always): probe metadata +
name/path/date → metadata-only embedding and probe record; works with zero LLM. **V2** (vision
chat): ≤ 4 locally sampled frames → Korean VLM captions feeding stored features and the embedding;
the default media path with vision configured. **V3 (ASR) is transcription only**: a conditional
transcript with a mandatory escape prompt ("say none unless actually audible") + technical
metadata; **no audio attributes ship** — genre/mood/kind/description invented instruments for
non-music audio and contradicted themselves across runs, and failure must stay conservative: a
missed transcript loses data, an invented genre poisons the index. Vocal music stores lyrics as
transcript, excluded from content scoring by the music marker; frames and transient audio are never
persisted. Image/video near-dup measures caption-space distance — weaker against re-encodes, an
accepted trade; model changes re-project via one backfill.

### 4.22 Search layers and the conversational boundary

The stack — file store → enrichment → features/embeddings/activity → search engine (name,
predicates, vectors, live permission filtering, deterministic merge) → _[conversational layer —
future]_ → user — consists only of features described elsewhere in this document; the
conversational layer is a **reserved boundary, not scheduled work**. SearchSession is a concept
with **zero storage today**: the first release ships only the §4.6 result-reference emission, and
future extensions must open through those reserved fields alone, non-breakingly.

A **result reference is a replay signature** over the normalized search, never an id list: a
follow-up like `of those…` reruns it and intersects **under current permissions at execution time**.
Snapshots were rejected — an id list freezes a past ACL — and inter-turn drift is accepted because
live behavior is what a file system promises; decided **always-replay**, no TTL or caching variant
retained. The parser classifies utterances while deterministic code merges them —
add/replace/multi-add per field, NOT-predicate or exclusion token, `exclude the similar ones` → exclude-similar
over the rerun set, pronouns → latest reference, unresolvable → re-embedded text-plus-utterance
vector fallback (structural failure ≠ search failure). Per the **symbol boundary** (§4.19), no
result content or ids ever enter prompts — hallucination is "no match", never "wrong file". Saving
accepts a reference as target; by the **flattening rule** definitions store the referenced
execution's snapshot (centroid + predicates), never the replay chain, semantic-only, confirm dialog
applying. **RAG is a different product feature:** content Q&A needs chunk-level embeddings,
request-path generation, and citations — only schema versioning, the text-space discipline, and the
extraction pipeline are reserved.

### 4.23 Provider presets and capability completeness

Distribution cannot know which models an endpoint runs, so **an offered option is a complete
feature bundle or is not offered** — visible-but-half-working is a defect, not a degradation.

### 4.23.1 Preset manifest

A **preset manifest** declares per provider family (llama.cpp, Ollama, OpenAI-compatible,
embedding-server class, …) _expected_ capabilities — text embedding, chat, vision chat, ASR
(image embedding retired: no consumer, §4.21) — plus budgets; providers are added as manifest
rows, never code branches.

### 4.23.2 The probe is final

Live flags = probe-verified ∩ configured; declared-but-failing ⇒ off, with a
declared-vs-probed admin card. **Probes use in-domain samples** (real speech, photos) —
out-of-domain probes confuse false negatives with false claims (both observed).
User-visible states are only ever complete-working or absent, never partial; unlike §4.13,
a missing LLM capability removes features while a missing database capability only slows
them.

### 4.23.3 Capability map

Gates UI: semantic search, seed collections, auto-create, near-dup, tag matching ← text
embedding; content features, parsing, LLM naming ← chat; captions ← vision chat;
transcription ← ASR. Absent capability ⇒ absent feature, never degraded.

### 4.23.4 Chat without an embedder is a legal deployment

The vector core behaves exactly as the no-LLM column; no half-AI state exists.

### 4.23.5 Surfaces

The setup wizard gains one **optional, skippable AI step** (preset → roles →
endpoint/key/model → per-role test) storing ordinary database settings rows, never
environment files — skipping costs nothing and configuration stays restart-free (§4.2);
admin keeps the full surface, the wizard being a shortcut to the same rows.

---

## Related documents

- [ARCHITECTURE.md](../ARCHITECTURE.md) — layering and where each behavior is hosted
- [api.md](../api.md) — endpoint surface for collections, search, and actions
- [shared-contracts.md](../shared-contracts.md) — error codes and payload formats
- [SETUP.md](../SETUP.md) — operator configuration and the provider preset table
- [client-ui.md](client-ui.md) — virtual collections and explorer overlays
- [config-source-resolution.md](config-source-resolution.md) — preset/wizard config surface
