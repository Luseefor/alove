# Editing on the PDF

Issue #67 changes Visual from a source projection into a PDF editing surface.
The previous projection remains available as Manuscript inside Source.

## Local browser evidence

- [Desktop draft on the PDF](pdf-draft-1440.png).
- [Phone draft on the PDF](pdf-draft-390.png).
- [Desktop after undo and rebuild](pdf-edit-1440.png).
- [Phone after undo and rebuild](pdf-edit-390.png).

These local screenshots use an actual minimal PDF rendered by pdf.js, with a
stubbed compiler transport and an explicit source-coordinate fixture. They prove
on-page interaction, source updates and undo; they do not constitute a local TeX
compiler run. The included-file journey imports source, enters Visual, edits a
paragraph on the page, preserves the draft through Source/Visual switches, applies
an escaped percent sign, rebuilds, exports exact source, undoes and rebuilds again.
The blank-document journey starts writing without submitting an empty build.
A mapped equation click opens its existing controls and Apply triggers a rebuild.

The production CI real-compiler journey in `e2e/pdf-visual.spec.ts` builds an
included manuscript, edits it through the PDF, rebuilds and checks exact source
preservation. Its draft/result screenshots are uploaded as the
`pdf-visual-editing-evidence` artifact. Results are recorded in the pull request.

## Validation

- 1,117 web unit tests pass with two workers. A highly parallel local run timed
  out in two pre-existing editor retention tests; reducing concurrency passed the
  full suite without changing those tests.
- Workspace lint and typecheck pass; production build passes.
- Four deterministic PDF browser cases cover phone/desktop text edits,
  blank-document writing and equation controls. Real-compiler execution is
  delegated to the Docker CI job because no local TeX service is installed.

## Boundaries

Only exact PDF-text matches with nearby source coordinates are editable.
Custom macro output, multi-page paragraphs and ambiguous matches remain Source
operations. Checkpoint failure or stale/read-only source refuses Apply while
keeping the draft. This is source-backed manuscript editing, not arbitrary PDF
binary rewriting.
