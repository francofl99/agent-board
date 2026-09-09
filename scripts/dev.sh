#!/bin/sh
# API on 4319, Vite on 4320 (proxies /api). Ctrl-C kills both.
set -e
npm --prefix server run serve &
api=$!
trap 'kill $api 2>/dev/null' EXIT INT TERM
npm --prefix web run dev
