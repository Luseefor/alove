# CodeMirror Browser QA

## Phase 6.7 — Playwright E2E Tests (2026-05-07)

- **Branch:** `feature/latex-ide-redesign` (current working tree)
- **Mode:** Default (textarea) and CodeMirror-enabled (`NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true`)
- **Tool:** Playwright 1.59.1 (Chromium headless)
- **Build:** Next.js webpack (`next build` without `--turbopack`)
- **Ports:** 30129 (default), 30130 (CodeMirror)
- **Commands used:**

### Default mode
```sh
cd apps/web
rm -rf .next
NEXT_PUBLIC_LOCAL_STANDALONE=true next build
NEXT_PUBLIC_LOCAL_STANDALONE=true next start -p 30129 &
E2E_CODEMIRROR=0 playwright test --reporter=line e2e/editor.spec.ts
```

### CodeMirror-enabled mode
```sh
cd apps/web
rm -rf .next
NEXT_PUBLIC_LOCAL_STANDALONE=true NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true next build
NEXT_PUBLIC_LOCAL_STANDALONE=true NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true next start -p 30130 &
E2E_CODEMIRROR=1 playwright test --reporter=line e2e/editor.spec.ts
```

### Result: **all 12 tests passed** (6 per mode)

| Mode | Tests | Result |
|---|---|---|
| Default (textarea) | 6 | **PASS** (1.6s) |
| CodeMirror-enabled | 6 | **PASS** (1.7s) |

## Checklist

| Area | Default | CodeMirror | Test coverage |
|---|---|---|---|
| Page load / editor surface mounted | ✅ | ✅ | `data-testid="latex-editor"` |
| Initial document content | ✅ | ✅ | `textarea.inputValue()` / `.cm-content innerText` |
| Basic editing (typing) | ✅ | ✅ | `textarea.fill()` / `cm-content fill` |
| CodeMirror host absent in default mode | ✅ | N/A | `.cm-content` not rendered |
| Textarea fallback absent in CodeMirror mode | N/A | ✅ | `latex-editor-textarea` not rendered |
| Find/search open and input | ✅ | ✅ | aria-label="Toggle find bar" click + `find-input` fill |
| Compile button present and enabled | ✅ | ✅ | `compile-button` visible and enabled |

## Key technical findings

1. **Turbopack does not inline `NEXT_PUBLIC_*` env vars** at build time — the compiled `isLocalStandalone()` reads from a Turbopack-internal process polyfill module (`ed.default.env`), not from `process.env`, so `process.env.NEXT_PUBLIC_LOCAL_STANDALONE` is never replaced.
2. **Webpack (`next build` without `--turbopack`) properly inlines** `process.env.NEXT_PUBLIC_*` via its DefinePlugin — but only when the source code accesses the var as a **direct member** of `process.env` (not through a helper variable).
3. **Fix applied:** `isLocalStandalone()` was refactored from `(env = process.env) => flagEnabled(env.NEXT_PUBLIC_LOCAL_STANDALONE)` to `(env?) => env !== undefined ? … : flagEnabled(process.env.NEXT_PUBLIC_LOCAL_STANDALONE)` so that the DefinePlugin can match and replace `process.env.NEXT_PUBLIC_LOCAL_STANDALONE` directly.
4. **E2E builds must use webpack.** The `package.json` scripts `e2e:default` and `e2e:cm` first run `rm -rf .next && … next build` (no `--turbopack`) and then invoke Playwright.
5. **Dynamic Clerk middleware import** avoids module-level `require("@clerk/nextjs/server")` crash when Clerk env vars are absent (`middleware.ts`).

## Phase 6.8 — Production-build parity (2026-05-07)

- **Build tool used by production:** Turbopack (`next build --turbopack`)
- **Build tool used by e2e:** webpack (`next build` without `--turbopack`)
- **New scripts added:**
  - `e2e:build:prod-default` — `NEXT_PUBLIC_LOCAL_STANDALONE=true next build --turbopack`
  - `e2e:build:prod-cm` — same plus `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true`
  - `e2e:prod-default` — Turbopack build + default mode Playwright
  - `e2e:prod-cm` — Turbopack build + CodeMirror mode Playwright

