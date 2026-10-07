# Ending E0 — pipeline map and profiling

Scope: map/profile only. No production optimization or UI work. Control UI1–UI6
is frozen. Fixtures and API writes must use temporary storage/ephemeral servers,
never the exhibition server on port 8000.

## Actual order and ownership

```text
Control: POST prepare (authenticated, idempotent request ID)
  → backend validates mask/seed/assets; snapshots live-page queue membership
  → Store copies, persists revision/state; broadcasts state_changed
  → Display fetches full /api/state (WebSocket is a notification, not asset data)
  → EndingPresentation.update detects a new session ID
  → compose targets synchronously BEFORE loading assets
  → six async workers loadArtwork; yield after each artwork
      v1: JSON → vector paint
      v2: JSON → SVG blob → Image.decode → master paint
      both: 280² alpha readback/bounds → material → 160² texture
  → Preview.prepare: planMotion → fixed-step simulateCloud → first draw
  → local ready → POST ready ACK → backend aggregate ready_displays
  → operator explicitly Start; server start_time = now + 2 seconds
  → synchronized 20-second playback; Reset cancels and clears
```

| Stage / responsible files | Sync/async; requests and concurrency | Bytes/cache/repetition | CPU/blocking |
|---|---|---|---|
| `control/ending.js`, `backend/app/ending.py`, `main.py`: prepare | One authenticated POST; Store commit/persist | Full-state response, metadata not vectors; durable snapshot of all nondeleted queue members, not only 27 active drawings | Validation, existence checks, deepcopy, serialization and persistence; backend request latency differs from pure prepare timing |
| `shared/api.js`, `display/app.js`: receive state | HTTP refresh following WS notification; refresh coalescing and 20-second reconciliation | Full state on each refresh; same session does not reload assets while loading/ready | State parse/update; server_time offset retained |
| `ending/session.js`, `composition.js`: targets/list | Synchronous compose once per session attempt; drawings already in snapshot | No asset request; seeded placement | Bounded mask selection and pairwise separation; runs before asset workers |
| `ending/assets.js`: v1 | JSON fetch/body then vector paint | One request per legacy drawing; HTTP cache may hit; no Ending texture cache | Paint, then common raster processing |
| `ending/assets.js`: v2 | JSON fetch/body THEN SVG fetch/blob/text/decode; six artwork workers, not twelve independent fetch workers | Two requests; JSON determines v2 branch, SVG master supplies geometry/alpha and graphite marker. SVG endpoint explicitly `no-store`; vector has no explicit cache directive | Decode is async elapsed time, not pure CPU; SVG paint preserves master shape/material |
| Common artwork conversion | Per artwork, sync portions on browser main thread | 280² mask → alpha bounds → material → retained 160² canvas. Repeated every Prepare/reset or failed retry | Readback, 78,400-pixel alpha scan, material paint and resize; no per-artwork Web Worker |
| `ending/preview.js`, `motion.js`, `flow.js`: plan | Synchronous once, after all assets | Precomputed trajectories reused during playback | Fixed 30Hz simulation through completion; can create a long task at 1,500, not dominant prior wall time |
| Local ready → server ready | Callback then asynchronous POST; heartbeat every 15s, expiry 45s | Only ready client IDs/timestamps, not connected/loading/missing registry or loaded counts | ACK request/broadcast and observation delay; local ready and server ready are distinct |
| Start/playback | Explicit authenticated POST; absolute server time, rAF playback | No fresh artwork loads needed | Evaluates precomputed trajectories; equations/timing unchanged |
| Reset/retry | Abort on clear; generation prevents stale completion; deadline 40s, retry gate 5s on next update | Partial loaded map discarded. Normal LED scene has its own bounded 81-entry promise cache, incompatible 110px mask versus Ending 280px/160px textures | Cleans timers, animation and observer; no persistent Ending asset cache |

## Existing behavior and limits

- Prepare already preloads before Start. Do not introduce a second preload flow.
- Normal Display and Ending use independent caches/render resolutions. Sharing
  LED textures directly would not prove equivalent alpha, bounds or material.
