#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose config --quiet
docker compose ps
docker compose exec -T db pg_isready -U monitoring -d monitoring
docker compose exec -T web wget -q -O /dev/null http://127.0.0.1/api/server
printf 'Database and API respond. Check UI and a real tracker before production use.\n'
