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
