#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="backups/database-$stamp.dump"
# Custom-format pg_dump is transactionally consistent while the service runs.
docker compose exec -T db pg_dump -U monitoring -d monitoring -Fc > "$target.partial"
mv "$target.partial" "$target"
printf 'Database backup: %s\n' "$target"
printf 'Also retain .env, your config changes and the Git commit ID in a secure location.\n'
