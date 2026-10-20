# Quality implementation progress

## Preserved redesign baseline

- Branch: `ace/quality-implementation`, based on `82446f3e47cb402275f58a8b23b2a02505390c85`.
- Source: `/Users/lucifer/Programming/alove`, branch `feature/latex-ide-redesign`. The original checkout is unchanged.
- Snapshot: `/Users/lucifer/.ace/project-backups/alove-quality-nds75vef/manifest.json`, with a binary tracked patch and content copies/hashes for all 13 dirty/untracked files.
- Carried into this isolated worktree: nine tracked source edits and the dashboard/collaboration test files. Backup patch and personal planning file remain outside the commit. Restored the existing MIT license from `e02b59f` and copied the reviewed quality roadmap from `9e82d2d`.
- Integration choice: continue from the redesign architecture. Keep its current README, deployment setup, worker safety work, and editor components. No wholesale merge of the older split editor.

Baseline checks on the preserved source (Bun 1.4.3, 2026-10-19):

| Check                       | Result                                                                            |
| --------------------------- | --------------------------------------------------------------------------------- |
| Frozen lockfile install     | Passed                                                                            |
| All-package typecheck       | Passed                                                                            |
| Lint                        | Passed; five package scripts still placeholders                                   |
| Production build            | Passed                                                                            |
| Worker unit tests           | 3 passed                                                                          |
| Web unit tests              | 28 passed, 9 failed: Node browser-storage binding unavailable to Zustand in jsdom |
| Docker / actual PDF compile | Not run: daemon unavailable                                                       |
| Browser / Playwright        | Pending                                                                           |

The saved patch has four pre-existing trailing-whitespace additions. Those source bytes are preserved in this checkpoint; later edited files will be formatted as part of their specific changes. This baseline is recoverable, not a release-ready claim.

## Durable local source and recovery

Implemented versioned IndexedDB workspaces with transactional revision checks, hydration before default documents, serialized autosave, and acknowledgement only after committed writes. New projects receive distinct durable URLs. Source, empty files, tabs, title, and the root path persist. Failed/quota writes retain edits; stale tabs report conflicts without overwriting. Presentation-storage denial no longer interrupts source editing. Cloud file-save acknowledgements also preserve newer edits and explicit conflict outcomes.

Source export is a versioned `.alove.json` archive; import validates it and creates a separate local project. It does not replace current work. Save errors provide export/retry/reload actions. A future history-restore UI and automatic checkpoints remain D4 follow-ups.

Validation: 3 Playwright Chromium checks passed against the local dev server: reload/empty-file/active-tab restoration, source export/import as a separate project, and conflicting tabs. Ace browser also confirmed saved text survived reload with no console errors. IndexedDB/session regressions cover delayed writes, quota failure/retry, corrupt data preservation, aborted transactions, concurrent revisions, unmount during load, and root extension renames. Initial Playwright launch failed because the isolated home lacked a browser; tests then used the matching browser already installed in the Mac's normal cache.

## Compile request and process boundary

The API now enforces an allow-list, runtime types, canonical relative paths, root presence, engine/timeout bounds, file-count/content-byte caps, and a streaming encoded-body cap before queueing. The worker revalidates queued input, so bypassing HTTP does not bypass policy. Image and arbitrary command-option overrides are rejected. Both clean and build use argument arrays; project rc and TeX shell escape are disabled. Host TeX now requires `COMPILE_TRUSTED_LOCAL=true` and is refused in production. The local image default remains `latest`; deployment documentation calls for a pinned digest.

Worker artifact handling reads bounded log tails, caps PDFs before reading, rejects artifacts resolved outside the job directory, and discards caller-supplied root PDF/log files before building. Nonzero exits and builds without a PDF report failure. Process fixtures verify argument boundaries and nested files without claiming a real TeX compile.

