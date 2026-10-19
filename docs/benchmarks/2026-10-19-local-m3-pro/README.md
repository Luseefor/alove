# Local recovery and performance measurements

Measured application revision: `5316c09acd83c127b055d8256d24e2c73fac95c0`. One Apple M3 Pro
Mac, 11 logical CPUs, 18 GiB RAM,
Docker Desktop 28.3.2 with 11 virtual CPUs / about 7.65 GiB VM memory, and an
**amd64 TeX image on an arm64 host (emulation)**. Bun 1.4.3,
Chromium 147.0.7727.15. The compiler run covered 2026-10-19T19:11:11.762Z through
2026-10-19T19:14:00.934Z, using the existing production preview, Redis and one worker.

This is a synthetic, single-machine baseline, **not an Overleaf comparison**,
a production capacity guarantee, or a representative sample of researchers' papers.

## Recovery correctness

- 20 unique fixtures, three recovery repeats each: **60/60 strict expected outcomes**.
- 15 recoverable fixture types: **45/45 verified runs**, correct expected file, with unrelated-file preservation.
- Two unresolved controls: 6/6 remained unresolved (independent faults; culprit beyond candidate budget).
- Three incompatible controls: 9/9 were refused (engine change, root change, malformed binary encoding).
- Unexpected verified paths: **0**. Lost unrelated edits in explicit preservation checks: **0**.
- Source/compile evidence: all 20 good baselines compiled; all 20 faulty snapshots failed. No fixture errors.
- Complete job metadata: 206/206. All 153 ready jobs returned nonempty PDFs;
  49 LaTeX failures, 3 timeouts and 1 validation failure returned no PDF.

Successful recovery (including rechecking the good baseline): **median
1.450 s, p95 2.168 s**, n=45;
range 1.429–2.512 s.
These are 15 related fixture types repeated three times, not 45 independent real-world documents.
Timing starts inside the recovery engine and includes its real HTTP/Redis/worker/polling
trials; it excludes the original good/failed setup builds, UI rendering and history storage.
Restoring a whole file can reverse other edits in that same file. Preservation concerns other files.

## Compiler latency by workload

API latency includes serialization, HTTP enqueue, Redis wait, real Docker compilation,
cleanup and the application's 350 ms polling. Worker time is the BullMQ job duration,
not isolated TeX CPU time. Figures are milliseconds; n is shown for every workload.

| Workload | n | API median ms | API p95 ms | Worker median ms | Queue median ms |
|---|---:|---:|---:|---:|---:|
| engine/pdflatex | 5 | 713.93 | 726.50 | 592.00 | <0.1 |
| engine/lualatex | 5 | 1438.04 | 1443.18 | 1093.00 | 1.00 |
| engine/xelatex | 5 | 2508.48 | 2513.52 | 2233.00 | 1.00 |
| scale/10-pages | 3 | 729.88 | 1084.91 | 709.00 | <0.1 |
| scale/100-pages | 3 | 1080.05 | 1085.22 | 797.00 | 1.00 |
| deadline | 3 | 1435.30 | 1435.49 | 1293.00 | 1.00 |
| bounded-burst | 12 | 1635.43 | 2521.02 | 515.50 | 867.00 |

The one-page engines use the same synthetic document. Ten/100-page samples are
simple prose, not complex TikZ/bibliography-heavy manuscripts. The one-second
infinite-loop deadline returned through the API at median
1435.30 ms; the worker's median duration
was 1293.00 ms including setup and cleanup.

Three four-job bursts (four clients, one worker) completed 12/12 builds. Measured
batch rates were 109.9, 95.2, 110.4 jobs/min;
median 109.9. This is bounded burst throughput,
not a sustained-load test. Burst queue wait had median
867.00 ms and maximum
1660.00 ms. Uncontended queue medians
were 0–1 ms. The mixed aggregate across all 206 jobs is retained in raw JSON for
audit only; it is deliberately not used as a latency headline.

## Browser processing and history storage

Actual helper modules, synthetic ASCII payloads in isolated Chromium. No compilation
in this phase. Timer resolution is approximately 0.1 ms; smaller values are shown
as <0.1, not zero processing cost. Hash/diff: n=100 at 10/100 KiB, n=20 at 1/10 MiB.
The first save includes database creation. Later-save median uses all four later
samples, including growing-history serialization and retention. n=5 for list.

