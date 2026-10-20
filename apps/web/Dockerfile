FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/compile-worker/package.json apps/compile-worker/
COPY apps/realtime/package.json apps/realtime/
COPY packages/editor/package.json packages/editor/
COPY packages/protocol/package.json packages/protocol/
COPY packages/queue/package.json packages/queue/

RUN bun install --frozen-lockfile

COPY . .

# UI mode is a build-time choice. It never grants compile authorization.
ARG NEXT_PUBLIC_LOCAL_STANDALONE=false
ENV NEXT_PUBLIC_LOCAL_STANDALONE=$NEXT_PUBLIC_LOCAL_STANDALONE

# Build the packages and web app
RUN bun run build --filter web

WORKDIR /app/apps/web

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "start"]
