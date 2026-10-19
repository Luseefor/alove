# Docker Deployment

## Local Development

The easiest way to run the entire backend and frontend stack locally is with Docker Compose.

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

This starts:
- **web:** Next.js application on `http://localhost:3000`
- **compile-worker:** Pulls compile jobs and runs TeX
- **redis:** Used for BullMQ job queues

### TeX Image
The compile worker will automatically spawn a Docker container from `ghcr.io/xu-cheng/texlive-full:latest`. 
_Note: The initial pull for this image may take a while depending on your connection._

### Security Note
In development, the compile worker mounts `/var/run/docker.sock` to control the host Docker daemon. This is convenient for local development but represents a security risk if exposed in untrusted environments. Production deployments should isolate the compilation process.

## Production Deployment

For a production environment, you should use `docker-compose.prod.yml` or deploy the services separately:

1. **Web App:** Next.js, requiring Clerk/Convex configuration if cloud mode is enabled.
2. **Redis:** A managed Redis instance or secured Redis container.
3. **Worker:** A secure, isolated environment for executing `compile-worker`.

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### Clerk and Convex
To run in cloud mode, `NEXT_PUBLIC_LOCAL_STANDALONE=false` must be set, along with your Clerk and Convex environment variables. The application will fail-closed if auth secrets are missing.

### Rollback
If there is an issue with the CodeMirror editor surface, you can roll back to the classic textarea by setting:
`NEXT_PUBLIC_EDITOR_MODE=textarea`
and rebuilding/redeploying the container.

## Troubleshooting

- **Redis unavailable:** The web compile API will return a 503 structured error, and UI will gracefully fail.
- **Docker unavailable:** The compile worker will fail jobs with `DOCKER_ERROR` and log details. Ensure the Docker daemon is running and accessible.
- **Cleanup failure:** If a container cannot be stopped/removed, the worker logs a warning. This does not fail the compile job if compilation succeeded.
