#!/usr/bin/env bash
# Takes the README screenshots (docs/screens/*.png) from the real application with demo data:
#   1. builds the web app;
#   2. starts the backend with demo data (backend/demo/run.py: real PostgreSQL, a stand-in SPA, embedded ClickHouse,
#      fake VPN server, router and device drivers) on :8080;
#   3. serves the web app with `vite preview` on :4173, proxying /api to the backend;
#   4. signs in through SPA and shoots every page in the light and the dark theme (frontend/scripts/screenshots.mjs).
#
# Needs: the backend dev requirements (chdb), a PostgreSQL database that may be emptied (DEMO_DATABASE_URL, default
# postgresql+asyncpg://postgres:postgres@127.0.0.1:55432/nc_demo), Node 20+, Playwright with Chromium installed.
# PYTHON points at the Python with the backend requirements (default: python3).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
PYTHON=${PYTHON:-python3}
API_PORT=${API_PORT:-8080}
WEB_PORT=${WEB_PORT:-4173}
export DEMO_PUBLIC_URL="http://127.0.0.1:${WEB_PORT}"
export DEMO_DATA_DIR=${DEMO_DATA_DIR:-$(mktemp -d)}
LOGS=$(mktemp -d)
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

wait_for() {  # url, seconds
  for _ in $(seq "$2"); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done
  echo "timed out waiting for $1 (logs in $LOGS)" >&2; exit 1
}

(cd frontend && { [ -d node_modules ] || npm install --no-audit --no-fund; } && npm run build >"$LOGS/build.log")
(cd backend && exec "$PYTHON" -m demo.run --port "$API_PORT" >"$LOGS/backend.log" 2>&1) & pids+=($!)
(cd frontend && VITE_API_TARGET="http://127.0.0.1:${API_PORT}" exec npx vite preview --host 127.0.0.1 --port "$WEB_PORT" \
  --strictPort >"$LOGS/web.log" 2>&1) & pids+=($!)
wait_for "http://127.0.0.1:${API_PORT}/api/health" 120
wait_for "${DEMO_PUBLIC_URL}/api/auth/config" 60
sleep "${WARMUP:-40}"  # a few collector and device polls, so live rates and charts have data
NC_URL="$DEMO_PUBLIC_URL" node "$ROOT/frontend/scripts/screenshots.mjs"
echo "screenshots: $ROOT/docs/screens"
