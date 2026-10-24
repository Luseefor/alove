# Release runbook

The application uses Clerk for identity, Convex for project data, and a private Redis queue between the website and a dedicated Docker runner. For personal Vercel hosting with on-demand TeX Sandboxes, use [vercel-personal-hosting.md](vercel-personal-hosting.md). The Docker hosting constraints are in [publish-plan.md](publish-plan.md). Local mode remains available without these accounts.

## Configuration to add

Create a GitHub environment named `production`. Use environment protection and restrict deployments to `main`. Add the following values there; do not put secrets in issues, pull requests or source files.

| Kind | Name | Source |
| --- | --- | --- |
| Variable | `ALOVE_SITE_URL` | Public HTTPS origin, with DNS pointing to the web host |
| Variable | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk production application, `pk_live_…` |
| Variable | `NEXT_PUBLIC_CONVEX_URL` | Convex production deployment URL |
| Variable | `CLERK_JWT_ISSUER_DOMAIN` | Exact issuer from the Clerk Convex JWT template |
| Variable | `DEPLOY_WEB_HOST` | Web VM SSH address |
| Variable | `DEPLOY_RUNNER_HOST` | Different, dedicated runner VM SSH address |
| Variable | `DEPLOY_SSH_USER` | Deployment account, `alove` with the provided cloud-init |
| Secret | `CLERK_SECRET_KEY` | Matching Clerk production secret key |
| Secret | `CLERK_WEBHOOK_SECRET` | Signing secret for the Convex account-deletion webhook |
| Secret | `CONVEX_DEPLOY_KEY` | Production deployment-scoped Convex deploy key |
| Secret | `REDIS_URL` | Authenticated `rediss://` URL shared by web and runner |
| Secret | `DEPLOY_SSH_PRIVATE_KEY` | Deployment SSH private key |
| Secret | `DEPLOY_SSH_KNOWN_HOSTS` | Host keys for both VMs, verified through the provider console |

`deploy/production.env.example` lists the configuration names. The workflow supplies `NEXT_PUBLIC_LOCAL_STANDALONE=false`, `COMPILE_USE_DOCKER=true`, `COMPILE_WORK_ROOT=/var/lib/alove/jobs` and concurrency 1. It builds TeX and deploys it by registry digest. It never enables anonymous local compute in production.

Run `bun run deploy:check -- --target=release` with the intended environment to list missing or invalid names. For separate checks use targets `web`, `runner`, `backend` and `transport`. `runner` and `release` additionally need `COMPILE_DOCKER_IMAGE` set to an actual immutable registry reference when checking manually. The workflow obtains it from its image build. The checker does not print values or validate that a key belongs to the intended provider account.

## Provider and host setup

1. Create a production Clerk application. Configure its domain, allowed redirects, `/sign-in` and `/sign-up` paths. Activate Clerk's Convex integration so session tokens have the `convex` audience. Existing installations can retain the JWT template named **convex** with application/audience `convex`; server routes support both modes. Copy the issuer exactly. Use the same Clerk application for the publishable key, secret key and webhook.
2. Create the Convex production deployment. Generate its deployment-scoped deploy key. The workflow sets the issuer and webhook secret in that deployment before deploying functions. It also checks that the deployment URL selected by the key equals the public URL used by the web image.
3. Add a Clerk webhook endpoint at `https://<production-deployment>.convex.site/clerk-users-webhook` (HTTP actions use `.site`, not `.cloud`). Subscribe to `user.deleted`. Copy its signing secret to `CLERK_WEBHOOK_SECRET`. Test delivery after deploying. Authentic account-deletion events schedule owner-scoped project cleanup; provider backups and browser drafts follow their separate retention policies.
4. Provision two Ubuntu 24.04 **amd64** VMs with Docker Engine and Compose **2.30 or newer**. `deploy/cloud-init.yml` installs these and creates the deployment account. Add the deployment public SSH key to that account's `authorized_keys` before using the workflow. Start with at least 4 GiB RAM per host and one worker; measure actual use before changing concurrency. TeX container limits remain separate from worker container limits.
5. Allow inbound 80/443 on the web host and SSH only from your management/deployment path. The runner exposes no application ports. Both hosts need outbound registry access, and the runner needs Docker access. The deployment account's Docker membership has host-root power. Use a dedicated daemon and keep unrelated workloads and credentials off that host. The web container has no Docker socket. Its server-only `ALOVE_COMPILE_TRUST_PROXY=true` setting accepts the configured public Host while Next uses an internal container URL. Host and browser Origin must still match `ALOVE_SITE_URL`, and Clerk/project/job ownership checks still apply. Do not expose the web container directly or trust arbitrary forwarded hosts.
6. Provision standard, standalone Redis with verified TLS, authentication, Lua and BullMQ-compatible commands, persistence and `noeviction`. Avoid HTTP-only or cluster endpoints. Reserve at least 2 GiB and monitor queue memory: ten retained 50 MiB PDFs alone can approach 670 MiB as base64 before source and Redis overhead. Allow connections only from the two hosts. The URL password must contain at least 16 decoded characters. Use a publicly trusted certificate for the supplied workflow; custom-CA support exists in queue configuration but is not provisioned by this deployment bundle.
7. Point the public domain at the web VM. Caddy obtains HTTPS certificates and persists them in named volumes. Do not proxy an anonymous local instance to the public domain.

