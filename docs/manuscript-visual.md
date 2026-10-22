# Manuscript visual writing

The work under issue #24 adds a per-file Visual surface for standard LaTeX
prose and supported tables, figures, equations and citation/reference controls. Source, Visual and Proof share the same canonical document and
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

Comments, custom commands, unsupported groups/environments and unsupported math
remain visible source fragments. Edits crossing protected wrappers are refused with a
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

## Tables, figures, equations and project keys

Place the cursor in a body paragraph, then use **Insert** in the Visual toolbar.
Click an existing object to edit it. Clicking a table cell focuses that cell's
field; arrow keys move between grid fields and Tab follows native form order.
All dialogs have a Source action, keyboard focus containment and Escape/Cancel.
Apply saves a checkpoint first, rechecks the exact project/file/revision/source
and role, then makes one undoable transaction. A newer edit, project switch,
viewer role or failed checkpoint leaves the draft unapplied.

- **Tables (#47):** edit plain cells, paste a tab-separated spreadsheet selection,
  add/remove the last row or column, set left/center/right column alignment and
  edit plain captions/labels. A cell-only change patches only that cell's source
  bytes. Resizing/alignment explicitly rebuilds the tabular portion. Existing
  rule commands, comments, custom cells, captions and surrounding float source
  remain intact during other edits. Custom cells are read-only and disable
  structural changes. Limits: 20 rows × 12 columns, 64 Ki pasted characters;
  oversized paste is refused without truncation. Merged cells, fixed column
  widths, longtable/tabularx, custom spacing and rich HTML/CSV paste use Source.
- **Figures (#48):** select a project PNG/JPEG/PDF, or upload one up to 500 KB;
  resize from 10–100% of text width and edit plain captions/labels. Standard
  includegraphics width options using textwidth/linewidth are supported; custom
  options remain Source. PNG/JPEG preview from project data only; PDF figures
  are shown in compiled Proof. If graphicx is absent from the main setup,
  explicit consent adds it in the same source transaction when editing that
  main file. Included files require setup in Source first. Uploads are separate
  project files and remain after Cancel or undo of the figure insertion. There
  is no crop, drag-resize, remote-URL fetch or arbitrary TeX package inference.
- **Equations (#49):** inline/display math and equation/equation* render through
  KaTeX with a LaTeX input, symbol buttons and live preview. Editing the body
  retains original delimiters, labels and whitespace. An explicit display toggle
  is available for unnumbered, unlabelled expressions. Unknown macros retain
  exact Source fallback; the preview does not execute the document preamble.
  Rendering disables trusted HTML/URLs, bounds size and macro expansion, and
  starts fresh macro state for each expression. Compilation remains authoritative.
- **Citations/references (#49):** project-wide bibliography metadata and label
  context can be searched, selected or entered as keys. Key edits retain existing
  cite notes, stars and style syntax; style changes patch only the command name.
  Missing keys are labelled and preserved until changed. Ref/eqref/autoref accept
  one key; cref/Cref and supported citation styles accept multiple keys. Styles
  requiring natbib/biblatex/hyperref/cleveref need their normal package setup;
  the picker does not install them. Chips show keys rather than compiled numbers
  or bibliography-style output.

These are bounded source-backed controls, not full visual-editor parity.
Issue #24 still includes wider manuscript navigation, complex tables and
arbitrary custom TeX support. Deployment/live provider checks stay deferred in
#42. See the [dated comparison](overleaf-comparison.md) for the remaining gaps.

## Validation

Unit checks cover exact source ranges, nested formatting, opaque custom syntax,
comment/math/verbatim exclusion, malformed document markers, bounded analysis,
protected edit refusal, escaped input, CRLF, read-only behavior and shared undo.
The production browser journey checks byte-exact source export before/after
mode switches, formatting, undo/redo, native typing, simulated IME composition,
custom-source refusal, durable reload and layouts/themes. A separate real
Redis/Docker scenario compiles the visually formatted paper and opens recovery.
Object tests additionally cover exact cell/caption/key patches, bounded paste,
comment-shaped commands, unsafe image paths, KaTeX trust/expansion limits, stale
checkpoint races, viewer refusal and live asset refresh without a view reset.
Production browser tests exercise the object dialogs, spreadsheet paste,
shared undo, durable reload, responsive themes and a real PNG/TeX/BibTeX build.
See quality-progress.md for final results and any corrected attempts.
