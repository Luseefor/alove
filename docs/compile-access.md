# Compile access

Compile jobs carry a server-generated owner record. Cloud submission requires a Clerk session, a Convex token and owner or editor membership in the requested project. Polling requires the submitting user and a fresh project owner/editor access check before the route reads state, logs or PDF data. Missing, foreign and legacy unowned jobs return the same 404 response. Every polling response carries `Cache-Control: private, no-store`.

The API accepts source files from the editor, including unsaved edits. It checks project access, not equality with the files saved in Convex. Current owners and editors can submit source; viewers cannot. Revocation and downgrade take effect on the next request. Jobs remain private to their submitting account, so another project member cannot retrieve that account’s logs or PDF through a guessed job ID.

The web API queues `{ version: 1, owner, request }`. The worker validates this record, then revalidates the compile request before execution. Client requests cannot set `owner` or other internal fields. Legacy jobs lack ownership and are rejected by the new worker and polling route. Stop submission, let running jobs finish, then deploy the web and worker together. This change does not migrate old results or cancel work already running.

Authentication and authorization errors fail closed. Clerk failures return 503. Missing configuration returns an error instead of anonymous access. Middleware no longer passes protected requests through after an authentication failure. The routes also enforce access themselves.

## Local use

Local writing and source export still work without an account. The public `NEXT_PUBLIC_LOCAL_STANDALONE` flag selects that UI. It grants no permission to compile.

Anonymous compilation requires a separate server variable containing the exact origin, including the non-default port:

```sh
NEXT_PUBLIC_LOCAL_STANDALONE=true bun run --filter web build
NEXT_PUBLIC_LOCAL_STANDALONE=true \
ALOVE_LOCAL_COMPILE_ORIGIN=http://127.0.0.1:30128 \
REDIS_HOST=127.0.0.1 REDIS_PORT=6381 \
bun run --cwd apps/web start --hostname 127.0.0.1 --port 30128
```

The default `bun run dev` launcher chooses a free port, binds Next to `127.0.0.1` and sets both variables. The Playwright launcher does the same for its port. Use the exact configured URL in the browser. Switching between `localhost` and `127.0.0.1`, or between ports, does not grant access to the other origin's jobs.

Requests must match the configured URL origin and Host header. An Origin header must also match. Fetch Metadata from a different origin is rejected. POST requires JSON, so an HTML form cannot submit a compile job. Local command-line clients may omit browser headers. Local users share the jobs belonging to that origin; this is a single-user workstation mode.

These checks restrict browsers. They do not establish the network address of the caller. A remote client can forge headers. Bind the listener to loopback, keep Redis private, and never expose this anonymous mode through a public reverse proxy or tunnel. In development Compose, the web and Redis ports publish only on `127.0.0.1`; trusted containers can still reach each other. Production Compose leaves Redis on its internal network and explicitly disables anonymous compile policy.

For cloud operation, unset `ALOVE_LOCAL_COMPILE_ORIGIN`, set `NEXT_PUBLIC_LOCAL_STANDALONE=false` at build time, and configure Clerk and Convex. A public flag accidentally enabled in a build cannot authorize anonymous compilation.

## Validation and limits

Automated checks cover cross-user reads, project access revocation, legacy job denial, failed identity and project checks, local origin restrictions and queue record validation. Local production browser checks exercise the real API, Redis, worker and Docker path.

Live Clerk sessions against a deployed Convex backend require separate validation with distinct accounts. Login UI and account configuration troubleshooting are outside this change. Public hosting also needs queue quotas, cancellation and restart handling, plus the runner isolation deployment work described in `compile-sandbox.md`.

The server integration follows Clerk's [route handler authentication](https://clerk.com/docs/reference/nextjs/app-router/route-handlers) and Convex's [authenticated Next.js server queries](https://docs.convex.dev/client/nextjs/app-router/).
