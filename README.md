# alove

Monorepo for a web LaTeX workspace (editor, compile queue, collaboration server, workers).

## Prerequisites

- Node 20+ (repo tested on Node 24)
- [pnpm](https://pnpm.io) 9+
- Docker (for TeX Live compiles by default)
- Optional: local TeX Live if you set `COMPILE_USE_DOCKER=false` on the worker

## Quick start

1. Start backing services:

```bash
docker compose up -d
```

2. Install dependencies:

```bash
pnpm install
```

3. Pull the TeX image once (large):

```bash
docker pull ghcr.io/xu-cheng/texlive-full:latest
```

4. Copy `apps/web/.env.example` to `apps/web/.env.local` and set **Clerk** keys plus **Convex** (`NEXT_PUBLIC_CONVEX_URL`, `CLERK_JWT_ISSUER_DOMAIN` — see [Convex + Clerk](https://docs.convex.dev/auth/clerk)).

5. Run **web** and **compile worker**:

```bash
pnpm dev
```

6. In a second terminal, sync the Convex backend (schema, queries, mutations) to your dev deployment:

```bash
pnpm --filter web run convex:dev
```

   Alternatively, from `apps/web` you can run `pnpm run dev:with-convex` to run **Convex + Next together** in one terminal (still start `pnpm dev` or `pnpm --filter compile-worker dev` elsewhere if you need the compile worker).

7. Open [http://localhost:3000/editor](http://localhost:3000/editor), sign in with Clerk, and optionally open a second profile or incognito window to confirm shared edits and presence.

**Production:** set `CLERK_SECRET_KEY` so middleware and `/api/compile` enforce sign-in. Leaving it unset only skips those checks for local experiments.

### Ports

- `3000` — Next.js (`apps/web`)
- `6379` — Redis (BullMQ)
- `5432` — Postgres (reserved for persistence / accounts)
- `3210` — Convex dev (CLI default when using `convex dev`)

### Environment

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk (see `apps/web/.env.example`)
- `NEXT_PUBLIC_CONVEX_URL` / `CLERK_JWT_ISSUER_DOMAIN` — Convex deployment + Clerk JWT issuer for `convex` auth
- `REDIS_HOST` / `REDIS_PORT` — Redis connection (defaults to `127.0.0.1:6379`)
- `COMPILE_USE_DOCKER` — `true` (default) runs `latexmk` inside Docker; set `false` to use host `latexmk` (enables `timeoutMs` kill path)
- `COMPILE_DOCKER_IMAGE` — override TeX image (default `ghcr.io/xu-cheng/texlive-full:latest`)
- Legacy Hocuspocus env vars (optional): commented in `apps/web/.env.example`; use `pnpm --filter realtime dev:legacy` if you still need that server

## Feature coverage (vs Overleaf-class roadmap)

| Area | In repo now | Still roadmap |
|------|-------------|----------------|
| Editing | CM6 LaTeX (stex), folding (`\\begin`/`\\end`), brackets, multi-cursor, search (Mod+F), go-to-line (Mod+G), snippets/autocomplete, optional **Vim**, word count | Emacs mode, richer cite/ref intel, spellcheck |
| Build | `latexmk` via Docker or host, **pdfLaTeX / XeLaTeX / LuaLaTeX**, optional **clean aux**, extra `latexmk` args, structured log parse, **host compile timeout** | Docker-side hard kill, SyncTeX, custom TeX Live lockfile UX |
| PDF | iframe preview, **zoom**, download | PDF.js in worker, in-PDF search, presentation mode |
| Multi-file | File tree, **templates** (article / article+bib), **\\input / \\include** navigator | ZIP/Git import, Git sync |
| Diagnostics | **Problems panel** + **lint gutter** from compile output | ChkTeX inline, fix-its |
| Collaboration | **Convex** + **Clerk**: shared project files, presence, **design mode** toggle (multi-file when on) | Roles, comments, track changes, chat |
| Versioning | **IndexedDB** compile snapshots (local) | Server history, diff, restore, Git export |
| Account / quotas | **Clerk** sign-in | Quotas, org billing |

## Packages

- `apps/web` — Next.js UI + `/api/compile` + editor workbench
- `apps/compile-worker` — BullMQ consumer (`latexmk` in Docker or host)
- `apps/realtime` — optional legacy Hocuspocus server (`pnpm --filter realtime dev:legacy`); collaboration in `web` uses Convex
- `packages/protocol` — shared compile types
- `packages/queue` — BullMQ helpers
- `packages/editor` — CodeMirror 6 surface (outline, input refs, keymaps, Vim option)

## Scripts

- `pnpm dev` — turbo dev (web + compile-worker; Convex is a separate process)
- `pnpm --filter web run convex:dev` — push Convex functions from `apps/web`
- `pnpm --filter web run dev:with-convex` — Next + Convex in one terminal
- `pnpm build` — production build
- `pnpm lint` / `pnpm typecheck` — quality gates
