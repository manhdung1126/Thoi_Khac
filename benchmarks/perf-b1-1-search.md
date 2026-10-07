# PERF-B1.1 — search long-task investigation

Date: 2026-10-07. Decision: **investigation complete; candidate reverted**.
No production optimization retained. No virtualization, debounce, CSS/UI changes,
backend changes, or PERF-B2 work. PERF-B1's existing card reuse remains intact.

## Method and scope

Chrome headless, 1536×768, same machine and existing isolated harness. Each run
uses temporary storage and a temporary API server, never exhibition storage.
Four unprofiled runs: baseline, batching candidate twice, restored baseline.
Eight observations per query shape and per Control operation; three per shape
in additional native-call/Chrome-trace profiling runs. No concurrent tests during
measurements. Percentiles at this sample size are exploratory, not SLA claims.

Opt-in fixture IDs contain deterministic hex markers: aaaa in floor(95%×N),
bbbb in floor(N/2), dddd in exactly 3, zzzz in none. Other fixture contents,
page counts, drawings, vectors, paused state, and assets remain unchanged.
Default fixtures remain unchanged unless --search-shapes is passed.

A: unchanged empty query; B: all → aaaa; C: all → bbbb; D: all → dddd;
E: all → zzzz; F: dddd → empty. Each sample restores its starting query outside
the measurement. A deliberately dispatches an input event even though its value
is unchanged, exposing redundant invalidation rather than optimizing it away.

Shape probes dispatch an input event and wait for paint plus 60 ms of observation.
The existing Control sequence uses Playwright fill(), alternating ffff and empty;
in these marked fixtures ffff matches the last 5%, **not zero**. Do not compare
its absolute timings directly with the older PERF-B1 zero/full ID fixture.
The baseline/candidate/restored comparisons here use identical marked fixtures.
Long tasks from fill() include browser/automation work; they are not exclusive
CPU time inside renderLibrary. Shape probes recorded zero long tasks even when
they dropped a frame: JS and layout can execute in separate tasks.

Source interception disables HTTP caching but preserves existing image/card
instances. Separate passive native-cache refresh checks remain in the harness.
Detailed profiling adds overhead and is used for attribution, not the plain
before/after timing comparison. rAF gaps are scheduling proxies, not GPU frames.
The final shape run retains the preceding rAF timestamp at reset to include the
first input interval; early shape probes reset it, so use the final shape frame
column rather than claiming a precise shape-level before/after rAF improvement.
The pre-existing multi-action Control frame measurement is unchanged throughout.

## 1–3. Pipeline, root cause, query shapes

Classification: **MIXED — MASS_VISIBILITY_UPDATE / DOM insertion + LAYOUT_STYLE_COST**.
Not expensive ID matching, image reconstruction, or primarily GC.

At 1,500 items, final restored detailed profiling (3 samples):

| Phase | Observed duration / behavior |
|---|---|
| Query trim/lowercase | 0 at timer resolution; not literally zero work |
| Page membership/active-set construction | 0–0.2 ms |
| Combined folder/deleted/favorite, ID substring, active-page filter | 0–0.2 ms total |
| Ordering | 0–0.1 ms |
| Cached-card state and bookkeeping | Approximately 4.2–4.4 ms residual on clear; includes key/meta/button checks and map/set bookkeeping, not a standalone exclusive card-state timer |
| All → half | 750 removals, 13.4–19.3 ms inside native remove calls |
| All → 3 | 1,497 removals, 25.6–35.5 ms inside native remove calls |
| All → zero | One replaceChildren, 3.5–4.5 ms |
| 3 → all | 1,497 insertBefore calls, 22.5–30.8 ms |
| Class checks on clear | 1,500 forced toggle checks, 0–0.5 ms; no class mutation when value matches |
| Image/source/handler changes during shape searches | None; zero image requests |
| Layout on clear | 18.1–20.8 ms per observation |
| Style update on clear | 11.4–11.9 ms per observation |
| GC on clear | Minor 0–0.79 ms; Major 0–2.83 ms, not the dominant cost |

The initial **pre-edit** profile independently measured filter 0.1–0.2 ms,
clear insertion 22.1–31.2 ms, layout 18.0–27.1 ms, and style 11.6–12.2 ms.
This evidence preceded the production trial.
The combined filter is measured as one predicate; per-condition nanosecond
attribution would perturb a phase already below ~0.2 ms. No false precision is
claimed for the separate folder and ID subexpressions. Layout/GC trace totals
cover the observation window, including the surrounding page, and must not be
added to synchronous JS totals as though they were exclusive phases.

### Invalidation audit

