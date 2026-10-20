# TeX runner image (reference)

The compile worker runs LaTeX inside Docker by default:

- `COMPILE_DOCKER_IMAGE` (default `ghcr.io/xu-cheng/texlive-full:latest`)
- `COMPILE_DOCKER_PLATFORM` (optional; defaults to `linux/amd64` on macOS arm64)
- `COMPILE_TIMEOUT_MS` (hard timeout cap, default `120000`)
- `COMPILE_MAX_FILES` (default `250`)
- `COMPILE_MAX_FILE_BYTES` (default `1048576`)
- `COMPILE_MAX_TOTAL_BYTES` (default `10485760`)
- `COMPILE_MAX_LOG_BYTES` (default `262144`)
- `COMPILE_MAX_PDF_BYTES` (default `52428800`)

Pull once before first compile:

`docker pull ghcr.io/xu-cheng/texlive-full:latest`

To use a host-installed TeX Live instead (faster local iteration):

`COMPILE_USE_DOCKER=false COMPILE_TRUSTED_LOCAL=true bun run --filter compile-worker dev`. Host execution is refused when `NODE_ENV=production`.

The API accepts project files, root, engine, clean-aux, and a bounded timeout. Image and command flags come from server policy; clients cannot override them. Project rc files and TeX shell escape are disabled. Use a pinned `COMPILE_DOCKER_IMAGE` digest for reproducible deployments; the local default remains `latest`.

The request boundary caps projects at 250 files, 1 MiB per file, 10 MiB total file content, and 21 MiB encoded request bytes. Worker environment limits can restrict these further. Container isolation, tenant authorization, and quotas require their own deployment checks; argument validation alone does not establish public-hosting readiness.

## Local Docker verification

On a development Mac, start Docker Desktop and confirm `docker info` works.
If Docker was launched from an isolated agent home and reports a Unix socket
path that is too long, quit that failed instance and launch Docker from the
normal home Terminal (`open -a Docker`). A stopped daemon does not require a
reinstall or data reset. The CLI and worker must use the same working Docker
context. On this Mac that is `DOCKER_CONFIG=/Users/lucifer/.docker` and
`DOCKER_CONTEXT=desktop-linux`; use your own normal Docker config elsewhere.

For a smaller runtime covering the bundled example, build the pinned amd64
base plus `physics` and `cleveref` (the full image remains an option):

```sh
docker build --platform linux/amd64 -t alove-tex:local -f services/tex-runner/Dockerfile.local services/tex-runner
COMPILE_DOCKER_IMAGE=alove-tex:local bun run --filter compile-worker test:docker
```

The base is pinned by digest; the added packages follow the upstream TeX Live
repository at build time. Both package operations use a fixed Illinois CTAN mirror
and require repository signature verification; a bad signature must fail the build.
This is a local development image, not a reproducible
release image. It used approximately 1.85 GB of image storage in verification.
Use `COMPILE_DOCKER_PLATFORM=linux/amd64` on other architectures for this image.

The opt-in Docker suite uses real pdflatex, lualatex and xelatex, nested roots,
includes, a binary PNG, BibTeX, an invalid document, and a timed-out job. It
checks PDF signatures, container removal and temporary-directory cleanup.
Run it without other active compile jobs because cleanup assertions inspect
all `alove-compile-*` containers. Default unit tests do not require Docker.
Binary image/PDF uploads use matching MIME/base64 data URLs; TeX and BibTeX
source remains text. Malformed encoded assets fail validation.

To run the full browser path, start a dedicated loopback Redis and the worker
in separate terminals, then build/start the local web app against that Redis.
Use an unused port to avoid consuming jobs from an existing development queue:

```sh
redis-server --bind 127.0.0.1 --port 6381 --save '' --appendonly no
REDIS_HOST=127.0.0.1 REDIS_PORT=6381 COMPILE_DOCKER_IMAGE=alove-tex:local bun run --filter compile-worker start
NEXT_PUBLIC_LOCAL_STANDALONE=true bun run --filter web build
```

From `apps/web`, start the production preview:

```sh
NEXT_PUBLIC_LOCAL_STANDALONE=true REDIS_HOST=127.0.0.1 REDIS_PORT=6381 bunx next start -p 30127 --hostname 127.0.0.1
```

Ensure the matching Playwright Chromium browser is installed (`bunx playwright
install chromium --only-shell` from `apps/web`). If using an explicit browser
cache, set `PLAYWRIGHT_BROWSERS_PATH` during both installation and the test run.
Then from the repository root:

```sh
E2E_BASE_URL=http://127.0.0.1:30127 E2E_REAL_COMPILE=1 bun run --filter web e2e e2e/real-compile.spec.ts
```

This test uses no compile API mocks: it creates a project, edits source,
compiles through Redis and Docker, downloads a valid PDF, retains that PDF
after a failed rebuild, reloads the saved source, and builds again. Its PDF is
saved in Playwright's test-results directory. The test is skipped unless
`E2E_REAL_COMPILE=1`. These commands verify a host worker with Docker TeX;
they do not verify the Compose worker's host bind-mount arrangement or cloud auth.

## Constrained job containers

Docker jobs now use a non-root user, read-only image/inputs, no network, resource
limits and bounded temporary filesystems. Fonts and packages must be present in
the server-owned image. See [the sandbox contract](../../docs/compile-sandbox.md)
for limits, artifact handling, validation and remaining deployment gates.
