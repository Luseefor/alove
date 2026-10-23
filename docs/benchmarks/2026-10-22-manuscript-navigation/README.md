# Manuscript navigation and object controls

Issues #54–#57 extend manuscript navigation, figures, tables and recovery evidence.

## Browser evidence

- [Phone outline](outline-390.png), [desktop outline](outline-1440.png).
- Before the layout fix: [phone subfigure editor](subfigures-phone.png),
  [desktop subfigure editor](subfigures-desktop.png). These captures document
  the defect; they do not show the final layout.

The production journeys import multiple files, follow the include outline,
reveal hidden preamble search hits, preserve undo, resize a figure by pointer,
apply placement with explicit package consent, edit one subfigure independently,
merge table rows and retain repeated longtable headers. The final object journey
produces a real PDF through Redis and the constrained Docker worker.

The first phone subfigure capture exposed a clipped Source action and actions
below the scrolling form. The final layout bounds the heading and pins Cancel
and Apply outside the form's scrolling region. Browser assertions cover these
phone bounds and visible actions. Those assertions passed in GitHub CI.

CI run 39856292050 passed build, browser and Docker jobs: 1,053 web unit
tests, 93 standard browser tests with 12 skipped, and 26 real compile browser
tests. All ten recovery corpus outcomes matched their expected results.
The previous local full-suite log was unavailable after the session handoff,
so the complete-suite result recorded here comes from CI.

## Recovery evidence

[Compact real-compiler report](recovery-results.compact.json): three expected
outcomes matched over 15 real compilation jobs. Two focused repairs retain
separate same-file prose; the independent two-file fault remains unresolved.
Verdicts, compiler logs, diagnostics and source fingerprints are unchanged;
repeated file payloads are represented by SHA-256/UTF-8-byte-length records to
avoid copying the same PNG and source text throughout the artifact.

The corpus uses an unchanged pinned public **thesis template**, not a submitted
thesis or representative sample of authors. Original source, image, license,
SHA-256 manifest and exact fault/prose transformations are versioned under
`scripts/benchmarks/fixtures/real-projects/` and `realProjectRecoveryCorpus.ts`.
This is capability evidence, not an executed Overleaf comparison or speed study.

Reproduce against a local web server and worker:

```sh
bun run verify:recovery --corpus real-projects --repeats 1 --output /tmp/real-recovery.json
# Includes the original synthetic refusal/fallback cases as well:
bun run verify:recovery --corpus all --repeats 1 --output /tmp/all-recovery.json
```

The raw report includes file contents. This committed compact artifact replaces
each `files`, `restoredFiles` and `expectedFiles` string map with per-file hashes
and UTF-8 lengths. Its `fullReportSha256` identifies the original raw artifact.
The report records the application revision and hashes of the runner/source
files as they existed during the run, including then-uncommitted fixture work.

Corrected attempts are not counted as successful checks:

- The first local Docker image build lacked an explicit AMD64 build platform;
  the constrained runner refused it before starting LaTeX. Rebuilding with
  `--platform linux/amd64` resolved the image metadata mismatch.
- A missing `\include` filename was an invalid failure fixture: LaTeX can
  continue with a missing-file notice. The final case uses `\incldue`, which
  produces a real undefined-command error, plus separate rendered prose.
- The first browser command lacked its expected headless-shell binary. Local
  checks use an installed Chromium executable through an uncommitted config;
  CI installs the version required by Playwright.
- `selectOption("1")` selected a row labelled 1 instead of the intended option
  with value 1. An explicit `{ value: "1" }` fixes the test. No table-control
  fix, forced click or timeout extension was needed.

Deployment and live provider/two-account validation stay deferred in #42.