### Result: **all 24 tests passed** (12 webpack + 12 Turbopack)

| Mode | Build | Tests | Result |
|---|---|---|---|
| Default | webpack | 6 | **PASS** (2.4s) |
| CodeMirror | webpack | 6 | **PASS** (2.6s) |
| Default | Turbopack | 6 | **PASS** (2.5s) |
| CodeMirror | Turbopack | 6 | **PASS** (2.7s) |

### Updated env-var findings

The `env` block in `next.config.ts` **does forward `NEXT_PUBLIC_*` values in Turbopack production builds**. The earlier Phase 6.7 note that "Turbopack does not inline NEXT_PUBLIC_* vars" referred to the automatic per-env-var injection (which webpack does via DefinePlugin). When the env vars are explicitly listed in the `env` config block, Turbopack correctly bakes them into the production artifact.

## Environment var propagation (summary)

| Build mode | `NEXT_PUBLIC_LOCAL_STANDALONE` | `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR` |
|---|---|---|
| Turbopack (`next build --turbopack`) with `env` config | ✅ available on client | ✅ available on client |
| Webpack (`next build` without `--turbopack`) | ✅ inlined at build time | ✅ inlined at build time |

**Rule:** For client-exposed build flags, always access via direct member access on `process.env` (e.g. `process.env.NEXT_PUBLIC_*`), never through an intermediate variable. See `localStandalone.ts` for the canonical pattern.

## Decision at Phase 6.8 (historical)

- **Keep CodeMirror flag-gated.**
- **Unblock default flip** is still conditional on:
  - cursor/selection parity,
  - snippet insertion parity,
  - PDF preview integration parity,
  - full keyboard command parity.
- **All existing parity tests** (jsdom-based, `EditorPane.test.tsx` + `LatexCodeEditor.test.tsx`) and browser-level E2E tests pass in both modes.
- Production-build parity is now verified: both webpack and Turbopack artifacts pass all 12 E2E tests.

## Phase 7.2 — Snippet + PDF safety parity (2026-05-07)

- **Scope:** Add focused browser-level parity coverage for snippet insertion and PDF preview safety in both textarea-default and CodeMirror-enabled modes.
- **Builds covered:** webpack (`next build`) and Turbopack (`next build --turbopack`) via existing script matrix.
- **Commands used:**
  - `bun run typecheck`
  - `bun run lint`
  - `bun run test`
  - `bun run build`
  - `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true bun run typecheck`
  - `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true bun run lint`
  - `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true bun run test`
  - `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true bun run build`
  - `bun run e2e:default`
  - `bun run e2e:cm`
  - `bun run e2e:prod-default`
  - `bun run e2e:prod-cm`

### Result: **all 54 tests passed**

| Mode | Build | Tests | Result |
|---|---|---|---|
| Default | webpack | 12 | **PASS** |
| CodeMirror | webpack | 15 | **PASS** |
| Default | Turbopack | 12 | **PASS** |
| CodeMirror | Turbopack | 15 | **PASS** |

### New parity coverage added

- Snippet insertion via real toolbar interactions:
  - template section snippet insertion
  - equation snippet insertion at cursor fallback
  - equation snippet insertion wrapping current selection
- PDF preview safety:
  - preview pane remains mounted after compile trigger
  - editor remains mounted after compile trigger
  - compile lifecycle exposes explicit state (`queued`/`running`/`failed`/`ready`) without UI crash
- Compile path in this QA pass is validated as **safe behavior**, not guaranteed successful TeX output (worker/backend may be unavailable in e2e runtime).

## Decision update

- **CodeMirror remains flag-gated in this phase.**
- Snippet insertion parity and PDF preview safety parity are now covered by browser e2e tests in both editor modes.
- A default flip should still be performed in a separate follow-up phase/commit.