Validation: shared protocol tests 17 passed; worker tests 10 passed; web tests 80 passed; all-package typecheck and lint passed. Default and local-standalone production builds passed. The local-standalone production browser suite passed 21 checks with 2 cloud-only skips. The first production build exposed a source-extension resolution mismatch in the protocol re-export; the validator now lives in the package's existing entry point, and both builds pass. The Docker daemon remained unreachable after attempting to start the installed application, including its normal-home socket; no actual TeX/container smoke is claimed.

Still required before public hosting: container/runner hardening and real cleanup smoke (C3), ownership and server-only local-mode policy (C4), quotas/cancellation (C5), and cloud membership/conflict work (S1/S2).

## Build provenance and usable previews

Builds now use the configured main document independently of the active tab. The file menu selects the main document, and local workspaces retain that choice. Each requested run supersedes the previous response, including invalid requests; project changes and unmount stop obsolete client polling. This stops watching a job, not the worker itself.

Successful previews retain their source revision and root. Rebuilds and failures keep the last successful PDF; source changes label it stale. A build finishing while typing may publish its captured snapshot as a stale preview, without changing newer source. Diagnostics retain their snapshot revision, paint only the matching file at valid locations, and stop painting after edits. Problem navigation normalizes worker paths and avoids stale line jumps. File switches isolate undo histories so another file's contents cannot be restored into the active file.

The preview no longer displays invented page counts, dummy thumbnails, or unwired controls. Native PDF viewing and source-named PDF download remain. Autosave no longer serializes the workspace for cursor/status-only updates.

Validation: 112 web unit tests passed; all-package typecheck and lint passed; local-standalone production build passed. The full production Chromium suite passed 22 checks with 2 cloud-only skips. Extended root-selection reload and cross-file undo checks then passed 2/2 after correcting a case-sensitive save-label locator in the test. Compile UI checks use mocked API results, not real TeX. Independent review found the invalid-request supersession race; its regression now passes. Settings/theme reconfiguration and cloud dirty-buffer merging are next; real runner smoke and public-hosting gates above remain open.

## Editor settings and cloud refresh safety

CodeMirror settings and root theme changes reconfigure the existing view. Text, selection, and undo survive; external value updates no longer echo through `onChange` or enter undo history as user edits. Diagnostics respect the code-check setting. The fallback textarea has an accessible label. Removed the editor's unconditional "Synced" badge; the header reports actual persistence state.

Cloud query updates now merge against a store-owned remote baseline instead of reinitializing the project. Dirty drafts, active tabs, the configured root, and local-only file operations survive unchanged echoes and remounts. Clean remote changes are applied; conflicting drafts retain their expected version and show recovery actions. Save acknowledgements cannot create ghost dirty paths after deletion or roll versions backward. Problem rows are keyboard-accessible navigation buttons, and stale diagnostics identify their earlier source version.

Validation: 132 web unit tests passed, including 14 remote-merge and 7 real CodeMirror adapter tests. All-package typecheck/lint and default/local-standalone production builds passed. Final production Chromium suite: 24 passed, 2 cloud-only skips. Ace browser open/snapshot checked the updated editor. No live Clerk/Convex integration or actual TeX/container compile was exercised. Independent review identified baseline/remount, recreated-version, and in-flight-echo cases; all now have passing regressions and follow-up review found no blockers. All 13 original dirty/untracked source files still match their backup hashes.

Next delivery order: C3 runner isolation, bounded resources, and real timeout/cleanup smoke; C4 job ownership and server-only local-mode policy; C5 quotas and worker cancellation. Then finish cloud mutation conflict handling (including deleted/recreated-file CAS and delete/rename failure recovery), history restore/checkpoints, per-file undo retention across tab switches, and responsive/accessibility checks. The Docker daemon must be available to verify the real runner. These are explicit remaining release gates, not claims of public-hosting readiness.

## Narrow workbench layout repair