- Neither v2 SVG removal nor JSON removal has a fidelity/equivalence proof.
- Live readiness means **at least one** fresh ready ACK; the API cannot establish
  that every required Display is connected/ready. Do not label it “all ready”.
- Live pause/resume is not supported by the persisted protocol; those actions
  exist for local rehearsal. Do not imply live pause in a UI-only redesign.
- Warm browser cache does not mean decoded texture reuse. Reset creates a new
  Ending ID and all textures/planning repeat; same-ID reconciliation does not.
- Representative fixtures: 20% legacy v1, 80% Mono v2, three 64-point strokes,
  4,096-point mask. Graphite, eraser-heavy art, complex SVGs, Safari/mobile, remote
  networks and multiple Display contention are not performance-certified here.

## Measurement method — 2026-10-07

Reused `performance.py` / `browser.mjs`; no new dependency or production hook.
Command:

```sh
caffeinate -di .venv/bin/python benchmarks/performance.py --ending-only > /tmp/ending-e0-profile.log 2>&1
```

macOS 15.5 arm64, Python 3.14.7, FastAPI 0.141.1, Chrome 154.0.8037.98,
Node 26.8.2, headless, viewport 1536×768. Tests/benchmark run sequentially.
Thirty backend samples, eight cold/warm single-artwork samples, three complete
prepare sessions **per cache context and workload**, actual 20-second playback
and reset for each context (18 prepares, six playback runs). Three temporary
server health checks returned 200; browser error lists empty.

Two distinct contexts, not a before/after optimization comparison:

1. **Profiled**: response-only wrappers plus alpha/material/resize timers;
   Playwright routing disables HTTP cache. The exact-anchor checks fail rather
   than silently profiling a changed pipeline. Original operations stay intact.
2. **Native HTTP cache**: no routing/interception. Class prototype decorators
   delegate to originals, allowing the same readiness/playback checks without
   turning cache off. First prepare follows normal LED's 27 active assets;
   subsequent two are reset/reprepare in the same context. Cold filesystem and
   cold GPU are not claimed. Native context has no asset-function concurrency
   hook: its zero worker-call entries mean **unmeasured**, not no workers.

Readiness wall time starts before POST prepare and ends after a successful state
probe sees ready_displays plus two rAF waits. It includes API commit/response,
state notification/fetch, loading/planning, ACK, polling and paint observation.
It is not the precise backend ACK-arrival timestamp. Browser resource totals
exclude the operator's Playwright APIRequestContext POST/response; these are
Display-side totals. Decode/body read durations include async waits, not pure
CPU. ResourceTiming transfer includes estimated HTTP overhead. A zero-transfer
entry suggests a cache hit; independent CDP probes corroborate actual hits.
No arbitrary timing gate. With n=3, p95 equals max, not a stable tail estimate.

## Operator-ready latency and requests

All latency values below are milliseconds; MB uses decimal units.

| Artworks | Pure backend prepare median (30) | Profiled ready median / max (3) | Native-cache ready median / max (3) | Vector / SVG requests per prepare | Display API request count |
|---:|---:|---:|---:|---:|---:|
| 27 | 2.81 | 225.28 / 241.31 | 221.58 / 239.16 | 27 / 21 | 52 |
| 250 | 6.18 | 1208.05 / 1290.45 | 1291.59 / 1310.16 | 250 / 200 | 454 |
| 1500 | 25.89 | 8701.06 / 9108.37 | 7756.93 / 8674.50 | 1500 / 1200 | 2703–2705 |

Backend prepared-state serialization medians: 0.81 / 1.83 / 9.07 ms. These
separate micro timings do not include endpoint persistence or HTTP delivery.
Previous baseline 7197.94 ms median / 11232.25 ms max used routed instrumentation;
new stage timers/environment add overhead. No production change occurred, so
differences are **not** an optimization improvement or application regression.

