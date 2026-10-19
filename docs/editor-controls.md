# Editor control coverage

The editor controls operate on the current source, selected file, persisted settings, or actual compiler result. Empty-state and unavailable actions are explicitly disabled or explained. This is local standalone validation, not a claim that cloud deployment or every browser has been tested.

| Surface | Implemented behavior | Evidence |
| --- | --- | --- |
| Cite | Search by text, fuzzy tokens or exact BibTeX key; insert at the current selection | Reference unit tests + production browser |
| Figure, Table, math snippets | Insert in the document body; toolbar changes can be undone/redone | Store/CodeMirror tests + production browser |
| Find | Next/previous with wrap, Enter/Shift+Enter/Escape | Production browser |
| Project search | Literal/regex and case options, visible regex errors, Clear, result jump | Production browser |
| File actions | Safe create/rename/folder, collision errors, confirmed deletion, persisted main root | 23 path tests + production browser |
| Upload | Size/path validation, binary data URLs, asset preview, persistence | Production browser PNG decode/reload/collision/delete |
| Editor settings | Autocomplete, bracket closing, non-blinking cursor, code check, spellcheck, Vim and Emacs navigation | CodeMirror facet/history tests + browser settings/reload |
| Theme/palette | Reconfigure without destroying editor history | CodeMirror unit tests + light/dark responsive screenshots |
| Compiler | All three engines use the configured root; clean-aux option reaches the worker | Existing real Docker engine tests + browser request/result check |
| PDF viewer | Embedded native controls, fit-width fragment, explicit browser-tab Blob link | Viewer tests + real compile; Chrome native PDF smoke |
| Tabs and Undo/Redo | Per-file history and selection restored when text still matches; project isolation | CodeMirror/store tests + browser tab-switch undo |
| Project/library controls | Saved projects, title search, rename/delete, independent templates/import, archive sharing | See issue #5 and project-library browser tests |

`Find` is case-sensitive within the active file; project search has separate case/regex options. Figure snippets leave missing image paths commented until an asset is chosen. Math/theorem snippets may need packages in the preamble, documented on `/help`. Emacs mode provides CodeMirror's Emacs-style navigation keymap, not a complete Emacs environment.

The browser-tab PDF action uses a Blob URL owned by the current page. The headless-shell regression verifies actual `%PDF-` bytes and a popup action; it does not pretend to render a native viewer. A separate fresh-profile Google Chrome 155.0.8059.80 smoke opened the compiled document at its Blob URL, loaded Chrome's PDF viewer extension, and rendered the one-page article.

Final local validation: 245 unit tests across 26 files; 46 production Chromium tests passed, two cloud-only tests skipped; six-package typecheck, web lint/design-token checks and production build passed. The first browser run exposed an unlabeled reference selector (fixed) and an unsupported headless PDF-URL assertion (replaced with bytes + popup checks, then native Chrome rendering checked separately). Additional test-only selector errors were corrected before the final run.

Live Clerk/Convex account integration remains unverified. Local Share exports a portable source archive; it does not advertise live collaboration or a billing plan. Existing compile-recovery limits are unchanged.
