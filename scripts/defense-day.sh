#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

read -r -s -p "Пароль локальних акаунтів захисту (від 12 символів): " password
printf '\n'

if (( ${#password} < 12 )); then
  echo "Потрібно щонайменше 12 символів." >&2
  exit 1
fi

CK_HASH="$(
  printf '%s' "$password" |
    bash scripts/defense-compose.sh exec -T server node --input-type=module -e '
      import { readFileSync } from "node:fs";
      import { hashPassword } from "./src/utils/password.js";
      const password = readFileSync(0, "utf8");
      process.stdout.write(await hashPassword(password));
    '
)"
unset password
export CK_HASH

bash scripts/defense-compose.sh exec -T -e CK_HASH db sh -ec \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < database/seeds/defense-day.sql