| Source bytes | Hash median / p95 ms | Diff median ms | First save ms | Later saves median ms (n=4) | List median ms |
|---:|---:|---:|---:|---:|---:|
| 10,240 | <0.1 / 0.10 | <0.1 | 1.70 | 0.30 | 0.20 |
| 102,400 | 0.10 / 0.20 | <0.1 | 3.40 | 0.65 | 0.40 |
| 1,048,576 | 1.55 / 1.70 | 0.20 | 5.40 | 7.05 | 3.40 |
| 10,485,760 | 14.85 / 15.80 | 0.20 | 26.10 | 82.70 | 35.70 |

The 10 MiB write/list costs are a useful optimization target: history operations
clone and serialize growing source snapshots. The read/write sample is small and
includes retention; do not interpret it as a pure storage-device benchmark.

## Editor responsiveness

Actual CodeMirror UI, project import followed by 20 keys per size, at least 40 ms
between keys. Capture-keydown to next animation-frame callback is a proxy; it is
**not INP, actual paint completion, or a burst-typing stress test**. Editing and
autosave remain enabled. Preparation import uses the application UI, with a
21-byte start marker in addition to the target text size.

| Actual source bytes | n | Key-to-next-frame median ms | p95 ms | Import preparation ms |
|---:|---:|---:|---:|---:|
| 10,261 | 20 | 6.30 | 8.60 | 105.53 |
| 102,421 | 20 | 6.85 | 8.20 | 90.64 |
| 1,048,597 | 20 | 14.55 | 16.40 | 153.44 |

## Resource accounting

Streaming Docker statistics were collected only in a separate 500-page profiling
phase (three builds). The 10 observations saw at most 48.91 MiB container memory;
this is **a sampled value, not a true peak or deployment memory requirement**.
CPU readings were near zero for these short emulated jobs and are not adequate
for a CPU-utilization claim. A separate `time -v` profiling artifact, if present,
records process accounting and must not be mixed with API latency measurements.


Separate 500-page direct Docker profiles (`tex-resources.json`), three per engine:

| Engine | n | Docker wall median ms | User CPU median s | System CPU median s | Largest recorded max RSS MiB |
|---|---:|---:|---:|---:|---:|
| pdflatex | 3 | 1128.16 | 0.76 | 0.07 | 34.04 |
| lualatex | 3 | 2414.52 | 1.88 | 0.12 | 132.61 |
| xelatex | 3 | 2758.41 | 2.21 | 0.26 | 178.71 |

BusyBox `time -v` accounts for the timed process and descendants; max RSS is not
the simultaneous sum across processes, container peak, Docker VM size or deployment RAM.
Emulation can distort CPU accounting. These are different documents/instrumentation
from the one-page API measurements above.

## Method and limits

All jobs create fresh working directories/containers. Docker, the image, filesystem
and OS caches were already warm; no cache reset or machine reboot was performed.
The first observed API sample was about 715 ms **after calibration**, so it is not
a true cold start. The fixed-order repeat counts are small: nearest-rank p95 for
n=3 or n=5 is their maximum. There are no confidence intervals or claims of
population-wide performance. Ordinary background machine activity was not controlled.

The first compiler attempt overlapped browser profiling and was stopped. Its
incomplete raw file is retained as `preliminary-overlap.json` and excluded from all
final figures. An initial large contenteditable-fill preparation timed out at
30 seconds; its exact input size was not logged. Browser preparation was changed
to real project import and the complete isolated run then passed. This is not
reported as a compiler failure or proof that importing large source fails.
Calibration is retained separately and not pooled into final timing samples.

The corpus intentionally covers 15 single-file recoveries, including a bibliography
fixture with a truncated entry and an undefined command in its title. It is not
randomized, and most candidate paths rank early. Multiple-fault and budget failures
are explicit limits rather than hidden successes. No native-arm64/native-Linux,
remote-network, multi-user auth, sustained-load, or Overleaf experiment was run.
The measurements do not close the container-isolation/ownership/quota release gates.

## Reproduce and inspect

See [benchmark commands](../../../scripts/benchmarks/README.md).
Raw final data: [API/recovery](recovery.json), [browser](browser.json),
[calibration](calibration.json), [direct resource profiles](tex-resources.json), [excluded preliminary attempt](preliminary-overlap.json).
Derived [summary JSON](summary.json), [latency CSV](latency.csv) and [per-case CSV](cases.csv)
are regenerated by `bun run bench:report <this-directory>`.

[Exportable latency figure](latency.png) · [Vector figure](latency.svg).
