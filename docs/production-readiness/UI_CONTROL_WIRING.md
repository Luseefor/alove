# UI Control Wiring Map

This document audits every visible control in the alove workspace and maps it to its actual behavior. Controls without real behavior are HIDDEN or HONESTLY DISABLED.

## Landing / Dashboard

| Control | Screen | Visible? | Behavior | Handler/Source | State |
|---|---|---:|---|---|---|
| alove Logo | Dashboard | yes | brand display | - | display-only |
| Projects (Icon) | Dashboard | yes | navigate to /editor | next/link | functional |
| Help | Dashboard | no | not implemented | - | hidden-unsupported |
| Theme Toggle | Dashboard | yes | switch light/dark | useTheme | functional |
| Palette Switcher | Dashboard | yes | change accent color | useTheme | functional |
| Account/Profile | Dashboard | no | user context not implemented | - | hidden-unsupported |
| Home | Sidebar | yes | active state indicator | usePathname | functional |
| Projects | Sidebar | yes | navigate to /editor | next/link | functional |
| Settings | Sidebar | yes | navigate to editor settings | next/link | functional |
| Local Mode Status | Sidebar | yes | system state indicator | isLocalStandalone | display-only |
| Hero Headline | Hero | yes | main pitch | - | display-only |
| Hero Subtext | Hero | yes | supporting pitch | - | display-only |
| Open Editor | Hero | yes | navigate to /editor | next/link | functional |
| New Project | Hero | yes | create blank document | next/link | functional |
| Mini Preview | Hero | yes | illustrative workspace | - | display-only |
| Workspace Status | Content | yes | real-time system health | /api/health | functional |
| Recent Projects | Content | yes | list demo documents | demoProject.ts | functional |
| New Document | Quick Start| yes | navigate to /editor?new=true | next/link | functional |
| Open Sample | Quick Start| yes | navigate to /editor | next/link | functional |
| Editor | Quick Start| yes | navigate to /editor | next/link | functional |
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
| Export | Header | yes | download compiled PDF | pdfDataUrl | disabled-no-pdf |
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
| Editor Tabs | Center | yes | switch active file | openFile | functional |
| Line Numbers | Editor | yes | gutter | CodeMirror | functional |
| Status Bar | Editor | yes | ln/col/stats | derived from state | display-only |
| Thumbnails | PDF Pane | success | browse pages | setCurrentPage | functional |
| PDF iframe | PDF Pane | success | view document | pdfDataUrl | functional |
| Document not built| PDF Pane | idle | empty state | - | display-only |
| Compiling status | PDF Pane | active | loading state | buildStatus | display-only |
| Build Failed state | PDF Pane | failed | error state | buildStatus | display-only |
| Log Tab | Bottom | yes | view build output | activeBottomTab | functional |
| Problems Tab | Bottom | yes | view diagnostics | activeBottomTab | functional |
| Build Result Card | Bottom | success | compile summary | buildStatus | display-only |
| Document Stats | Bottom | yes | derived metrics | derivedStats | display-only |
