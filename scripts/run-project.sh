#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FRONTEND_PORT="${PORT:-5173}"
API_PORT="${API_PORT:-5000}"
DB_PORT="${LOCAL_DB_PORT:-5433}"
DB_SOCKET="$ROOT_DIR/.local/pgsocket"
DB_DATA="$ROOT_DIR/.local/pgdata"
DB_LOG="$ROOT_DIR/.local/postgres.log"
API_PID=""
DB_PID=""

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$DB_PID" ]] && kill "$DB_PID" 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

if [[ -z "${DATABASE_URL:-}" ]]; then
  mkdir -p "$ROOT_DIR/.local" "$DB_SOCKET"
  if [[ ! -f "$DB_DATA/PG_VERSION" ]]; then
    initdb -D "$DB_DATA" --auth=trust --username=runner --no-locale >/dev/null
  fi

  if ! pg_isready -h "$DB_SOCKET" -p "$DB_PORT" >/dev/null 2>&1; then
    postgres -D "$DB_DATA" -k "$DB_SOCKET" -p "$DB_PORT" >"$DB_LOG" 2>&1 &
    DB_PID=$!
    for _ in {1..40}; do
      pg_isready -h "$DB_SOCKET" -p "$DB_PORT" >/dev/null 2>&1 && break
      sleep 0.25
    done
  fi

  if ! psql "postgresql://runner@/postgres?host=$DB_SOCKET&port=$DB_PORT" -tAc "SELECT 1 FROM pg_database WHERE datname='devicebridge'" | grep -q 1; then
    createdb -h "$DB_SOCKET" -p "$DB_PORT" -U runner devicebridge
  fi
  export DATABASE_URL="postgresql://runner@/devicebridge?host=$DB_SOCKET&port=$DB_PORT"
fi

pnpm --filter @workspace/db run push >/dev/null

(
  export NODE_ENV="${NODE_ENV:-development}" PORT="$API_PORT"
  pnpm --filter @workspace/api-server run dev
) &
API_PID=$!

for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "DeviceBridge API stopped before it became ready." >&2
    exit 1
  fi
  sleep 0.5
done

if ! curl -fsS "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null 2>&1; then
  echo "DeviceBridge API did not become ready on port $API_PORT." >&2
  exit 1
fi

export PORT="$FRONTEND_PORT"
export BASE_PATH="${BASE_PATH:-/}"
export API_URL="${API_URL:-http://127.0.0.1:$API_PORT}"
exec pnpm --filter @workspace/devicebridge run dev