# alove

Monorepo for a web LaTeX workspace: Next.js editor, BullMQ compile worker (TeX Live in Docker), and optional Convex-backed collaboration. **Dependencies and scripts use [Bun](https://bun.sh)** (`bun install`, `bun run`, workspaces, and the Bun runtime for the compile worker and legacy realtime server).

**Default `bun run dev`** runs the web app in **local standalone** mode: **no Clerk or Convex**, editor + PDF + multi-file on disk-backed browser history only, **no live collaboration**, Next.js on **[http://localhost:3001](http://localhost:3001)**. Use **`bun run --filter web dev:cloud`** plus Convex when you want the full authenticated stack (port **3000**).

## Prerequisites

| Tool | Notes |
|------|--------|
| **[Bun](https://bun.sh/docs/installation)** | **1.3.10+** — matches `packageManager` in root `package.json` and CI |
| **Docker** | Docker Engine + Compose v2 (Redis, Postgres, TeX compiles) |
| **Git** | SSH recommended for GitHub |
| **Clerk** | Only for **cloud** mode — [sign up](https://dashboard.clerk.com), create an application |
| **Convex** | Only for **cloud** mode — [sign up](https://dashboard.convex.dev), create a project |

Install Bun (macOS/Linux):

```bash
curl -fsSL https://bun.sh/install | bash
```

Windows: see [Bun docs](https://bun.sh/docs/installation).

## Clone the repository

```bash
git clone git@github.com:Luseefor/alove.git
cd alove
```

## Step 1 — Install dependencies

```bash
bun install
```

## Step 2 — Start Redis and Postgres

```bash
docker compose up -d
```

This exposes **Redis** on `6379` and **Postgres** on `5432`.

## Step 3 — Pull the TeX Live image (compile worker)

```bash
docker pull ghcr.io/xu-cheng/texlive-full:latest
```

Optional: set `COMPILE_USE_DOCKER=false` and use host TeX Live; see **Environment variables** below.

## Step 4 — Configure environment

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/web/.env.local` when using **cloud** mode (`dev:cloud` / `dev:with-convex`):

1. **Clerk** — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the Clerk dashboard. For relaxed local cloud dev you can omit `CLERK_SECRET_KEY`; set it for production-like middleware and `/api/compile`.
2. **Convex** — after Step 5, the Convex CLI writes `NEXT_PUBLIC_CONVEX_URL` into `.env.local` (or copy from the Convex dashboard).
3. **Clerk JWT for Convex** — `CLERK_JWT_ISSUER_DOMAIN` (Clerk issuer URL, often `https://<instance>.clerk.accounts.dev`). Add a JWT template named **`convex`** per [Convex + Clerk](https://docs.convex.dev/auth/clerk).
4. **Redis** — defaults `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379` match `docker compose`.

**Local standalone** (default `bun run dev`): you do **not** need Clerk or Convex in `.env.local`. Optionally set `NEXT_PUBLIC_LOCAL_STANDALONE=true` yourself if you run `next dev` without the web `dev` script.

The compile worker reads `REDIS_*` from the environment (defaults match Docker). Next.js loads `apps/web/.env.local` for the web app.

## Step 5 — Link Convex (cloud mode only)

Skip this for default local standalone. From the **repository root**:

```bash
bun run convex:dev
```

This runs `convex dev` in the `web` workspace (`apps/web`). Log in when prompted, select a project, and keep the process running while developing, **or** use the combined script in Step 6.

## Step 6 — Run the app

### Default — local editor + compile (no auth, no collab)

**Terminal 1** — Next.js (port **3001**) + compile worker via Turbo:

```bash
bun run dev
```

Ensure **Redis** is up (`docker compose`). No Convex terminal is required in this mode.

Open [http://localhost:3001/editor](http://localhost:3001/editor).

### Cloud — Clerk + Convex + collaboration

**Terminal 1** — Next on port **3000** + compile worker:

```bash
bun run --filter web dev:cloud
bun run --filter compile-worker dev
```

(Or run both via two terminals / a process manager.)

**Terminal 2** — Convex:

```bash
bun run convex:dev
```

**Alternative — Next + Convex in one terminal** (Next still on **3000**):

```bash
bun run dev:with-convex
```

Use a second terminal for the compile worker:

```bash
bun run --filter compile-worker dev
```

### Open the editor (cloud)

1. [http://localhost:3000/editor](http://localhost:3000/editor)
2. Sign in with Clerk.
3. Optional: second browser or incognito to verify collaboration.

**Ports:** `3001` — Next.js default dev (local standalone); `3000` — Next.js cloud dev; `6379` — Redis; `5432` — Postgres; Convex URL comes from `NEXT_PUBLIC_CONVEX_URL` when enabled.

## Other useful commands

| Command | Purpose |
|---------|---------|
| `bun run build` | Production build (Turbo) |
| `bun run typecheck` | Typecheck all packages |
| `bun run lint` | Lint |
| `bun run test` | Tests |
| `bun run format` | Prettier |

**Workspace examples:**

```bash
bun run --filter web lint
bun run --filter compile-worker dev
bun run --filter realtime dev:legacy
```

## Environment variables (reference)

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_LOCAL_STANDALONE` | build / `.env.local` | `true` / `1` disables Clerk, Convex UI, and collaboration (also set by default `apps/web` `dev` script) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `apps/web/.env.local` | Clerk |
| `NEXT_PUBLIC_CONVEX_URL`, `CLERK_JWT_ISSUER_DOMAIN` | `apps/web/.env.local` | Convex + Clerk JWT |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | env / `.env.local` for Next; export for worker | BullMQ |
| `COMPILE_USE_DOCKER` | worker | `true` (default) Docker; `false` / `0` host `latexmk` |
| `COMPILE_DOCKER_IMAGE` | worker | TeX image override |
| `WORKER_CONCURRENCY` | worker | BullMQ concurrency (default `2`) |

## Packages and apps

- `apps/web` — Next.js UI, `/api/compile`, Convex client
- `apps/compile-worker` — BullMQ consumer (`bun` runtime)
- `apps/realtime` — optional legacy server (`bun` runtime)
- `packages/protocol`, `packages/queue`, `packages/editor` — shared libraries

## Feature coverage (high level)

| Area | In repo | Roadmap-style gaps |
|------|---------|---------------------|
| Editing | CM6 LaTeX, folding, brackets, search, Vim option, autocomplete | Richer cite/ref, spellcheck |
| Build | `latexmk` via Docker or host, multiple engines, log parse, timeout | Docker-side hard kill, SyncTeX |
| Collaboration | Convex + Clerk | Roles, comments, track changes |
| Versioning | IndexedDB compile snapshots | Server history, Git |

---

Repository: [https://github.com/Luseefor/alove](https://github.com/Luseefor/alove)