| Artworks | Profiled vector transfer B | Profiled SVG transfer B | Profiled Display API transfer B | Native first prepare API transfer B | Native reset repeats API transfer B |
|---:|---:|---:|---:|---:|---:|
| 27 | 114791 | 141131 | 423872–423874 | 423878 | 309082 / 309085 |
| 250 | 1068824 | 1346037 | 3049233–3049234 | 2933304 | 1980413 / 1980413 |
| 1500 | 6413800 | 8073692 | 17321147–20154494 | 18621928 | 13740701 / 12439954 |

SVG counts equal current v2 count; legacy SVG files exist but are not fetched.
Total uncompressed asset bodies actually requested: 241522 / 2279861 /
13677492 B (not every SVG in fixture storage). State refresh/ACK accounts for
the remaining API bytes and request-count variation. Backend protocol stays
unchanged; repeated state URL entries are not duplicate artwork requests.

**Zero duplicate asset URL entries within each prepare**, checked across both
contexts. Nonetheless reset/reprepare repeats all asset processing and all
1,200 SVG network requests at stress size. HTTP cached vector entries still
appear in resource counts; do not label every resource entry a network request.

Native vector zero-transfer counts per preparation:

- 27: 0 / 27 / 27.
- 250: 27 / 250 / 250.
- 1500: 27 / 1500 / 1473 (27 were fetched again; cache is not guaranteed).

Native SVG zero-transfer entries: **zero in every preparation**. Endpoint
`Cache-Control: no-store` and independent CDP probes confirm repeated network
delivery. Warm cache saves bytes, but does not consistently reduce full ready
latency: native 250 repeats 1271.10 / 1291.59 ms versus first 1310.16 ms;
native 1500 repeats 7735.60 / 8674.50 ms versus first 7756.93 ms.

## Stage costs and concurrency

Profiled actual prepares, each row lists three runs in order:

| Artworks | compose sync ms | Asset-worker span ms | Preview.prepare sync ms (includes plan/first draw) | Session.prepare wall ms | Max simultaneous artwork loads | Async slot utilization |
|---:|---|---|---|---|---:|---|
| 27 | 5.1 / 2.4 / 9.6 | 105.4 / 117.2 / 123.0 | 12.3 / 6.7 / 7.0 | 123.8 / 126.8 / 140.3 | 6 | 85.7% / 86.1% / 87.1% |
| 250 | 10.7 / 10.7 / 18.5 | 961.3 / 993.1 / 1048.2 | 41.9 / 27.8 / 46.2 | 1014.8 / 1032.1 / 1113.9 | 6 | 91.0% / 90.6% / 90.4% |
| 1500 | 40.8 / 46.3 / 58.1 | 6535.9 / 7733.1 / 8212.3 | 171.6 / 148.3 / 156.3 | 6749.3 / 7928.9 / 8427.5 | 6 | 90.4% / 90.3% / 89.7% |

Utilization = summed overlapping artwork-call elapsed times / (six × span).
It includes network/decode/main-thread waits, **not CPU utilization**. Span
includes queue scheduling/yields. The six slots are already substantially
occupied; no evidence here proves increasing concurrency helps. Workers are
async functions on the main thread, not isolated CPU workers. Do not add their
overlapping durations to claim total wall time or attribute span solely to HTTP.

At 1500, per-artwork profile medians / p95 across the three runs:

| Stage | Calls per prepare | Median ms | p95 ms | Interpretation |
|---|---:|---:|---:|---|
| SVG image.decode | 1200 | 1.3–1.4 | 5.8–6.1 | async wait, not exclusive CPU |
| Mask readback | 1500 | 1.5–1.6 | 4.2–4.3 | synchronous; includes raster/GPU flush costs |
| Alpha bounds scan | 1500 | ~0.1 | ~0.1 | small relative to readback/loading |
| Material paint | 1500 | ~0.1 | ~0.2 | CPU submission, not completed GPU work |
| Texture resize | 1500 | <0.1 | ~0.1 | timer resolution; not free |