Official setup references: [Clerk with Convex](https://docs.convex.dev/auth/clerk), [Clerk webhooks in Convex](https://docs.convex.dev/auth/database-auth), [Convex deploy keys](https://docs.convex.dev/cli/deploy-key-types), [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/), [Compose raw env files](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/).

## Release and rollback

Merge the ready PR and wait for **build**, **browser** and **docker** CI jobs on that exact main revision. Run the manual **deploy** workflow from `main`. A run from another branch fails explicitly. The workflow checks configuration and successful CI, builds immutable web/runner/TeX images in GHCR, deploys Convex functions, then activates the runner before the web host. Public client variables are supplied at web-image build time; secret keys stay in runtime files.

SSH uses pinned host keys and batch mode. Registry credentials travel over SSH stdin and are logged out after image pulls. Runtime files under `/opt/alove/releases/<commit>-<unique-release-id>/.deploy` are mode 600; deployment directories are private. They contain secrets and need protected backups. Each retry gets a new release directory, even for the same commit, so it cannot overwrite the previous runtime files. Old image layers and release directories are intentionally retained for rollback. Do not prune them until a subsequent release is accepted.

Activation waits for container health, then updates `/opt/alove/current` and `/opt/alove/previous`. The web container checks liveness so help and recovery pages remain available during a queue outage. The worker refreshes its heartbeat only after a bounded probe can inspect the configured Docker image (or run `latexmk -v` in explicitly trusted local mode). Failed probes let readiness expire within the 15-second heartbeat window; repairing the runtime restores it without restarting the worker. This checks runtime availability, not the success of a particular document. The release gate separately waits for public `/api/ready` to confirm authentication configuration, Redis and a recent worker heartbeat. It does not prove Clerk login or cloud document sync.

A failed readiness gate leaves a failed workflow, not a success. Inspect `docker compose ... ps` and the sanitized worker events on each host. For rollback, SSH to **each affected host**, enter `/opt/alove/previous`, and run:

```sh
# Runner host
/bin/sh deploy/activate.sh runner --rollback
# Web host
/bin/sh deploy/activate.sh web --rollback
```

Rollback uses previously pulled local images and does not require a registry token. On a failed first activation with no previous release, repair configuration and rerun the workflow. Backend changes must remain compatible across this transition; application rollback does not restore a Convex database snapshot. Use the Convex dashboard/export and tested backup policy before destructive schema migrations. This release adds no destructive schema migration.

## Checks before inviting users

- Sign up, verify email, sign out and sign in again. Check password recovery and the configured social providers if enabled.
- Open a protected project deep link while signed out; after login it must return to that project, not lose its query string.
- In account A, create, edit, reload, rename, export and delete a project. Import an archive as a separate project. Check Unicode, binary assets, engine choice and actual PDF download.
- In account B, try A's project ID and compile job ID. Reads, edits, deletion and job polling/cancellation must be refused. Sign out and switch accounts without a reload; prior source must not appear.
- Simulate an offline cloud save, reload the same tab and explicitly restore its browser draft. A newer remote revision must produce a conflict while preserving both sources. Browser unload backup is best effort; export remains the independent recovery path.
- Delete a test account through Clerk and verify its signed webhook removes that owner's projects/files/presence while another account remains intact. Use Clerk delivery retries for a transient backend outage.
- Stop the runner: `/api/ready` must become unavailable within the heartbeat window while `/api/health`, Help and source export stay reachable. Restart it and retry a build. Stop Redis: API calls must fail promptly rather than hang or report a successful save/build.
- Cancel a running TeX loop; require a `CANCELLED` worker result and no surviving job container. Confirm per-user and global admission limits and 429 retry guidance. Deployment SIGTERM waits for active jobs, then aborts them after the grace deadline.
- Verify HTTPS, the public 404, phone/tablet/desktop layout, provider operational backups, retention and an operator contact on the Privacy page.

These checks require the real domain and account configuration. Local mocks, signed test events and Convex test identities do not substitute for this final live pass. Keep a small private pilot until it passes.
