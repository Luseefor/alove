# Weftly

**Weftly** is a web LaTeX workspace you run yourself. Write in the browser, compile with a full TeX Live install in Docker, and preview the PDF next to your source. Default local mode needs no account. Optional Clerk + Convex provides an authenticated cloud workspace; public multi-user release gates remain open.

There is no public hosted demo; clone the repo and run it.

The app was previously named alove. Existing saved projects, `.alove.json` archives, environment variables and package identifiers remain compatible. New source downloads use `.weftly.json`. Brand assets live in `apps/web/public/brand/weftly`.

## Why Weftly (vs Overleaf)

Overleaf is a hosted service. Weftly is software you clone and run:

- **Local-first** — editor, multi-file projects, and PDFs on your machine; no sign-in for the default `bun run dev`
- **Your TeX Live** — `latexmk` in Docker (`pdflatex`, `xelatex`, `lualatex`) or a host install
- **Cloud sync when you opt in** — Clerk auth + owner-scoped Convex projects, not required to write
- **Open source** — MIT; fork, self-host, or wire up the cloud path yourself

## Features

- CodeMirror 6 source editor, PDF preview, outline, folding, snippets and search
- Durable browser workspaces with revision conflicts and portable source archives
- Source-aware builds that retain the last successful PDF and mark stale previews
- Immutable build receipts and bounded, compile-tested whole-file recovery
- Validated compile requests, bounded process execution and real Docker checks

See [build recovery](docs/build-recovery.md) and the [local benchmark report](docs/benchmarks/2026-10-19-local-m3-pro/README.md). The local numbers do not establish an advantage over Overleaf.

## Quick start with Docker

```bash
cp .env.example .env
bun run docker:dev
```

Visit `http://127.0.0.1:3000` (the exact local compute origin). See [Docker deployment](docs/deployment/docker.md).

## Try it

You need [Bun](https://bun.sh) **1.3.10+** and Docker (Engine + Compose v2).

```bash
git clone https://github.com/Luseefor/alove.git
cd alove
bun install
docker compose up -d
docker build -t alove-tex:local -f services/tex-runner/Dockerfile.local services/tex-runner
COMPILE_DOCKER_IMAGE=alove-tex:local bun run dev
```

Open **`/editor`** at the URL printed in the terminal (the app picks a free port starting at **30127**). Redis from Compose is required for compiles. Clerk and Convex are **not** used in this mode.

## Cloud projects (optional)

Cloud mode uses Clerk, Convex and the same compile worker. Projects are owner-only; invitation-based multi-user collaboration is not available. Copy [`apps/web/.env.example`](apps/web/.env.example) to `apps/web/.env.local`, fill Clerk and Convex keys, then:

```bash
bun run --filter web dev:cloud
bun run --filter compile-worker dev
bun run convex:dev
```

Editor: [http://localhost:3000/editor](http://localhost:3000/editor). Ports, env vars, host TeX Live, and workspace commands: [docs/development.md](docs/development.md).

## Publishing

Use the [release runbook](docs/release-runbook.md) for the backend decision, separate web/runner deployment, HTTPS, provider configuration, rollback and live checks. The manual deploy workflow stops when required configuration is missing. The [publishing plan](docs/publish-plan.md) explains the hosting constraints.

## License

[MIT](LICENSE)
