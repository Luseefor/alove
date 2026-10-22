# Manuscript visual writing

This first increment of issue #24 adds a per-file Visual surface for standard
LaTeX prose. Source, Visual and Proof share the same canonical document and
CodeMirror history. No HTML-to-LaTeX conversion regenerates the project.

## Writing modes

- **Source** shows the selected file's LaTeX on a broad editing canvas.
- **Visual** presents standard section headings, bold/italic text and simple
  itemize/enumerate lists with manuscript typography. Files remain available on
  demand; entering Visual closes the desktop file browser.
- **Proof** reveals the compiled PDF beside the last editing surface on desktop.
  Narrow layouts show one pane at a time, with Source/PDF controls.

The initial layout remains Proof with Source editing for compatibility with
existing projects. Visual requires a `.tex` file and CodeMirror; the textarea
fallback and non-TeX assets retain their existing source/preview behavior.

Select prose to apply bold or italic, or choose a heading style for its line.
Select plain lines to create a bulleted or numbered list. These actions change
only that source range and form one undoable operation. Formatting controls do
not rewrite the preamble. The document setup control opens Source explicitly.

## Source preservation

The visual surface hides known command wrappers while retaining their exact
source offsets. Paragraph typing, native paste and formatting write through the
existing save/checkpoint path. Mode switching does not replace the editor or
create a source edit. Undo/redo remains shared across modes and retained file
states. CRLF and mixed line-ending bytes remain canonical rather than being
normalized on the first edit.

Ordinary visual input escapes LaTeX-special characters. Pasted LaTeX is treated
as prose; use Source to paste commands. Existing escaped characters render as
literal characters and can be deleted as complete tokens. Protected command
boundaries refuse typing that could accidentally rename a custom command.

Comments, custom commands, unsupported groups/environments and math remain
visible source fragments. Edits crossing protected wrappers are refused with a
Source action available. Navigation to hidden setup or protected syntax opens
Source rather than leaving an invisible selection. Viewer roles cannot format
or type. Remote/source synchronization remains distinct from user typing.

## Limits

This is structured writing for a standard subset, not arbitrary-TeX WYSIWYG.
Only standalone, single-line section/subsection/subsubsection headings without
optional arguments are projected. Custom list labels and complex environments
remain source. Bold/italic requires a selection; list creation requires plain
body lines. Cross-structure deletions require Source. Empty/new paragraph
behavior follows the underlying LaTeX text editor; complex list restructuring
also uses Source.

Analysis is capped at 1 Mi UTF-16 units and 20,000 LF-separated lines per file.
Known nesting is bounded; large or ambiguous syntax falls back to protected
source. The projection does not execute macro definitions or infer package
semantics. Compilation remains the authority for typeset output; Proof can show
a previous successful PDF while source is newer.

Editable table cells, spreadsheet paste, image resizing/captions, rendered math
editors and citation/reference chips are subsequent increments of #24. Existing
source insertion tools, project completion and SyncTeX remain available. The
new surface does not establish Overleaf visual parity or live collaboration
readiness. Deployment/live provider checks remain deferred in #42.

## Validation

Unit checks cover exact source ranges, nested formatting, opaque custom syntax,
comment/math/verbatim exclusion, malformed document markers, bounded analysis,
protected edit refusal, escaped input, CRLF, read-only behavior and shared undo.
The production browser journey checks byte-exact source export before/after
mode switches, formatting, undo/redo, native typing, simulated IME composition,
custom-source refusal, durable reload and layouts/themes. A separate real
Redis/Docker scenario compiles the visually formatted paper and opens recovery.
See quality-progress.md for final results and any corrected attempts.
