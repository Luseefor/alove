# UI Control Wiring Map

This document audits every visible control in the alove workspace and maps it to its actual behavior. Controls without real behavior are marked for removal or honest disabling.

## Landing / Dashboard

| Control | Location | Visible? | Real behavior | Handler / Source | If unsupported |
|---|---|---|---|---|---|
| Open Editor | Hero | Yes | Navigates to `/editor` | Next.js Link | - |
| New Project | Hero | Yes | Opens "New File" modal (demo hack) | `setNewFileOpen(true)` | Better: real project creation |
| Home | Sidebar | Yes | Active state for home | `usePathname` | - |
| Projects | Sidebar | Yes | Navigates to `/editor` | Next.js Link | - |
| Snippets | Sidebar | Yes | Disabled placeholder | `disabled` | Hide or wire to real snippets |
| Citations | Sidebar | Yes | Disabled placeholder | `disabled` | Hide or wire to real library |
| Templates | Sidebar | Yes | Disabled placeholder | `disabled` | Hide or wire to real gallery |
| Trash | Sidebar | Yes | Disabled placeholder | `disabled` | Hide |
| Compile | Tools | Yes | Disabled placeholder | `disabled` | Hide |
| PDF Workflow | Tools | Yes | Disabled placeholder | `disabled` | Hide |
| Bibliography | Tools | Yes | Disabled placeholder | `disabled` | Hide |
| Settings | Tools | Yes | Disabled placeholder | `disabled` | Wire to IdeSettingsDialog |
| Local Mode Card | Sidebar | Yes | Displays operational status | `isLocalStandalone` | - |
| View System Details | Status Card | Yes | Navigates to health check (stub) | - | Better: health modal |
| Search Projects | Header | Yes | Decorative input | - | Hide or wire to project search |
| Notifications | Header | Yes | Disabled placeholder | `disabled` | Hide |
| Help | Header | Yes | Decorative icon | - | Wire to support docs |
| Recent Projects | Content | Yes | Renders demo project list | `demoProject.ts` | Show real projects if any |

## Editor Workspace

| Control | Location | Visible? | Real behavior | Handler / Source | If unsupported |
|---|---|---|---|---|---|
| Build | Top Header | Yes | Triggers LaTeX compilation | `runCompile()` | - |
| Export | Top Header | Yes | Downloads PDF | `pdfDataUrl` download | Disabled if no PDF |
| Share | Top Header | Yes | Disabled in local mode | `isLocalStandalone` | Tooltip explanation |
| Save | Header Icon | Yes | Saves active file | `saveActiveFile()` | - |
| Undo/Redo | Header Icons | Yes | Editor history | `requestEditorCommand` | - |
| Project Title | Header Center | Yes | Decorative button | - | Make editable or read-only |
| Cite | Feature Bar | Yes | Inserts `\cite` snippet | `appendToActiveFile` | Wire to real BibTeX selector |
| Library | Feature Bar | Yes | Disabled placeholder | `disabled` | Hide |
| Style | Feature Bar | Yes | Disabled placeholder | `disabled` | Hide |
| Manage | Feature Bar | Yes | Disabled placeholder | `disabled` | Hide |
| Figure | Feature Bar | Yes | Inserts figure snippet | `appendToActiveFile` | - |
| Table | Feature Bar | Yes | Inserts table snippet | `appendToActiveFile` | - |
| Subfloat | Feature Bar | Yes | Disabled placeholder | `disabled` | Hide |
| Chart | Feature Bar | Yes | Disabled placeholder | `disabled` | Hide |
| Find | Feature Bar | Yes | Opens editor find bar | `requestEditorFindBar` | - |
| PDF Target | Feature Bar | Yes | Decorative selector | - | Fixed to PDF for now |
| Project Rail | Left Rail | Yes | Selects file tree | `setActiveRail('explorer')` | - |
| Search Rail | Left Rail | Yes | Selects project search | `setActiveRail('search')` | - |
| Source Control | Left Rail | Yes | Disabled placeholder | `disabled` | Hide |
| History | Left Rail | Yes | Disabled placeholder | `disabled` | Hide |
| File Row | Sidebar | Yes | Switches active file | `openFile(path)` | - |
| Snippets Tab | Bottom Sidebar | Yes | Shows insertable snippets | `sidebarTab` state | - |
| Outline Tab | Bottom Sidebar | Yes | Shows document structure | `sidebarTab` state | - |
| Jump to Section | Outline | Yes | Scrolls to line | `jumpToDiagnostic` | - |
| Editor Tabs | Center | Yes | Switches active file | `openFile(path)` | - |
| Log Tab | Bottom Utility | Yes | Shows build log | `activeBottomTab` | - |
| Problems Tab | Bottom Utility | Yes | Shows diagnostics | `activeBottomTab` | - |
| Citations Tab | Bottom Utility | Yes | Placeholder | `activeBottomTab` | - |
| Stats Card | Bottom Utility | Yes | Derived text metrics | `useMemo` from content | Show unknown if not built |

## Decisions

1. **Hide** all "Coming Soon" or placeholder tools from the sidebar/rail that are not part of the core editor workflow.
2. **Harden** state checks: Don't show "Build Successful" if `buildStatus !== 'ready'`.
3. **Refine** file tree: Eliminate any potential for duplicate folders in `ProjectService`.
4. **Light Theme**: Force a light, high-contrast theme for the editor and toolbar to match the premium reference.
