# TeX runner image (reference)

The compile worker runs LaTeX inside Docker by default:

- `COMPILE_DOCKER_IMAGE` (default `ghcr.io/xu-cheng/texlive-full:latest`)

Pull once before first compile:

`docker pull ghcr.io/xu-cheng/texlive-full:latest`

To use a host-installed TeX Live instead (faster local iteration):

`COMPILE_USE_DOCKER=false` on the compile-worker process.
