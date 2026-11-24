#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

export POSTGRES_DB=ck_defense
export POSTGRES_PORT=5543
export SERVER_PORT=3100

exec docker compose --env-file .env -p ckdefense -f compose.yaml "$@"
