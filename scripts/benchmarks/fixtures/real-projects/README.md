# Real-project recovery fixtures

This folder vendors a small, pinned subset of a real public LaTeX project for
recovery-corpus use. It does not run the compiler, server, browser, build, or
git, and it adds no dependencies.

## What this is

- Upstream: https://github.com/dcroote/stanford-thesis-example (`master`,
  commit `ffef6af633d0716fb0592b83c8ce594ed38819d2`).
- This is a real public thesis **TEMPLATE / example thesis**, not a real
  submitted manuscript, not a private thesis, and not a user study.
- It is not a representative survey of real papers. It is one pinned public
  template used to check that focused recovery works on real-world file shapes
  (`\include`, `.sty`, `.bib`, real PNG) rather than only synthetic `article`
  fixtures.
- Baseline is original upstream with no adaptations. If an adaptation is ever
  needed (engine, timeout, path shim), it must be documented separately; this
  change has none.
- Build status is **unclaimed** here. Actual-compiler verification is future
  work via the primary verification CLI (`verifyFocusedRecovery.ts`), which
  runs the real compiler. This corpus change only defines fixtures and proves
  targeted diffs, hashes/provenance, and licensing statically.

## Vendored files (unchanged)

Under `stanford-thesis-example/`:

- `main.tex`, `ch_intro.tex`, `ch_paper1.tex`, `ch_conclusion.tex`,
  `preface_abstract.tex`, `preface_acknowledgements.tex`, `mybib.bib`,
  `suthesis-2e.sty`, `figs/paper1/fig1.png`, `LICENSE`.

All bytes are unchanged from the pinned commit. All copyright notices are
preserved:

- Repository `LICENSE`: MIT, `Copyright 2019 Derek Croote`.
- `suthesis-2e.sty`: original Stanford thesis-style permissive notice
  (“People are free to borrow as long as they … acknowledge the work …”,
  Joseph Pallas / Emma Pease lineage).
- `main.tex` / `suthesis-2e.sty` headers preserve the Stanford/Registrar
  comments.

`stanford-thesis-example.manifest.json` records the canonical URL, branch,
commit, and SHA-256 + byte size for every vendored file.

## Corpus cases (`../realProjectRecoveryCorpus.ts`)

`realProjectRecoveryCorpus` exports the same `FocusedRecoveryFixture` type as
`focusedRecoveryCorpus.ts`:

1. `real-thesis-chapter-typo-preserved` — `ch_paper1.tex` command typo
   (`\textbf` → `\textfb`) plus a later separated same-file prose addition.
   Expected `verified` / `hunk` on `ch_paper1.tex`, preserving prose.
2. `real-thesis-include-command-preserved` — `main.tex`
   `\include{ch_paper1}` → `\incldue{ch_paper1}` plus a later separate
   same-file prose addition. Expected `verified` / `hunk` on
   `main.tex`, preserving prose.
3. `real-thesis-dual-fault-unresolved` — independent faults in two files
   (`ch_intro.tex` undefined command + `ch_paper1.tex` typo). Expected
   `unresolved` control with no restoration payload.

Payload `files` are text plus a `data:image/png;base64,…` URL for
`figs/paper1/fig1.png`, matching the existing corpus binary convention.
`LICENSE` is vendored for provenance/licensing only and is not part of the
compile payload.

Fetch used the existing Mac GitHub login
(`GH_CONFIG_DIR=/Users/lucifer/.config/gh`), no tokens.