Readback repetition is a meaningful part of preparation even with HTTP warm.
Planning/simulation is measurable (native Preview.prepare 183.9 / 147.7 /
153.2 ms at 1500), but far smaller than the 7.1–8.1-second native Session.prepare.
No mask/geometry/color change is justified by these measurements.

## Cold/warm representative artwork probes

Stress fixture; n=8 each; cold = fresh context, warm = immediate repeat in it.
Both still create new textures; OS/filesystem is warm.

| Asset | Cold median / max ms | Warm median / max ms | Cold / warm total transfer B (8 samples) | Warm CDP vector hits / SVG hits |
|---|---:|---:|---:|---:|
| v1 | 8.60 / 10.60 | 4.30 / 6.80 | 27800 / 0 | 8 / not fetched |
| v2 | 12.40 / 18.60 | 7.80 / 9.50 | 89808 / 53904 | 8 / 0 |

V2 cold/warm decode median: 1.80 / 1.30 ms; vector body-read/parse await:
0.35 / 0.30 ms; readback median: 1.95 / 2.15 ms. Small fixture cache hits were
less reliable (v1 warm 3/8; v2 vector 6/8), reinforcing that warm is not a
guarantee. Existing LED promise-cache texture hit was below timer resolution,
versus 3.20 ms median fresh LED texture in the stress probe. This shows reuse
potential, **not** fidelity equivalence with Ending's different raster pipeline.

## Long tasks, frame cadence and playback

| Artworks | Profiled prepare long tasks / max ms (three runs) | Native prepare long tasks / max ms | Prepare rAF median / worst interval ms (profiled; native) |
|---:|---|---|---|
| 27 | 0 / —; 0 / —; 0 / — | 0 / —; 0 / —; 0 / — | 16.7 / 16.8; 16.7 / 16.8 |
| 250 | 0 / —; 0 / —; 0 / — | 0 / —; 0 / —; 0 / — | 16.7 / 33.3; 16.7 / 33.3 |
| 1500 | 1 / 172; 1 / 148; 3 / 156 | 1 / 184; 1 / 148; 3 / 153 | 16.7 / 166.6; 16.7 / 166.7 |

Prepare gaps >1.5× median: profiled 0/0/0 at 27, 0/0/1 at 250,
2/3/3 at 1500; native 0/0/0, 1/0/0, 2/3/3 respectively. Prepare planning
long tasks remain real; extra ~60ms tasks in the last stress sample are not
attributed to a named stage without a trace.

Actual playback: all six runs had **zero long tasks and zero rAF-gap proxies**,
16.7 ms median, 16.7–16.8 ms p95, 16.8 ms max observed rAF interval. Native
draw callback median/p95/max: 27 = 0.2/0.4/0.6 ms; 250 = 0.7/0.9/1.6 ms;
1500 = 4.6/6.1/11.7 ms. Profiled stress draw max reached 17 ms but no long
task. These are main-thread scheduling/submission measurements, not physical
LED/compositor/GPU certification. Do not rewrite playback from this evidence.

## Classification and next decision — no optimization implemented

Primary classification: **MIXED**, dominated by the asset-loading/conversion
pipeline rather than backend prepare or trajectory planning.

- **REQUEST_COUNT + V2_DUAL_PATH:** 2700 asset entries at stress size, sequential
  JSON→SVG within each v2 artwork, with six concurrent artwork slots.
- **CACHE_MISS:** SVG intentionally bypasses HTTP cache. Warm JSON reduces
  transfer, but every artwork still performs raster readback/material/resize.
- **DUPLICATE_LOADING:** not duplicate requests within a prepare; repeated
  decode/texture work across reset/reprepare and separate normal LED/Ending
  pipelines. A failed attempt discards partial work as well.
- **DECODE_COST:** present, but decode awaits alone do not explain the wall time;
  repeated synchronous readback and scheduling also contribute.
- **NETWORK_SERIALIZATION:** serial dependency inside each v2 is proven by
  source. Whole network throughput/remote RTT is not isolated on localhost.
