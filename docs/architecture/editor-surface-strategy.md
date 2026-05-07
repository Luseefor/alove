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
