# alove

Monorepo for a web LaTeX workspace: Next.js editor, BullMQ compile worker (TeX Live in Docker), and Convex-backed collaboration.

## Prerequisites

| Tool | Notes |
|------|--------|
| **Node.js** | 20 or newer (CI uses 22) |
| **pnpm** | 9.x — repo pins `pnpm@9.15.4` via `packageManager` in root `package.json` |
| **Docker** | Docker Engine + Compose v2 (for Redis, Postgres, and TeX compiles) |
| **Git** | SSH recommended for GitHub |
| **Clerk** | [Sign up](https://dashboard.clerk.com), create an application |
| **Convex** | [Sign up](https://dashboard.convex.dev), create a project |

Enable pnpm with Corepack (ships with Node):

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

## Clone the repository

```bash
git clone git@github.com:Luseefor/alove.git
cd alove
```

## Step 1 — Install dependencies

```bash
pnpm install
```

## Step 2 — Start Redis and Postgres

```bash
docker compose up -d
```

This exposes **Redis** on `6379` and **Postgres** on `5432` (defaults used by the stack; Postgres is reserved for future persistence).

## Step 3 — Pull the TeX Live image (compile worker)

Compiles run `latexmk` inside Docker by default. Pull the image once (large download):

```bash
docker pull ghcr.io/xu-cheng/texlive-full:latest
```

Optional: set `COMPILE_USE_DOCKER=false` and use a host-installed TeX Live instead; see **Environment variables** below.

## Step 4 — Configure environment

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/web/.env.local`:

1. **Clerk** — set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the Clerk dashboard. For local dev you can omit `CLERK_SECRET_KEY`; for production-like auth on middleware and `/api/compile`, set it.
2. **Convex** — after Step 5, Convex CLI will write `NEXT_PUBLIC_CONVEX_URL` into `.env.local` (or copy it from the Convex dashboard).
3. **Clerk JWT for Convex** — set `CLERK_JWT_ISSUER_DOMAIN` to your Clerk Frontend API / issuer (often `https://<instance>.clerk.accounts.dev`). In Clerk, add a JWT template named **`convex`** as described in [Convex + Clerk](https://docs.convex.dev/auth/clerk).
4. **Redis** — defaults `REDIS_HOST=127.0.0.1` and `REDIS_PORT=6379` match `docker compose`; change if you use a remote Redis.

The compile worker reads `REDIS_*` from the process environment (defaults match Docker). Next.js loads `apps/web/.env.local` automatically for the web app.

## Step 5 — Link Convex (first time only)

From the repo root:

```bash
cd apps/web
pnpm exec convex dev
```

Log in when prompted, select or create a Convex project, and let the CLI sync functions from `convex/`. Keep this process running while developing, **or** use the combined script in Step 6.

Return to the repo root for the next steps (`cd ../..` from `apps/web`).

## Step 6 — Run the app

You need **Next.js**, the **compile worker**, and **Convex** in some combination.

### Option A — Two terminals (common)

**Terminal 1** — web + compile worker (Turbo runs both):

```bash
pnpm dev
```

**Terminal 2** — Convex dev server (push schema/functions on save):

```bash
pnpm --filter web exec convex dev
```

### Option B — Convex + Next in one terminal

**Terminal 1:**

```bash
pnpm --filter web run dev:with-convex
```

**Terminal 2** — worker still required for compiles:

```bash
pnpm --filter compile-worker dev
```

### Open the editor

1. Open [http://localhost:3000/editor](http://localhost:3000/editor).
2. Sign in with Clerk.
3. Optional: open a second browser or incognito window to verify shared edits and presence.

**Ports:** `3000` — Next.js; `6379` — Redis; `5432` — Postgres; Convex dev uses the URL in `NEXT_PUBLIC_CONVEX_URL` (not necessarily a fixed local port in hosted dev).

## Other useful commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Production build (Turbo) |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm lint` | Lint |
| `pnpm test` | Run tests |
| `pnpm format` | Prettier write |

Legacy optional Hocuspocus server: `pnpm --filter realtime dev:legacy` (see commented vars in `apps/web/.env.example`).

## Environment variables (reference)

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `apps/web/.env.local` | Clerk auth |
| `NEXT_PUBLIC_CONVEX_URL`, `CLERK_JWT_ISSUER_DOMAIN` | `apps/web/.env.local` | Convex deployment + Clerk JWT validation |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | env / `.env.local` for Next; export for worker | BullMQ |
| `COMPILE_USE_DOCKER` | worker process env | `true` (default) uses Docker; `false` / `0` uses host `latexmk` |
| `COMPILE_DOCKER_IMAGE` | worker | Override image (default `ghcr.io/xu-cheng/texlive-full:latest`) |
| `WORKER_CONCURRENCY` | worker | BullMQ concurrency (default `2`) |

## Packages and apps

- `apps/web` — Next.js UI, `/api/compile`, editor workbench, Convex client
- `apps/compile-worker` — BullMQ consumer for `latexmk`
- `apps/realtime` — optional legacy collaboration server
- `packages/protocol` — shared compile job types
- `packages/queue` — BullMQ queue name + Redis connection helpers
- `packages/editor` — CodeMirror 6 LaTeX surface

## Feature coverage (high level)

| Area | In repo | Roadmap-style gaps |
|------|---------|---------------------|
| Editing | CM6 LaTeX, folding, brackets, search, Vim option, autocomplete | Richer cite/ref, spellcheck |
| Build | `latexmk` via Docker or host, multiple engines, log parse, timeout | Docker-side hard kill, SyncTeX |
| Collaboration | Convex + Clerk: files, presence, design mode | Roles, comments, track changes |
| Versioning | IndexedDB compile snapshots | Server history, Git |

---

Repository: [https://github.com/Luseefor/alove](https://github.com/Luseefor/alove)
