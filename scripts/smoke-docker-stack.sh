#!/bin/bash
# Isolated Docker-stack smoke test.
#
# Uses the dev compose file on its own Compose project with isolated host
# ports and an isolated work root outside the checkout. Verifies the real
# queue + worker path over HTTP (POST /api/compile, poll, DELETE cancel).
# Cleanup is scoped to this smoke's project and work root only: it never
# touches the user's stack (no bare `down`, no global docker prune/rm, no
# Redis FLUSHDB).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.dev.yml"
PIPELINE="$REPO_ROOT/scripts/smokeCompilePipeline.ts"

# Isolated ports (defaults) - configurable without touching dev defaults
# (dev: 3000/6379). Fails fast if the chosen ports are already occupied so
# this smoke never steals a user's stack or another service.
SMOKE_PORT="${ALOVE_SMOKE_PORT:-30132}"
SMOKE_REDIS_PORT="${ALOVE_SMOKE_REDIS_PORT:-${SMOKE_REDIS_PORT:-6382}}"
# Own Compose project so containers/networks/volumes never mix with the
# user's default (directory-named) project.
SMOKE_PROJECT="alove-smoke-${SMOKE_PORT}-$$"
TEX_IMAGE="${COMPILE_DOCKER_IMAGE:-alove-tex:local}"
SMOKE_BASE="http://127.0.0.1:${SMOKE_PORT}"
SMOKE_ORIGIN="http://127.0.0.1:${SMOKE_PORT}"
# Wait up to 180s for build + web/redis/worker readiness.
READY_TIMEOUT_SEC="${ALOVE_SMOKE_READY_TIMEOUT:-180}"

if ! [[ "$SMOKE_PORT" =~ ^[0-9]+$ ]] || [ "$SMOKE_PORT" -lt 1 ] || [ "$SMOKE_PORT" -gt 65535 ]; then
  echo "Invalid smoke web port: $SMOKE_PORT" >&2
  exit 1
fi
if ! [[ "$SMOKE_REDIS_PORT" =~ ^[0-9]+$ ]] || [ "$SMOKE_REDIS_PORT" -lt 1 ] || [ "$SMOKE_REDIS_PORT" -gt 65535 ]; then
  echo "Invalid smoke redis port: $SMOKE_REDIS_PORT" >&2
  exit 1
fi

port_occupied() {
  python3 -c 'import socket,sys; s=socket.socket(); s.settimeout(0.5); sys.exit(0 if s.connect_ex(("127.0.0.1", int(sys.argv[1])))==0 else 1)' "$1" 2>/dev/null
}

if port_occupied "$SMOKE_PORT"; then
  echo "Smoke web port 127.0.0.1:$SMOKE_PORT is already occupied. Set ALOVE_SMOKE_PORT to a free port." >&2
  exit 1
fi
if port_occupied "$SMOKE_REDIS_PORT"; then
  echo "Smoke redis port 127.0.0.1:$SMOKE_REDIS_PORT is already occupied. Set ALOVE_SMOKE_REDIS_PORT to a free port." >&2
  exit 1
fi

# Temp work root outside the checkout, resolved to a real path. The same
# absolute path is bind-mounted into the worker (see docker-compose.dev.yml)
# so the host Docker daemon can mount job sources back.
SMOKE_WORK_ROOT_RAW="$(mktemp -d /tmp/alove-smoke-work.XXXXXX)"
SMOKE_WORK_ROOT="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$SMOKE_WORK_ROOT_RAW")"
case "$SMOKE_WORK_ROOT" in
  "$REPO_ROOT"/*)
    echo "Smoke work root must be outside the checkout: $SMOKE_WORK_ROOT" >&2
    exit 1
    ;;
esac

cleanup() {
  # Scoped cleanup only: this smoke's Compose project and its temp work root.
  # No global `docker rm/prune`, no FLUSHDB, no bare `compose down` that
  # would touch the user's own stack.
  if [ -n "${SMOKE_PROJECT:-}" ]; then
    (cd "$REPO_ROOT" && docker compose -p "$SMOKE_PROJECT" -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1) || true
  fi
  if [ -n "${SMOKE_WORK_ROOT:-}" ] && [ -d "${SMOKE_WORK_ROOT:-}" ]; then
    rm -rf "$SMOKE_WORK_ROOT" || true
  fi
}
trap cleanup EXIT INT TERM

command -v docker >/dev/null || { echo "docker is required for the smoke test" >&2; exit 1; }
command -v bun >/dev/null || { echo "bun is required to run the smoke pipeline" >&2; exit 1; }

# TeX image used by the worker. Build the small local image only when it is
# missing; never pulls or rebuilds unconditionally.
if ! docker image inspect "$TEX_IMAGE" >/dev/null 2>&1; then
  echo "Building missing TeX image $TEX_IMAGE via services/tex-runner/Dockerfile.local..."
  docker build -f "$REPO_ROOT/services/tex-runner/Dockerfile.local" -t "$TEX_IMAGE" "$REPO_ROOT/services/tex-runner"
fi

echo "Starting isolated smoke stack (project=$SMOKE_PROJECT web=$SMOKE_PORT redis=$SMOKE_REDIS_PORT)..."
echo "Work root: $SMOKE_WORK_ROOT"
(cd "$REPO_ROOT" && \
  ALOVE_WEB_PORT="$SMOKE_PORT" \
  ALOVE_REDIS_PORT="$SMOKE_REDIS_PORT" \
  ALOVE_COMPILE_WORK_ROOT="$SMOKE_WORK_ROOT" \
  COMPILE_DOCKER_IMAGE="$TEX_IMAGE" \
  docker compose -p "$SMOKE_PROJECT" -f "$COMPOSE_FILE" up --build -d)

echo "Waiting for $SMOKE_BASE/api/ready (up to ${READY_TIMEOUT_SEC}s)..."
READY_OK=0
for ((i = 1; i <= READY_TIMEOUT_SEC; i++)); do
  if curl -fsS --max-time 5 "$SMOKE_BASE/api/ready" 2>/dev/null | grep -q '"ok":true'; then
    echo "Stack is ready (queue + worker)."
    READY_OK=1
    break
  fi
  if [ "$i" -eq "$READY_TIMEOUT_SEC" ]; then
    break
  fi
  sleep 1
done

if [ "$READY_OK" -ne 1 ]; then
  echo "Timeout waiting for $SMOKE_BASE/api/ready." >&2
  echo "--- smoke compose status (project=$SMOKE_PROJECT) ---" >&2
  (cd "$REPO_ROOT" && docker compose -p "$SMOKE_PROJECT" -f "$COMPOSE_FILE" ps >&2) || true
  (cd "$REPO_ROOT" && docker compose -p "$SMOKE_PROJECT" -f "$COMPOSE_FILE" logs --tail=200 >&2) || true
  exit 1
fi

# Real end-to-end compile checks (main PDF + cancel + 1s timeout) with the
# exact standalone Origin header http://127.0.0.1:<port>.
echo "Running compile pipeline against $SMOKE_BASE..."
bun "$PIPELINE" --base "$SMOKE_BASE" --origin "$SMOKE_ORIGIN"

echo "Smoke test passed (project=$SMOKE_PROJECT)."
