# Subfigure ordering (#59)

[Phone reorder draft](subfigure-order-phone.png), [desktop editor](subfigures-desktop.png),
[phone editor](subfigures-phone.png) show the rebuilt production application.

Move earlier/later retains the selected original panel and its unsaved edits.
Apply moves exact panel blocks between existing separator slots. Panel count
changes and custom layouts remain Source operations.

Local validation passed:

- 1,063 web unit tests across 89 files; workspace tests, typecheck and lint.
- Standalone production build.
- Four object browser journeys, including exact exported bytes after edit +
  reorder, Cancel, single undo/redo, reload, phone bounds and keyboard activation.
- Ace browser inspection at desktop and phone sizes; no console errors.

The local browser config selected the installed Chromium headless shell because
its revision differs from the package default. The temporary config is not shipped.
Local Docker is unavailable and the worker is offline, so the real PDF portion
of the browser journey is reserved for Docker CI with E2E_REAL_COMPILE=1.
Deployment/live provider checks remain deferred in #42.
