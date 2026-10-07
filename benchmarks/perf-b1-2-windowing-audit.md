# PERF-B1.2 — Control library geometry audit and windowing decision

Date: 2026-10-07. Decision: **NEEDS_UX_DECISION**, at the mandatory V0 stop point.

The audit ran on the existing renderer before any production edit. A fixed-row
prototype was not implemented because measured rows differ by 46 px within the
same result grid. A variable-row implementation also needs a strategy to preserve
native focus and Tab access across offscreen results. These are the conditions
the request explicitly asks us to report before implementation:

> “If not, stop and report the additional complexity before implementation.”

> “If maintaining current keyboard accessibility requires significant architecture, STOP and report before proceeding.”

No production virtualizer was introduced or retained. There is consequently no
virtualized “after” measurement, overscan winner, or new virtualization E2E claim.
The existing PERF-B1 renderer and its reusable card cache remain in place.

## V0 — measured existing geometry

The opt-in audit reuses the existing temporary-storage benchmark and its
temporary servers. It changes favorite/archive metadata only in those temporary
fixtures through existing APIs, before opening Control. Live exhibition storage
and port 8000 are never used. It runs without source interception.

Each 27/250/1,500 fixture has six favorites, three archived drawings (two of them
favorite), four active favorites, and the remaining active nonfavorites. All
active results are still mounted. Two independent audit runs agreed on the
geometry, scroll and focus findings; the second output is compacted rather than
retaining repeated per-card measurements.

| Viewport width | Columns | Library width | Card width | Observed row heights | Row gap |
|---|---|---|---|---|---|
| 1920 px | 2 | 365.00 px | 173.50 px | 342.00 / 296.00 px | 20px |
| 1536 px | 2 | 365.00 px | 173.50 px | 342.00 / 296.00 px | 20px |
| 1200 px | 2 | 315.00 px | 148.50 px | 317.00 / 271.00 px | 20px |
| 1100 px | 2 | 281.00 px | 131.50 px | 300.00 / 254.00 px | 20px |
| 821 px | 2 | 281.00 px | 131.50 px | 300.00 / 254.00 px | 20px |
| 820 px | 3 | 788.00 px | 252.66 / 252.67 px | 421.16 / 375.17 / 421.17 px | 20px |
| 600 px | 3 | 568.00 px | 179.33 px | 347.83 / 301.83 px | 20px |
| 480 px | 2 | 448.00 px | 215.00 px | 383.50 / 337.50 / 337.48 px | 20px |
| 390 px | 2 | 358.00 px | 170.00 px | 338.50 / 292.50 px | 20px |
| 320 px | 2 | 288.00 px | 135.00 px | 303.50 / 257.50 px | 20px |

Column breakpoints are: **2 above 820 px; 3 at 481–820 px; 2 at 480 px and below**.
Additional 1,100 and 1,500 px rules alter the sidebar/card width, so height changes
even when the number of columns stays the same.

The square image follows card width. Metadata plus two action buttons contributes
the remaining height. Measured action sections are **90 px without download**
and **136 px with download**: a conditional 44 px SVG download link plus a 2 px
grid gap causes the **46 px difference**. The favorite heart is absolutely
positioned and does not itself add height. Grid rows stretch shorter cards to
the tallest card in that row; that does not equalize different rows.

Buttons are min-height 44 px with white-space: normal. They were all 44 px in the
tested 320–1,920 px widths, including the current add/move/locked labels. That
observation is not a fixed-height CSS contract: narrower widths, font metrics or
future label changes can wrap more and grow buttons. The existing declaration
grid-auto-rows: max-content explicitly accommodates content-dependent height.

Empty results replace cards with the existing paragraph. At desktop in the
stress fixture, the library shrinks from 464 px tall to 73.5 px for empty text,
and to 348 px for one favorite result. The scroll container is **#library**,
with overflow:auto and flex-constrained height, not the page itself. On mobile
the library panel moves into document flow, but #library still scrolls internally.

Source: [style.css](/Users/a123/cloud_of_strokes/frontend/control/style.css:86),
[renderLibrary](/Users/a123/cloud_of_strokes/frontend/control/app.js:102).

### Existing scroll semantics

There is **no explicit scroll reset or remembered per-query/folder scroll offset**
in the renderer. The browser preserves scrollTop if the new grid is long enough,
otherwise clamps it to the new maximum. The measured stress transition starts at
scrollTop=1,200 px:

