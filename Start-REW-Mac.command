#!/bin/bash
cd "$(dirname "$0")"
if [ -x "node_modules/.bin/electron" ]; then
  ./node_modules/.bin/electron .
elif command -v node >/dev/null 2>&1; then
  echo "Starting Room EQ Wizard (REW V5.40) server on http://127.0.0.1:4580 ..."
  open "http://127.0.0.1:4580" 2>/dev/null || true
  node server.js
else
  open "public/index.html"
fi
