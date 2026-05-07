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

`COMPILE_USE_DOCKER=false` on the compile-worker process.
