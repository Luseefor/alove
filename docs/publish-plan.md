# Publishing alove

The delivery target is a reproducible cloud deployment with credential-free local checks. Live authentication, DNS, TLS issuance and provider deployment checks need the owner's account configuration. A passing local check does not establish that those external services work.

## Backend decision

Keep Convex as the managed project database and Clerk as the identity provider. The editor already uses both. Convex handles transactional file versions and project ownership; Clerk handles sessions, account recovery and identity verification. The application keeps authorization decisions in its own server functions.

Run Next as a container behind an HTTPS reverse proxy. Run TeX jobs on a separate dedicated VM/daemon, connected to private authenticated Redis. Do not put the Docker socket on the public web host. Start with a single compile worker and bounded admission; scale after measuring queue wait and memory. The deployment bundle supports Ubuntu/Docker hosts without tying the application to a hosting vendor. Hetzner is one possible VM provider; the bundle does not purchase infrastructure.

Vercel's function request/response limit is 4.5 MB. Current compile requests allow about 21 MiB and PDFs up to 50 MiB, so the existing API does not fit that hosting model. A future object-storage upload/download design could change this decision. Convex documents are limited to 1 MiB, so cloud files need stricter bounds than local compile files until binary storage is moved into the storage service.

References: [Convex limits](https://docs.convex.dev/production/state/limits), [Clerk integration](https://docs.convex.dev/auth/clerk), [Vercel function limits](https://vercel.com/docs/functions/limitations), [Docker daemon security](https://docs.docker.com/engine/security/).

## Delivery scope

- Public pages, custom 404, route/global error recovery and accessible loading states.
- Cloud provider and redirect configuration that preserves deep links; private pages wait for database authentication.
- Bounded owner-scoped cloud file mutations with version conflicts tested using two identities.
- Compile admission limits, bounded queue retention, outage handling, cancellation and graceful worker shutdown.
- Honest readiness checks and user-facing retry states.
- Correct container build variables and worker source mounts, separate deployment roles, HTTPS/private Redis configuration and recovery instructions.
- CI unit/type/lint/build checks, production browser checks and actual Docker TeX smoke checks.
- Release/deploy and backend deployment workflows with environment checks, credential-free validation and a final list of missing configuration names.
- Signed Clerk account-deletion events with bounded, owner-scoped cloud cleanup.

[release-runbook.md](release-runbook.md) contains the exact configuration names, host setup, rollback and remaining live checks. Optional integrations will not block local editing or silently send document source to third parties.
