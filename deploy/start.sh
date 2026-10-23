#!/bin/sh
set -eu

/opt/backend-venv/bin/python -m uvicorn main:app --app-dir /app/backend --host 127.0.0.1 --port 8000 &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM

attempt=0
until /opt/backend-venv/bin/python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=2)' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ] || ! kill -0 "$backend_pid" 2>/dev/null; then
    echo 'Backend did not become healthy' >&2
    exit 1
  fi
  sleep 1
done

cd /app/frontend
HOSTNAME=0.0.0.0 PORT="${PORT:-10000}" node server.js