The reported overlapping header and crushed sidebar/editor/preview were reproduced at 525 CSS pixels. Earlier DOM snapshots and desktop checks did not establish responsive visual quality. The header now uses normal document flow, truncates long titles, and keeps actions reachable without overlap. Build has one global action. Below 1024 pixels, Source and PDF use separate views while retaining mounted editor state; project files open in a drawer. Desktop keeps a readable 220–280 pixel sidebar and resizable source/PDF panes. Empty build output no longer consumes a third of the screen. The preview has compact controls and a bounded empty state; editor chrome follows the light/dark palette and uses thinner scrollbars.

Validation: inspected real Ace browser screenshots in light and dark, including the reported 525-pixel width and phone/tablet/desktop sizes. Added 11 browser regressions for header geometry, clipping, minimum editor/sidebar widths, Source/PDF switching with undo, and resizing across the breakpoint. The final local-standalone production build passed; production Chromium suite passed 35 tests with 2 cloud-only skips. Web unit suite remains 132 passed, and web typecheck/lint passed. Independent layout review found no blockers. Initial preview-unit failures were a missing React import during the rewrite; the import was restored and all seven preview regressions pass. Runner/cloud release limitations above remain unchanged.

## Real Docker and PDF workflow verification

Docker Desktop was installed but stopped. Launching it from the isolated agent
home failed because the Unix socket path was too long. Launching the existing
application from the normal Mac Terminal restored the daemon; Docker 28.3.2 and
a real hello-world container succeeded. No reinstall, factory reset, image purge
or user-data deletion was needed. The CLI/worker use the normal desktop-linux
context. A smaller local TeX image was built from a pinned amd64 TeX Live base
with physics/cleveref; the bundled demo produced a real 128,381-byte PDF. Added
packages are not version-pinned, so this development image is not a reproducible
release artifact.

Real execution exposed defects that fake-process fixtures could not detect:
image data URLs were written as UTF-8, and nested main documents produced PDFs
in a different directory from the worker's retrieval path. Uploaded binary data
is now decoded with strict MIME/base64 validation; both latexmk steps explicitly
write into the configured root's directory. Generated output must start with a
PDF signature. Ordinary TeX errors now report LATEX_ERROR instead of a Docker
infrastructure error. A timeout takes precedence over partial invalid PDFs.
Repeated real timeout runs also exposed Docker's automatic-removal race with
explicit cleanup; cleanup now retries the specific removal-in-progress response
with bounded attempts and command deadlines, while other failures remain visible.

The live test uses a dedicated loopback Redis on port 6381, a host worker running
Docker TeX, and the local production preview at http://127.0.0.1:30127. Existing
Redis port 6379 and its queued jobs were left untouched. The preview and worker
remain running for inspection. This setup does not verify the Compose worker's
host bind-mount arrangement.

