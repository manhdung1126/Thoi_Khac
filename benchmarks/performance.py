"""Opt-in performance measurements. All application imports/storage stay temporary.

Run from the repository: .venv/bin/python benchmarks/performance.py
No timing assertions, production instrumentation or correctness-test registration.
"""
import argparse
import copy
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
WORKLOADS = [("small", 27, 1, 0), ("normal", 250, 3, 5), ("stress", 1500, 10, 20)]


def summary(values):
    ordered = sorted(values)
    return {"n": len(values), "median_ms": statistics.median(ordered),
            "p95_ms": ordered[math.ceil(len(ordered) * .95) - 1], "max_ms": ordered[-1]}


def fixture(directory, name, count, pages, snapshots, main, led, search_shapes=False):
    store = main.Store(directory)
    state = copy.deepcopy(store.state)
    state.update(pages=[], drawings=[], snapshots=[], submissions={}, current_page_id="")
    # Freeze test-server carousels only through the existing persisted setting.
    # Backend carousel benchmarks explicitly exercise running states separately.
    state["settings"]["paused"] = True
    vector_bytes = svg_bytes = 0
    for i in range(count):
        drawing_id = f"{i + 1:032x}"
        if search_shapes:
            drawing_id = ("aaaa" if i < int(count * .95) else "ffff") + ("bbbb" if i < count // 2 else "cccc") + ("dddd" if i < 3 else "eeee") + f"{i + 1:020x}"
        material = i % 5 != 0  # 80% current Mono v2, 20% legacy solid v1.
        strokes = []
        for s in range(3):
            points = []
            for p in range(64):
                x = 40 + p * 9.7
                y = 110 + s * 160 + 52 * math.sin(p * .16 + i * .13 + s)
                points.append([round(x, 3), round(y, 3)] + ([.55] if material else []))
            strokes.append({"erase": False, "width": 2, "points": points,
                            **({"material": "mono-v1"} if material else {})})
        vectors = {"version": 2 if material else 1, "profile": "led-2px", "strokes": strokes}
        raw = json.dumps(vectors, separators=(",", ":")).encode()
        svg = led.svg_document(vectors)
        for folder, suffix, data in [("vectors", "json", raw), ("drawings", "svg", svg)]:
            target = directory / folder / f"{drawing_id}.{suffix}"
            target.parent.mkdir(exist_ok=True)
            target.write_bytes(data)
        vector_bytes += len(raw)
        svg_bytes += len(svg)
        state["drawings"].append({"id": drawing_id, "image_path": f"/api/drawings/{drawing_id}",
            "vector_path": f"/api/strokes/{drawing_id}", "created_at": 100 + i * .7,
            "width": 720, "height": 720, "deleted": False, "favorite": False})
        state["submissions"][f"{i + 50000:032x}"] = {"id": drawing_id, "digest": "a" * 64}
    for p in range(pages):
        page = main.create_page(state)
        page["id"] = f"{p + 100000:032x}"
        # Every page contains the same collection, rotated deterministically.
        # Page count and collection size co-vary across these scenarios; this
        # is a workload baseline, not an independent page-count scaling test.
        for i in range(count):
            cell = page["cells"][(i + p) % 27]
            cell["drawing_ids"].append(state["drawings"][i]["id"])
        for cell in page["cells"]:
            cell["active"] = cell["drawing_ids"][-1] if cell["drawing_ids"] else None
            cell["shown_at"] = 100 + cell["id"] * .03 if cell["active"] else None
        led.sync_items(page)
        page["timer_paused_at"] = 105
    state["current_page_id"] = state["pages"][0]["id"]
    # Valid, tiny PNGs; snapshot metadata affects public/Control costs, not LED.
    png, _, _ = main.decode_png(_snapshot_png(main), crop=False)
    for i in range(snapshots):
        snapshot_id = f"{i + 200000:032x}"
        target = directory / "snapshots" / f"{snapshot_id}.png"
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(png)
        state["snapshots"].append({"id": snapshot_id, "name": f"Moment {i + 1}",
            "image_path": f"/api/media/{snapshot_id}.png", "created_at": 100,
            "page_id": state["pages"][min(i + 1, pages - 1)]["id"]})
    store.commit(state)
    mask = {"id": "bench-grid-64", "width": 64, "height": 64, "aspect": 1,
            "points": [[x, y] for y in range(64) for x in range(64)]}
    descriptor = {"name": name, "count": count, "pages": pages, "snapshots": snapshots,
        "queue_min": count // 27, "queue_max": math.ceil(count / 27),
        "points_per_artwork": 192, "v2_count": sum(i % 5 != 0 for i in range(count)),
        "mask_points": len(mask["points"]), "state_bytes": store.path.stat().st_size,
        "vector_bytes": vector_bytes, "svg_bytes": svg_bytes, "storage": str(directory), "mask": mask}
    return store, copy.deepcopy(state), descriptor


def _snapshot_png(main):
    image = main.Image.new("RGBA", (32, 16), "#e7bd00")
    stream = main.io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def backend(store, base, description, count, main, led, ending):
    result = {"fixture": {k: v for k, v in description.items() if k not in ("storage", "mask")}}
    original_copy = copy.deepcopy
    copy_times, totals, derivation = [], [], []
    for _ in range(3):
        store.public()
    def timed_copy(value):
        started = time.perf_counter()
        value = original_copy(value)
        copy_times.append((time.perf_counter() - started) * 1000)
        return value
    with patch.object(main.copy, "deepcopy", timed_copy):
        for _ in range(count):
            started = time.perf_counter()
            store.public()
            elapsed = (time.perf_counter() - started) * 1000
            totals.append(elapsed)
            derivation.append(elapsed - copy_times[-1])
    result["public"] = {"total": summary(totals), "deepcopy": summary(copy_times), "derivation": summary(derivation)}
    parts = {name: [] for name in ("total", "callback", "deepcopy", "timers", "json", "temp_create", "write", "flush", "fsync", "replace")}
    current = {}
    def timed(name, function):
        def invoke(*args, **kwargs):
            started = time.perf_counter()
            try:
                return function(*args, **kwargs)
            finally:
                current[name] = current.get(name, 0) + (time.perf_counter() - started) * 1000
        return invoke
    real_fdopen = main.os.fdopen
    class Stream:
        def __init__(self, stream): self.stream = stream
        def __enter__(self): self.stream.__enter__(); return self
        def __exit__(self, *args): return self.stream.__exit__(*args)
        def write(self, data): return timed("write", self.stream.write)(data)
        def flush(self): return timed("flush", self.stream.flush)()
        def fileno(self): return self.stream.fileno()
    def callback(state): state["pages"][0]["name"] = "Measured page"
    for _ in range(3): store.mutate(callback)
    with ExitStack() as stack:
        for obj, attr, name in [(main.copy, "deepcopy", "deepcopy"), (main, "_update_page_timers", "timers"),
                               (main.json, "dumps", "json"), (main.tempfile, "mkstemp", "temp_create"),
                               (main.os, "fsync", "fsync"), (main.os, "replace", "replace")]:
            stack.enter_context(patch.object(obj, attr, timed(name, getattr(obj, attr))))
        stack.enter_context(patch.object(main.os, "fdopen", lambda *a, **kw: Stream(real_fdopen(*a, **kw))))
        for _ in range(count):
            current.clear()
            started = time.perf_counter()
            store.mutate(timed("callback", callback))
            current["total"] = (time.perf_counter() - started) * 1000
            for name in parts: parts[name].append(current.get(name, 0))
    result["persistence"] = {name: summary(values) for name, values in parts.items()}
    page = original_copy(base["pages"][0])
    carousel = {}
    for name in ["sync_valid", "sync_repair", "advance_all_due", "advance_none_due", "allocate_random_balanced"]:
        elapsed, cpu = [], []
        outcome = None
        for _ in range(count + 3):
            working = original_copy(page)
            if name == "sync_repair": working["cells"][0]["active"] = "missing"
            started, used = time.perf_counter(), time.process_time()
            if name.startswith("sync"): outcome = led.sync_items(working)
            elif name == "advance_all_due": outcome = led.rotate(working, 8, 120)
            elif name == "advance_none_due": outcome = led.rotate(working, 8, 101)
            else: outcome = led.assign(working, "extra-benchmark-drawing")
            elapsed.append((time.perf_counter() - started) * 1000)
            cpu.append((time.process_time() - used) * 1000)
        carousel[name] = {**summary(elapsed[3:]), "cpu_median_ms": statistics.median(cpu[3:]),
                          "writes_disk": False, "revision_delta": 0, "return_value": outcome}
    running = original_copy(base)
    running["settings"]["paused"] = False
    running["pages"][0].pop("timer_paused_at", None)
    for due, now in [(False, 101), (True, 120)]:
        elapsed, deltas, outcomes = [], [], []
        for _ in range(count):
            store.commit(original_copy(running))  # reset outside timed interval, with real persistence
            before = store.state["revision"]
            with patch.object(main.time, "time", return_value=now):
                started = time.perf_counter()
                outcome = store.rotate()
                elapsed.append((time.perf_counter() - started) * 1000)
            deltas.append(store.state["revision"] - before)
            outcomes.append(outcome)
        carousel["store_all_due" if due else "store_none_due"] = {**summary(elapsed),
            "revision_deltas": sorted(set(deltas)), "changed": sorted(set(outcomes))}
    result["carousel"] = carousel
    preparation, serialization = [], []
    for _ in range(count):
        state = original_copy(base)
        started = time.perf_counter()
        ending.prepare(state, {"mask": description["mask"], "seed": "perf-baseline"}, store.directory)
        preparation.append((time.perf_counter() - started) * 1000)
        started = time.perf_counter()
        json.dumps(state, ensure_ascii=False, allow_nan=False).encode()
        serialization.append((time.perf_counter() - started) * 1000)
    result["ending_backend"] = {"prepare": summary(preparation), "prepared_state_serialization": summary(serialization)}
    store.commit(original_copy(base))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--browser-samples", type=int, default=8)
    parser.add_argument("--backend-only", action="store_true")
    parser.add_argument("--control-only", action="store_true", help="Reuse fixtures and only measure the existing Control cases")
    parser.add_argument("--ending-only", action="store_true", help="Profile Ending and native-cache repeats, without Control or Draw")
    parser.add_argument("--profile-library", action="store_true", help="Extra isolated DOM/pipeline/Chrome tracing; not comparable to unprofiled timings")
    parser.add_argument("--repeat-search", action="store_true", help="Add a separately reported warm-search repeat after the unchanged Control cases")
    parser.add_argument("--search-shapes", action="store_true", help="Deterministic six-shape search investigation; use with --control-only")
    parser.add_argument("--audit-library-geometry", action="store_true", help="Measure existing grid geometry/scroll/focus only, on isolated fixtures")
    parser.add_argument("--capture-control", type=Path, help="Capture desktop/mobile Control review images after timings, in this directory")
    args = parser.parse_args()
    if args.ending_only and (args.control_only or args.backend_only): parser.error("--ending-only cannot be combined with --control-only/--backend-only")
    if args.search_shapes and not args.control_only: parser.error("--search-shapes requires --control-only")
    if args.audit_library_geometry and not args.control_only: parser.error("--audit-library-geometry requires --control-only")
    if args.capture_control and not args.control_only: parser.error("--capture-control requires --control-only")
    if args.samples < 5 or args.browser_samples < 3: parser.error("Use at least 5 backend and 3 browser samples.")
    with tempfile.TemporaryDirectory(prefix="cos-performance-") as temporary:
        directory = Path(temporary)
        os.environ["CLOUD_STORAGE_DIR"] = str(directory / "import-only")
        os.environ["CLOUD_ADMIN_PIN"] = "2468"
        from backend.app import main as app_main, led, ending
        results = {"environment": {"platform": platform.platform(), "python": sys.version.split()[0],
            "fastapi": importlib.metadata.version("fastapi"), "pillow": importlib.metadata.version("Pillow"),
            "samples": args.samples, "browser_samples": args.browser_samples}, "backend": []}
        manifest = []
        for name, count, pages, snapshots in WORKLOADS:
            print(f"Measuring backend {name}: {count} artworks", file=sys.stderr, flush=True)
            store, base, description = fixture(directory / name, name, count, pages, snapshots, app_main, led, args.search_shapes)
            if not args.control_only:
                results["backend"].append(backend(store, base, description, args.samples, app_main, led, ending))
            else:
                results["backend"].append({"fixture": {k: v for k, v in description.items() if k not in ("storage", "mask")}})
            manifest.append(description)
        if not args.backend_only:
            path = directory / "manifest.json"
            path.write_text(json.dumps(manifest))
            flags = (["--control-only"] if args.control_only else []) + (["--profile-library"] if args.profile_library else []) + (["--repeat-search"] if args.repeat_search else [])
            if args.ending_only: flags.append("--ending-only")
            if args.search_shapes: flags.append("--search-shapes")
            if args.audit_library_geometry: flags.append("--audit-library-geometry")
            if args.capture_control: flags.extend(["--capture-control", str(args.capture_control.resolve())])
            browser = subprocess.run(["node", str(ROOT / "benchmarks/browser.mjs"), str(path), str(args.browser_samples), *flags],
                cwd=ROOT, text=True, stdout=subprocess.PIPE, check=True)
            results["browser"] = json.loads(browser.stdout)
        print("PERFORMANCE_RESULT " + json.dumps(results, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
