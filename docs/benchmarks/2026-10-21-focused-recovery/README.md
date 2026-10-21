# Focused recovery: preservation checks

Functional run on 2026-10-21, code revision `ae9cb7c`. The exact engine, bounded
diff helper, fixture and runner SHA-256 hashes are in [results.json](results.json),
along with every synthetic source snapshot, trial input hash, runtime identity
and bounded compiler log. This is a local correctness/preservation check, not
an executed Overleaf comparison, latency benchmark or user study.

The application used the real production HTTP API, Redis and a Docker worker on
an Apple Silicon Mac with an amd64 TeX image. All 67 completed jobs used the
same recorded image identity and sandbox policy. The raw data records the full
identity and platform. No compiler responses were mocked.

## Results

Seven unique fixtures, three recovery runs per fixture: **21/21 expected
outcomes**, with no unexpected patch or mismatched tested-source fingerprint.

| Fixture | Expected / observed result | Repeats | Same-file revised prose |
| --- | --- | --- | --- |
| Removed macro | Verified change block | 3/3 | Preserved |
| Typo in an included file | Verified change block | 3/3 | Preserved |
| Wrong input path | Verified change block | 3/3 | Preserved |
| Removed amsmath package | Verified change block | 3/3 | Preserved |
| Independent faults in two files | Unresolved, no patch | 3/3 | Working source untouched |
| Two faults in one file | Verified whole-file fallback | 3/3 | Reversed, explicitly a fallback |
| Compiler engine changed | Incompatible, no trial patch | 3/3 | Working source untouched |

All 12 focused positive runs produced the exact expected file map: the broken
block was restored, separate same-file prose and every other file stayed at
their failed-snapshot contents. All 21 runs left their input snapshots unchanged.
The 15 verified runs included three intentionally destructive whole-file
fallbacks; do not count those as preservation successes.

For each positive fixture, the runner also executed a whole-file restoration
once against the same failed source: **4/4 reference builds compiled, and all
four reversed the separate prose edit**. A fifth reference build covered the
fallback control. These five reference executions are not repeated Overleaf
samples. They measure the old restore-file operation, which can also be
performed manually with history, rather than testing Overleaf Error Assist.

There were 67 actual compile jobs: 45 returned a PDF and 22 failed. Setup builds,
baseline rechecks, failed candidate trials and reference builds are included;
none are filtered out of the raw data.

## Method and limits

The known-good and broken versions were compiled once per fixture. Recovery
then ran three times with a fresh baseline recheck each time. Candidate trials
used the same Docker environment and source settings; the engine-change control
was intentionally refused. The selected patch fingerprint must equal the last
successful trial input. No working document is mutated by this runner; the
browser scenario separately verifies explicit apply, undo, durable reload and
PDF rebuild.

The production browser scenario passed at phone, tablet and desktop widths
in both light and dark themes:

| Width | Light | Dark |
| --- | --- | --- |
| Phone, 390 px | [Screenshot](recovery-390.png) | [Screenshot](recovery-390-dark.png) |
| Tablet, 768 px | [Screenshot](recovery-768.png) | [Screenshot](recovery-768-dark.png) |
| Desktop, 1440 px | [Screenshot](recovery-1440.png) | [Screenshot](recovery-1440-dark.png) |

The screenshots show the tested block and explicit Apply control before the
working source is changed.

Submission pacing is 2,200 ms minimum, below the normal 30-build/minute local
principal quota. The runner also honours a bounded Retry-After response. This
deliberate pacing precludes interpreting its total wall time as product latency.
The final run needed no admission retries. There were no source changes to the
application's admission limits, compiler deadlines or recovery budgets.

The first, unpaced attempt hit HTTP 429 after 30 jobs: nine focused runs matched,
three reported unresolved when baseline submissions were rate-limited, and the
next setup request stopped the run. That incomplete attempt remains in
[admission-limited.json](admission-limited.json); it is excluded from the final
21-run denominator. The pacing correction was made in the verification runner.

The fixtures are small and synthetic. Three repeats of four related positive
cases are not evidence of a population success rate. Adjacent edits may share
a block; multi-file faults can stay unresolved; whole-file fallback can lose
same-file prose; changing the environment is refused. Successful compilation
does not prove scientific correctness, equivalent layout or a minimal cause.
Broader papers, real writers and an actual matched Overleaf/History/Error Assist
study are still needed for comparative speed or reliability claims.

## Reproduce

Start the local production application, Redis and the Docker compile worker,
then run from the repository root:

```sh
bun run verify:recovery --base-url http://127.0.0.1:30130 --repeats 3
```

The runner permits loopback targets only. It writes to ignored
`benchmark-results/focused-recovery.json` by default. Fixtures and positive /
negative controls are in `scripts/benchmarks/focusedRecoveryCorpus.ts`; the
corpus integrity checks run with `bun test ./scripts/benchmarks/*.test.ts`.
Docker CI runs one repeat of the full corpus after its real browser scenarios.

See the [capability comparison](../../overleaf-comparison.md) for what this
establishes relative to the documented Overleaf workflow and what it leaves open.
