#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/full-platform-scaffold"

# Ensure we are in a git repo
if [ ! -d .git ]; then
  echo "This script must be run from the root of a git clone of your repository."
  exit 1
fi

# Create branch (overwrite if exists locally)
git checkout -B "$BRANCH"

# Create directories
mkdir -p services/generator services/media services/publish services/blockchain services/market services/headspace services/audio services/backup frontend infra .github/workflows data

# package.json
cat > package.json <<'EOF'
{
  "name": "x-ai-prototype-js",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js",
    "lint": "echo \"no linter configured\"",
    "test": "node --test"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "bcrypt": "^5.1.1",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.1.2",
    "multer": "^1.4.5-lts.1",
    "node-fetch": "^3.4.1"
  }
}
EOF

# .gitignore
cat > .gitignore <<'EOF'
/node_modules
/data
.env
.env.local
.DS_Store
npm-debug.log*
coverage
EOF

# README.md
cat > README.md <<'EOF'
# X-AI Prototype (JavaScript monorepo scaffold)

This branch contains a large JavaScript prototype scaffold implementing the multi-service platform described in the issue. It's intended to be a working prototype with secure defaults and placeholder implementations you can extend.

Structure