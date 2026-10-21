# Authoring and collaboration

The authoring baseline follows the reliability fixes in PR #29. It adds working features under issues #32–#40; it does not establish full Overleaf parity or live provider validation.

## Source and PDF navigation

Successful builds collect bounded SyncTeX data from the actual TeX engine. Source → PDF highlights the current source line in the Interactive viewer. Double-click a point in the PDF to open the corresponding source passage. Page controls also support keyboard navigation. Default switches back to the embedded browser viewer.

Editing source or switching the main document makes the mapping stale. Build again before syncing. Failed builds retain the previous PDF and its provenance. Missing, malformed or oversized maps leave compilation usable and display an unavailable/truncated status. Mapping bounds are 5 MiB compressed/decompressed, 20,000 anchors and 1,000 inputs.

## Language tools and project search

Completion reads all project `.bib` and `.tex` files. Citation variants and comma-separated keys include bibliography metadata; `ref`, `eqref`, `autoref` and `cref` use project labels and their context. This is project parsing, without an external citation database.

Enable Spell in the source status bar or Settings. The English dictionary loads on demand with Hunspell affix rules. Hover a marked word for corrections or Add to dictionary. Settings lists personal words and supports removal and dictionary-load retry. Corrections are ranked when displayed, keeping that work off the typing path. The personal dictionary stays in this browser’s preferences. More languages remain further work.

Search supports case, whole word, regular expressions, and comma-separated include/exclude globs (`*`, `**`, `?`). Results group matches by file, highlight exact hits and navigate to their selections. Regular expressions use RE2 syntax; unsupported lookaround/backreferences fail visibly. Binary previews are excluded. Results are bounded; refine a truncated search before replacing all.

Replace one or preview Replace all. Changing source or search options invalidates the results. Saving/checkpointing must succeed before replacement, and a revision check refuses changes that arrive while the checkpoint is written.

## Cloud access and review

Deploy the updated Convex schema/functions together with the web application. In Share, owners invite an existing Clerk account by its verified email. The recipient accepts the invitation on Projects within seven days. Owners can change a collaborator’s role, remove access or revoke an invitation. Shared projects appear in the recipient’s project list.

- Owners manage access and can delete the project.
- Editors change source, compile, restore history and participate in review.
- Viewers read and export source/history/review, without source or review mutations.

Authorization is checked on every server operation. Source writes still use version and row-identity compare-and-swap. This remains conflict-aware file synchronization; simultaneous edits to the same passage do not provide character-level merging.

Select source, open Review and capture the selection. Add an anchored comment, reply, resolve or reopen a thread. A changed or ambiguous passage is marked rather than silently relocated. Limits are 100 threads and 1,000 messages per project.

Edit Proposed replacement to submit a tracked source proposal, including insertion or deletion. The original source remains canonical until an editor accepts the proposal. Acceptance checkpoints source, verifies current file identity and resolves the original passage by unique context; stale/ambiguous passages require a new proposal. Rejection changes only proposal status. This proposal-based workflow supports 100 suggestions per project; it does not automatically track every editor keystroke.

## Source history and recovery

History in local projects retains 20 readable IndexedDB checkpoints / 50 MiB. Cloud History retains 100 file revisions / 8 MiB, with content stored separately from metadata. Saves, deletion, rename, restoration and accepted suggestions preserve prior source atomically.

Bulk cloud replacements and GitHub pulls also preserve complete project snapshots, including projects above 100 files. The two latest snapshots retain at most 8 MiB. History can preview/restore individual checkpoint files or download the complete snapshot as `.alove.json`; import it from Projects to recover an independent copy. Retention is bounded, so export important milestones for longer storage.

## GitHub repository pull/push

Cloud projects expose GitHub in the header. Configure the Clerk GitHub OAuth connection to permit the `repo` scope and the application’s redirect URLs. The signed-in account grants GitHub access through Connect GitHub account. Access tokens are obtained server-side from Clerk, never returned to the editor or saved in project records. Each collaborator uses their own GitHub authorization.

Owners select a repository and branch. For an empty repository, enter a branch name and explicitly confirm Initialize empty branch from saved source. Initialization creates a new branch without replacing an existing ref; a competing branch creation refuses the operation. For an existing branch, Preview pull lists additions, possible updates, removals and local-only files that will be kept. The initial import requires explicit confirmation and merges repository files into the project. Applying a pull rechecks the remote head, the repository binding and every saved file identity, then checkpoints the entire project and applies the tree atomically. Local-only files survive; subsequent pulls remove only paths previously tracked by sync.

Push saves source and compares the live branch with the last synchronization. It creates Git objects and advances the branch without force. A moved branch, an untracked remote collision, symlink/submodule collision or stale local snapshot refuses the operation. Pull and review remote changes before pushing again. If a push reaches GitHub but its local acknowledgement fails, Refresh reconciles only when remote and saved project contents match exactly.

The workflow currently targets GitHub repositories and lists the first 100 repositories/branches. Project limits remain 250 files, 768 KiB per file and 4 MiB total. Unsupported binary formats, unsafe paths, oversized/truncated repository trees, symlinks and submodules are refused. No force-push or silent conflict overwrite is offered.

## Validation boundary

Unit/API tests use provider mocks, and Convex tests use distinct authenticated identities. Real TeX/browser evidence is recorded in [quality-progress.md](quality-progress.md). Live deployed Clerk login, two-account invitation/revocation and GitHub OAuth pull/push are separate checks and are not claimed from those local tests.
