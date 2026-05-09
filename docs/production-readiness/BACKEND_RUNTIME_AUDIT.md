# Backend Runtime Audit

## Current State

| Area | Current state | Gap | Required action |
|---|---|---|---|
| Web app runtime | Next.js development and production build work locally. | No Docker container setup exists. | Create `apps/web/Dockerfile` and `apps/web/.dockerignore`. |
| Compile API | Working with proper local and fallback configuration. Returns 503 when queue fails. | Need health check integration to expose Redis status. | Add `/api/health` route for status checks. |
| Redis queue | Setup via `packages/queue`. Used via `docker-compose.yml`. | Connection is hardcoded to `process.env.REDIS_HOST`. | Validate `docker-compose.yml` points web/worker to Redis hostname correctly. |
| Compile worker | Exists in `apps/compile-worker`. Pulls jobs from BullMQ. | No Docker container setup exists. | Create `apps/compile-worker/Dockerfile` and `.dockerignore`. |
| Dockerized TeX | Executes `ghcr.io/xu-cheng/texlive-full:latest`. | Worker needs Docker socket to spawn containers. | Ensure socket is mounted in `docker-compose.dev.yml` and documented as a security note. |
| Local standalone mode | Working and active by default. | Fully functional. | No action required. |
| Clerk/Convex cloud mode | Documented and operational behind flags. | Functional. | Ensure `.env.example` clearly explains auth setup. |
| Existing Docker Compose | `docker-compose.yml` runs Redis and Postgres. | Postgres is not used natively by the app currently; no web or worker services exist. | Move Postgres to a profile. Add `web` and `compile-worker` services. |
| Existing Dockerfiles | None. | Web and worker Dockerfiles missing. | Add them. |
| Existing health checks | None. | Missing API health check for Compose to rely on. | Add `apps/web/src/app/api/health/route.ts`. |
| Existing environment variables | In `apps/web/.env.example`. | Root and worker examples missing or uncentralized. | Create consolidated `.env.example`. |
| Existing production deployment docs | None. | Documentation missing for production. | Add `docs/deployment/docker.md` and complete `ENVIRONMENT_MATRIX.md`. |

## Answers to key questions

1. Does the repo have a root `docker-compose.yml`? Yes, but it only spins up Redis and Postgres.
2. Does it start only Redis/Postgres, or the full app stack? Only Redis and Postgres.
3. Is Postgres actually used? No, not accessed by the codebase.
4. Is Redis required for compile? Yes.
5. Does the compile worker run from Docker Compose? No, currently run via `bun run`.
6. Does the compile worker require Docker socket access? Yes, if `COMPILE_USE_DOCKER=true` (default).
7. Does the web app container build successfully? Dockerfile missing.
8. Does the compile worker container build successfully? Dockerfile missing.
9. Can a local user run one command and open `/editor`? Need to provide `docker compose up --build`.
10. Can a local user trigger compile and see a safe result? Need to ensure Docker-in-Docker or host Docker socket is handled securely.