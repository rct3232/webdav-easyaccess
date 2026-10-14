# Proof of Concept — AI-Driven Storage

> **Status: closed, 2026-09-16 (+ dated addendum §6, 2026-10-08 — EmbeddingGemma 2
> migration probes; §1–§5 untouched).** This document records every experiment run before writing any
> product code. Each experiment states **Where** (the real environment used), **What** (the
> question it had to answer), **How** (the method), **Why** (which plan assumption it tests),
> and then **Result → Meaning → What it makes possible / impossible**.
>
> The plan being tested lives in `PLAN.md` (task graph) and `AI_FEATURE_PLAN.md` (design).
> No prior knowledge of those documents (or of AI jargon) is needed to read this.

---

The product idea in one line: teach a self-hosted file vault to understand what its files are
about — AI describes each file in words, turns those descriptions into numerical
"fingerprints", and then finds and organizes files by meaning rather than by exact file name.

A plan is just neatly written guesses. This document flew each risky guess to the ground and
let reality grade it — before a single line of product code was written. Some guesses survived,
some died, and three times the bug was in our own measuring tools. Those are written here too,
because knowing _how_ a measurement went wrong matters as much as trusting one that went right.

---

## 1. Where — the environment, honestly described

| Piece                          | What it is                                                                             | Notes                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **bge-m3** @ `10.0.0.106:8082` | llama.cpp serving the BAAI bge-m3 text-embedding model, GGUF q8_0, 1024-dim            | configured `n_ctx=8192, batch(-b)=2048, unit-batch(-ub)=512`                                                        |
| **Hana** @ `10.0.0.106:8081`   | llama.cpp serving gemma-4-12b-it (Q4_K_M) with vision+audio adapter; chat model        | `n_ctx=32768`, single slot (`-np 1`)                                                                                |
| PostgreSQL @ `10.0.0.103`      | The running app's metadata DB (native PG16 cluster, Ubuntu 24.04)                      | pgvector **not installed**; apt only offers 0.6.0; benchmarking done in docker `pgvector/pgvector:pg16` = **0.8.6** |
| MinIO @ `10.0.0.104`           | S3 object storage holding the real files (bucket `webdav-temp`, 31 GB, 10,841 objects) | read via S3 API for copies; originals untouched                                                                     |
| Dev box                        | Node v24 (built-in `node:sqlite`), Python 3.12, ffmpeg, single-core benches            | all PoC scripts live in `poc/` (git-ignored data)                                                                   |

**The test data.** Nothing was invented from scratch; every experiment used one of three pools:

1. **Real operational mirror** — the running instance's own corpus (≈5.4k documents after
   augmentation, 300 wedding photos copied via S3, 6 audio clips provided by the owner), plus
   directory names used as free labels (e.g. every photo under `wedding/` is a wedding photo —
   no human labeling needed for those).
2. **Public data** — Korean Wikipedia articles, the NSMC movie-review corpus, a
   topic-labeled Korean news dataset, random photos from picsum — chosen so each item carries a
   known "truth" label for scoring.
3. **Deliberate constructions** — a 11k-char contract with a distinctive clause inserted at a
   chosen position; image "near-duplicates" made by re-encoding/cropping/resizing 60 anchors;
   perturbed text variants at controlled damage levels (1% / 5% / 15%). These exist because
   you cannot grade a duplicate detector without _known_ duplicates.

One honest caveat up front: the "topic" corpora (news, movies) are templates and short reviews,
which the experiments later caught inflating similarity — several findings below exist precisely
because we fell into that trap and fixed it.

---

## 2. The experiments

### 2.1 The models probe — "is the manual lying?"

- **What**: before trusting any measurement, verify what the two AI servers can actually do.
- **How**: send a 64×64 solid-red image and audio clips to the endpoints; compare answer
  tokens and behavior against a text-only control.
- **Why**: the plan's provider model (`AI_FEATURE_PLAN §4.23`) says capability must be decided
  by probing, never by declared metadata — this principle needed its first real test case.
- **Result**:
  - bge-m3 is **text-only, and silently wrong on images**: sending a base64 PNG did not error —
    it embedded the _letters of the base64 string_ and returned a confident vector.
  - Hana sees images correctly ("dark red", from the reasoning trace) — vision is real.
  - Hana's advertised audio: first test said "no audio heard" — **that was a bug in our test**
    (we fed sine-wave beeps, which are outside the speech domain). Re-tested with real speech:
    full, accurate Korean transcription (30 s news clip, +727 tokens for the audio = genuinely
    encoded). Audio support is real.
- **Meaning**: declared capability and actual capability diverged in both directions — the
  product may trust neither without probing, and a probe must use _in-domain_ samples.
- **Consequence**: the whole "provider preset = expectation, boot probe = truth" rule in the
  plan is kept and hardened. The "silent wrong vector" failure mode (a text embedder fed an
  image returns _success_) is why multimodal inputs must never be sent to the wrong endpoint.

### 2.2 Auditing the live system

- **What**: check the plan's assumptions against the actual production database and object
  store.
- **How**: read-only SQL over SSH (`information_schema`, counts, distributions).
- **Why**: the plan had two explicit premises about the data layer (T0.1 content-hash, schema
  state).
- **Result**: `filecache.content_hash` is already populated on 100% of the 10,841 live objects;
  the live DB schema is _older_ than the repo DDL (no `file_nodes.size`); 9 stuck
  `pending_upload` nodes exist; 4.3 MB median / 362 MB max object sizes; one user's real photo
  tree (`wedding/ceremony-snaps`, ~9k jpgs) doubles as free ground-truth labels.
- **Meaning**: plan task T0.1 ("populate content_hash") is actually "use the hash that's
  already there"; and a migration-status check must precede implementation.
- **Consequence**: exact-duplicate finding (planned as AI-adjacent) becomes a _trivially
  available_ non-AI feature — moved into P0.

### 2.3 Corpus building

- **What**: a test set large and labeled enough to grade everything below.
- **How**: scripts in `poc/`: NSMC news-style pulls via Wikipedia/HF APIs, 160
  topic-labeled news docs, 60 random photos ("anchors"), 300×5 near-duplicate image variants,
  60 long/synthetic docs with known inserted facts, plus 300 wedding-photo copies via S3.