- **CONCURRENCY_LIMIT:** six already; no controlled worker-count comparison,
  so it is not established as the root problem or justification to increase it.

E1 candidate, requiring separate verification: bounded reuse of **the same
Ending-quality** loaded assets/texture results for unchanged drawings across
session attempts. Preserve source identity/material/alpha/bounds, abort and
failed-load semantics, release obsolete references, and prove visual equality.
Do not substitute LED 110px textures for Ending 160px/280px assets. This would
target repeated preparation; it cannot promise a faster first cold prepare.
Only if that measured benefit is insufficient should shared master-source
loading be considered; it must not expand into a renderer/protocol redesign.
Retaining 1500 160×160 RGBA textures represents about 153.6 MB of pixel data
before browser/GPU overhead; reuse must not silently create duplicate canvases
or keep multiple obsolete sessions. This is a lifetime/memory tradeoff, not a
free optimization. No such cache was introduced during E0.

Rejected now: removing JSON/SVG paths without equivalence, changing HTTP headers,
blindly increasing workers, simulation/playback rewrites, unbounded preload,
fake progress percentages or pretending the aggregate ACK is an all-Display
registry. E2 should use honest state-based operator feedback under the existing
protocol unless separately approved richer telemetry is justified.

## Files and verification

Only benchmark support/report files changed by this task:
`benchmarks/browser.mjs`, `benchmarks/performance.py`, `benchmarks/README.md`,
this report. Existing `.gitignore` modification belongs to other work and was
left untouched. No frontend/backend/test/dependency/storage change.

- Benchmark: PASS, 18 prepares + six real playback/reset runs, expected vector
  and SVG counts asserted, no runtime page errors, three isolated health 200s.
- JS/Python harness syntax: PASS.
- Full regression: **177/177 PASS — 50 JavaScript, 106 Python, 21 E2E**,
  zero failures/skips; full runner exit 0. Includes prepare/ready/start/reset,
  local pause/resume, mask validation, offline/reconnect, two-Display real
  playback after SIGKILL/restart and durable snapshot contracts.
- First runner invocation failed at browser setup because the default
  Playwright Chromium executable was absent; core 156/156 passed. Classified
  as environment/missing browser, not a product failure. Reran the entire suite
  with installed Chrome via `PLAYWRIGHT_CHANNEL=chrome`; no dependency install,
  source change, weakened assertion or timeout change.
- Syntax: **34 JS/CJS/MJS + 17 Python files PASS**, including harness files.
- Live server read-only health: **200**, `status=ok`; no exhibition mutation.
- `git diff --check` and new report no-index whitespace check: **PASS**.
- `git diff --exit-code` for frontend/backend/tests/dependencies/run.py: clean;
  product source and contracts match the commit used for this measurement.
- New correctness tests: none, because no product behavior changed. Added only
  diagnostic count/error assertions to the opt-in harness.
- No lint/type checker/bundled build is configured; this remains vanilla modules
  served by FastAPI, not a newly introduced toolchain.

Verification commands (from repository root):

```sh
caffeinate -di .venv/bin/python tests/run_regression.py
PLAYWRIGHT_CHANNEL=chrome caffeinate -di .venv/bin/python tests/run_regression.py
# node --check on every JS/CJS/MJS returned by rg --files frontend tests benchmarks
.venv/bin/python -m compileall -q backend tests benchmarks run.py
curl --fail --silent http://127.0.0.1:8000/api/health
git diff --check
git diff --no-index --check /dev/null benchmarks/ending-e0-profile.md
git diff --exit-code -- frontend backend tests package.json package-lock.json run.py
git diff --stat -- benchmarks
```

Scoped tracked diff stat: README 12 added lines, browser harness 64 touched lines,
Python harness 3 added lines; **73 insertions, 6 deletions** across three tracked
files, plus this new report (untracked files do not appear in ordinary diff stat).
Existing `.gitignore` change is excluded from these task-specific counts.

**E0 stop: do not implement E1 optimization or E2 UI work in this batch.**