Every search scans all N authoritative drawings for filtering, creates the
available-ID set, scans the renderer cache, and checks state for M matching
cards. Reused cards still recompute their small key, membership text, target
label and permissions. Nonmatching cards are not state-rendered. Removal is
already guarded by parentNode; correctly placed cards are not reinserted.
Text, locked and disabled writes already compare current values. Forced
classList.toggle on an already correct class produces no mutation in Chrome.
An unchanged empty search inspected 1,500 candidates / 1,500 matched cards but
changed **zero** library nodes. No hidden/style writes, no image-src changes,
no getBoundingClientRect/offset/client-size/computed-style reads in this renderer.
The empty-result paragraph is recreated; its cost is small next to removing cards.

## 4–6. Trial, DOM writes, rejected alternatives

Tried batching consecutive missing cards with native before(...cards) / append,
leaving already correctly placed nodes attached. No new cache or invalidation
contract. On F, native insertion calls fell **1,497 → 1**, but the same **1,497
card nodes** still reentered the document. Unique changed nodes remained 1,498
(cards plus parent); layout remained ~19 ms plus ~12 ms style. The candidate
profile still spent 20.9–24.7 ms inside that single native insertion.

The main 1,500-item sequence improved only 24.50 → 23.45 / 23.05 ms median
(~4–6%), with **4 long tasks in every run**. Restoring the original gave 23.85 ms,
inside this range. The 3→all shape looked better in the two candidate runs,
but the restored baseline also improved without the change. Benefit is too
small relative to run variability and does not resolve the target hotspot.
**Reverted the candidate completely; do not retain extra reconciliation logic
just to reduce native-call count.**

Rejected: redundant equality guards (actual identical writes already skipped),
search-text cache (filter only ~0.2 ms), unrelated-card-state caching (new
invalidation risk for a few milliseconds), workers/search libraries (wrong
bottleneck), debounce (changes response timing), blanket replaceChildren or
moving the entire host (focus/scroll/image-state risk), virtualization (requires
separate approval). No new dependencies or generic renderer framework.

## 7–11. Plain before / candidate / restored measurements

Times in ms. Sequence is 8 alternating ffff/empty actions. Each cell is
median / worst synchronous library render. LT counts cover the whole 8-action run.

| Artworks | Before | Candidate 1 | Candidate 2 | Restored | LT before / C1 / C2 / restored |
|---|---|---|---|---|---|
| 27 | 0.20 / 0.30 | 0.20 / 0.30 | 0.20 / 0.30 | 0.20 / 0.30 | 0 / 0 / 0 / 0 |
| 250 | 1.35 / 1.60 | 1.40 / 1.60 | 1.40 / 1.80 | 1.50 / 1.70 | 0 / 0 / 0 / 0 |
| 1500 | 24.50 / 33.80 | 23.45 / 26.50 | 23.05 / 28.60 | 23.85 / 28.80 | 4 / 4 / 4 / 4 |

| Artworks | Before rAF p95 / max | C1 rAF p95 / max | C2 rAF p95 / max | Restored rAF p95 / max | Max LT before / C1 / C2 / restored |
|---|---|---|---|---|---|
| 27 | 16.80 / 16.80 | 16.70 / 16.70 | 16.80 / 16.80 | 16.80 / 16.80 | 0.00 / 0.00 / 0.00 / 0.00 |
| 250 | 16.80 / 16.80 | 16.80 / 16.80 | 16.70 / 16.80 | 16.80 / 16.80 | 0.00 / 0.00 / 0.00 / 0.00 |
| 1500 | 50.10 / 66.60 | 50.00 / 66.70 | 50.10 / 50.10 | 50.00 / 66.60 | 66.00 / 65.00 / 57.00 / 61.00 |

### All six shapes, 1,500 artworks

JS entries: median / worst ms, 8 observations each. Final frame value is the
largest per-observation p95 / max (not a pooled percentile). LT is total across
each shape's eight observations. All shapes inspect N=1,500 filter candidates;
matched cards checked are the result count (zero for E).

| Shape / matches | Before JS | C1 JS | C2 JS | Restored JS | Restored rAF p95 / max | LT before / C1 / C2 / restored |
|---|---|---|---|---|---|---|
| A_all / 1500 | 3.10 / 4.20 | 3.05 / 5.20 | 2.60 / 3.90 | 3.20 / 4.90 | 16.80 / 16.80 | 0 / 0 / 0 / 0 |
| B_almost_all / 1425 | 4.35 / 5.80 | 4.60 / 6.40 | 4.50 / 4.80 | 4.65 / 5.50 | 16.80 / 16.80 | 0 / 0 / 0 / 0 |
| C_half / 750 | 19.45 / 21.40 | 16.40 / 21.10 | 15.85 / 20.50 | 16.20 / 21.20 | 16.80 / 16.80 | 0 / 0 / 0 / 0 |
| D_few / 3 | 27.65 / 38.20 | 31.50 / 36.50 | 29.00 / 35.40 | 30.00 / 37.50 | 33.40 / 33.40 | 0 / 0 / 0 / 0 |
| E_zero / 0 | 4.40 / 5.10 | 4.40 / 4.70 | 4.35 / 5.20 | 4.60 / 4.90 | 16.70 / 16.70 | 0 / 0 / 0 / 0 |
| F_clear / 1500 | 30.30 / 33.30 | 23.65 / 28.90 | 24.20 / 32.90 | 25.65 / 37.70 | 66.70 / 66.70 | 0 / 1 / 0 / 0 |