Validation: 23 worker unit/process tests passed; the real Docker suite passed
6/6 (pdflatex/lualatex/xelatex, nested include/PNG/BibTeX, real TeX error, deadline
and container/temp-directory cleanup). A separate repeated timeout check passed.
All-package typecheck and lint passed; five package lint tasks remain no-ops.
Web unit tests passed 132/132 (Node's experimental-storage notices remain).
The final real production browser workflow passed 1/1 in 17 seconds against the
updated worker, without compile mocks: create, edit, queue, build, download a
valid PDF, preserve it after failure, reload saved source, and rebuild. Ace's
visible browser also rendered an actual compiled PDF. The final browser rerun
was initially blocked by a missing matching Playwright executable; the official
matching browser archive was installed into an explicit cache, then the rerun
passed. Independent reviews of the runtime changes and timeout race found no
blockers. All 13 original dirty/untracked source files still match their backup
hashes; all changes remain isolated on ace/quality-implementation.

Next release gates remain C3 container resource/network/user/filesystem isolation,
C4 ownership and server-only local-mode policy, C5 quotas/cancellation, and cloud
conflict/history recovery. The real runner smoke closes the earlier Docker-
unavailable verification gap; it does not establish safe public TeX hosting.

## Regression debugger foundation

Added immutable, bounded build records with canonical SHA-256 source fingerprints,
recorded source revisions/settings/results, and transactional IndexedDB retention
that preserves the latest successful baseline. Build-history failures do not
turn a successful compile into a failure or discard source. The worker now resolves
and executes the configured Docker image by its immutable local identity and
returns that identity/platform in both successful and failed compilation results.

The recovery engine validates recorded fingerprints/settings/runtime, rebuilds
the good baseline, then tests up to five independent whole-file restorations.
It never edits working source or replaces its preview. Runtime drift, timeouts,
infra failures and exhausted budgets produce no verified recovery. Cancellation
stops client waiting and further enqueueing, not a queued/running worker job.
Apply/undo check source/root/project/settings again to preserve concurrent edits.
The first real production browser scenario passed without compile mocks: restored
a deleted macro, retained an unrelated prose change, reloaded durable evidence,
exported trial results, applied/undid/reapplied, then compiled successfully.
Full UI validation and final evidence follow with the UI delivery checkpoint.

## Recovery dialog and real workflow

Build recovery is reachable from the toolbar, failed preview and Export menu.
The dialog shows persisted good/failed snapshots, changed-file previews, bounded
trial progress/results, a compile-verified full-file restoration, guarded apply
and undo, and an evidence export containing source/settings/runtime/logs/trials.
It does not silently modify working source or replace the working PDF with a
trial PDF. Apply is local-only. The UI explicitly distinguishes whole-file
restoration from minimal-edit diagnosis and discloses source in exports.

Validation at the core checkpoint 840f376 plus this UI: 181 web unit tests,
24 worker unit/process tests, six real Docker integration tests, all-package
typecheck, web lint and the final local-standalone production build passed.
Final targeted production Chromium suite: 13/13 passed in 38.9 seconds: real
recovery workflow, existing real create/compile/download/reload workflow, and
11 responsive editor checks. The recovery case itself passed in 22.3 seconds
including setup, initial builds, baseline/candidate trials, export, apply/undo
and final rebuild. A prior run took 38.2 seconds; neither is a comparative
benchmark. Verified the populated dialog at 390/525/1440 pixels in light/dark,
with actual screenshots inspected. Ace open/snapshot and phone/tablet/desktop
screenshots also checked the empty-history dialog and toolbar entry.

Review found a WebCrypto-unavailable path, baseline-selection guard, live settings
race and undo-during-build state. Those paths were fixed; new regressions include
settings changes inside the apply action and unavailable source hashing. Follow-up
review found no blockers. Initial typecheck found an older narrow polling-result
type and test-fixture signatures; both were corrected. The first Docker smoke
attempt could not resolve the local image tag; rebuilding the local Dockerfile
from cached layers restored it and all six real checks passed. Node experimental
storage/deprecation notices remain; five package lint scripts remain no-ops.
All 13 original dirty/untracked source files still match their backup hashes.

See docs/build-recovery.md for operation, architecture, limits, test commands and
a proposed public 20-failure benchmark against Overleaf history/Error Assist.
No Overleaf comparison has been executed and no superiority claim is made.
Next feature slice: line/hunk-level candidates, multiple-failure handling and an
executable reproduction bundle. Public-hosting C3/C4/C5 and cloud mutation/history
work remain separate release gates.

## Local recovery and performance baseline — 2026-10-19

Measured the production application at 5316c09 on this Apple M3 Pro (11 logical
CPUs, 18 GiB RAM), using dedicated loopback Redis 6381, one real worker and an
amd64 Docker TeX image under arm64 emulation. Product source was unchanged.
The compiler run followed the isolated browser run; no browser profiling overlapped
its final latency measurements. Raw data, reproducible scripts, CSVs and figures:
[local benchmark report](benchmarks/2026-10-19-local-m3-pro/README.md).

The 20-fixture synthetic corpus produced 60/60 strict expected outcomes across
three repeats: 45 compile-verified single-file recoveries, six unresolved controls
and nine incompatible controls. All 45 preservation checks retained unrelated-file
edits, and every verified candidate matched its expected path. This is 15 positive
fixture types repeated three times, not 45 independent real manuscripts. Whole-file
restoration can still reverse other edits within that file. No Overleaf comparison.

Successful recovery median/p95: 1449.6/2168.1 ms (n=45), including baseline and
candidate trial jobs, excluding original evidence builds, history writes and UI.
One-page API medians: pdfLaTeX 713.9 ms, LuaLaTeX 1438.0 ms, XeLaTeX 2508.5 ms
(n=5 each). Simple 100-page pdfLaTeX median 1080.0 ms (n=3). Three bounded
four-client bursts with one worker completed 12/12 jobs, 95.2–110.4 jobs/min;
this is not sustained capacity. All 206 final API jobs had complete queue metadata:
153 ready PDFs, 49 LaTeX failures, three real timeouts, one validation failure.

Chromium source hashing median was 1.55 ms at 1 MiB and 14.85 ms at 10 MiB.
Later history-save medians (n=4) were 7.05/82.7 ms respectively, including growing
history and retention. Actual editor keydown-to-next-animation-frame median/p95
was 14.55/16.4 ms at about 1 MiB (n=20), with 40 ms gaps. This is a responsiveness
proxy, not INP, actual paint completion or burst typing. Large history snapshots
are the clearest measured optimization target.

Separate direct-Docker 500-page profiles (three per engine) recorded largest
process max-RSS values about 34/133/179 MiB for pdfLaTeX/LuaLaTeX/XeLaTeX.
These exclude Docker VM/web app RAM and are not simultaneous container peaks.
Streaming stats during a different API profiling phase were sparse; their CPU
readings are inconclusive. Do not derive deployment capacity from either profile.

Checks this turn: 22 benchmark tests passed (165 assertions); all-package typecheck
passed via the existing cache; report recalculated from raw data and independently
audited. Existing product tests were not rerun for benchmark-only additions.
Calibration: 40 jobs, zero fixture errors. An incomplete compiler attempt overlapped
browser profiling and was stopped/excluded, with raw data retained. Initial large
contenteditable-fill preparation timed out; switching to real project import
allowed the complete isolated browser run to pass. No true cold start, cache purge,
remote staging, native Linux, sustained load or comparative competitor test occurred.
Public C3/C4/C5 release gates remain open. Next: optimize history storage, then run
this corpus on private staging before making public performance claims.

## History copying optimization

Removed redundant JSON round-trip clones: save snapshots with structuredClone
before its first await; list returns IndexedDB's already-detached records. Retention
counts JSON bytes once per row and reuses the counts for victims. IDB v1, immutable
IDs, 20-record/50-MiB limits, pinned newest/last-good, corrupt-row preservation
and transaction-completion acknowledgements are unchanged. Twelve repository
tests pass, including new mutation-isolation checks.

A same-session paired Chromium comparison (five alternating-order rounds per
size) measured 10-MiB later-save median 82.65→73.80 ms (n=20 each) and list median
36.60→17.20 ms (n=25 each). The read improvement is the clearest gain.
Raw timing data and boundaries: [history storage comparison](benchmarks/2026-10-19-history-storage/README.md).
The final run includes an idempotency regression for legacy records with omitted
optional fields; the preliminary run remains separate. No application/TeX latency
or competitor advantage is inferred from this helper benchmark.


## Project library and project navigation — issue #5

Replaced fabricated recent-project cards with saved browser workspaces, title search, rename and revision-checked confirmed deletion. Blank, article, BibTeX and sample launchers create independent projects; archive import commits the new workspace before navigation. Editor title changes, project links and main-document persistence now use real local or authenticated Convex operations. Navigation saves the current source before leaving and shows failures. Corrupt local rows remain untouched and no longer hide healthy projects. Added a working help route and responsive, theme-aware dashboard.

Validation on the combined project/control working tree: web unit suite 245 passed; all six packages typecheck; production build passed. Production Chromium project-library tests 2/2 and dashboard tests 5/5 passed, including import/reload, rename, search and cancel/confirm deletion. Eight backend-handler unit tests cover authentication, ownership and root updates. Live Clerk/Convex deployment was not exercised. Editor-control changes are delivered separately under issue #6.


## Functional editor controls — issue #6

Wired autocomplete, Emacs navigation, non-blinking CodeMirror cursor, reference-search mode and PDF-viewer preferences to real consumers. Snippets/citations insert at the caret or before the document end; menu insertions participate in undo history, which survives file switches without crossing projects. Find and global-search results navigate the live editor. File dialogs keep validation errors visible, folder/upload controls preserve safe paths and binary assets, and file deletion/root selection work. Settings text and account/subscription panels now describe available behavior truthfully.

Final combined validation: 245/245 web unit tests; production Chromium 46 passed, two cloud-only skipped (48 total), including seven new controls tests, real Docker compilation and recovery, storage conflicts and 11 responsive checks. Six-package typecheck, web lint/design-token checks and local production build passed. Native Google Chrome 155.0.8059.80 separately rendered a compiled one-page PDF from the browser-tab Blob link. Ace screenshots inspected editor/settings at phone/tablet/desktop in light/dark; independent visual review found no blockers for dashboard/library at the same sizes/themes. Initial missing reference label fixed; test-only locator and unsupported headless-shell native-viewer assertions corrected and rerun. Live cloud integration not claimed. See `docs/editor-controls.md`.


## Constrained TeX job containers — issue #10

Replaced root/networked, writable-host compilation with a non-root read-only container: no network/capabilities/privilege escalation, CPU/memory/PID/file limits and bounded tmpfs work/cache space. Only a read-only source child enters the container; the host parent remains private. A bounded fixed Perl reader retrieves regular log/PDF artifacts while the container is alive, rejects links/FIFOs and preserves timeout cleanup. Build records and recovery now compare a versioned effective sandbox policy as well as the immutable image ID. Restrictive worker umask 077 is covered.

Validation: 46 worker unit tests, 250 web unit tests, nine actual Docker checks and three production Chromium workflows passed. Docker evidence includes three TeX engines, nested includes/PNG/BibTeX, failures, timeout/removal, read-only/network/resource restrictions, special-file reads and a successful subsequent job. Browser evidence covers compile/download/failure retention, compile-tested recovery/apply/undo/export and compiler/PDF settings against the actual Redis/Docker worker. All-package typecheck, web lint/design-token checks and production build passed. An initial missing-PDF reader classification was corrected; the old network-interface-name assertion was replaced with a direct blocked-connect test. No new processing-speed benchmark or public-hosting readiness is claimed.

The interrupted worktree was recreated at main 8af7510; unfinished changes were restored and checks rerun. Current unfinished changes also have a separate backup under `/Users/lucifer/.ace/project-backups/alove-sandbox-20261019`. Shared/public deployment still requires dedicated daemon isolation, ownership, quotas and operational cancellation/restart checks. See `docs/compile-sandbox.md`.


## 2026-10-20: compile ownership and local access, issue #12

Base revision `a3d735f`, branch `quality/compile-access`. The API now queues a server-generated creator with the validated compile request. Cloud submission checks the Clerk session and Convex project owner. Polling checks the creator and current project ownership before reading state or artifacts, denies legacy unowned jobs, and sends private/no-store cache policy. Worker validation rejects unowned queue records. Authentication failures fail closed in routes and middleware.

Anonymous local compute requires `ALOVE_LOCAL_COMPILE_ORIGIN` with an exact loopback origin. The public UI flag alone permits no compile access. Local dev and Playwright launchers bind to loopback. Development Compose publishes loopback ports; production Redis has no published port. Header checks do not prove the caller is local; public proxies/tunnels must not expose anonymous mode. See `compile-access.md` for deployment and queue rollout limits.

Validation before publication: 343 web unit tests, 32 protocol tests and 46 worker unit tests passed; all six packages typechecked; web ESLint/design-token checks and local production build passed. Three production Playwright checks passed in 33 seconds against real Redis6381, worker and Docker TeX: compile/download/failure retention/reload, tested file recovery with apply/undo/export, and negative origin/form requests. A separate production instance with only the public UI flag returned 503 for compile submission/polling and 200 for local editing. Both Compose configurations parsed. The live loopback listener and Ace editor snapshot were checked.

Initial production builds exposed the repository's source-package `.js` resolution limit; queue declarations now use the existing protocol entry point. Initial real browser runs failed because Next normalizes loopback request URLs to localhost. The implementation now retains the exact browser Host when handling that normalization, with regression tests using real NextRequest; the final browser runs passed. Live Clerk/Convex sessions with distinct accounts remain untested. Login UI troubleshooting, memberships, quotas and cancellation remain separate work.


## 2026-10-20: publishing preparation, issue #14

Base `4ab0dbf`, branch `quality/publish-readiness`. Kept Clerk identity, Convex project storage and a private authenticated TLS Redis queue. Public help, status, privacy, 404, route/global error and loading pages work without provider keys. Cloud pages wait for database authentication; archive import, bounded owner-only file/project mutations, version conflicts, account switching and browser draft recovery have regressions. Signed Clerk account-deletion events schedule bounded owner-scoped cleanup.

Compile admission limits are atomic in Redis. Cancellation reaches the worker, which handles shutdown, heartbeats, retention cleanup and a shared absolute source directory. Producer connections recover after outages. Production deployment separates the HTTPS web host from the Docker runner, pins release images by digest, passes public web configuration at build time, keeps secrets at runtime, and has readiness gates and rollback pointers. CI now runs real package lint/build, production browser tests, Docker TeX, containerized stack smoke, real Redis admission and worker shutdown checks. The manual deployment workflow requires main and successful CI; missing configuration fails explicitly.

Checkpoint validation: 474 web unit tests, 32 protocol tests, 51 worker unit tests, 35 queue tests against dedicated Redis, 36 deployment-script tests and 22 benchmark-helper tests passed. All-package typecheck/lint passed. Default cloud and standalone production builds passed during implementation. Nine real Docker checks passed. The actual Compose stack produced a 38,204-byte nested-root PDF with PNG/BibTeX, returned CANCELLED after active DELETE, returned TIMEOUT after a one-second deadline, and removed its own stack. A separate real process test passed SIGTERM, CANCELLED, exit 0 and container/source cleanup in 11.94 seconds total. An isolated Redis outage failed promptly and recovered with a fresh producer connection.

The first full production-browser run had 50 passed, three failed and two cloud-only skips. An obsolete ONLINE assertion was updated to LOCAL; the cancellation test now allows bounded queue wait and cleans up on failure, which also prevented its failed loop from delaying the next real-compile test. All seven tests in the affected dashboard/cancel/compile recheck passed. The final complete production-browser run then passed 53 tests with two cloud-only skips in 1.3 minutes. Independent Ace visual review captured public pages across phone/tablet/desktop in both themes with no blockers; the exact captured matrix is retained in the thread, not represented as exhaustive screenshots of every combination.

Other corrected attempts: missing local TeX tag restored by rebuilding its pinned Dockerfile; an edited running shell script interrupted an early smoke; container port mapping initially failed the strict origin check, now covered by explicit server-only proxy transport plus Host/Origin/ownership checks; unsupported Japanese text in the pdfLaTeX fixture was replaced with supported accented UTF-8. These earlier failures are not counted as passes.

No infrastructure was purchased and no cloud release or live Clerk login was claimed. The final external handoff is provider keys, domain/host configuration and the live two-account checklist in [release-runbook.md](release-runbook.md). Invitation-based multi-user collaboration remains outside this owner-only release.

Final review: Standards found no hard violations and two optional readability notes; Spec found no blocking gaps and two nonblocking cleanup/clock notes. GitHub push protection rejected the first unpublished checkpoint because a synthetic `sk_live_` test string resembled a Stripe key. The fixture now constructs an unmistakably dummy value at runtime; no real provider credential was used. Only unpublished local history was amended, with both Git identities reverified.

A final deployment retry check found that reusing a commit-named release directory could overwrite rollback configuration when rerunning the same revision. Releases now use a validated unique suffix on both hosts; tests cover uniqueness and unsafe identifiers. CI cancels superseded runs for the same PR instead of spending runners on obsolete revisions. Deployment-script coverage is now 38 passing tests.

The first GitHub run passed the build job but failed browser tests on Linux because three specs used Mac-only Meta shortcuts. Fourteen shortcut strings now use Playwright's platform-aware ControlOrMeta without changing assertions; the three affected specs passed 27/27 locally. The clean Docker build also stopped on a bad GPG signature from a geo-selected CTAN mirror. The development Dockerfile now selects the Illinois CTAN mirror and requires verification for both TeX Live operations. A fresh amd64 image build reported both repositories verified; all nine real Docker tests then passed against that new image in 29.06 seconds. These local rechecks do not replace the pending Linux CI rerun.

The next Linux run passed build and corrected all shortcut failures: 48 browser tests passed, six credential/real-worker tests skipped, and one access test failed because the browser job had no Redis service (503 rather than the required missing-job 404). The browser job now provisions health-checked Redis, preserving the exact test assertion. The Docker job in that run passed the freshly verified TeX build and all nine compile tests before continuing the stack checks.


## 2026-10-20: runtime-aware worker readiness, issue #16

A closed production-browser run found an unavailable local TeX image while the queue heartbeat still advertised Ready. Docker listed the tag but could not inspect it; the initial suite was interrupted after 38 passes, two runtime-dependent failures and one interrupted test. Rebuilding/loading the pinned local image restored actual compilation. No daemon reset or reinstall was used.

Worker heartbeats now require a fresh bounded image-inspection probe and valid sandbox policy, or an explicitly trusted nonproduction host with executable latexmk. Probes do not overlap, publish no command output and abort during shutdown. A repaired runtime resumes readiness without restarting the worker; existing timestamps expire after 15 seconds when it fails. The dedicated Redis/process regression exercised missing → available → missing → restored in the same worker and SIGTERM during a slow probe; it passed 39 assertions in 40.80 seconds, including the actual local /api/ready endpoint. Seventeen focused probe tests passed. CI now runs this process regression before starting its long-lived worker. Multiple-worker readiness aggregation remains outside the existing single-worker release.


## 2026-10-20: failed PDF-driver diagnostics, issue #17

The closed journey exposed a malformed PNG that Chromium displayed but XeTeX's PDF driver rejected. The PNG's IDAT CRC was invalid. The worker preferred the ordinary TeX .log over captured driver stderr, then replaced the actionable failure with an invalid-PDF-signature message. Failed processes now retain bounded compiler/driver output alongside the file log, including converter fatal and libpng errors as diagnostics. A nonzero process exit keeps its failure cause; successful-process signature validation, timeout precedence and artifact limits remain enforced. The process regression covers a normal-looking log, empty PDF, fatal stderr, no returned PDF and byte-cap/truncation reporting. The initial combined worker suite passed 69 tests. Additional regressions cover actual merged-log truncation and duplicate messages echoed in both streams: the Problems list must not show the same diagnostic twice. All 19 focused process/safety tests passed in 5.73 seconds; the scoped diagnostics review found no blockers.
