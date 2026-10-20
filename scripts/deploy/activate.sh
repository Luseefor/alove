#!/bin/sh
set -eu
role=${1:?web or runner required}
case "$role" in
  web) compose=docker-compose.prod.yml; project=alove-web ;;
  runner) compose=docker-compose.runner.yml; project=alove-runner ;;
  *) exit 2 ;;
esac
# Compose 2.30+ is required for raw env files. Values are never printed.
docker compose version >/dev/null
if [ "${2:-}" != --rollback ]; then
if [ "$role" = runner ]; then
  tex_image=$(sed -n 's/^COMPILE_DOCKER_IMAGE=//p' .deploy/compose.env)
  docker pull "$tex_image" >/dev/null
fi
docker compose -p "$project" --env-file .deploy/compose.env -f "$compose" pull --quiet
fi
docker compose -p "$project" --env-file .deploy/compose.env -f "$compose" up -d --pull never --wait --wait-timeout 120
old=$(readlink /opt/alove/current 2>/dev/null || true)
if [ -n "$old" ] && [ "$old" != "$(pwd)" ]; then ln -sfn "$old" /opt/alove/previous; fi
ln -sfn "$(pwd)" /opt/alove/current
