# alove quality roadmap

This is an implementation plan, not a claim that the proposed fixes are complete. The goal is a dependable local LaTeX workspace: open a project, write safely, compile predictably, understand errors, and recover or export the source. Cloud collaboration is optional. Visual refinement should reinforce these workflows.

## Baselines and evidence

Assessment date: 2026-10-19. Two different checkouts exist:

| Checkout                                                        | Observed state                                                                | Validation in this assessment                                                                                                                                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Thread branch `ace/check-project-status`, starting at `e02b59f` | Older split editor; clean before this plan                                    | Frozen install, production build, all-package typecheck, lint, and 3 theme tests passed. Editor loaded without console errors; a new local file disappeared after refresh. Five workspace lint scripts are placeholders. |
| Main directory, `feature/latex-ide-redesign` at `82446f3`       | Five commits ahead of its recorded upstream; tracked edits and untracked work | Source inspected. Web test/typecheck attempts failed before running: `vitest` and `tsc` unavailable. Historical readiness results were not rerun.                                                                        |

The redesign already contains a store-backed UI, worker timeout/path/output-limit work, API tests, Playwright coverage, health checks, and Docker setup absent from the thread snapshot. Reuse and verify it. Do not rebuild the old editor or assume its defects remain unchanged in the redesign.

Docker's daemon was unavailable. TeX-to-PDF output, container cleanup, and live Clerk/Convex collaboration remain unverified. No production deployment or dependency vulnerability audit was performed.

Confirmed evidence in the thread snapshot:

- `apps/web/src/components/EditorWorkbench.tsx:512,584`: local documents live in memory and `queueSave` does nothing. `src/lib/compileHistory.ts` stores compile snapshots separately; no workspace restore exists.
- `apps/compile-worker/src/runCompile.ts:61,85,115`: clients can select the image/extra flags; filename/options enter a shell string; Docker lacks a timeout. The redesign already escapes shell tokens and adds timeout handling, so those fixes need verification rather than duplication.
- `apps/web/src/app/api/compile/[jobId]/route.ts:19`: lookup has no ownership check. The inspected redesign endpoint also lacks per-job ownership enforcement.
- `apps/web/convex/files.ts:10,30`: cloud access is owner-scoped. Sharing needs explicit membership semantics.

Confirmed overlap in the newer, dirty redesign source:

- `EditorWorkbenchLocal` seeds demo/new files and installs empty persistence handlers. Store persistence excludes source. `saveActiveFile`/`saveAllDirtyFiles` clear dirty state before persistence succeeds.
- Cloud rows trigger `initializeProject`, which replaces documents and dirty state. The save adapter reduces `saveFile` results to a version, losing the conflict outcome.
- The compile store chooses the active `.tex` tab ahead of `main.tex`, allowing an included chapter to become the root. The older hook always hardcodes `main.tex`. Both need an explicit root contract.
- The newer worker still accepts request-supplied image/extra flags. Extend and test its existing validation, timeout/cleanup, and size-limit code.

## Architecture decisions

1. **Build on the redesign after reconciliation.** Preserve its dirty work and establish an isolated baseline. Compare overlapping changes before integrating; retain license/documentation from the thread baseline as appropriate.
2. **Separate documents from presentation.** One workspace model owns project ID, files, root, document revisions, and dirty/save state. Tabs, layout, themes, and PDF controls remain presentation. Reuse the existing store/services.
3. **Use adapters with explicit outcomes.** IndexedDB for local source; Convex for cloud source. Return saved revision, conflict, or failure. An absent handler is not success. Draft recovery and compile history are separate.
4. **Make saves and builds revision-aware.** An old acknowledgement must not clear newer edits. Builds carry project, root, source revision, and run/job identity. Only the intended run updates current status; PDFs retain source revision.
5. **Keep execution policy on the server.** Public request fields differ from internal queue metadata. Authentication supplies identity. Revalidate at the worker because the queue is another input boundary.

## Ordered, bounded work

Each row is one reviewable change or a short sequence of tightly related commits. The primary owns cross-cutting design and integration. Delegate only the named closed subtask with exact paths and expected HEAD.

