# Visual object acceptance evidence

Local production browser check on 2026-10-22. This is a synthetic acceptance
fixture, not an Overleaf user study or a performance comparison.

The fixture imports CRLF LaTeX, a two-column table, inline math, section/table
labels, a BibTeX bibliography and an untouched second file. It checks exact
exports through Cancel, cell editing, Source undo/Visual redo, TSV paste,
explicit table resizing/alignment, captions and durable reload. Clicking a cell
focuses its corresponding dialog field; arrow keys move between fields.

Additional scenarios edit an equation with a rendered preview, search and change
project citation/reference keys, insert tables/display equations, upload a PNG,
resize and caption it, explicitly enable graphicx, and undo/redo the source
transaction. Upload remains an independent project asset. With E2E_REAL_COMPILE=1,
the edited paper goes through HTTP, Redis, sandboxed Docker TeX and BibTeX and
must return a PDF. No compiler result is mocked in that path.

| Width | Light | Dark |
| --- | --- | --- |
| Phone, 390 px | [Screenshot](objects-390-light.png) | [Screenshot](objects-390-dark.png) |
| Tablet, 768 px | [Screenshot](objects-768-light.png) | [Screenshot](objects-768-dark.png) |
| Desktop, 1440 px | [Screenshot](objects-1440-light.png) | [Screenshot](objects-1440-dark.png) |

All screenshots show the table dialog; the test also checks the document has no
horizontal page overflow. Ace separately inspected the native editor/table/math
surface and cell-focus dialog at phone/tablet/desktop sizes. The checked tab had
no console errors.

Corrected attempts: a new adapter test initially selected CodeMirror's invisible
widget-buffer image; the assertion now targets the figure image specifically.
The test was retained and verifies that a project asset update refreshes the
preview without recreating the editor or changing source. A session test's hard
coded revision was replaced by the actual revision captured by the store's
source-change subscription. The first full run passed 91, skipped two cloud cases and failed one
new table assertion that assumed separator spacing. It now checks the edited
cell and exact untouched prefix rather than pretty-print whitespace. Continuing
that scenario caught a real CRLF bug: new inline math lacked the document
line-ending context when converted to display math. The parser now receives
that context, and a regression checks both existing and newly inserted math.
The CRLF assertion was retained. Review also added recognition masks for commented commands and
explicit selected-cell focus before the final build.

Limits: plain-cell tabular tables up to 20×12, supported figure width syntax,
bounded KaTeX previews and key chips. Merged/fixed-width/complex tables, custom
figure options, arbitrary macros and compiled bibliography-number rendering
still use Source/Proof. Deployment and live two-account/provider validation are
deferred in #42. See [scope and limits](../../manuscript-visual.md).
