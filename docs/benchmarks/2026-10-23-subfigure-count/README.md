# Subfigure panel count (#61)

[Phone removal confirmation](subfigure-remove-phone.png),
[phone reorder controls](subfigure-order-phone.png),
[desktop editor](subfigures-desktop.png), and
[phone editor](subfigures-phone.png) show the final production build.

Add inserts a project-image panel after the selection, selects it, uses a unique
project label and leaves existing widths unchanged. Remove requires confirmation
and retains at least one panel; groups have at most four active panels. Selection
changes cancel pending confirmation. Upload results remain tied to their original
panel, and removed new drafts are compacted rather than accumulated.

Structural edits preserve surviving original blocks exactly and retain source
outside the original panel span. Only whitespace and hfill/hfil separators may
be rebuilt. Comments, forced linebreaks and metadata between panels require Source
for count changes. Order-only moves retain those separator bytes as before.

Local validation passed 1,076 web unit tests across 89 files, workspace tests,
lint/typecheck, production build and all five object browser journeys. The new
journey checks confirmation cancellation, one/four limits, add/remove no-op,
combined add/edit/reorder/remove, exact surviving blocks and outer source,
unique labels, one undo/redo, reload and phone confirmation visibility.

Two initial unit-test assertions were corrected: the option count included
unrelated dropdowns, and an image-path absence assertion confused removal of an
original panel with reuse of its image by a new panel. The final tests check
panel options and original caption/label/block identity instead. No application
guards, assertion timeouts or compiler limits were relaxed.

Local Chromium uses an installed revision through a temporary uncommitted config.
Local Docker is unavailable, so the PDF portion runs under E2E_REAL_COMPILE=1 in
Docker CI. Deployment/live providers remain deferred in #42.
