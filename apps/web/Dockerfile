FROM oven/bun:1.3.10-alpine

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1

COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/compile-worker/package.json apps/compile-worker/
COPY apps/realtime/package.json apps/realtime/
COPY packages/editor/package.json packages/editor/
COPY packages/protocol/package.json packages/protocol/
COPY packages/queue/package.json packages/queue/

RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/compile-worker/src/compileFileData.ts apps/compile-worker/src/logParse.ts apps/compile-worker/src/synctex.ts ./apps/compile-worker/src/

# UI mode is a build-time choice. It never grants compile authorization.
ARG NEXT_PUBLIC_LOCAL_STANDALONE=false
ENV NEXT_PUBLIC_LOCAL_STANDALONE=$NEXT_PUBLIC_LOCAL_STANDALONE
# Public client credentials. Empty by default so plain CI builds still pass.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CONVEX_URL=""
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL

# Build the packages and web app
RUN bun run build --filter web

WORKDIR /app/apps/web

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "start"]
