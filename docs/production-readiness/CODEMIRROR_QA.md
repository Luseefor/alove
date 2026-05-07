# CodeMirror Browser QA

- Date: 2026-05-07
- Branch: `feature/latex-ide-redesign`
- Commit: `7585e8b`
- Mode: CodeMirror (`NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true`) and default textarea mode
- Command used:
  - `cd apps/web && NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true bun run dev`
  - `curl http://127.0.0.1:30127/editor`
  - `cd apps/web && bun run dev`
  - `curl http://127.0.0.1:30127/editor`
- Browser/tool used: **No browser automation available in this environment** (`playwright`/`puppeteer` not installed; no interactive browser runner in CLI)
- Result: **blocked**

## Checklist

| Area | Result | Notes |
|---|---|---|
| Page load | blocked | `/editor` returned HTTP 200 in both modes, but browser runtime/hydration checks were not executable without browser automation. |
| Initial document | blocked | Could not verify visible editor content in a real browser session. |
| Basic editing | blocked | Could not perform typing/delete/paste interactions without browser automation. |
| Dirty state | blocked | Could not verify UI dirty indicators via browser interaction. |
| File switching | blocked | Could not verify tab switching behavior in browser. |
| Cursor/selection | blocked | Could not verify real cursor/selection behavior in browser. |
| Snippet insertion | blocked | Could not execute toolbar/snippet flow in browser. |
| Find/search | blocked | Could not execute interactive find UI flow in browser. |
| Compile trigger | blocked | Could not click Compile in browser; compile UI behavior not exercised here. |
| PDF preview | blocked | Could not verify preview behavior without browser execution. |
| Textarea fallback | blocked | Default mode server responded HTTP 200, but browser editing behavior was not exercised. |

## Issues Found

- No CodeMirror runtime defect was observed in this phase because browser-level QA could not be executed in the current tool environment.
- QA blocker: missing browser automation capability for end-to-end UI interaction.

## Decision

- **Keep CodeMirror flag-gated.**
- **Block default flip pending browser-level QA execution** (interactive/manual or automated E2E run) for editing, selection, snippets, find, compile, and preview flows.