| Transition | Before | After | Returning to all |
|---|---|---|---|
| Search all → one favorite | 1,200 | 0 | 0 |
| Search all → zero | 1,200 | 0 | 0 |
| Active → four favorites | 1,200 | 246 (new maximum) | 246 |
| Selected cell change | 1,200 | 1,200 | n/a |
| Selected preview page change | 1,200 | 1,200 | n/a |
| Authoritative HTTP refresh | 1,200 | 1,200 | n/a |

Refresh retained the same grid and geometry. The existing renderer does not
restore the earlier 1,200 px when a short filter is cleared. A future prototype
must reproduce clamping, not introduce automatic “always go to top” or recover
an old query offset silently.

### Existing keyboard/focus behavior

In all three workloads, focusing the first card's heart and scrolling to the
bottom leaves **the identical button connected and focused**, even when it is
far outside the viewport. The audit then focused the last card and pressed
native Tab; focus moved to that card's next enabled action and the browser
scrolled it into view. The current full DOM gives all eligible card buttons and
download links their normal sequential Tab order; no roving tabindex or custom
keyboard collection exists.

The measured collection is a div containing articles, with no explicit
collection role or tabindex on the container. Its result-count span reports
the complete filter result. A virtualizer must retain that complete count and
choose appropriate collection semantics before using positional ARIA. Adding
aria-setsize/aria-posinset blindly to the current markup is not a substitute for
a keyboard strategy.

Simply detaching an offscreen focused row loses the observed focus behavior.
Keeping only the focused row attached in an arbitrary extra location can corrupt
Tab order. Extending one contiguous window from that row to the scrolled viewport
can remount almost the entire 1,500-item collection. Preserving current behavior
requires deliberate focus retention plus boundary navigation; one top spacer,
one contiguous window and one bottom spacer do not resolve this by themselves.

## Concrete choices for the next implementation request

**A — agree to equal-height rows.** Reserve the missing download-action space
on nonfavorite cards, keeping button/link appearance and positions unchanged.
At 1,536 px this means 342 px rows instead of the present 296/342 px mix.
Normal rows gain 46 px of whitespace. In this fixture that adds approximately
34,270 px of logical scroll height (745 short rows × 46 px), about 14.5%.
This is a visible spacing/density change, which the current request excludes.
Once accepted, the row/window math is simple, but focus/Tab still needs handling.

**B — preserve the current visual layout.** Use content-dependent row heights:
measure representative card states after width/font changes, group the full
ordered results into rows, compute row offsets, locate the scroll window from
those offsets, and invalidate heights when favorite/actions/columns change.
If a two-height model cannot be proven for all supported labels/fonts, measure
mounted rows and correct offsets while maintaining scroll anchoring. Preserve a
focused offscreen row as an extra ordered segment and explicitly handle Tab/
Shift+Tab across unmounted boundaries, skipping disabled controls and including
download links. This adds row measurement/offset state, resize invalidation,
scroll anchoring and keyboard-window coordination, rather than a generic library
dependency. It needs dedicated E2E cases before retention.

Recommendation: **B if preserving current spacing and keyboard behavior remains
mandatory; A only if the extra whitespace is accepted.** Neither option has
been implemented as production code here. No speculative claim about speed,
blanking or heap savings is made.

Browser find-in-page currently has the complete mounted card text available,
including offscreen prefixes/action text. Windowing removes that access for
unmounted items. The application's own full-ID search would remain available
across all authoritative drawings, but does not replace arbitrary browser text
find. No recorded requirement or usage evidence establishes whether operators
rely on browser find; this tradeoff must be accepted with the prototype.

## Requested final decision checklist

