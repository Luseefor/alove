# Personal hosting on Vercel

Weftly can use Vercel Functions to claim queued builds and start an isolated TeX
Sandbox on demand. This avoids an always-running runner for personal use. The
existing Docker deployment remains documented in [release-runbook.md](release-runbook.md).

## Configure the services

Use Vercel Hobby, Clerk Hobby, Convex Free and an explicitly free Redis plan.
Check current quotas before provisioning. Do not select a trial that converts to
a paid subscription. On 2026-10-24, Vercel documents Hobby Sandbox allowances of
5 active CPU hours, 420 GB-hours of memory, 5,000 creations and 20 GB of transfer
per month, with 15 GB of lifetime snapshot storage. Quota exhaustion pauses creation.
Hobby is for personal, noncommercial use. See [Sandbox pricing](https://vercel.com/docs/sandbox/pricing).

The Redis endpoint must support BullMQ's TCP protocol, Lua scripts and TLS, with
eviction disabled. A REST URL is insufficient. Upstash documents
[BullMQ over TLS](https://upstash.com/docs/redis/integrations/bullmq) and a
[Free plan](https://upstash.com/pricing/redis). Redis Cloud's free Essentials plan
[does not support TLS](https://redis.io/docs/latest/operate/rc/security/database-security/tls-ssl/).

In Vercel, set Root Directory to `apps/web`, use Bun and permit imports from
outside that root. `apps/web/vercel.json` selects `bun run build:vercel`, which
deploys Convex and supplies `NEXT_PUBLIC_CONVEX_URL` to the Next build. The normal
`bun run build` stays available for standalone development and CI.

| Vercel variable                     | Value                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY`                 | Marketplace-managed Production key for Production, Preview key for Preview |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production `pk_live_…`; development key for Preview                        |
| `CLERK_SECRET_KEY`                  | Matching Clerk key, stored as sensitive                                    |
| `REDIS_URL`                         | Dedicated `rediss://` connection string, stored as sensitive               |
| `ALOVE_SITE_URL`                    | Exact public HTTPS origin, such as `https://weftly.rijan.sh`               |
| `COMPILE_RUNTIME`                   | `vercel-sandbox`                                                           |
| `COMPILE_VERCEL_SNAPSHOT_ID`        | Verified, nonexpiring snapshot containing TeX tools only                   |
| `COMPILE_MAX_OWNER_JOBS`            | Start with `1` for personal use                                            |
| `COMPILE_MAX_QUEUED_JOBS`           | Start with `2` for personal use                                            |

Leave `NEXT_PUBLIC_LOCAL_STANDALONE` and `ALOVE_LOCAL_COMPILE_ORIGIN` unset on
cloud deployments. Leave `REDIS_HOST` and `REDIS_PORT` unset when using the URL.
Set Preview's site origin to its actual origin before testing browser compile
requests there. Production Clerk keys require the configured custom domain.

Activate Clerk's Convex integration in each Clerk environment. Set
`CLERK_JWT_ISSUER_DOMAIN` in the corresponding **Convex deployment**, using that
Clerk environment's exact Frontend API origin. Configure project defaults for
new Preview/Development deployments separately from Production. Follow
[Convex's hosting instructions](https://docs.convex.dev/production/hosting/vercel).
The `user.deleted` webhook and its Convex-side `CLERK_WEBHOOK_SECRET` still need
the signed-delivery check in the release runbook.

## TeX snapshot and proof

The tools snapshot needs `latexmk`, the three TeX engines, bibliography tools,
and the packages used by supported manuscript controls. It must contain no
documents or application credentials. Runtime Sandboxes use Vercel's automatic
OIDC identity in the Function; do not create a long-lived Vercel token for TeX.

Set `WEFTLY_VERIFY_SANDBOX=1` only for the administrative Preview branch to run
`scripts/verify-vercel-sandbox.ts` before its Vercel build. Ordinary builds do not
run this proof. It uses the configured tools snapshot. If that snapshot
expires, it clones the clean tools filesystem and snapshots it with
`expiration: 0` before writing any fixtures. Copy the printed public snapshot ID
into `COMPILE_VERCEL_SNAPSHOT_ID`, then remove or disable the proof flag.
Do not leave an expiring snapshot configured for the published app.

The proof exercises the real SDK, all three engines, nested main files,
included source, a PNG asset, SyncTeX, TeX failure and cancellation. It also checks
that app credentials are absent and outbound TCP is blocked. Every proof VM is
stopped. The script is administrative and has no public HTTP endpoint.

## Runtime behavior and limits

Authenticated project access, ownership checks and existing Redis admission
limits run before enqueueing. `after()` claims one durable BullMQ job. Polling
can wake waiting work after a cold start or scheduling failure. A crashed
Function's abandoned job eventually fails through the stalled checker rather
than automatically consuming another compile. Retrying is explicit.

Each compile starts a fresh VM with one CPU, 2 GB memory, denied network access,
no application credentials and an unprivileged TeX user. Shell escape and custom
latexmk configuration are disabled. Artifact reads reject links and special
files. The VM is stopped after completion or cancellation and has a bounded
orphan timeout.

| Limit                             | Personal cloud value |
| --------------------------------- | -------------------- |
| Serialized project request        | 3,000,000 bytes      |
| PDF                               | 2,000,000 bytes      |
| Retained log tail                 | 131,072 bytes        |
| Compressed/decoded source mapping | 1,000,000 bytes      |
| Source mapping entries            | 3,000                |
| Serialized result                 | 4,000,000 bytes      |
| Compile deadline                  | At most 60 seconds   |

These bounds leave space below the Vercel Function payload limit. The browser
checks the serialized request before sending it. Larger projects need a
different deployment or direct artifact storage.

`/api/ready` checks auth configuration, Redis and the Sandbox snapshot's status
and expiry. It does not prove login or successful TeX execution. Before public
release, verify GitHub sign-in, cloud save/reload, repository authorization using
that same account, an actual queued PDF build, on-page editing/rebuild and signed
account deletion. Local mocks and a connected integration are insufficient.