### Normal workloads, six shapes

| Artworks / shape | Before JS median / worst | C1 | C2 | Restored |
|---|---|---|---|---|
| 27 / A_all | 0.20 / 0.30 | 0.25 / 0.30 | 0.20 / 0.20 | 0.20 / 0.30 |
| 27 / B_almost_all | 0.25 / 0.40 | 0.20 / 0.40 | 0.25 / 0.30 | 0.25 / 0.40 |
| 27 / C_half | 0.35 / 0.40 | 0.30 / 0.40 | 0.30 / 0.30 | 0.30 / 0.50 |
| 27 / D_few | 0.35 / 0.50 | 0.40 / 0.40 | 0.40 / 0.50 | 0.30 / 0.50 |
| 27 / E_zero | 0.30 / 0.40 | 0.20 / 0.30 | 0.30 / 0.40 | 0.30 / 0.40 |
| 27 / F_clear | 0.25 / 0.60 | 0.20 / 0.30 | 0.30 / 0.40 | 0.30 / 0.40 |
| 250 / A_all | 1.00 / 1.10 | 0.80 / 1.20 | 0.90 / 1.10 | 0.80 / 1.10 |
| 250 / B_almost_all | 0.90 / 1.60 | 0.80 / 1.50 | 0.85 / 1.20 | 0.85 / 1.20 |
| 250 / C_half | 1.30 / 1.60 | 1.30 / 1.70 | 1.45 / 1.70 | 1.35 / 1.50 |
| 250 / D_few | 2.15 / 2.40 | 1.75 / 1.80 | 2.05 / 2.50 | 1.70 / 2.20 |
| 250 / E_zero | 1.05 / 1.20 | 1.00 / 1.30 | 0.90 / 1.10 | 1.00 / 1.20 |
| 250 / F_clear | 1.60 / 1.90 | 1.30 / 2.20 | 1.35 / 1.60 | 1.50 / 1.90 |

No 27/250 shape recorded a long task; maximum shape rAF gap ~16.8 ms.

### Nodes and mutations per shape (same unique nodes before and candidate)

Unique changed nodes count MutationObserver targets and directly added/removed
nodes **inside the library**, not every descendant of a detached subtree. The
count label outside the library is excluded. Document DOM count counts attached
elements, not detached cached cards. Mutation records include the page and count
label; records are not a count of unique nodes or paint operations.

| N / shape | Candidates inspected | Matched cards checked | Unique changed nodes | Mutation records before → C1 | Attached document elements before → after |
|---|---|---|---|---|---|
| 27 / A_all | 27 | 27 | 0 | 0 → 0 | 480 → 480 |
| 27 / B_almost_all | 27 | 25 | 3 | 3 → 3 | 480 → 466 |
| 27 / C_half | 27 | 13 | 15 | 15 → 15 | 480 → 382 |
| 27 / D_few | 27 | 3 | 25 | 25 → 25 | 480 → 312 |
| 27 / E_zero | 27 | 0 | 29 | 2 → 2 | 480 → 292 |
| 27 / F_clear | 27 | 27 | 25 | 25 → 2 | 312 → 480 |
| 250 / A_all | 250 | 250 | 0 | 0 → 0 | 2122 → 2122 |
| 250 / B_almost_all | 250 | 237 | 14 | 14 → 14 | 2122 → 2031 |
| 250 / C_half | 250 | 125 | 126 | 126 → 126 | 2122 → 1247 |
| 250 / D_few | 250 | 3 | 248 | 248 → 248 | 2122 → 393 |
| 250 / E_zero | 250 | 0 | 252 | 2 → 2 | 2122 → 373 |
| 250 / F_clear | 250 | 250 | 248 | 248 → 2 | 393 → 2122 |
| 1500 / A_all | 1500 | 1500 | 0 | 0 → 0 | 11214 → 11214 |
| 1500 / B_almost_all | 1500 | 1425 | 76 | 76 → 76 | 11214 → 10689 |
| 1500 / C_half | 1500 | 750 | 751 | 751 → 751 | 11214 → 5964 |
| 1500 / D_few | 1500 | 3 | 1498 | 1498 → 1498 | 11214 → 735 |
| 1500 / E_zero | 1500 | 0 | 1502 | 2 → 2 | 11214 → 715 |
| 1500 / F_clear | 1500 | 1500 | 1498 | 1498 → 2 | 735 → 11214 |

