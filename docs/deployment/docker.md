# Docker deployment

For local use, build the pinned small TeX image, then start the development stack:

```sh
docker build -t alove-tex:local -f services/tex-runner/Dockerfile.local services/tex-runner
bun run docker:dev
```

Open `http://127.0.0.1:3000`. This exact origin is required for anonymous local compiles. Development Compose runs web, Redis and the worker, publishes loopback ports, and shares an identical absolute job path between the worker and host Docker daemon. Its Docker socket mount gives the worker control of that daemon. Keep this stack local; do not tunnel it to the internet.

`ALOVE_WEB_PORT` and `ALOVE_REDIS_PORT` can select unused host ports. `ALOVE_COMPILE_WORK_ROOT` selects the shared absolute source directory. `COMPILE_DOCKER_IMAGE` selects an already installed TeX image; the worker does not silently pull a missing one. Use `bun run smoke:docker` for an isolated stack that checks actual nested-file/image/bibliography compilation, worker cancellation and timeout cleanup. It creates a separate Compose project and removes only its own services afterward.

For production, follow the [release runbook](../release-runbook.md). `docker-compose.prod.yml` is the web host plus Caddy; `docker-compose.runner.yml` is a separate dedicated Docker host. Both use authenticated managed Redis over verified TLS. There is no public Redis port and no Docker socket on the web container. Production Compose consumes immutable images and private runtime environment files created by the manual deploy workflow; it is not a replacement for the local build command above.

The workflow builds public Clerk/Convex configuration into the web image, keeps secret keys at runtime, deploys the backend, checks container health and public backend readiness, and retains previous release directories for rollback. Missing configuration fails the workflow. Real login, cross-account isolation, DNS/TLS and provider backup checks remain part of the live release checklist.
