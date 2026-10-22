# Advanced visual table acceptance evidence

Checked locally on 2026-10-22 against the production build and actual TeX worker.
These synthetic acceptance fixtures do not establish Overleaf task performance
or general visual-editor parity.

The imported CRLF project contains a three-column tabular float, a tabularx
with an X column, a longtable with caption/label, and an untouched second file.
The browser scenarios check:

- Byte-exact no-op/Cancel, rich text and inline math, horizontal merge/split,
  wrapping widths, booktabs rules, and explicit array/booktabs package consent.
- One shared undo transaction for source and setup, exact restoration on undo,
  redo and durable reload; unaffected caption/float and second-file bytes.
- Refusal of TSV through merged cells, retention of combined content on split,
  and mandatory consent before populated row deletion.
- Independent tabularx width/cell and longtable cell edits with exact surrounding
  source preservation.
- Actual HTTP → Redis → Docker compilation of the edited source, including
  merged formatted text, math, m-column widths and booktabs plus the edited
  tabularx/longtable. The current PDF must become ready; no compiler mock is used.
- Dialog containment at 390/768/1440 px, light/dark themes, arrow-key navigation
  and focus returning to the writing surface after Escape.

Final local checks: 966 web tests across 79 files; workspace typecheck, lint
and production build pass. Full production browser run: 97 passed, two deferred
cloud skips.

[Rejected phone form](before-phone.png) · [Replacement phone grid](advanced-tables-390-light.png)

| Width | Light | Dark |
| --- | --- | --- |
| Phone, 390 px | [Screenshot](advanced-tables-390-light.png) | [Screenshot](advanced-tables-390-dark.png) |
| Tablet, 768 px | [Screenshot](advanced-tables-768-light.png) | [Screenshot](advanced-tables-768-dark.png) |
| Desktop, 1440 px | [Screenshot](advanced-tables-1440-light.png) | [Screenshot](advanced-tables-1440-dark.png) |

The table grid scrolls within the modal; the page has no horizontal overflow.
Apply/Cancel remain in a fixed footer outside the scrolling grid/settings.
Three-column fixtures must show every column on a phone without horizontal
scrolling. Ace also inspected the running
native browser preview and dialog at narrow and desktop sizes.

The first interface stacked every setting below an oversized input grid. It
passed a page-overflow assertion but clipped columns and buried controls on
phones. After user review, it was replaced with a full-screen phone grid,
compact formatting toolbar, separate settings panels and fixed actions. The
revised assertions check the final cell and action bounds, not just page width.

Corrected attempts: the first compile test waited for an outdated “Recompile”
button label and timed out before sending a job. It now targets the established
compile control and checks the PDF pane's ready status. The rerun compiled the
edited source successfully. A component-selection test initially dispatched an
input-level select event; document selectionchange is required to exercise
React's controlled-input onSelect in jsdom. Its exact escaping assertion was
retained and passed. Review also corrected merged-cell preview alignment/border
precedence and synchronized explicit border changes with multicolumn overrides.

Supported scope is bounded to 20×12 cells with horizontal spans, known column
specifiers and inline markup. Vertical multirow merging, programmable columns,
custom spacing and repeated-longtable-header restructuring require Source.
Compilation remains the layout authority. Deployment, real-user OAuth and live
two-account validation remain deferred in #42.
