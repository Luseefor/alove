# Development

alove is a Bun monorepo. Default `bun run dev` is **local standalone**: Next.js editor + BullMQ compile worker, **no Clerk or Convex**. Live collab is the **cloud** path (`dev:cloud` + Convex).

## Prerequisites

| Tool | Notes |
|------|--------|
| **[Bun](https://bun.sh/docs/installation) 1.3.10+** | Matches `packageManager` in the root `package.json` |
| **Docker** | Engine + Compose v2 (Redis, Postgres, TeX compiles) |
| **Clerk + Convex** | Cloud mode only |

```bash
curl -fsSL https://bun.sh/install | bash   # macOS / Linux; Windows: see Bun docs
```

## Local standalone

From the repo root:

```bash
bun install
docker compose up -d          # Redis :6379, Postgres :5432
docker pull ghcr.io/xu-cheng/texlive-full:latest
bun run dev
```

Open **`/editor`** on the URL printed in the web logs. Next.js binds the first free TCP port from **`ALOVE_WEB_PORT`** (default **30127**) upward (skips common services and Next-blocked ports such as **6000**). Set a starting port with `ALOVE_WEB_PORT=38400 bun run dev`.

You do not need Clerk or Convex. Optionally set `NEXT_PUBLIC_LOCAL_STANDALONE=true` if you run `next dev` without the web `dev` script.

To compile with a host TeX Live instead of Docker, see [services/tex-runner/README.md](../services/tex-runner/README.md).

## Cloud mode (Clerk + Convex)

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill Clerk keys and `CLERK_JWT_ISSUER_DOMAIN` (JWT template named **`convex`** — [Convex + Clerk](https://docs.convex.dev/auth/clerk)). `bun run convex:dev` writes `NEXT_PUBLIC_CONVEX_URL`.

```bash
bun run --filter web dev:cloud      # Next on :3000
bun run --filter compile-worker dev
bun run convex:dev                  # keep running, or use bun run dev:with-convex
```

Then [http://localhost:3000/editor](http://localhost:3000/editor). Sign in with Clerk; a second browser/incognito window is a quick collab check.

Env var comments also live in [`apps/web/.env.example`](../apps/web/.env.example).

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_LOCAL_STANDALONE` | build / `.env.local` | `true` / `1` disables Clerk, Convex UI, and collaboration (set by the default web `dev` launcher) |
| `ALOVE_WEB_PORT` | dev only | Starting port for local Next scan (default **30127**) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `apps/web/.env.local` | Clerk (cloud). `CLERK_SECRET_KEY` can be omitted for relaxed local cloud; set it for production-like middleware and `/api/compile` |
| `NEXT_PUBLIC_CONVEX_URL`, `CLERK_JWT_ISSUER_DOMAIN` | `apps/web/.env.local` | Convex + Clerk JWT |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | env / `.env.local` | BullMQ (defaults match Compose: `127.0.0.1:6379`) |
| `COMPILE_USE_DOCKER` | worker | `true` (default) Docker; `false` / `0` host `latexmk` |
| `COMPILE_DOCKER_IMAGE` | worker | TeX image override |
| `COMPILE_DOCKER_PLATFORM` | worker | `docker run --platform`; on **macOS + arm64** defaults to **`linux/amd64`** |
| `WORKER_CONCURRENCY` | worker | BullMQ concurrency (default `2`) |

## Commands

| Command | Purpose |
|---------|---------|
| `bun run build` | Production build (Turbo) |
| `bun run typecheck` | Typecheck all packages |
| `bun run lint` | Lint |
| `bun run test` | Tests |
| `bun run format` | Prettier |
| `bun run --filter web lint` | One workspace |
| `bun run --filter realtime dev:legacy` | Optional legacy realtime server |

## Layout

- `apps/web` — Next.js UI, `/api/compile`, Convex client
- `apps/compile-worker` — BullMQ consumer (`bun` runtime)
- `apps/realtime` — optional legacy server (`bun` runtime)
- `packages/protocol`, `packages/queue`, `packages/editor` — shared libraries

## Status

| Area | In repo | Gaps |
|------|---------|------|
| Editing | CM6 LaTeX, folding, brackets, search, Vim, autocomplete | Richer cite/ref, spellcheck |
| Build | `latexmk` via Docker or host, multiple engines, log parse, timeout | Docker-side hard kill, SyncTeX |
| Collaboration | Convex + Clerk | Roles, comments, track changes |
| Versioning | IndexedDB compile snapshots | Server history, Git |