| ID  | Change and boundary                                                                                                                                                                                                                                                  | Acceptance evidence                                                                                                                                                                               | Dependency / owner                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| B0  | Preserve tracked/untracked redesign work and its manifest in an isolated baseline copy; compare branches and report integration choices without merging. Restore locked dependencies. Exclude node_modules, build/test output, and backup patches from staging.      | SHA plus preserved patch/file manifest; current checks accurately recorded; original checkout unchanged.                                                                                          | First / primary                                                                                   |
| D1  | Implement versioned local workspace storage: source, stable project ID, explicit root, active path, revision. Hydrate before defaults and save subscriptions.                                                                                                        | Storage round trip; malformed/unsupported data preserved for recovery; refresh restores added and empty files.                                                                                    | B0 / primary; delegate storage helper                                                             |
| D2  | Connect save acknowledgement to successful transactions. Handle quota/denied/blocked storage and edits during saves.                                                                                                                                                 | Truthful saving/saved/error UI; rejected writes leave edits dirty; older acknowledgement cannot mark newer content saved.                                                                         | D1 / primary                                                                                      |
| D3  | Compare revisions inside write transactions; add stale-tab recovery. BroadcastChannel provides notification only.                                                                                                                                                    | Two local IndexedDB tabs cannot silently overwrite each other; both revisions can be exported; no wall-clock ordering dependency.                                                                 | D2 / primary; delegate conflict test                                                              |
| D4  | Add source export, recoverable history restore, and a checkpoint-before-replacement contract for template/new-project/delete actions. Index and bound history. E3 owns apply-time UI.                                                                                | Export/import preserves paths/content/root; cancel preserves work; restore previews/checkpoints current work; export works despite storage failure.                                               | D2 / primary; delegate export helper or one dialog                                                |
| C1  | Strict compile request validator plus separate internal job envelope. Cap request bytes before full parsing, files/content bytes before Redis, and validate engine/timeout/paths. Revalidate in worker; reject image/option overrides.                               | Invalid/null/oversized requests return 400/413 without enqueue; valid nested projects work; traversal/absolute/colliding/option-like paths fail deterministically.                                | B0 / primary; delegate validator tests                                                            |
| C2  | Use TeX argument arrays and server-owned image/options. Validate/pin a supported image. Keep host TeX only as explicit trusted local execution.                                                                                                                      | Metacharacters cannot change process execution; unknown engine/options/image rejected; host mode unavailable publicly; supported engines smoke tested.                                            | C1 / primary; delegate process-builder helper                                                     |
| C3  | Verify existing Docker timeout/cleanup; add bounded CPU/memory/PIDs/disk/output and restricted network/capabilities/user/environment. Public jobs use an isolated runner without application secrets or broadly exposed host daemon.                                 | Job and descendants/container exit on timeout; temporary data removed; later jobs run; logs/PDFs bounded before full reads; font/cache compatibility checked.                                     | C2 / primary; delegate read-only timeout/cleanup audit; primary hardens runner in separate commit |
| C4  | Cloud config/auth fails closed; bind jobs to authenticated owners using current project policy and check status/artifact access. S1 later extends this to membership. Anonymous local mode uses server-only policy and localhost binding; Redis stays local/private. | Cross-user status/PDF reads denied; missing cloud secrets cannot enable anonymous compute; account-free local mode works; Redis not publicly reachable.                                           | C1 / primary; delegate authorization tests                                                        |
| C5  | Per-user queue/rate caps, bounded retention, Redis/worker restart recovery, cancellation independent of client polling.                                                                                                                                              | Flooding bounded; Redis outage fails promptly with actionable error; cancel terminates work; restart preserves correct job state.                                                                 | C3, C4 / primary                                                                                  |
| E1  | Explicit project root; one compile controller tracks run/project/source revisions, aborts obsolete polling, and ignores stale responses.                                                                                                                             | Included chapter editing still compiles configured root; slow A cannot replace newer B; unmount/project change cannot apply old results.                                                          | D1, C1 / primary; delegate race tests                                                             |
| E2  | Retain last successful project PDF during compile/failure, labelled stale when needed. Normalize/filter diagnostic paths; navigation opens the right file/line.                                                                                                      | Tab switches preserve project PDF; project switch clears it; no wrong-file markers; fresh build clears resolved errors.                                                                           | E1 / delegate one renderer or diagnostic helper                                                   |
| E3  | Repair template application and editor lifecycle. Do not recreate documents for theme/layout changes. Apply D4 checkpoint/replacement semantics in the UI.                                                                                                           | Template appears immediately even on selected root tab; no silent deletion/merge; cursor, selection, undo, edits survive appearance changes.                                                      | D4 / primary; delegate only same-tab template refresh bug after reproducing on target revision    |
| S1  | Fix cloud acknowledgement/conflict propagation first; add owner/editor/viewer membership and shared authorization across files, presence, compile.                                                                                                                   | Failed/conflicting saves retain draft; old acknowledgement cannot clear new edits; invited distinct users share; viewer mutations denied.                                                         | D2, C4 / primary                                                                                  |
| S2  | Invitation/revocation plus deliberate same-file conflict recovery. Start with versioned saves; evaluate collaborative text operations only if simultaneous character-level editing is required.                                                                      | Invite, concurrent edits, offline reconnect, revoke tested with distinct accounts; draft recoverable after access loss.                                                                           | S1 / primary                                                                                      |
| U1  | Refine hierarchy around project/files/editor/preview/problems. Audit keyboard/focus/labels/contrast and responsive writing/preview layouts. Verify every visible control.                                                                                            | Keyboard-only write/compile/recover/export; dialog focus returns; narrow/desktop usability; truthful disabled states; browser evidence recorded.                                                  | D4, E2, E3 / primary; delegate one component audit                                                |
| R1  | Release gates on reconciled revision: meaningful package lint, unit/integration/browser checks, real worker fixture, reproducible setup. Review usage before removing unused infrastructure.                                                                         | Clean lockfile install; typecheck/lint/test/build; PDF fixtures for engines/includes/BibTeX/Unicode; storage/races/auth/outage/recovery and supported editor fallback checks pass; skips visible. | Each task, final milestone / primary                                                              |

