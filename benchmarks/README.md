# Performance baseline — opt-in, isolated

These measurements are **not correctness tests or performance gates**. They
do not change application source, algorithms, timing, caching, or persistence.
No new dependencies are required: use the existing Python environment and
Playwright installation.

From the repository root, with Google Chrome installed:

```sh
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py
```

Backend only, or a shorter exploratory run:

```sh
.venv/bin/python benchmarks/performance.py --backend-only
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --samples 15 --browser-samples 5
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --profile-library
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --repeat-search
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --search-shapes
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --search-shapes --profile-library --browser-samples 3
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --audit-library-geometry
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --capture-control /tmp/control-review
```

The default run takes several minutes. It runs sequentially and prints progress
to stderr and one `PERFORMANCE_RESULT` JSON object to stdout. Keep that output
outside the repository if needed; no result files are written automatically.

`--capture-control` optionally writes desktop/mobile review PNGs after timings.
It uses a separate uninstrumented context on the 250-artwork temporary fixture;
its favorite/preview selection never touches exhibition data. See
[control-redesign.md](control-redesign.md) for the UI1–UI6 verification ledger.

`--control-only` reuses the exact same fixtures, operations, sample counts and
passive Control check while skipping unrelated backend, Draw, asset and Ending
measurements. This is the PERF-B1 before/after command. `--profile-library`
additionally times the library filter/sort/membership stages and native DOM
calls, and records Chrome layout/style/GC traces. Those extra hooks add overhead;
do not compare their timings directly with runs without this flag. Call-count
entries use the existing stats shape but represent counts, not milliseconds.
Tracing covers the complete Control operation sequence, not the library alone.
`--repeat-search` adds a separately labelled warm-search observation after the
unchanged primary cases/trace and network settling; it is a diagnostic, not a
replacement for the original search result.

`--search-shapes` requires `--control-only`. It opts into hex ID markers for
deterministic all / 95% / half / three / zero / clear-query cases; default IDs
and fixtures are unchanged. It records each observation's attached DOM size,
candidate count, changed library nodes, mutations, render time, long tasks and
rAF intervals, and checks count/order plus browser errors. Profile mode adds
per-shape layout/style/GC tracing. Counts and unique changed nodes are not the
same as native DOM-call counts. See [perf-b1-1-search.md](perf-b1-1-search.md)
for measurement limitations, the reverted batching trial, and the stop point
before any separately approved virtualization work.

`--audit-library-geometry` requires `--control-only` and exits each workload
after auditing the existing library. On its temporary server it creates a
deterministic mix of favorites and archived items through existing APIs, then
measures the 2/3-column breakpoints, actual row/card/action heights, existing
scroll transitions and focus/Tab behavior. It runs without source interception
or a production virtualizer. See [perf-b1-2-windowing-audit.md](perf-b1-2-windowing-audit.md)
for the mandatory V0 stop condition and concrete options requiring a UX decision.

On macOS, keep the host awake for measurements (without changing system settings):

```sh
PLAYWRIGHT_CHANNEL=chrome caffeinate -di .venv/bin/python benchmarks/performance.py --control-only
```

See [perf-b1-control.md](perf-b1-control.md) for the scoped Control optimization,
correctness checks, repeat measurements, and remaining limitations.
This prevents idle sleep only while the command runs; it does not override lid
closure or explicit sleep. Keep the laptop open during timing-sensitive runs.

## Isolation and measurement

- `performance.py` sets `CLOUD_STORAGE_DIR` **before importing the app**, builds
  deterministic 27/250/1,500-artwork fixtures under `TemporaryDirectory`, and
  removes them on exit. It never reads or writes the exhibition storage.
- Browser tests start their own servers on OS-selected ports; they never use
  port 8000 or depend on the currently running exhibition server. Their own
  servers and browser contexts are closed after measurement.
- Backend wrappers delegate to the original functions. `fsync` and atomic
  replacement are real. No fault injection or disabled durability is used.
- Browser function timers are appended to **intercepted responses only**;
  repository files are not rewritten. This turns off HTTP cache in those
  contexts. Cold/warm asset probes and the independent Control check use
  separate contexts without source interception.
- Independent Control observation uses only native long-task/resource/rAF
  collection, without function wrappers, DOM observers, or source hooks.
- Normal browser fixtures are paused through the existing setting to isolate
  refresh operations. Backend tests separately measure actual running,
  no-due/all-due carousel logic. Existing Ending loading concurrency is unchanged.
- ResourceTiming buffer capacity is explicitly increased so large Ending asset
  loads are not truncated at the browser's default 250 entries.

Default samples: 30 backend observations (after three warmups where applicable),
8 Control/asset observations, 5 gestures per Draw case, 22 Draw micro observations
(25 minus three warmups), 8 Ending micro observations (10 minus two warmups),
and 3 complete Ending preparations plus a real playback per artwork count.
Percentiles use nearest rank. With 3/5/8 samples, p95 is simply the maximum;
these are exploratory tails, not statistically stable percentile estimates.

Native browser long tasks use the standard 50 ms definition, not an invented
application budget. rAF intervals/gaps are scheduling proxies, **not** physical
GPU/compositor dropped-frame measurements. The reported gap count compares
intervals with 1.5× that recording's median; this can hide a consistently slow
cadence, so always inspect the actual median/p95/max intervals too.

Function timings measure synchronous JavaScript/DOM work, not completed paint.
Control action wall time includes automation, network, and two rAF waits;
initial wall time additionally includes authentication and `networkidle`'s
settling wait. `Response.json` timing includes waiting for the body, not just
CPU parsing. Async per-asset durations overlap and must not be summed to obtain
overall Ending ready time. Zero Chrome timings mean below timer resolution.

Draw inputs are deterministic synthetic Pointer Events, in coalesced groups of
up to 32 points with one rAF wait per group. Gesture duration is therefore not
hardware input latency. DPR 3 does not simulate an iPhone CPU, Safari, physical
touch sampling, memory pressure, or LED output.

See [baseline-2026-10-07.md](baseline-2026-10-07.md) for the measured baseline,
classifications, evidence, and recommended next investigation order.
