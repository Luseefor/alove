# Editor Surface Strategy

## Decision

- **Active editor surface:** `apps/web/src/components/latex-ide/*`
- **Legacy/deprecated surface:** `apps/web/src/components/editor/*`

## Evidence

- `/editor` route renders `EditorWorkbench` (`apps/web/src/app/editor/page.tsx:3-30`).
- `EditorWorkbench` renders `LatexEditorApp` from the latex IDE surface (`apps/web/src/components/EditorWorkbench.tsx:6`, `72`, `91`).
- No active imports from `components/editor/*` were found in `apps/web/src` route/component wiring.
- Legacy files still exist and are exported (`apps/web/src/components/editor/index.ts:1-5`), so removal is not yet safe.

## Rules

1. All new editing/PDF/workbench feature work goes into:
   - `apps/web/src/components/latex-ide/*`
   - `apps/web/src/stores/workbenchStore.ts`
   - `packages/editor/*`
2. Legacy `apps/web/src/components/editor/*` gets only:
   - compatibility fixes
   - security fixes
   - build/lint break fixes
3. Do not add new product features to the legacy surface.

## Phase 6 Status (CodeMirror)

- **Mode:** fallback-backed migration
- `LatexCodeEditor` adapter exists at `apps/web/src/components/latex-ide/LatexCodeEditor.tsx`.
- `EditorPane` can render either surface and now defaults to CodeMirror.
- Textarea fallback remains available via `NEXT_PUBLIC_EDITOR_MODE=textarea` (rollback path).
- Compile/store wiring is preserved because both surfaces write through `updateActiveFileContent`.

## Phase 6.5 Validation Status

- `EditorPane` now has focused parity tests for the CodeMirror-enabled integration path (render, file switching, content updates, selection/find wiring, compile trigger wiring).
- Validation was run in both default mode and `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true` mode.
- Decision: keep CodeMirror flag-gated for now.
- Rationale:
  - parity tests currently use a mocked adapter contract in jsdom rather than full browser-level behavior;
  - manual QA for cursor/selection/find/snippet parity and PDF-side workflows has not been completed yet.

## Phase 6.7 Browser QA Status (Playwright E2E)

- Playwright 1.59.1 has been installed and configured in `apps/web/`.
- 12 E2E tests (6 per mode) cover:
  - Editor surface mount (`data-testid="latex-editor"`)
  - Initial document content (textarea value / CodeMirror text)
  - Basic typing interaction
  - Absent alternate surface check
  - Compile button presence and enabled state
  - Find bar open/input
- **Both modes pass all tests** (default: 1.6s, CodeMirror: 1.7s).
- **Key technical insight:** Webpack's DefinePlugin inlines `NEXT_PUBLIC_*` env vars, but only when the source accesses them as direct members of `process.env`. Turbopack does not perform this inlining at all.
- E2E builds use `next build` (webpack) explicitly; run via `bun run e2e:default` or `bun run e2e:cm`.
- Decision remains unchanged: keep CodeMirror flag-gated pending cursor/selection/snippet/preview parity verification.

## Phase 6.8 Production-Build Parity (E2E)

- Production build uses `next build --turbopack`.
- Production-build parity scripts were added: `e2e:prod-default` and `e2e:prod-cm`.
- Both Turbopack production artifacts pass all 6 E2E tests (12 total across both modes).
- `env` config in `next.config.ts` correctly forwards `NEXT_PUBLIC_*` values in Turbopack builds.
- Decision remains unchanged: keep CodeMirror flag-gated (see Phase 6.8 criteria below).

## Decision Criteria (Phase 8 status)

CodeMirror default is enabled with explicit fallback controls:
- unset flags default to CodeMirror
- `NEXT_PUBLIC_EDITOR_MODE=textarea` forces textarea fallback
- legacy `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true/false` remains supported for compatibility
- compile success-path behavior is still environment-dependent; browser parity coverage validates compile-trigger safety/non-crash behavior
- textarea fallback remains available and is retained for rollout safety

Covered in browser e2e across both modes/builds:
- editing + cursor/selection + keyboard interaction parity
- snippet insertion parity (template + equation insert/wrap paths)
- compile trigger safety + PDF preview pane stability parity

## Current Inventory

### Active surface files

- `apps/web/src/components/latex-ide/LatexEditorApp.tsx`
- `apps/web/src/components/latex-ide/EditorPane.tsx`
- `apps/web/src/components/latex-ide/PdfPreviewPane.tsx`
- `apps/web/src/components/latex-ide/ActionToolbar.tsx`
- `apps/web/src/components/latex-ide/ProjectSidebar.tsx`
- `apps/web/src/components/latex-ide/BottomUtilityPanel.tsx`
- `apps/web/src/components/latex-ide/AppHeader.tsx`
- `apps/web/src/components/latex-ide/ActivityRail.tsx`
- `apps/web/src/components/latex-ide/IdeSettingsDialog.tsx`
- `apps/web/src/components/latex-ide/ClerkAccountPanels.tsx`

### Legacy surface files

- `apps/web/src/components/editor/CommandPalette.tsx`
- `apps/web/src/components/editor/EditorHeader.tsx`
- `apps/web/src/components/editor/EditorLeftRail.tsx`
- `apps/web/src/components/editor/EditorRightRail.tsx`
- `apps/web/src/components/editor/index.ts`

## Removal Criteria for Legacy Surface

- No runtime imports from `apps/web/src/components/editor/*` remain.
- `/editor` depends only on `latex-ide` components.
- Equivalent behavior exists on the active surface.
- Compile/workbench behavior remains covered by automated tests.

## Remaining Editor Migration Work

- Keep textarea fallback available for at least one release cycle after default flip.
- Run one queue/worker-provisioned compile-success browser pass to complement the safe-failure coverage.
- Remove textarea path only after default rollout is stable and regression coverage remains green.

## Phase 9 Release Readiness Status

- Repository hygiene confirmed. Generated playwright artifacts (`test-results/` and `playwright-report/`) are ignored.
- CodeMirror default and fallback functionality have passed exhaustive validation (Typecheck, Lint, Test, Build, and 84/84 E2E).
- Rollback mechanisms are explicitly documented in `RELEASE_READINESS.md`.
- The branch is deemed stable and prepared for merging into the main branch.
