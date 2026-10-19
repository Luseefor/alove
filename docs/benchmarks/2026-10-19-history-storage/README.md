# Browser history copying comparison

Same-session, paired comparison of the actual repository at `eed8107` and the
updated implementation (source hashes in [raw data](comparison.json)). The
comparison bundles both helpers into one fresh Chromium context; it does not
measure API compilation or application typing. No compiler or other benchmark
ran concurrently. Host: the same Apple M3 Pro used by the earlier local baseline.

Five paired rounds per size alternate which version runs first. Each variant
uses a fresh database and five sequential save/list operations. The first save
includes database creation; later saves include growing history and retention.
Record preparation/hashing is outside the timers. Both use the same synthetic
ASCII files, immutable-ID checks and default 20-record/50-MiB policy. The fifth
10-MiB snapshot triggers retention because JSON metadata also consumes space.

| Source per snapshot | Save median before / after, ms (n=20 each) | List median before / after, ms (n=25 each) | List median reduction |
|---|---:|---:|---:|
| 1 MiB | 7.75 / 6.70 | 3.60 / 2.10 | 41.7% |
| 10 MiB | 82.65 / 73.80 | 36.60 / 17.20 | 53.0% |

Removing redundant JSON round-trip copies roughly halved list latency in these
fixtures. The 10-MiB write median improved only slightly; full history reads and
byte-accounting serialization remain. The result does not show that storage
overall is twice as fast, nor does it establish a production tail distribution.
Samples within a round share growing history; they are not independent devices
or users. All samples, first writes and p95 values remain in the raw file.

Reproduce from the repository root:

```sh
PLAYWRIGHT_BROWSERS_PATH=/path/to/cache E2E_BASE_URL=http://127.0.0.1:30128 bun scripts/benchmarks/compareHistoryStorage.ts --output benchmark-results/history-comparison.json
```

The web origin must already be running. The script deletes only its own temporary
databases and leaves application workspaces untouched. No database migration or
retention-policy change was required.

The preliminary comparison is retained in [preliminary data](preliminary-comparison.json).
The final run followed an optional-field compatibility regression fix: legacy JSON
records omit undefined fields, which must compare idempotently with current records.
The timing code and corpus were unchanged. Only the final run populates the table.
