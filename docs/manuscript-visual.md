# Manuscript visual writing

Visual mode edits supported text on the compiled PDF page. The earlier per-file
projection is now named **Manuscript** inside Source. Both write precise patches
to the canonical LaTeX document and retain the mounted source editor's undo history.
No HTML-to-LaTeX conversion regenerates the project.

## Writing modes

- **Source** shows the selected file's LaTeX. Its LaTeX/Manuscript control switches
  between raw source and the existing prose/object projection.
- **Visual** opens the PDF across the writing area. Click a supported paragraph,
  heading or list item to edit it on the page, then choose Apply & rebuild.
  Supported table, figure and equation clicks open their existing controls.
- **Proof** shows source and PDF together on desktop. Narrow layouts show one
  pane at a time, with Source/PDF controls.

Entering Visual builds a missing or outdated PDF. An empty document body instead
shows a blank writing page; the first paragraph is escaped into the body, checkpointed
and compiled. A working compile service is required to typeset the updated PDF.

## Editing on the PDF (#67)

Editable regions require an exact normalized match between source-backed text and
actual PDF text runs, plus nearby SyncTeX coordinates for the same file and lines.
Nearest-source-line navigation alone does not authorize a text replacement.
Ambiguous repeated text is omitted. On-page drafts survive Source/Visual switches
and PDF rerenders. Apply checks project, role, full source, revision and PDF provenance
before and after checkpointing, then makes one shared-undo source edit and rebuilds.
Typing `%`, `&` or other TeX-special characters inserts escaped prose. Included files
are edited in their own source document. An unsuccessful build retains the last PDF;
rebuild before making further mapped edits. Undo remains available in the app header.

This supports plain body paragraphs, standard headings/list items and plain text
inside supported bold/italic wrappers. A whole text block must match on the current
PDF page. Paragraphs spanning pages, rotated text, custom macro output, unmatched
hyphenation and ambiguous mappings use Source or Manuscript. Complex PDF layouts
are not reconstructed from pixels. The default/native PDF viewer remains available
in Proof; Visual always uses the interactive PDF canvas.

## Manuscript source presentation

The Manuscript control provides the earlier source-backed prose and object editor.
Select prose to apply bold or italic, or choose a heading style for its line.
Select plain lines to create a bulleted or numbered list. These actions change
only that source range and form one undoable operation. Formatting controls do
not rewrite the preamble. The document setup control opens Source explicitly.

## Source preservation

The Manuscript presentation hides known command wrappers while retaining their exact
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
The table opens as a grid with a formatting toolbar. Use Columns, Borders or
Caption for settings, the merge menu for spans, and the more menu for row/column
operations. On phones the table workspace fills the screen; Apply/Cancel stay
visible while the grid or settings scroll.
All dialogs have a Source action, keyboard focus containment and Escape/Cancel.
Apply saves a checkpoint first, rechecks the exact project/file/revision/source
and role, then makes one undoable transaction. A newer edit, project switch,
viewer role or failed checkpoint leaves the draft unapplied.

- **Tables (#47, #51):** edit plain or supported formatted cells, paste a bounded
  tab-separated spreadsheet selection, insert/delete rows or columns, merge
  horizontally across one row, split merged cells and set their alignment.
  Merge joins all contents with spaces; split keeps that content in the first
  cell. Deleting populated cells needs explicit confirmation. Natural and
  wrapping `p`/`m`/`b` columns support bounded dimensions and alignment. Imported
  standard `tabularx` tables also support flexible `X` columns and table width;
  standard `longtable` cells, captions and labels are editable. Vertical
  single/double boundaries, horizontal/partial rules and booktabs presets are
  available. Rich cells support bold, italic, underline, line breaks and inline
  math through safe previews; LaTeX mode keeps source visible in the cell field.
  Plain clipboard text is escaped, and TSV refuses merged/custom overlaps.
  Cell-only edits patch only their source ranges; column-only edits patch the
  column definition. Explicit structural changes rebuild only the table body.
  No-op/Cancel preserve exact bytes, including CRLF, float placement, captions
  and labels. Required array/booktabs/tabularx/longtable setup is added only with
  consent, in the same main-file transaction; included files require main setup
  in Source first. Limits: 20 rows × 12 columns, 64 Ki pasted characters and
  10,000 characters per cell. Custom cells/comments and repeated longtable
  headers protect structure while allowing independent supported cell edits.
  Standard positive vertical multirow spans support merge/split with all contents
  retained in the anchor. Horizontal and vertical spans cannot be combined;
  split them before changing intersecting rows. First/repeated headers and
  footers in longtable have labelled sections and exact independent cell edits.
  Structural rewrites across these sections stay in Source. Programmable/repeated columns, custom spacing,
  environment conversion and rich HTML/CSV paste require Source. The preview
  illustrates structure; the compiled PDF remains the layout authority.
- **Figures (#48):** select a project PNG/JPEG/PDF, or upload one up to 500 KB;
  resize from 10–100% of text width by dragging, keyboard, slider or number,
  and edit plain captions/labels. Explicit float placement keeps the original
  option until changed; H requires consent to enable float. Standard
  includegraphics width options using textwidth/linewidth are supported; custom
  options remain Source. PNG/JPEG preview from project data only; PDF figures
  are shown in compiled Proof. If graphicx is absent from the main setup,
  explicit consent adds it in the same source transaction when editing that
  main file. Included files require setup in Source first. Uploads are separate
  project files and remain after Cancel or undo of the figure insertion. There
  is no crop, remote-URL fetch or arbitrary TeX package inference.
  Standard subcaption groups support up to four panels with one contextual
  editor for the selected panel: project image, width, alignment, caption and
  label. Group caption/label/placement are separate. Move earlier/later changes
  panel order as a draft, retaining selection and edits on the same original
  panel. Apply moves exact panel blocks between existing separator slots;
  comments, custom captions and line endings travel with their panel. Add panel
  uses a project image and a unique label without resizing existing panels.
  Remove panel requires confirmation; groups retain one to four panels.
  Count changes preserve surviving panel blocks and reuse supported separator
  slots. Comments, forced linebreaks or metadata between panels require Source
  for count changes; order-only moves still retain those separator bytes.
  Insertion adds a two-panel group with unique labels. Subcaption setup also
  requires consent in the same checkpointed transaction. Custom layouts stay
  in Source.
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
Issues #54–#56 add project navigation, figure controls and vertical table spans.
Issue #24 still includes unsupported table structures and arbitrary custom TeX support. Deployment/live provider checks stay deferred in
#42. See the [dated comparison](overleaf-comparison.md) for the remaining gaps.

## Manuscript navigation (#54)

The outline follows literal input/include commands from the chosen main file in
manuscript order. Entries identify the file and line, including repeated inputs.
It skips comments, verbatim content and macro arguments; missing/dynamic inputs,
cycles and scan limits have notices. Literal includeonly uses its last assignment.
The bounded scanner does not execute macros, conditionals, custom import packages
or TeX filename expansion. Root-relative targets win; a missing root target may
resolve relative to its including file when that path exists inside the project.

Outline, search, diagnostics and reverse SyncTeX reveal the source pane on phones.
Targets hidden or protected by Visual switch to Source before their selection is
consumed. Forward SyncTeX reveals Proof. These view changes preserve source and
per-file undo. Missing-file and stale diagnostic clicks do not open a wrong file.

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
Advanced-table checks also compile edited merges, rich cells, widths, borders,
tabularx and longtable through the actual worker; deletion/paste refusals,
explicit package consent and byte-exact shared undo are covered.
See quality-progress.md for final results and any corrected attempts.
