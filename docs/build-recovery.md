# Compile-tested change recovery

Recovery answers: **can restoring one separated change block make this failed
source snapshot compile, while keeping other edits in the same file and changes
in other files?** Whole-file restorations remain an explicit fallback.
It does not claim to find a minimal edit, establish causality, or validate the
scientific meaning or layout of the result. No comparative Overleaf benchmark
has been run.

## Try it locally

1. Run the local web app, Redis and Docker compile worker as described in
   `services/tex-runner/README.md`.
2. Build a working project. Then change files and produce a LaTeX build failure.
3. Open **Build recovery** in the toolbar, or **Find breaking change** beside
   a failed preview. Recovery is also available in the Export menu after reload.
4. Inspect the changed-file comparison. Choose **Test recovery**.
5. If a focused trial succeeds, inspect its proposed change and choose
   **Apply tested change restoration**. Source outside that block survives.
   A whole-file fallback instead offers **Apply tested file restoration** and
   warns that all edits in that file will be reversed. The matching **Undo**
   action reverses that restoration only if the source and
   compiler settings still match the expected state.
6. Rebuild the working project to update its preview.

Applying recovery is currently limited to local projects. Cloud projects can
inspect and export their local evidence, but cloud mutation/version conflict
handling needs a separate implementation. A focused result preserves source
outside its displayed block; adjacent edits within that block are reversed
together. Whole-file fallbacks reverse all edits in that file. Apply is disabled when
working source, root, or compiler settings differ from the tested snapshot.

## Evidence and storage

Each completed, accepted editor build captures the requested files, root,
engine, clean-aux setting, document revision, timestamps, diagnostics, bounded
log and result. SHA-256 covers a canonical array of root, engine, clean-aux and
sorted path/content pairs. A source hash identifies the input, not the PDF.

Records use a separate IndexedDB database and immutable UUID keys. Writes are
acknowledged only after transaction completion. Conflicting writes to an existing
record ID are rejected. Retention is per project: at most 20 records and 50 MiB
of JSON-encoded evidence, retaining the newest record and latest successful
record. Corrupt entries are surfaced rather than silently removed. PDFs are
not duplicated into history; binary source assets may still exist in source
snapshots. Storage errors leave source editing and the current build intact.
Browser storage can be evicted or unavailable; export evidence for durable
external retention.

The worker resolves the configured Docker image tag locally before compiling,
executes that resolved immutable identity, and returns it with its platform.
Recovery requires matching Docker identities/platforms, root, engine and
clean-aux settings across the good build, failure and every new trial. Host
TeX is deliberately considered unverified for this feature. An unavailable
local image must be pulled or built first. HTTPS or localhost is needed for
WebCrypto fingerprinting.

**Export debugging evidence** downloads both source snapshots, their metadata,
logs and the trial report as versioned JSON. Trials include the tested scope,
line and exact source fingerprint; the selected candidate contains the full
repaired file as well as the changed fragments. It contains the full source;
review it before sharing. This is evidence export, not a one-command hermetic
rebuild capsule. Runner policy, kernel resources, timestamps and package
repository state are not fully captured, and byte-for-byte PDF reproducibility
is not promised. The development image's added packages float at image-build
time; recording the resolved image distinguishes different builds of that tag.

## Trial algorithm

1. Require a successful baseline and a subsequent LATEX_ERROR from the same
   project with matching settings and recorded Docker identity.
2. Recompute both source hashes and refuse modified/corrupt evidence.
3. Recompile the successful source from a clean job directory. If it no longer
   builds, stop rather than attribute the failure to a source edit.
4. Order changed files by diagnostic path, then source extension, then path.
5. Split eligible text changes into blocks separated by exact unchanged lines.
   Test up to three focused candidates first, then whole-file fallbacks within
   the same five-candidate limit, reserving at least two slots for file candidates.
   Each focused candidate starts from the failed snapshot and reverses exactly
   one block; source outside it is unchanged. Added/deleted files and binary
   assets use whole-file fallback. Empty files remain distinct from absent files.
6. Accept only a completed successful PDF build in the same recorded runtime.
   Stop on infrastructure failures/timeouts. Report unresolved if no candidate
   succeeds within the budget. Never publish trial PDFs as the working preview.

The baseline plus candidates means at most six queued jobs per invocation.
Each requests a 15-second compiler deadline; the client stops waiting after
60 seconds. **Stop waiting** stops polling and further enqueueing; it does not
cancel a job already in Redis or running in Docker. Its compiler deadline starts
when execution begins. These client limits are not server quotas or public
hosting isolation. Existing C3/C4/C5 release gates remain open.

Focused analysis is bounded to 1,048,576 UTF-16 code units and 10,000 lines per
side, 2,000 residual lines per side and 250,000 LCS cells. Candidate ranking and
the cap run before full repaired strings are created. Oversized changes fall
back to whole-file analysis; the UI reports analysis/candidate limits. These are
line blocks, not a proof of the smallest or causally responsible edit. Multiple
independent faults can remain unresolved, or require a whole-file fallback.

The comparison previews at most 80 changed lines per file, and truncates long
lines for display. Export the full evidence before inspecting larger changes.
Trials are isolated
from the working source. Final apply and undo re-check the exact working map,
project, root and compiler settings synchronously, guarding edits made while
trials were running or between render and click.

## Verification and a future post

Unit regressions cover immutable/transactional storage and retention, source
capture while editing, write failures, trial limits, environment drift, hash
mismatch, cancellation, unrelated-file preservation and guarded apply/undo.
The opt-in browser test uses the real API, Redis, worker and Docker, without
compile mocks:

```sh
E2E_BASE_URL=http://127.0.0.1:30127 E2E_REAL_COMPILE=1 bun run --filter web e2e e2e/build-recovery.spec.ts
```

The original scenario imports a three-file project, builds it, deletes a macro definition, changes
prose in another file, records a real failure, reloads, runs recovery, exports
evidence, applies/undoes/reapplies the restoration, and rebuilds successfully.
The initial run took 38.2 seconds end-to-end, including project setup, initial
builds, trial compilation, export and final rebuild. This is one development
machine/run, not a latency benchmark or superiority claim. A second scenario
breaks a macro while changing separate prose in the same file and another file,
checks that the compiling proposal has not yet changed working source, exports
its fingerprint, applies/undoes/reapplies it, rebuilds and checks durable reload.

Before publishing a claim about outperforming Overleaf, build a public corpus
of at least 20 failures and compare complete recovery tasks using Overleaf's
history and Error Assist. Include removed macros, missing inputs, package
changes, bibliography failures, interacting edits, no-good-baseline cases and
environment drift. Measure time to a compiling document, unrelated edits lost,
false diagnoses, unresolved cases, trials and compute cost. Retain the source,
runtime, settings and raw results for both workflows. Include repeated runs and
actual writers; publish failures as well as successes.

A technical post can explain canonical snapshots, source/result races, runtime
identity, conservative trial search, non-minimality and safe recovery. The next
algorithmic work is dependency-aware candidates and multiple-fault handling,
followed by an exportable executable reproduction bundle. Those capabilities
are not present. Bounded change-block recovery is now implemented; a dated
[Overleaf capability comparison](overleaf-comparison.md) separates its observed
workflow distinction from an unexecuted comparative performance study.

A local synthetic baseline is now available in the
[October 19 performance report](benchmarks/2026-10-19-local-m3-pro/README.md):
20 fixtures, three repeats, 60/60 expected outcomes, successful-recovery median
1.45 seconds. It does not execute the comparative study proposed above or establish
an advantage over Overleaf. Raw data, methods and limits accompany the report.