## Milestones

- **Dependable local release:** B0, D1-D4, C1-C3, E1-E3, relevant U1/R1 checks, and C4 local-network restrictions. Acknowledged saves survive refresh; failures visible; source exportable; compile bounded. No cloud account needed.
- **Private cloud release:** add C4-C5 and S1. Pass the cloud environment matrix and distinct-user authorization checks on the deployed revision.
- **Shared workspace release:** add S2 and full U1. Demonstrate conflict recovery/revocation before advertising multi-user collaboration.
- **Later enhancements:** The authoring baseline for SyncTeX, project cite/ref, English spellcheck, cross-file search, GitHub/server history, roles/comments and source change proposals is implemented under issues #32–#40 after the reliability gate. See [authoring and collaboration](authoring-and-collaboration.md). Measured compile caching, additional languages and broader collaboration remain further work. Dashboard controls require working backing operations.

## First implementation batch

1. B0: preserve/select the redesign baseline; compare branches and record current validation in an isolated copy. Decide integration from this evidence before editing implementation files.
2. D1-D2: durable local source plus truthful save status, with browser reload and delayed/rejected storage checks.
3. C1-C2: close request-to-process policy gaps, reusing existing redesign worker work.
4. Review/commit each completed boundary before D3/C3/E1. Do not parallelize writes to the same store or API contract.

Every delegated task states absolute worktree, expected HEAD, exact files, allowed mutations, verification, and stop condition. One committer stages only the reviewed allow-list after validation; verifies effective author/committer `Luseefor <sapanakosansar18@gmail.com>` and final metadata; never adds authorship trailers or stages unrelated work. Commit locally. Push, PR, and deployment are separate actions.

## Verification record for this planning change

This change adds the roadmap only. Passing checks on the starting snapshot are from the initial assessment, not proof of redesign readiness. The newer checkout's test/typecheck attempts failed for missing tools; dependencies were not installed into that dirty checkout. Its tracked/untracked work was preserved. Independent source, security, and editorial reviews checked branch accuracy, dependencies, and acceptance criteria; their scope corrections were incorporated. Roadmap formatting and whitespace checks passed. The companion alove-quality skill was validated separately.

## Reliability follow-up gate (issues #25–#28)

Implemented and merged in PR #29. Delivered reliability boundaries:

1. D4: bounded local source checkpoints, preview/cancel/restore, and a checkpoint of current work before replacement or project deletion (#25). Templates, new projects and archive imports continue to create separate projects.
2. Cloud mutations: compare both file version and row identity, preserve drafts on failed/conflicting delete or rename, and carry the original identity through browser draft recovery (#26).
3. Per-file undo/redo: retain histories across tabs with project and file-incarnation isolation and bounded retention (#27).
4. U1: keyboard actions, dialog/drawer focus, labels and responsive source/preview checks (#28).

Issues #32–#40 implement the subsequent authoring baseline: coordinate SyncTeX, project cite/ref, English spellcheck, bounded cross-file search/replacement, GitHub pull/push, server history, memberships, comments and proposed source changes. Automatic tracking of every keystroke and simultaneous character-level merging remain beyond this proposal-based review workflow. Live Clerk/Convex login, deployed two-account authorization and end-user GitHub OAuth remain unverified; local provider mocks and distinct `convex-test` identities do not establish live collaboration readiness.

The next local recovery increment (#43) tests separated change restorations
before Apply while preserving other same-file edits. See the
[Overleaf comparison](overleaf-comparison.md) and its real-compiler evidence for
the narrow workflow distinction, remaining gaps and limits. Deployment/live
provider checks (#42) remain deferred; a broader superiority claim requires an
actual matched comparison rather than feature-count parity.

Issue #45 delivers the first [Manuscript visual-writing](manuscript-visual.md)
increment: per-file prose, headings, bold/italic and simple lists using shared
Source/Visual/Proof history. Issues #47–#49 add bounded table cell editing and
TSV paste, figure preview/width/caption controls, rendered equations and project
citation/reference pickers. Apply checkpoints and rechecks exact source before
one shared-undo transaction. Complex/merged tables, fixed column widths, custom
TeX and further manuscript navigation remain under #24; live validation stays
separate in #42.
