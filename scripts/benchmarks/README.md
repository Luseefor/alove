# Local performance and recovery benchmarks

Run against an already-built local production web app and the real Docker worker.
Use the dedicated loopback Redis 6381 described in services/tex-runner/README.md.
These scripts refuse remote URLs and the normal Redis port. The production API
and benchmark queue must point at the same Redis. Keep the worker concurrency at
one. Do not run browser profiling, other compile jobs, or unrelated heavy work
concurrently with compiler latency measurements.

```sh
REDIS_HOST=127.0.0.1 REDIS_PORT=6381 bun run bench:recovery --phase calibrate --repeats 1 --output benchmark-results/calibration.json
REDIS_HOST=127.0.0.1 REDIS_PORT=6381 bun run bench:recovery --phase all --repeats 3 --output benchmark-results/recovery.json
```

Pass the Docker config/context environment that works on your machine. Use
`--base-url http://127.0.0.1:30127` if changing the local production preview.
Other phases: `speed`, `corpus`, `profile`. `--case <id>` selects one corpus case.
Corpus repeats reuse the captured good/failed pair but recompile the baseline
and candidate(s) each time. A full run includes engine repeats, page-size scaling,
real deadlines, three bounded four-job bursts, 20 recovery fixtures and a separate
resource-profiling phase. Results checkpoint after phases/cases/repeats; an
aborted run stays incomplete. Setup errors and unexpected outcomes are retained.

The engine corpus is synthetic and deliberately scoped: 15 expected single-file
recoveries, two unresolved controls (multiple faults and the five-candidate cap),
and three incompatible controls (engine/root changes and invalid binary encoding).
It is a regression/coverage corpus, not a representative survey of real papers.
Whole-file restoration may remove other edits within the restored file. The
preservation checks concern other files and the explicit expected culprit path.

For browser processing/storage and actual CodeMirror keyboard measurements:

```sh
PLAYWRIGHT_BROWSERS_PATH=/path/to/matching/playwright-cache E2E_BASE_URL=http://127.0.0.1:30127 bun run bench:browser
bun run test:benchmarks
```

The browser script bundles the actual helper modules into a fresh Chromium
context, uses separate temporary IndexedDB databases, and deletes those databases
after measurement. Synthetic 10 KiB–10 MiB payloads measure hashing, comparison
and receipt-storage costs; those processing fixtures are not compiled as TeX.
Typing preparation imports a fresh project through the actual UI. A 20-event
sample at each size measures keydown capture to the next animation-frame callback,
with at least a 40 ms gap between events. This is a responsiveness proxy, not
INP, paint completion, or a burst-typing/backpressure test. The first IDB save
includes database creation; later saves include growing history and retention.

## Interpretation

- Each compile uses a fresh working directory and container. The host VM, image
  layers, OS caches and TeX image are already present. The first observed request
  is not a true cold-start measurement. No images/cache/user data are purged.
- API timings include serialization, HTTP enqueue, Redis wait, real worker and
  the application's 350 ms polling. Worker and queue timestamps come from the
  corresponding BullMQ job, read immediately after completion. Missing metadata
  is counted as a measurement error.
- Report latency strata separately (engine, page size, burst, setup, trial and
  deadline). The heterogeneous aggregate is an audit appendix, not a headline.
- Median averages the middle pair; p95 uses nearest rank. Always publish `n`;
  p95 from five samples is simply their maximum and is not a robust tail estimate.
- `matchedRuns` is the strict recovery criterion: expected status, expected file
  for a verification, and preservation. The simpler `outcomes.matched` checks
  status only. Report unexpected verified paths and lost-edit counts explicitly.
- Streaming Docker stats runs only in the profiling phase. CPU percentages are
  Docker's sampling metric (100% is roughly one core); memory samples are not a
  true memory high-water mark. Profiling job timings should not be mixed with
  the uninstrumented latency phase.
- This measures one local machine/session. It does not establish sustained
  server capacity, public-hosting safety, private-cloud latency or an advantage
  over Overleaf. Run the same corpus on private staging after the release gates.

Generate the derived report without dependencies beyond Python's standard library:

```sh
bun run bench:report docs/benchmarks/2026-10-19-local-m3-pro
# Optional exportable charts, isolated Python dependencies:
uv run --with matplotlib python scripts/benchmarks/reportBenchmark.py docs/benchmarks/2026-10-19-local-m3-pro --plots
# Separate 500-page process accounting, not API latency:
bun run bench:resources benchmark-results/tex-resources.json
```

The report expects complete `recovery.json` and `browser.json` files in its target
folder; `tex-resources.json` is optional. The published October 19 baseline and
raw data live in `docs/benchmarks/2026-10-19-local-m3-pro/`.
