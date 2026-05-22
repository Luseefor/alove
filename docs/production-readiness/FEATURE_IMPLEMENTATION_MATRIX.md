# Feature Implementation Matrix

| Feature | Current state | Required implementation | Source of truth | UI location | Test coverage | Status |
|---|---|---|---|---|---|---|
| Open Editor | Navigates to `/editor` | Functional route link | `next/link` | Dashboard Hero / Quick Start | e2e | implemented |
| New Project | Uses `?new=true` query param | Creates untitled local project | `workbenchStore.ts` / `EditorWorkbench.tsx` | Dashboard Hero / Quick Start | manual/e2e | implemented-local-only |
| Recent Projects | Hardcoded demo row | Load real persisted projects or single demo project | `demoProject.ts` / `workbenchStore.ts` | Dashboard Content | e2e (renders) | implemented |
| Templates | Hardcoded array in toolbar | Implement real template picker/definitions | `templates.ts` / `workbenchStore.ts` | ActionToolbar / Dashboard | manual | hidden-until-supported |
| Snippets | Hardcoded array in Sidebar | Read from structured definition, insert at cursor | `workbenchStore.ts` | ProjectSidebar / ActionToolbar | e2e | implemented |
| Outline | Parses `\section` via regex | Derive hierarchical outline from text | `OutlineService.ts` | ProjectSidebar | e2e | implemented |
| Citations | Parses keys from `.bib` | Search/insert from library | `BibliographyService.ts` | ActionToolbar | e2e | implemented |
| Search (Find) | Editor local search works | Editor find bar | `workbenchStore.ts` | ActionToolbar | e2e | implemented |
| PDF Preview | Renders `pdfDataUrl` | Stateful iframe with thumbnails | `workbenchStore.ts` | PdfPreviewPane | e2e | implemented |
| Export | Downloads `pdfDataUrl` | Save PDF to disk | `ActionToolbar.tsx` | AppHeader | manual | implemented |
| Build Log | Renders text log | Show compile steps/output | `workbenchStore.ts` | BottomUtilityPanel | e2e | implemented |
| Problems | Renders diagnostics | Show errors/warnings mapped to lines | `workbenchStore.ts` | BottomUtilityPanel | manual | implemented |
| Document Stats | Derived from active content | Live derived text metrics | `BottomUtilityPanel.tsx` / `workbenchStore.ts` | BottomUtilityPanel | manual | implemented |
| Workspace Health | Fetches `/api/health` | Determine local/cloud/redis status | `DashboardContent.tsx` | Dashboard Content | manual | implemented |
| Account / Auth | Displays fake "Guest User" | Real Clerk integration or disabled status | `DashboardHeader.tsx` | Dashboard Header / Editor Header | manual | disabled-with-explanation |
| Share | Disabled in local mode | Cloud collaboration integration | `AppHeader.tsx` | AppHeader | manual | disabled-local-mode |
| Import / Upload | Local file selection | Read files into workbench | `ProjectSidebar.tsx` | ProjectSidebar | manual | implemented-local-only |
| File Tree | Hierarchical tree | Full CRUD operations | `workbenchStore.ts` / `ProjectService.ts` | ProjectSidebar | e2e | implemented |
