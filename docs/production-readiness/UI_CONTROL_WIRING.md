# UI Control Wiring Map

This document audits every visible control in the alove workspace and maps it to its actual behavior. Controls without real behavior are HIDDEN or HONESTLY DISABLED.

## Landing / Dashboard

| Control | Screen | Visible? | Behavior | Handler/Source | State |
|---|---|---:|---|---|---|
| alove Logo | Dashboard | yes | brand display | - | display-only |
| Projects (Icon) | Dashboard | yes | navigate to /editor | next/link | functional |
| Help | Dashboard | yes | show documentation modal | setHelpOpen | functional |
| Theme Toggle | Dashboard | yes | switch light/dark | useTheme | functional |
| Palette Switcher | Dashboard | yes | change accent color | useTheme | functional |
| Account/Profile | Dashboard | yes | user context | - | disabled-local-mode |
| Home | Sidebar | yes | active state indicator | usePathname | functional |
| Projects | Sidebar | yes | navigate to /editor | next/link | functional |
| Settings | Sidebar | yes | open settings modal | setSettingsModalOpen | functional |
| Local Mode Status | Sidebar | yes | system state indicator | isLocalStandalone | display-only |
| Open Editor | Hero | yes | navigate to /editor | next/link | functional |
| New Project | Hero | yes | create blank document | next/link | functional |
| Mini Preview | Hero | yes | illustrative workspace | - | display-only |
| Workspace Status | Content | yes | real-time system health | /api/health | functional |
| Recent Projects | Content | yes | list demo documents | demoProject.ts | functional |
| Quick Start Cards | Content | yes | primary actions | next/link | functional |
| Pro Tip Bar | Bottom | yes | helpful hints | - | functional |

## Editor Workspace

| Control | Screen | Visible? | Behavior | Handler/Source | State |
|---|---|---:|---|---|---|
| alove Logo | Editor | yes | brand display | - | display-only |
| Save | Header | yes | save current file | saveActiveFile | functional |
| Undo/Redo | Header | yes | history management | requestEditorCommand | functional |
| Project Title | Header | yes | document title | projectTitle | display-only |
| Saved Status | Header | yes | dirty state indicator | hasDirty | display-only |
| Build (Button) | Header | yes | trigger compilation | runCompile | functional |
| Export | Header | yes | download compiled PDF | pdfDataUrl | functional |
| Share | Header | no | cloud-only feature | - | hidden-unsupported |
| Cite | Feature Bar | yes | insert bib snippet | appendToActiveFile | functional |
| Figure | Feature Bar | yes | insert figure snippet | appendToActiveFile | functional |
| Table | Feature Bar | yes | insert table snippet | appendToActiveFile | functional |
| Find | Feature Bar | yes | open source find bar | requestEditorFindBar | functional |
| Build (Toolbar) | Feature Bar | yes | trigger compilation | runCompile | functional |
| App Rail Icons | Rail | yes | switch active view | setActiveRail | functional |
| Sidebar Tabs | Sidebar | yes | switch snippet/outline | sidebarTab state | functional |
| File Tree | Sidebar | yes | file management | openFile/createFile | functional |
| Snippets | Sidebar | yes | insert math/latex | appendToActiveFile | functional |
| Outline | Sidebar | yes | navigate document | jumpToDiagnostic | functional |
| Editor Tabs | Editor | yes | switch active file | openFile | functional |
| Status Bar | Editor | yes | document metrics | cursor/stats | display-only |
| PDF Preview | PDF Pane | success | view document | pdfDataUrl | functional |
| PDF Thumbnails | PDF Pane | success | navigate pages | setCurrentPage | functional |
| Log / Problems | Bottom | yes | view output | activeBottomTab | functional |
| Build Success Card| Bottom | success | compile summary | buildStatus | display-only |
| Document Stats | Bottom | yes | derived metrics | derivedStats | display-only |

## Non-Negotiable Repairs

1. **Light Theme**: Re-implement `globals.css` and palettes to force a clean light IDE.
2. **Layout Consistency**: Ensure no overlaps. Mini preview belongs in a card in the main grid.
3. **Sidebar**: Use light background for all sidebars.
4. **State Consistency**: PDF pane and Build Result card MUST agree on `buildStatus`.
5. **No Fakes**: Remove Storage, Sync, Invite, and all dead toolbar icons.
