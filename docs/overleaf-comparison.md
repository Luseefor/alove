# alove and Overleaf: evidence before a release decision

Checked 2026-10-21 against Overleaf's official documentation and the local alove
implementation. Include Overleaf's paid and AI capabilities in the comparison;
matching a feature restricted to a particular plan is not evidence that alove
is ahead. This is a capability comparison, not an executed Overleaf user study.

## Current position

| Area | Overleaf documentation | alove evidence | Assessment |
| --- | --- | --- | --- |
| Writing surface | Code and Visual editors, layout controls and source/PDF navigation | CodeMirror, coordinate SyncTeX and responsive panes; source-preserving Visual mode remains issue #24 | Overleaf has the broader writing surface. [Editor guide](https://docs.overleaf.com/getting-started/how-do-i-use-overleaf/redesigned-overleaf-editor) |
| Collaboration | Real-time coauthoring, reviewing, comments and automatically tracked edits | Roles, comments and explicit source proposals; no simultaneous character merge or automatic tracking; live two-account checks deferred | Overleaf leads this area. [Collaboration](https://docs.overleaf.com/collaborating/collaborating-in-overleaf), [track changes](https://docs.overleaf.com/collaborating/track-changes) |
| History and Git | Project/file history restoration and Git/GitHub integration | Bounded local/server checkpoints and GitHub pull/push; live OAuth unverified | No general advantage established. [History](https://www.overleaf.com/learn/latex/Using_the_History_feature), [GitHub](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/github-synchronization) |
| Language and research tools | AI explanations, language tools and citation review alongside conventional editing | Project cite/ref completion, English Hunspell and RE2 project search/replacement | No breadth advantage established. Overleaf's July 2026 announcement includes AI allowances across plans; do not treat Error Assist as absent on its free plan. [Current AI announcement](https://www.overleaf.com/blog/overleaf-ai-now-a-part-of-overleaf-plans), [AI assistant](https://docs.overleaf.com/integrations-and-add-ons/ai-features/ai-assistant) |
| Offline operation | Git supports a local editor workflow; Community Edition and Server Pro support offline installations | Account-free local editing, checkpoints and a local Docker compiler | Useful alove workflow, but offline operation alone is not unique. [Git](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration), [offline deployments](https://docs.overleaf.com/on-premises/installation/air-gapped-offline-deployments) |
| Compile recovery | Error Assist documents a suggested diff, user review, Apply suggestion, then automatic recompilation. History can restore a file or project. | Deterministic history-derived trials compile separately before Apply is enabled. Focused trials preserve source outside one separated block, including other edits in the same file. | A specific stronger safety order is demonstrated locally against that documented Error Assist interaction. This does not establish that no alternate Overleaf workflow can achieve the same result. [Error Assist](https://docs.overleaf.com/integrations-and-add-ons/ai-features/error-assist) |

## The useful distinction to develop

For a paper that compiled before a recent edit, alove can test restoring a
separated change block using the recorded Docker runtime. The working document
remains unchanged during those trials. Apply is offered only after a trial
produces a PDF; the proposal and the tested source fingerprint are exportable.
A separate prose revision in the same file and edits in other files survive
that focused restoration. Apply and undo refuse newer source or changed settings.
This recovery path makes no language-model API calls. In local mode its source
and compiler trials stay on the local application/runner. Overleaf documents
that Error Assist sends the error, relevant code lines and file names to OpenAI
when requested, and that the data is not used for training. This is a useful
choice for local debugging, not a claim that all Overleaf operations use AI.

The documented Error Assist interaction applies a suggestion before recompiling.
The comparison here is the order and evidence required before changing the
working document. It is not a claim that every Error Assist suggestion is
unverified internally, that Overleaf lacks debugging assistance, or that manual
history editing cannot preserve prose. Error Assist can address errors without
a known-good local baseline, which alove's history-derived recovery requires.

Focused recovery is local-only and bounded. It can miss a candidate, revert
multiple adjacent edits within one block, or need a whole-file fallback. A
fallback is explicitly labelled because it can discard other same-file edits.
Successful compilation does not establish scientific correctness, equivalent
layout, the smallest patch or causality. See [build recovery](build-recovery.md).

## Evidence required for the decision

The local verification corpus contains four positive preservation cases
(macro deletion, command typo, missing input and removed package) and three
controls (independent file faults, whole-file fallback and changed engine).
The runner compiles real good/failed snapshots, rechecks the baseline and tests
candidate restorations through HTTP, Redis and Docker. It also executes a
whole-file reference operation on the same fixtures. That reference is the
restore-file operation, not an Overleaf session or an Error Assist evaluation.

Run it sequentially against the local production app and worker:

```sh
bun run verify:recovery --base-url http://127.0.0.1:30130 --repeats 3
```

The browser acceptance scenario must verify pre-apply source preservation,
the displayed block, exported input fingerprint, apply/undo, a real rebuild,
durable reload and narrow layouts. The [dated results](benchmarks/2026-10-21-focused-recovery/README.md)
retain complete synthetic source/log evidence: 21/21 expected outcomes, including
all 12 focused preservation runs, across 67 real compiler jobs. The four positive
whole-file reference operations also compiled, but each reversed the separate
prose revision. These are four fixtures repeated three times, not 12 independent
papers or Overleaf trials.

This narrow workflow distinction supports further local work on recovery.
It does not justify a general “better than Overleaf” claim or a performance
claim. Establishing faster or more reliable task completion needs a matched
Overleaf study including Error Assist, repeated complete tasks, preserved-edit
checks, representative papers and failures—not comparison of local compiler
times with guessed cloud times.

Deployment remains deferred. No real-user collaboration or end-user OAuth
claim follows from local tests; those checks remain issue #42.