| Item | Result |
|---|---|
| 1. Virtualization design | Proposed choices A/B above; V0 stop before implementation |
| 2. Row-height model | Measured variable heights, 46 px conditional difference; no safe fixed-row assumption |
| 3. Overscan choice | Not selected; 1/2/4-row trials deferred until a compatible model and focus strategy exist |
| 4. Attached nodes before/after | Existing mixed-fixture counts below; no virtualized after |
| 5. 27 performance | Existing PERF-B1.1 baseline available; no prototype timing |
| 6. 250 performance | Existing PERF-B1.1 baseline available; no prototype timing |
| 7. 1,500 performance | Existing search hotspot remains; no prototype timing |
| 8. Six search shapes | Previously measured A–F; no new after values claimed |
| 9. Long tasks | Last PERF-B1.1 restored sequence: 4 at 1,500; no virtualized run |
| 10. rAF | Last restored 1,500 sequence p95 50 ms / max 66.6 ms; no virtualized run |
| 11. Scroll | Native preserve/clamp semantics measured and documented above |
| 12. Responsive | All three column regimes and width-dependent row heights measured |
| 13. Focus/keyboard | Native focus survives offscreen scroll; Tab accesses later artwork; strategy needed before detaching |
| 14. Accessibility | Full result count required; current article collection has no custom keyboard/ARIA model |
| 15. Find-in-page | Offscreen text access would be reduced; no elaborate workaround added |
| 16. Memory | No new production cache; no virtualized heap comparison |
| 17. Correctness | Full existing suite verification recorded below; no virtualizer-specific tests added without a virtualizer |
| 18. Complexity | Variable height/offsets + resize/scroll anchoring + focus/Tab coordination exceeds the simple fixed-row prototype |
| 19. Recommendation | **NEEDS_UX_DECISION** at explicit V0/keyboard stop conditions |
| 20. git diff --stat | Pre-existing tracked changes preserved; current work affects untracked benchmarks only |
| 21. git diff --check | Verification below |

### Existing attached DOM in mixed geometry fixtures

These are not the all-active PERF-B1.1 fixtures: three drawings are archived,
and four of the remaining drawings have an extra download link. Do not present
them as a before/after reduction.

| Input drawings | Active count / mounted cards | Document elements at all active | Desktop logical scrollHeight |
|---|---|---|---|
| 27 | 24 / 24 | 456 | 3962 px |
| 250 | 247 / 247 | 2100 | 39354 px |
| 1500 | 1497 / 1497 | 11192 | 236854 px |

For the unchanged all-active search/performance baseline, refer to
[PERF-B1.1 measured report](/Users/a123/cloud_of_strokes/benchmarks/perf-b1-1-search.md):
27/250/1,500 attached document elements 480/2,122/11,214; HTTP library refresh
~0.20/0.60/2.50 ms median. Those are prior verified measurements, not fresh
PERF-B1.2 performance runs. Search/page/cell/WebSocket after measurements,
fast-scroll blanking and overscan comparisons are explicitly deferred by the
pre-implementation stop condition, rather than fabricated for a nonexistent
prototype.

## Verification and files

Geometry audit: **PASS** for 27/250/1,500 fixtures, two runs; each temporary server
health 200, no page errors, focused button retained and native Tab assertion
passed. No live server/storage was modified. No production files or correctness
test files were edited in this phase.

Full verification: **173/173 PASS — 50 JavaScript, 106 Python, 17 E2E**,
zero failures/skips. The command exited 0; E2E duration 185.98 seconds.
Syntax checks passed for 34 JS/CJS/MJS and 17 Python files. Tracked and changed
untracked files passed whitespace checks after removing one extra report EOF
blank line. No application behavior was modified to make tests pass.

Changed in this phase:
- benchmarks/browser.mjs: opt-in existing-renderer geometry/scroll/focus audit.
- benchmarks/performance.py: route the audit-only flag; require --control-only.
- benchmarks/README.md: explain invocation and scope.
- benchmarks/perf-b1-2-windowing-audit.md: this decision and evidence.

Tracked diff at turn start and after the audit is unchanged:

```
 frontend/control/app.js | 64 +++++++++++++++++++++++++++++++++++----
 tests/browser/smoke.cjs | 79 +++++++++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 138 insertions(+), 5 deletions(-)
```

Those changes belong to earlier PERF-B1 work. git diff --stat excludes untracked
benchmarks; it must not be described as this phase's application diff.

Commands run from the repo:

```sh
PLAYWRIGHT_CHANNEL=chrome caffeinate -di .venv/bin/python benchmarks/performance.py --control-only --audit-library-geometry
PLAYWRIGHT_CHANNEL=chrome caffeinate -di npm test
node --check benchmarks/browser.mjs
.venv/bin/python -m py_compile benchmarks/performance.py
git diff --stat
git diff --check
```

Audit command ran twice; final compact output is
/tmp/perfb12-geometry-final.json (ephemeral), full-test log
/tmp/perfb12-tests.log. The benchmark itself writes no permanent fixture data.
No framework/dependency, worker, debounce, server pagination, production CSS,
Draw or Ending change was added. PERF-B2 has not started.
