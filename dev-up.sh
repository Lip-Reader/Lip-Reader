#!/usr/bin/env bash
# Start everything for local development: API backend (8000), VSR service (8001,
# needs weights under benchmarks/LRS3) and the Expo web app (5173). Ctrl-C stops all.
set -euo pipefail
cd "$(dirname "$0")"

uv sync
(cd app && npm install)

trap 'kill 0' EXIT INT TERM
uv run uvicorn backend.app.main:app --port 8000 &
uv run uvicorn backend.app.vsr_main:app --port 8001 &
(cd app && npm run web) &
wait
