# Manuscript browser evidence

Local production browser check on 2026-10-21. These are synthetic acceptance
fixtures, not an Overleaf comparison or a user study. The editor uses the same
canonical LaTeX source in Source, Visual and Proof.

The browser journey imports CRLF source with a custom macro, comments, existing
bold/italic markup and a second file. It exports an exact source archive before
editing; applies formatting; undoes in Source and redoes in Visual; types an
accented string containing `%`; and commits simulated IME composition through
Chromium's input protocol. Each expected source is checked byte-for-byte.
Protected custom source refuses editing. The result is saved, reloaded and
exported again. No assertion accepts normalization of the original CRLF bytes.

| Width | Light | Dark |
| --- | --- | --- |
| Phone, 390 px | [Screenshot](manuscript-390-light.png) | [Screenshot](manuscript-390-dark.png) |
| Tablet, 768 px | [Screenshot](manuscript-768-light.png) | [Screenshot](manuscript-768-dark.png) |
| Desktop, 1440 px | [Screenshot](manuscript-1440-light.png) | [Screenshot](manuscript-1440-dark.png) |

A separate scenario applies italics and creates a bulleted list, checks the
exact resulting source, and compiles the paper through real HTTP, Redis and
the Docker TeX runner, requires a returned PDF, and opens build recovery. Both
scenarios passed against the rebuilt production application. The same spec is
included in Docker CI, while its non-compiler case runs in ordinary browser CI.

Corrected attempts: the first guard check found that focus after a mode switch
could adopt the browser's collapsed selection. `EditorView.focus()` now restores
the canonical selection after reconfiguration; the unchanged protected-edit
assertion then passed. Screenshot review exposed duplicate native/custom Find
panels and cramped mobile controls; capture-phase Find handling now opens only
the existing app Find UI, and compact labelled list buttons fit the phone bar.
The rebuilt native typing/composition/export checks passed without increasing
budgets or removing assertions. Initial unit tests also exposed CRLF
normalization, fixed by preserving CR in CodeMirror's canonical text.

This establishes the tested first visual-writing increment only. It does not
cover every browser, physical input method, journal template, macro definition
or package. Rich tables, figures and math/citation editors remain under #24;
see [Manuscript scope and limits](../../manuscript-visual.md).
