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

Still required before public hosting: container/runner hardening and real cleanup smoke (C3), ownership and server-only local-mode policy (C4), quotas/cancellation (C5), and cloud membership/conflict work (S1/S2). Local history restore/checkpoints and compile-controller races remain the next editor tasks.
