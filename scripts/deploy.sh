#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Building X AI prototype"
npm install
npm test

echo "Deployment scaffold ready"
