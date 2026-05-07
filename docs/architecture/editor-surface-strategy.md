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
- `EditorPane` can render the adapter when `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true`.
- Default behavior remains textarea-backed to preserve all existing editing interactions while migration completes.
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

## Decision Criteria (Phase 6.8)

CodeMirror remains flag-gated because:
- selection/cursor parity across both surfaces is not covered by current E2E tests
- snippet insertion parity is not tested
- PDF preview integration with CodeMirror is not tested
- Textarea fallback is preserved and working

All production-build parity checks pass, which unblocks the eventual default flip once remaining items are addressed.

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

- Make CodeMirror mode default after parity checks for find/search, clipboard commands, and diagnostics navigation.
- Add one browser-level (non-mocked) QA pass for editor command and selection behavior before default flip.
- Remove textarea path once parity and regression coverage are complete.
