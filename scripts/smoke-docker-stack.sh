#!/bin/bash
set -e

echo "Starting Docker Compose stack..."
docker compose -f docker-compose.dev.yml up --build -d

echo "Waiting for web service to be healthy (up to 30 seconds)..."
for i in {1..30}; do
  if curl -fsS http://localhost:3000/api/health >/dev/null; then
    echo "Web service is healthy!"
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "Timeout waiting for web service."
    docker compose -f docker-compose.dev.yml logs
    docker compose -f docker-compose.dev.yml down
    exit 1
  fi
done

echo "Checking /api/health..."
HEALTH=$(curl -fsS http://localhost:3000/api/health)
echo "$HEALTH"
if ! echo "$HEALTH" | grep -q '"ok":true'; then
  echo "Health check failed."
  docker compose -f docker-compose.dev.yml down
  exit 1
fi

echo "Checking /editor..."
if ! curl -fsS http://localhost:3000/editor >/dev/null; then
  echo "Failed to load /editor."
  docker compose -f docker-compose.dev.yml down
  exit 1
fi

echo "Smoke test passed successfully."
docker compose -f docker-compose.dev.yml down
