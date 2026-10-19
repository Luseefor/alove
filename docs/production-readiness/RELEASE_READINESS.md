# Release Readiness

This document outlines the final verification steps and criteria for merging the `feature/latex-ide-redesign` branch into production.

## Remaining Untracked Files
- `local_changes_backup.patch`: Local backup artifact; explicitly left untracked. Do not commit.
- `pixel-perfect-latex-ide-redesign-plan-alove.md`: Planning artifact; explicitly left untracked. Do not commit.
- `apps/web/test-results/` & `apps/web/playwright-report/`: Generated test output; removed and explicitly ignored in `apps/web/.gitignore`.

## Editor State and Semantics
- **CodeMirror is now the default editor.**
- Textarea fallback has been explicitly preserved.
- **Rollback command/setting:** `NEXT_PUBLIC_EDITOR_MODE=textarea`
- **Legacy flag behavior remains supported:** 
  - `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true` (CodeMirror)
  - `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=false` (Textarea)

## Editor Rollback Procedure
If CodeMirror experiences a production-blocking regression:
1. Set `NEXT_PUBLIC_EDITOR_MODE=textarea`.
2. Rebuild/redeploy the Next.js web application.
3. Verify by running `bun run e2e:textarea` and `bun run e2e:prod-textarea`.
4. Keep the textarea fallback available for at least one release cycle.

## Final Validation Results
- `bun run typecheck`: PASS
- `bun run lint`: PASS
- `bun run test`: PASS
- `bun run build`: PASS
- `NEXT_PUBLIC_EDITOR_MODE=textarea bun run build`: PASS
- `NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true bun run build`: PASS

## Final E2E Totals
- 84 / 84 passing across default, fallback, webpack, and turbopack builds.

## Production Environment Validation Checklist
- Clerk publishable key configured.
- Clerk secret key configured.
- Convex URL configured.
- Convex auth issuer configured.
- Redis host/port/password configured where required.
- Compile worker deployed and connected to the same Redis queue.
- Docker/TeX image access validated.
- Compile timeout and cleanup settings configured.
- `NEXT_PUBLIC_EDITOR_MODE` intentionally set or intentionally unset.
- Textarea rollback tested with `NEXT_PUBLIC_EDITOR_MODE=textarea`.
- `/editor` smoke tested after deploy.
- Compile button smoke tested after deploy.
- PDF preview smoke tested after deploy.

## Merge Summary
- Auth/config fail-closed hardening
- Compile worker hardening
- Critical tests added
- Playwright E2E coverage added and expanded
- CodeMirror adapter added
- CodeMirror made default
- Textarea fallback preserved
- Repository hygiene improved (generated outputs cleaned and ignored)

**Ready for PR and production-deploy candidate.**
Final production deploy requires environment validation for Clerk, Convex, Redis, compile worker, Docker/TeX image access, and deployment secrets.
