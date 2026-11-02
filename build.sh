#!/bin/sh
set -eu
mkdir -p dist
cp server.js run.sh package.json dist/
cp -R public dist/
cp -R data dist/
chmod 755 dist/run.sh