### HTTP refresh gains remain intact

| N | Before | Candidate 1 | Candidate 2 | Restored |
|---|---|---|---|---|
| 27 | 0.15 | 0.10 | 0.20 | 0.20 |
| 250 | 0.60 | 0.65 | 0.60 | 0.60 |
| 1500 | 2.55 | 2.55 | 2.70 | 2.50 |

## 12. Memory tradeoff

No new production cache retained. Existing Map remains bounded by authoritative
drawing IDs, including detached filtered cards. Attached full DOM remains
480 / 2,122 / 11,214 elements for 27 / 250 / 1,500. Detached cards intentionally
remain reusable. No claim of reduced heap usage; heap bytes were not profiled.
The rejected temporary batch used an O(number-of-insertions) local reference
array, not a persistent cache. Fewer calls did not mean fewer DOM nodes.

## 13. Correctness and verification

**173/173 PASS: 50 JavaScript + 106 Python + 17 E2E**, zero failures/skips.
Full command exited 0; E2E duration 187.36 seconds. Syntax checks passed for
34 JS/CJS/MJS and 17 Python files; git diff --check passed. No configured lint,
type-check, or production-build command was invented or added.
No correctness tests changed in this phase;
no new production cache/invalidation contract was introduced. Existing E2E
coverage includes search/clear, favorite/archive folders, active-page filter,
mutation→refresh, image/focus reuse, current preview target, and selected/live
page separation. Added opt-in benchmark assertions compare result count and
ordered image paths against deterministic expected results and reject page errors.
All benchmark servers reported health 200. These are isolated servers, not a
claim about the exhibition service on port 8000.

## 14–15. Stop point and closure

**Do not close the 1,500-item search hotspot as fixed.** PERF-B1 card-reuse gains
remain valid; PERF-B1.1 investigation is complete with a rejected micro-optimization.
Restored sequence: ~23.85 ms median JS, 4 long tasks (max 61 ms), rAF max 66.6 ms.
Restored F: ~25.65 ms median / 37.70 ms worst JS, rAF max 66.7 ms, 11,214 attached
elements when all results return. Normal 27/250 workloads remain responsive.

If eliminating stress-library jank is required, a separately approved windowed
grid is justified for investigation, not automatically approved implementation:
keep full ordered filtered IDs, render visible rows plus a small overscan window,
retain existing actions/permission logic, and size top/bottom spacers. Must handle
2/3-column responsive breakpoints and variable heights (favorite download links,
wrapped labels). Preserve/reset scroll according to existing behavior, maintain
stable focused item and keyboard access when it leaves the window, supply total
result semantics to assistive technology, and verify filter changes do not lose
selection or trigger the live page. Browser find-in-page and offscreen DOM access
need explicit UX decisions. This is materially more complex than the present
renderer; no virtualization or debounce has been implemented here.

## 16–17. Diff and commands

Tracked diff is pre-existing PERF-B1 work, preserved after reverting the candidate:

```
 frontend/control/app.js | 64 +++++++++++++++++++++++++++++++++++----
 tests/browser/smoke.cjs | 79 +++++++++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 138 insertions(+), 5 deletions(-)
```

This phase changes only opt-in benchmark tooling/documentation under the already
untracked benchmarks directory: browser.mjs, performance.py, README.md, and this
new report. git diff --stat does not count untracked files. No commit made.
Final git diff --check: **PASS**. Separate whitespace checks also cover the
untracked benchmark files, which ordinary git diff does not inspect.

Commands executed (repo root):

```sh
PLAYWRIGHT_CHANNEL=chrome caffeinate -di .venv/bin/python benchmarks/performance.py --control-only --search-shapes --profile-library --browser-samples 3
PLAYWRIGHT_CHANNEL=chrome caffeinate -di .venv/bin/python benchmarks/performance.py --control-only --search-shapes
PLAYWRIGHT_CHANNEL=chrome caffeinate -di npm test
git diff --stat
git diff --check
node --check benchmarks/browser.mjs
```

Plain command ran four times (before, two candidates, restored); profile command
ran three completed times (before, candidate, restored). An initial sandboxed
Chrome launch failed with SIGABRT/EPERM; rerun with reviewed execution permission
succeeded. This was environment setup, not an application or test failure.
Raw outputs for this session are /tmp/perfb11-{before,after1,after2,restored}.json
and corresponding profile files; /tmp is ephemeral. Reproduce with the commands
above. Do not treat timing tables as production performance guarantees.
