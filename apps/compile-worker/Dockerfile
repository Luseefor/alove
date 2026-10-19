FROM oven/bun:1-alpine

# Install Docker CLI to spawn TeX containers
RUN apk add --no-cache docker-cli

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

WORKDIR /app/apps/compile-worker

CMD ["bun", "run", "start"]