- **Why**: §2.1 of the plan — every experiment here is unpayable without ground truth; also
  the first tag experiments (2.9) died of a too-small sample, so the corpus was deliberately
  scaled up mid-PoC.
- **Result**: 6,177 items / 1.5 GB; every row tracked in `poc/manifest.jsonl`; 5,477 embeddable
  docs.
- **Consequence**: all later numbers are reproducible via the scripts in §5.

### 2.4 E1 — embedding every document, under the worst server settings

- **What**: can we embed an entire corpus reliably when the server can only process ≤512-token
  chunks (`-ub 512`, observed empirically as HTTP 500s)?
- **How**: chunk each document to ≤550-char pieces at 90% paragraph-aware boundaries, embed ≤4
  pieces spread evenly, average the vectors, renormalize (this is the planned
  "chunk-pool" §4.3 ladder), embed all 5,477 docs.
- **Why**: the design's over-length ladder was paper math; also a fairness test — the product
  must work on the _worst_ realistic llama.cpp config, not one we tuned.
- **Result**: **5,477/5,477 embedded, 0 failures, 36 seconds (~15,200 docs/min)**; corpus
  coverage p10 = 1.0 (90% of docs fit inside 4 chunks); measured ≈**1.7 chars/token** (mixed).
- **Meaning**: enrichment is embarrassingly cheap on this hardware; per-file AI cost is a
  non-issue for embeddings; and chunking (not server reconfiguration) is the only sane answer
  to length limits.
- **Consequence**: E1/E10 constants feed the plan's budget section; the "raise `-ub`" idea was
  dropped as cosmetic (a bigger ub just moves the wall — context windows still exist).

### 2.5 E2 — can one number separate "duplicates", "same topic", "unrelated"?

- **What**: the plan sprinkles cosine thresholds everywhere (near-dup θ≈0.98, cluster edges,
  gray bands). Are those separable at all?
- **How**: compute cosine for three populations: injected near-duplicate text variants,
  different documents of the same topic, random unrelated pairs; compare distributions.
  **Act 1 failed loudly** (see below). **Act 2 (E2v2)** fixed both experiment bugs and measured
  220 realistic-perturbation pairs vs 3,000 same-topic vs 4,000 unrelated pairs.
- **Why**: the single most load-bearing assumption — "similarity thresholds mean something".
- **Result**:
  - Act 1: apparent failure (gap −0.09). Root cause was _ours_: the "duplicates" were
    word-shuffled gibberish (semantically destroyed), and the "same-topic" docs shared a
    template skeleton, inflating their scores. Both artifacts, not the model.
  - E2v2, realistic edit strengths (typos, sentence-level edits): near-dup P10 = **0.977**,
    same-topic median = 0.655, unrelated P99 = **0.471**. Clean separation for _near-dup_
    (gap +0.5), but **topic-vs-unrelated remains heavily overlapped** (topic P90 0.78 inside
    the near-dup zone, unrelated climbs to 0.6).
  - Cross-check with a different embedder would change these numbers — a measured constant is
    valid per (model × corpus), see §3/§4 verdict.
- **Meaning**: θ≈0.97 for duplicate detection is _real and safe_ on bge-m3+Korean; "is this the
  same topic as that" is **not decidable by one cosine** — that decision must be relative
  (nearest neighbors, margins), statistical, or made by a human-in-the-loop suggestion —
  exactly how the plan already routes merges (§4.4) but the thresholds themselves needed this
  rewrite. The absolute "floor" of unrelatedness is corpus-dependent → replaced by a
  _per-query dynamic baseline_ (measure the same query against a random corpus sample and judge
  relative; no stored magic number).
- **Consequence**: plan changes at §4.3/§4.9/§4.17 (θ_dup=0.97 kept; θ for topics/clusters
  deleted; dynamic baseline added; exact duplicates go through the hash path, not cosine).

### 2.6 E3 — does semantic search actually work on this corpus?

- **What**: PLAN §4.6 promised recall@20 ≥ 0.6 for hybrid search.
- **How**: two scorers, both automatic: (a) 117 image queries generated from _independently
  verified_ captions (20/20 sample accepted by the owner — the "neighbor grandma" check); (b)
  249 "sentence probes" (take a sentence, find its document). Plus a blind A/B/C harness
  comparing name-search / semantic / hybrid lists.
