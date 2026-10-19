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