- **Why**: search is the headline feature; if meaning-search fails here, nothing else matters.
- **Result**: images **recall@20 = 0.829** (chance = 0.004), MRR 0.566; sentence probes 0.996.
  The A/B harness exposed two more things: our _name-search code_ had a bug (OR-matching on
  tokens dragged an unrelated GDP file into "heavy-snow damage concern areas" results because "area" is a
  substring of "by-region") — fixed to AND-with-segments, **and that bug revealed a spec hole**:
  the plan's literal "names containing the query" would match almost nothing on multi-word
  queries. Negative-control junk queries returned "20 plausible-looking wrong answers" — which
  led to the floor/flatness gate (2.5's dynamic baseline) making "no results" an honest answer.
- **Meaning**: meaning-search is _proven_ on Korean media+text on our hardware. Name-search and
  vector-search failures are _disjoint_, confirming the two-section design.
- **Consequence**: §4.6 amended (AND-token segment matching; confidence gate); the E3-AB
  human-pref session was cancelled by the owner as uninformative (name lists win trivially on
  content queries, ties elsewhere) — recorded, not silently dropped.

### 2.7 E4 — can the machine invent collections from real photos?

- **What**: PLAN §4.9's silent generator: cluster embeddings → propose collections.
- **How**: three acts.
  1. Naive connected-components clustering on the text corpus: "purity 1.0"… but the clusters
     were trivial (news domain = news cluster), and identical template files formed fake
     clusters. Owner's verdict: **worthless as evidence**, and revealed the generator needs a
     dedup pre-pass (hash first).
  2. Switch to mutual-kNN (k=6, ≥0.82) on real data: caption 300 real wedding photos + 60
     unrelated stock photos through Hana (60/60 valid JSON, ~35 min), embed, cluster.
  3. Multi-tier (tight 0.86 / mid 0.80 / loose 0.72) on the merged 360-image library.
- **Why**: a generator that makes junk clusters or misses the obvious ones is worse than none.
- **Result**: act 2 produced **two flawless sub-clusters of a single event** — 16 photos of
  "groom/groomsmen getting ready" and 9 of "bride getting ready (veil, earrings)" — with
  **zero** stock-photo contamination; 60 unrelated stock photos alone formed **no cluster ≥8**
  (max 4). Act 3 additionally found event-scale clusters (170/212/273 of 300) with still zero
  contamination, and one 11-photo stock-only cluster at loose tier. Chaining (one giant blob)
  appeared exactly once and is size-gated out.
- **Meaning**: the mechanism works at _both_ granularities — "narrow and clever" (preparation
  shots, a collection nobody named) and "broad and obvious" (the whole wedding). Specificity is
  excellent at every tier (0 cross-contamination in ~250 clustered members).
- **Consequence**: plan generator rewritten — multi-tier with per-tier gates, dedup pre-pass,
  and (per owner's decision) **no special protection for big tiers**: system-origin collections
  archive/expire by the same uniform activity rules, user pins only manually. The earlier
  "fear-driven" exemption proposals were struck.

### 2.8 E5 — cheap, stable feature extraction, and the reasoning question

- **What**: can a small local model produce structured `ai_features` (tags/summary/category)
  reliably and affordably; and does enabling "thinking mode" help?
- **How**: fixed JSON-forced prompt, 1,117 documents (stratified across domains), temperature
  0, reasoning **off** (`chat_template_kwargs.enable_thinking=false`, works on this server).
  A separate 5-doc × {think, no-think} probe compared quality and latency directly.
- **Why**: every "LLM at write time" cost estimate rests on this; also the plan's per-role
  reasoning policy needed data.
- **Result**: nothink validity **1,115/1,117 = 99.8%**, ~5 s/doc, quality spot-good
  (ganache→[ganache,dessert,chocolate,baking]). Think mode: equal-or-worse tags, 5–10× slower, and
  it _crashed on a short review_ (burned 4,000 reasoning tokens, produced nothing) — reasoning
  hurt the one task it was "needed" for.
- **Meaning**: extraction-class roles = always off. (The later arbiter test, 2.10, reversed the
  remaining hope that _judgment_ roles need thinking — they don't either, on this model.)
- **Consequence**: `llm_models.reasoning` per-role default off; effort knobs only if a provider
  actually exposes them (this one does not — `supports_reasoning_effort:false`).

### 2.9 E6 — tagging "synonyms": the feature that dissolved

- **What**: PLAN §4.18 proposed merging similar tags via cosine ≥0.86 + co-occurrence ≥3 docs.
- **How**: act 1 (77-doc sample): the "dual condition" looked sane but co-occurrence was dead
  data (almost nothing co-occurs). Act 2 (E6b, graded rules): merge-by-cosine alone mislabeled
  _sibling_ terms (conifer↔flowering-plant family words) as duplicates; containment rules
  mislabeled hypernyms. Act 3 (E6c, full 1,115-doc vocabulary = 1,271 distinct tags):
  the high-cosine pairs are mostly (a) **spelling variants** (`"wasted time" vs "wastedtime" (spacing variant)`, cos
  0.98+, NFKC+whitespace-normalization merges them _deterministically_) and (b) **containment
  pairs** which are _hierarchies, not duplicates_; the old rule would have merged 102 pairs
  with zero evidence; doc-set statistics remain uninformative at corpus scale.
- **Why**: tags feed collections/predicates; a bad merge silently destroys user-meaningful
  distinctions; a good one is invisible — high stakes, low tolerance.
- **Result / meaning**: the problem §4.18 was invented to solve barely exists once you
  normalize orthography; what's left is hierarchy display and fuzzy tag _matching_, which the
  vector search (2.6) already does without any merging.
- **Consequence**: §4.18 rewritten as a 3-step pipeline — `NFKC normalize → containment =
parent-suggestion (non-destructive, display-only, per owner's scope decision no labeling
audit needed) → gray band left alone`. The old θ.86-merge and the k≥3 co-occurrence clause
  are both dead.

### 2.10 E7 — merge detection between _collections_ (sets), and the "arbiter"

- **What**: PLAN §4.9c's rule (sizeRatio≥0.7 ∧ Jaccard≥0.7, reject containment) — does it
  actually distinguish "same thing twice" from "subset" from "siblings"? And can an LLM
  adjudicate the gray band?
- **How**: geometrically _constructed_ pairs with known truth: strict subset, near-identical
  (swap 4/10, jac≈.82), mid-band (jac .54), low (jac .33), real siblings (groom-prep vs
  bride-prep clusters; economy vs IT news) — then a 5-pair × {think, nothink} arbiter battery.
  (First attempt had a harness bug: both lists were identical by mistake — caught and fixed;
  the earlier "thinking wins 2/2" reading was n=2 noise.)
- **Why**: merges destroy named objects; a wrong merge is the worst UX failure of the platform.
- **Result**: set-rule classified **every constructed case as intended** (subset rejected —
  naive overlap coefficient would have wrongly merged it; .82 pair → merge candidate;
  .54/.33 → band/reject; siblings → reject). Arbiter, given _symmetric-difference_ input
  (unique-member ratio + samples of each side): merge-vs-don't decision **5/5 for both modes**
  (thinking on/off identical at action level); finer 3-way labels slightly favor no-think.
- **Meaning**: the rule ladder is sound; the arbiter's value is in its _input format_, not its
  thinking. Two failure modes were found and fixed in harnesses before trusting either number.
- **Consequence**: §4.19 merge-arbiter keeps "must include symmetric difference", drops the
  reasoning-on requirement. §4.9c survives unchanged with evidence.

### 2.11 E8/E9/E11 — the vector-computation layer, all three backends

- **What**: is "compute it in JS" fast enough (fallback path), and do the native paths
  (pgvector; sqlite-vec) meet the accuracy contract on _real_ vectors?
- **How**: 5,417–60,000×1024-float benches: pure JS cosine+topK; pgvector HNSW (docker 0.8.6)
  exact-vs-ANN comparison over 216 real queries + 60 external-caption queries, ef_search
  sweep 100/400/1000; `node:sqlite` + sqlite-vec v0.1.9 (loadable extension; PK-BigInt gotcha
  and a JOIN-planner bug found and documented) at full corpus scale.
- **Why**: the architecture's "A-plan" choice depends on which backend does the math, and the
  accuracy contract (recall floor) has to be _measured_, not assumed.
- **Result**:
  - JS brute force: **67 ms** full scan at 60k vectors — plenty for fallback, but pays TEXT
    decoding per query (resident-state banned by design → fine at personal scale).
  - pgvector: build HNSW 5,417 in **2.1 s**; external-query recall@50 = **0.74 at default
    ef_search=100** → **1.00 at ef=400**. The default is _wrong for real (out-of-graph)
    queries_; 400 costs ~2 ms.
  - vec0 (sqlite): loads 5,417 in 163 ms, exact KNN **5.3 ms**, recall trivially 1.0 (it is
    exact); ACL joins unsupported by its KNN planner → oversample-then-filter helper needed.
- **Meaning**: three viable, code-simple layers; the one dangerous assumption (ANN recall at
  default settings) was caught by measuring _external_ queries, not self-queries.
- **Consequence**: `ef_search=400` fixed into plan §4.13; the "no pgvector ⇒ AI off" policy is
  superseded by "⇒ JS fallback + admin _performance_ warning" (owner decision), and
  sqlite-vec via `node:sqlite` (T0.12) is confirmed feasible — product Node floor ≥ 24.

### 2.12 E12 — do we lose facts inside long documents?

- **What**: single pooled vector per doc (§4.3's chunk-pool) vs storing chunk vectors: does the
  pooling _destroy_ retrievability of a fact in the middle of a long contract?
- **How**: synthetic 11.4k-char contract with a distinctive termination clause; query it;
  compare pooled vs max-over-chunks similarity.
- **Result**: pooled **0.510–0.563** (≈ the unrelated-document floor — effectively invisible)
  vs chunk-max **0.662–0.674**; worse, the stride-4 sampling _missed the section entirely_ in
  one placement.
- **Meaning**: pooling-for-storage is a real, measured retrieval hazard for long docs, and the
  "defer it, it interacts with calibration" excuse we made was invalid — the quality question
  was answerable today and was answered.
- **Consequence**: chunk-vector retention + max-pool scoring enters the plan; paragraph-aware
  chunking; chunk size derived at runtime from the server's real token budget (not a constant —
  `-ub 256` environments must keep working).

### 2.13 E13 — audio understanding beyond transcription: closed, and by evidence

- **What**: can we offer "find my rock tracks" via audio features (genre/mood/description)?
- **How**: Hana audio QA three ways — forced-JSON schema, open-ended "describe only what you
  actually hear", and a plain transcription battery — across: real speech, vocal music,
  instrumental music, a subway recording, a crowd, white noise; owner then supplied ground
  truth for each clip.
- **Result**: schema-forced generation **invented instruments for non-music audio**; the open
  prompt removed _some_ of it (white noise now "distorted electronic noise" — plausible) but
  the subway clip was called "fast cheerful electronic music with kick and snare" (the train
  motor, apparently) and the _transcription_ battery's earlier "no speech" on that same clip
  turned out to be a miss (it contains announcements). The instrumental track got
  **contradictory genres across two runs** (orchestral/classical vs hip-hop/trap).
- **Meaning**: non-ASR audio intelligence on this model is a coin flip; the _only_ failure mode
  we can tolerate is the conservative one (missed transcription = no data, vs invented genre =
  poisoned data).
- **Consequence (owner decision)**: audio scope freezes at **ffprobe metadata + conditional
  transcription** with the "no speech ⇒ 'no speech'" escape prompt; no audio descriptions,
  genres, kinds, or mood fields. Media ladder V3 = ASR only.

---

## 3. Scorecard — each plan assumption vs evidence

| Assumption (plan)                          | Verdict              | Evidence                                                                                    | Plan action                                                   |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| LLM is enrichment-only (never render path) | ✅ held              | E5/E7 all batchable; query-embed only sync call                                             | keep                                                          |
| Near-dup detection via cosine 0.98-class θ | ✅ with rewrite      | E2v2 P10=0.977 vs floor P99=0.471                                                           | θ_dup=0.97, exact-dups via hash first                         |
| One θ separates topics/clusters            | ❌ killed            | E2v2 overlap; E6 family confusion                                                           | relative-kNN + dynamic baseline + human loop (as designed)    |
| Tag "merge" pipeline                       | ❌ dissolved         | E6c: ortho variants + hierarchies dominate                                                  | §4.18 3-step rewrite; no destructive merges                   |
| Silent generator usefulness                | ✅                   | E4 two clean event sub-clusters, 0 contamination, no junk clusters from 60 unrelated photos | multi-tier, per-tier gates, dedup pre-pass, uniform lifecycle |
| Set-merge rule ladder                      | ✅                   | E7 all constructions classified as intended                                                 | §4.9c unchanged                                               |
| Arbiter needs reasoning mode               | ❌ (n=2 noise first) | E7 v2: 5/5 both modes; input format is what matters                                         | off everywhere; symmetric-difference input mandated           |
| pgvector absence ⇒ AI off                  | ❌ (owner)           | JS 67 ms; vec0 5.3 ms exact                                                                 | JS fallback + performance-only warning                        |
| ANN defaults are safe                      | ❌ caught            | external-query recall 0.74 @ ef=100                                                         | ef_search=400 constant                                        |
| Chunk-pool without stored chunks is fine   | ❌ for long docs     | E12 0.51 vs 0.67; section missed entirely                                                   | keep chunk vectors; paragraph-aware; runtime-sized chunks     |
| ASR usable (integrated multimodal)         | ✅                   | 6/6 battery + ground-truth regrade                                                          | transcription only, conservative gate                         |
| Audio genre/desc extraction                | ❌                   | E13 contradictions/hallucinations vs owner truth                                            | cut from v1                                                   |
| content_hash must be backfilled            | ❌ premise           | already 100% in live DB                                                                     | T0.1 becomes "use, not fill" + migration-state check          |
| Declared provider capability = real        | ❌ twice             | bge-m3 fake image vector; Hana audio flag                                                   | probe-is-truth rule hardened (already policy)                 |
| Experiment harnesses are correct           | ❌ twice (ours)      | E3 token-OR bug; arbiter A==B bug                                                           | both fixed in-place; findings restated — kept here as caution |

## 4. What the PoC opens, and what it closes

**Opens (go).** Semantic search on Korean text+captions at personal scale. Write-time tagging
/summary at 99.8% validity ≈ 5 s/file on one GPU. Collection generation from real photos
(narrow _and_ broad tiers, zero contamination). Set-level merge proposals with a working rule
ladder. Near-dup + exact-dup finding (hash-first, cosine-0.97). Embedding cost is a rounding
error (~15k docs/min). sqlite-vec/pgvector layer with known, cheap constants (ef 400;
oversample helper). Transcription-only audio.

**Closes (stop).** Anything gated on a _single absolute cosine_ for topics/clusters; stored
magic floors; tag-merge tables; audio genre/description; the arbiter's reasoning budget;
"AI-off when pgvector missing"; fixed-800-char chunking.

**Still unproven here, flagged for the build.** V1 image embeddings (abandoned by owner —
everything goes through text space); the θ numbers on _other_ models (they are per-model
constants now, measure at release like a browser-support table — no runtime calibration, no
shipped dataset: owner's standing decision); long-doc multi-vector cost at 100k docs; the 4-6
month drift question (does a real user's library shift the 0.471-style baselines? the
per-query dynamic baseline exists precisely because we refuse to guess).

---

## 5. Reproduction map

> **Archival note (2026-09-16):** the `poc/` scripts, datasets and the `poc-pgvec` bench
> container have been deleted after the PoC closed; paths below describe what existed, not
> what is kept. Re-running any experiment requires rebuilding its harness from §2's method
> descriptions (each is specified tightly enough to do so). The three plan documents remain
> the live artifacts.

| Artifact                  | Where                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus builder scripts    | `poc/gen_poc_data.py`, `build_nsmc.py`, `build_news.py`, `wiki_slow.py`, S3 copy `dl.py` (keys via `.env.bak`)                                          |
| Manifests & labels        | `poc/manifest.jsonl` (6,177 rows), `poc/captions.jsonl`, `poc/verify_sample20.md` (accepted 20/20), `poc/e5b_results.jsonl` (1,115 tags)                |
| E1                        | `poc/e1_flush.py`, `e1c_chunks.py` → `vectors_pool.jsonl`                                                                                               |
| E2                        | `poc/e2_dists.py`, `e2b_dists.py` → `e2v2_result.json`                                                                                                  |
| E3 (+AB harness & bugfix) | `poc/e3_search.py`, `e3ab.py`, `queries.txt`, `e3ab_sheet.md`, `e3ab_key.json`                                                                          |
| E4                        | `poc/e4_clusters.py`, `e4b_seed.py`, `e4r_real.py`, `e4c_multi.py` → `e4b_/e4r_/e4c_*.md` review sheets, `wedding_captions.jsonl`                       |
| E5 / reasoning probe      | `poc/e5_extract.py`, `e5b_run.py`, `/tmp/opencode/poc/reason_probe.py`(transcribed results above)                                                       |
| E6                        | `poc/e6_tagcal.py`, `e6b_score.py`, `e6c_hierarchy.py` → `e6c_pairs.json`                                                                               |
| E7 / arbiter battery      | `poc/e7_sets.py`; `/tmp/opencode/poc/arbiter_battery.py` (v1 & v2 logs)                                                                                 |
| E8/E9/E11/E12/E13         | `e8_cosine.js`, `e9_pgvector.sh`, `vec_spike.js`/`vec0_bench2.js`, `e11_recall.py`, `multivec_test.py`, `asr_battery.py`, `audio_qa.py`, `audio_qa2.py` |
| Bench DB                  | docker `poc-pgvec` (pgvector 0.8.6, port 55432, table `emb2`) — left running for re-runs; stop with `docker rm -f poc-pgvec`                            |

_Numbers in §2 are as measured on 2026-09-15/16 on the hardware of §1. Treat them as
per-model, per-corpus constants — that is literally the lesson the document repeats._

---

## 6. Addendum — EmbeddingGemma 2 migration probes (2026-10-08)

> This addendum **does not revise §1–§5**: those numbers are the bge-m3 record and remain
> true per-model constants. It records the first probes against the new embed model and the
> decisions they trigger (owner: **V1/V3 revived 2026-10-08** — media enters the embedding
> space directly; see AI_FEATURE_PLAN §4.20/§4.21/§9). Test data: `data/corpus/eg2-test/`
> (git-ignored, same archival policy as `poc/`).

**Environment change (§1, historical now):** `10.0.0.106:8082` no longer serves bge-m3 — it
serves `embeddinggemma-2` (llama.cpp 0.6.0-dev b11459, GGUF Q4_K_XL + mmproj Q8, GPU,
`--embeddings --pooling mean -c 8192 -ub 512 -ngl 99`). Model: 740M (270M text + 170M vision

- 300M audio encoders), 768-dim, one shared multimodal space, Apache-2.0, 8K token context.

### 6.1 Capability probe — declared vs actual, again (extends §2.1)

- `/v1/models` declared `input_modalities:[text,image,audio,video]`. **Wrong-format media
  requests returned HTTP 200 with the TEXT vector** (top-level `image`/`audio` fields
  silently dropped; cos vs plain-text control = 1.000000) — the §2.1 "silent wrong vector"
  failure class reproduced on the very model that supports media. Correct shape:
  `{"input":[{"content":[{"type":"image_url|input_audio|video_url", ...}]}]}`.
- **Pooling is a space-changer:** server started `--pooling cls` (model trained mean) moved
  unrelated text-pair cosines 0.457→0.664 with zero errors. Fixed to `mean`; the `content`
  media path was unaffected by the flag (internally pooled).
- `-ub 512` wall repeats: >~20 s audio or >~1 image/frame per call → HTTP 500; 60 s video
  tokenized (5,922 tok) then rejected. Client-side segment/pool worked (19 s audio windows).
- Q4_K_XL GGUF vs reference: probe battery differences ≤0.004 — quantization class OK on
  this model at this checkpoint (release-measure still required per §4.15).

### 6.2 Cross-modal battery (new ground truth)

Wedding photos (S3, DB-path-mapped `rct3232/picture/25/25.09.28 결혼식/…`) + 6.2 s event
video `62.mp4`; owner-labeled audio clips (news/lofi/vocal-music/meeting/subway/pink-noise/
Japanese-info); Hana captions as text references.

- **text↔image**: photo ↔ its caption 0.66–0.75; video ↔ event photos **0.78–0.79**;
  near-dup re-encode 0.972 / half-crop 0.947 / different-photo 0.661 → media bands exist and
  order correctly.
- **audio↔text**: every target pair ranked top-1 in its row (news 0.848, meeting 0.796,
  lofi-label 0.787, JP summary 0.787/ko-translation 0.735, subway 0.709, noise-label 0.738)
  — **but margins thin (+0.02–0.07) and floors high (0.59–0.69)**: absolute-θ decisions stay
  banned (§2.5 lesson survives); dynamic baseline + ranking remain the only honest gate.
- **video↔audio identity**: `test-1.mp4` (pink-noise audio track) vs `test-6.mp3`: audio
  track vs audio file **0.9988**; native video embedding vs audio 0.654 (frames ≠ waveform —
  llama.cpp video input is vision-only; interleaved `<|audio|>` fusion unproven on this
  server).
- Hana-side findings: full-file >~300 s audio crashed the container once; 45–90 s chunked
  ASR stable (385 s meeting clean, 13/14 chunks of 588 s Japanese, one permanently
  degenerated chunk); ASR said "no speech" on vocal music even with priming → §2.13's
  conservative-failure profile confirmed; **none of this poisons the embed space** (transcript
  is stored, never silently invented).

### 6.3 Scorecard deltas

| Assumption                      | Δ                     | Evidence                             | Action taken                                                                               |
| ------------------------------- | --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| V1 image embeddings (abandoned) | **REVIVED**           | 6.1–6.2 cross-modal ordering correct | owner decision 2026-10-08; AI_FEATURE_PLAN §4.20/§4.21/§9 rewritten                        |
| Audio scope (ASR only)          | REVIVED as embed-only | 6.2 audio rows top-1                 | §4.21 V3: direct audio embed added; **genre/mood/desc ban HOLDS** (retrieval ≠ generation) |
| Declared capability ≠ real      | ❌ again (3rd model)  | 6.1 silent-ignore                    | probe suite must use positive media controls (§4.23.2)                                     |
| One θ per population            | unchanged             | 6.2 compressed bands                 | adoption re-measurement checklist opened (PLAN §16 / Q10)                                  |

### 6.4 Still unproven (carried forward)

θ_dup/tier/θ_lo/chPerTok re-measurement on the EG2 reference set (the whole §2 battery in
EG2 space); interleaved text+media fusion; video native serving (`-ub` raise); Korean
cross-modal recall@20 vs the 0.829 caption-path baseline; 100k-doc media backfill cost.
(§6.4 items 1 and 4 closed by §6.5 below; items 2, 3, 5 stay open.)

### 6.5 Q10 release-measurement battery (2026-10-08, same day, post-decision)

Four parallel reference-set runs, harnesses rebuilt from §2 method descriptions; artifacts
in `data/corpus/q10/{text,images,media,tags}/` (git-ignored; each with result.json +
METHODOLOGY.md). Server as §6 environment (GPU, mean, ub-512). Determinism: re-embedding
matched cached vectors at cos 1.0000 (the `(content_hash, model_id)` idempotency rule holds
on EG2).

| Measurement (§2 counterpart)                               | bge-m3 (original)     | EG2 (this battery)                                                        | Verdict                                                                   |
| ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| text near-dup P10 (E2v2)                                   | 0.977                 | **0.9746** (typo .9775/del .9617/swap .9896, n=751)                       | band class transfers                                                      |
| text same-topic median / unrelated P99 (E2v2)              | .655 / .471           | **.7392 / .7294** (max .8826)                                             | FLOORS RISE — compressed space; one-θ near-dup-only conclusion REPRODUCED |
| θ_dup recommendation                                       | 0.97                  | **0.955**                                                                 | per-model, confirmed                                                      |
| E12 pooled vs max-over-chunks                              | .51 vs .67            | .665 flat-pooled vs clause-rank 1–3; **stride-4 missed at all positions** | hazard reproduced → multi-vector design validated                         |
| chPerTok (E10)                                             | ≈1.7                  | **1.74 mean / 1.50 worst-class**                                          | ship 1.5                                                                  |
| throughput (E1)                                            | 15.2k docs/min        | **6.1k seq / 12.1k batch-8** (GPU)                                        | still cheap                                                               |
| prefix policy sensitivity                                  | n/a                   | band deltas ≤0.006 (text); tag-hierarchy gap ×3 with doc-form             | keep prefixes; doc-form for tags                                          |
| E3 image recall@20 — NOW with real photos, no caption path | 0.829 (caption-based) | **1.000 / MRR 0.881** (n=20, exact-caption queries — upper bound)         | V1 beats retired path                                                     |
| image near-dup P10 / same-event max                        | (caption proxy only)  | **.9426 / .990**                                                          | media θ flag-only (proposal generator, never auto-pick)                   |
| audio near-dup P10 / noise-twin                            | n/a                   | .969 / **.9988**                                                          | same conclusion                                                           |
| E4-style mutual-kNN (55 images, tiers .86/.80/.72)         | zero contamination    | **zero contamination**; event blob ≥0.80 (size gates already exist)       | tiers provisional-OK in image space                                       |
| junk-query floor (§4.6 gate data)                          | —                     | top1 .545–.640, rank1–20 spread .037–.054 flat                            | δ≈.06–.10 directional (n=5)                                               |
| tag vocabulary (E6c, 909 tags, 100% JSON validity)         | θ_lo .75 worked       | containment P10 **.8025** < sibling P90 **.8913**; unrelated P50 .7527    | absolute θ_lo unusable → Q11, CLOSED §6.9                                 |
| video band reproduction                                    | n/a                   | frames↔event-photos .763–.798; track↔noise .9988                          | reproducible                                                              |

**Q8 quantization control (same day)** — Q11's band overlap re-measured on the Q8_0 GGUF
(CPU): per-tag Q4↔Q8 vector cos median 0.9958; containment P10 .7954 / sibling P90 .8918 /
unrelated P50 .7511 — class bands shifted ≤0.008, the overlap persists. Verdict: band
compression is model-space geometry, not quantization (artifact `q8_compare.json`).

Not closed here: interleaved text+media fusion (untested on llama.cpp serving), native
`video_embed` (server `-ub` infra call — Q10-adjacent), 100k-doc media backfill cost,
text-space kNN tier rerun, real-world ortho-variant tag folding (synthetic only),
speech/noise class continuum (no global θ separates; ranking survives, thresholding dies).

### 6.6 Long-document battery (2026-10-14) — the short-slice intrusion does NOT transfer to real documents

- **What**: §6.5's intrusions (30.7% of unrelated pairs ≥ topic-band floor) came from
  ≤450-char intro slices and noun-phrase tags. Do real files — long text with context,
  subjects, and narrative — separate better? And how do _similar-but-different_ subjects
  cluster? Also: can the app embed long docs at all under this server (`-ub 512` caps one
  input at ~920 Korean chars — measured: 1,200 chars = 651 tok → HTTP 500)?
- **How**: 20 full Korean Wikipedia articles in 4 deliberately-close families (revolutions,
  bio-energy, stellar-death, cities), truncated 6k chars, embedded production-policy:
  paragraph-aware chunks ≤700 chars with `title:` prefix, pooled = mean+renorm(stride-4),
  plus max-over-chunks. Server: EG2 Q8_0 CPU (10.0.0.106:8082), artifacts
  `data/corpus/q10/longdoc/` (docs_chunked.json, emb_cache.jsonl, result.json — no
  METHODOLOGY.md here; this section is the method record).
- **Result**:
  1. **Feasibility OK** — chunk ladder embeds long docs cleanly (205 chunks/58 s CPU).
  2. **Intrusion collapses**: cross-family ≥ same-family-P10 drops **30.7% → 0.7%**
     (pooled). Context genuinely separates macro-topics on EG2: within-family P50 .805 vs
     cross-family P99 .773; margin +.096 at family level.
  3. **Granularity limit**: family-level grouping is clean — mutual-kNN(k=4) recovered
     4/4 clusters with ZERO mixing. Instance-level ("Paris" vs "London" as separate
     collections) is NOT threshold-separable: same-family P10 .780 vs cross-family P90
     .7485 leaves a ±.03 gray band — instance separation needs assertions (tag/path), not θ.
  4. **max-over-chunks is the WRONG grouping metric** (new flaw): max scoring is an
     O(n²) lottery — at θ=.75 it admits 13.3% cross-family vs pooled's 8.7%, and mutual-kNN
     on max-scores **merged cities+revolutions into one 9-doc blob**. Retrieval keeps max
     (E12 fact-finding role, unchanged); **grouping/membership/seed math must use pooled**.
- **Meaning**: the user-facing promise ("collections that gather themselves") is true at
  THEME granularity for long text, false at INSTANCE granularity for any cosine — consistent
  with §2.5 and the assertion-vs-measurement split. And a plan bug surfaced: §4.13
  `neighbors()` max-over-chunks is currently the single scoring path for BOTH retrieval and
  grouping.
- **Consequence**: AI_FEATURE_PLAN §4.13/§4.19 amendment pending (split scoring metrics:
  pooled for grouping/seed/centroid, max for retrieval); §4.6 unchanged; §2.5 conclusion
  REFINED (not reversed): one-θ topic separation fails on short text but succeeds at
  family level on long text — per-corpus, per-granularity constants matter (Q10 checklist).

### 6.7 In-process Node.js runtime probe (2026-10-14)

- **What**: can EG2 run INSIDE the product's Node ≥24 process, with no external server —
  and not just text: the FULL multimodal surface (text + image + audio + video)?
- **How**: `@huggingface/transformers` v4.3.1 + `onnx-community/embeddinggemma-2-ONNX`
  (the official transformers.js export; Apache-2.0; encoders selectively loadable by nulling
  config sections). `device:'cpu'` (onnxruntime-node; sharp for images; ffmpeg→16k-mono
  Float32Array for audio; 1-fps frames via `RawVideo`). dtype q8 (text+vision+audio).
  Embed the SAME battery inputs as the llama.cpp Q8-GGUF server for parity. Dev box
  (6-core CPU-only, NOT the 106 hardware).
- **Result — all four modalities work in-process, ranking parity perfect**:
  - Audio: clips 1/2/5/6 pooled ladder (19 s segments) → own text rank **1/5 in all four**
    (0.843/0.775/0.724/0.745 vs server 0.848/0.787/0.709/0.738 — Δ≤.013, ordering identical).
  - Video: 62.mp4 6-frame `RawVideo` ↔ wedding photos **.745–.761** (server .763–.798).
    Images (prior battery) and text parity hold as before: cos(ONNX,GGUF)=0.9997–0.9999 text;
    image bands shift ≤.02 with ordering preserved (re-encode .989 > crop .948 > other .649 >
    caption .695 > unrelated .507).
  - **Never mix engines in one corpus without re-embedding** — same space semantically,
    different arithmetic (preprocessing/quantization paths); engine+precision join the
    model profile (§4.15 shape-flag rule extended). model_id=space key stays load-bearing.
  - Speed (6-core dev CPU — NOT the same hardware as 106, so no cross-machine multipliers
    claimed): text 263 ms/embed; image 8.3–9.6 s; audio ~4.7 s/19 s-seg. (llama.cpp-CPU on
    106 did image 0.63 s.) CPU multimodal in-process = feasible for batch enrichment, NOT
    for interactive query-embed (<100 ms gate; text-only interactive needs target-hardware
    measurement).
  - Memory: RSS ~1.6 GB with all three q8 encoders loaded; q4 worst-case cos-to-fp32 .975
    ⇒ product default q8.
  - _Harness caution (3rd instance of this document's theme)_: an initial "audio NaN" scare
    was MY probe bug (double `[0]` indexing turning vectors into scalars → `dot` NaN), not
    the runtime — disproved by isolation before any conclusion; recorded as caution.
- **Meaning**: EG2 multimodal embedding is fully embeddable inside the product's own Node
  runtime — the "backend-agnostic, even fully local" positioning reaches its strongest
  form: one npm package + q8 weights = text/image/audio/video search with no server, no
  GPU. GPU llama.cpp remains the interactive path and the throughput path for media.
- **Consequence**: candidate preset family `transformersjs-embeddinggemma2` (all four embed
  caps, CPU-served — media caps carry a latency warning in the profile); E2 query-embed
  gate ⇒ in-process mode advertises text-interactive only until measured on target hardware;
  enhancement task NOT scheduled — owner decision (PLAN §16 carry-forward).

### 6.8 Built-in embedding engine + q4 dtype decision (2026-10-14)

- **What**: pick the product's embedding runtime and precision; §6.7 left "q8 default" as a
  recommendation and the enhancement unscheduled — this section supersedes both lines.
- **How**: q4 is an OFFICIAL export dtype (measured files: model 174 MB + vision 109 MB +
  audio 189 MB = **473 MB** full set; q4f16 426 MB; fp32 2,929 MB). Reran the audio-rank
  battery and image band probe at q4, plus warm timing/RSS for both precisions (6-core dev
  CPU, transformers.js in-process).
- **Result (q4 vs q8)**:

| measure                       | q4                                   | q8             | verdict                                                           |
| ----------------------------- | ------------------------------------ | -------------- | ----------------------------------------------------------------- |
| text embed                    | **0.13 s**                           | 0.48 s         | 3.7× — brings the E2 <100 ms gate within reach on faster hardware |
| image embed                   | 7.1 s                                | 8.9 s          | dtype-insensitive (encoder conv dominates)                        |
| audio 19 s seg                | 3.85 s                               | 5.08 s         | dtype-insensitive                                                 |
| RSS (3 encoders)              | **1,112 MB**                         | ~1,600 MB      |                                                                   |
| audio own-text rank (4 clips) | **4/4 rank-1** (.836/.774/.734/.727) | 4/4 rank-1     | ordering survives q4                                              |
| image band re/crop/other      | .991/.944/.635                       | .989/.948/.649 | ordering survives; abs drift ≤.02                                 |

- Export's own warning — q4 worst-case cos-to-fp32 .975 (audio worst) — is real but lands
  only on flag-only consumers (§6.5: media θ is a proposal generator; text θ_dup is
  proposal-only too), never on ranking paths.
- Distribution facts pinned in-session: HF resolve-URL is commit-immutable; per-file
  sha256 == registry `x-linked-etag` (verified); dev-box cache yields the full lock
  (7 q4/lock files, sizes+hashes) — **no self-hosted asset pipeline needed**.
- **Decisions (owner, 2026-10-14)**:
  1. Embedding is a **built-in product capability**: in-process (transformers.js + ONNX
     export), no external serving step required; external GGUF/HTTP providers remain valid
     overrides (and the interactive/throughput path for media on GPU).
  2. **dtype = q4** (full set 473 MB) as product default; q8 documented as quality-first
     profile alternative (a lockfile dtype change = new model_id = re-embed, per §4.15).
  3. **Distribution = lockfile + boot provisioning (BLOCKING), universal**: npm ships a few-KB
     lock {repo, revision-pin, files[], sha256[], dtype}; at boot the engine uses
     pre-provisioned `WEA_MODEL_DIR` if present, else downloads once — **the boot BLOCKS on
     provisioning and the CLI prints per-file download progress** (owner ruling 2026-10-14;
     atomic temp-file+rename, sha256-verified, idempotent) — same rule single-node or 1000
     replicas; pre-provisioning is an optimization, never a mode switch (a STRICT flag was
     considered and REJECTED: replicas are identical builds, so download-if-absent is already
     correct and ban adds nothing).
  4. Provisioning attempt fails (offline first boot / checksum mismatch) ⇒ after the blocking
     attempt boot continues with embed caps OFF + admin prompt; every other product behavior
     unaffected (enrichment-dependency stance holds).
- **DDL**: `llm_models` gains `engine (embedded|remote)`, `precision`, `model_revision`
  (001 edited; no live users ⇒ big-bang migration script at the `ai-feature`→`dev` deploy).
- **Consequence**: AI_FEATURE_PLAN §4.2/§4.12/§4.15/§4.20/§4.23/§5 updated (built-in
  embed role, blocking provisioning, engine+precision+revision in the model-profile identity);
  spec-level contracts go to llmPresets/llmAdapter next; provisioning CLI + lock generation
  become PLAN task **T1.0** recorded in **§17** (new section, owner ruling). Pending
  measurements: q4 TEXT θ_dup band re-check, text-only interactive latency on target
  hardware, q4 audio long-file pooling drift (§6.5 rows were q8-GPU measured).

### 6.9 Tag layer dissolved to descriptive-only (2026-10-16, owner decision)

The §6.5 tag battery + the follow-up review chain (θ_tag → θ_lo → lifecycle) ended not in
re-anchoring but in DISSOLUTION: LLM tags stay words that describe a file (display chips,
naming/adjudication material), and every institution around them is retired — θ_tag fuzzy
predicates, θ_lo/parent hints, `tag_embeddings`, LLM-tag materialization/fold-tables.
Decisive measurements (this addendum): containment P10 .8025 < sibling P90 .8913 (cos gate
dead); a refined string-rule trial kept 263/318 while REVERSING cos's discrimination (real
parent .679 vs junk .881) — proving the error lived in the string layer all along; and the
products' semantic-expansion need is already served by document/media vectors (V1/V3 +
E3-validated). Derived local facets (`mime:`/`ext:`/`month:`/`path:` in `ai_tag_raw`)
survive unchanged — folded string-equality predicates, no embedding, model-invariant.
Q11 closes by removal; E6c's "nothing merges automatically" becomes a permanent law rather
than a pipeline step. Record: AI_FEATURE_PLAN §4.18/§3.2, PLAN §19.
