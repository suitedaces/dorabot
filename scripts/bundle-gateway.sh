#!/bin/bash
# Bundle the gateway server for Electron packaging
# Copies compiled backend + production deps into desktop/resources/gateway/

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_BUNDLE="$ROOT/desktop/resources/gateway"

echo "==> Bundling gateway into $GATEWAY_BUNDLE"

# Clean previous bundle
rm -rf "$GATEWAY_BUNDLE"
mkdir -p "$GATEWAY_BUNDLE"

# 1. Copy compiled backend
echo "  Copying dist/..."
cp -r "$ROOT/dist" "$GATEWAY_BUNDLE/dist"

# 2. Create production package.json (strip devDeps and scripts)
echo "  Creating production package.json..."
node -e "
const pkg = require('$ROOT/package.json');
const prod = {
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
  main: pkg.main,
  dependencies: pkg.dependencies,
  engines: pkg.engines
};
require('fs').writeFileSync(
  '$GATEWAY_BUNDLE/package.json',
  JSON.stringify(prod, null, 2)
);
"

# 3. Install production dependencies
echo "  Installing production dependencies..."
cd "$GATEWAY_BUNDLE"
npm install --production --ignore-scripts 2>&1 | tail -5

# 4. Rebuild native modules (better-sqlite3) against Electron's Node headers
echo "  Rebuilding native modules for Electron..."
ELECTRON_VER=$(node -e "console.log(require('$ROOT/desktop/node_modules/electron/package.json').version)")
echo "  Electron version: $ELECTRON_VER"
cd "$GATEWAY_BUNDLE"
npx --yes @electron/rebuild -v "$ELECTRON_VER" -m . -w better-sqlite3 2>&1 | tail -5

# 5. Strip non-target vendor binaries from Codex SDK (~330MB savings)
echo "  Stripping non-target binaries from @openai/codex-sdk..."
CODEX_VENDOR="$GATEWAY_BUNDLE/node_modules/@openai/codex-sdk/vendor"
if [ -d "$CODEX_VENDOR" ]; then
  OS="$(uname -s)"
  ARCH=$(uname -m)
  KEEP_DIR=""
  case "$OS" in
    Darwin)
      if [ "$ARCH" = "arm64" ]; then
        KEEP_DIR="aarch64-apple-darwin"
      else
        KEEP_DIR="x86_64-apple-darwin"
      fi
      ;;
    Linux)
      if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
        KEEP_DIR="aarch64-unknown-linux-musl"
      else
        KEEP_DIR="x86_64-unknown-linux-musl"
      fi
      ;;
  esac

  if [ -n "$KEEP_DIR" ]; then
    for dir in "$CODEX_VENDOR"/*/; do
      dirname=$(basename "$dir")
      if [ "$dirname" != "$KEEP_DIR" ]; then
        echo "    Removing vendor/$dirname"
        rm -rf "$dir"
      fi
    done
  else
    echo "    Unknown OS ($OS) — keeping all vendor binaries"
  fi
fi

# 6. Strip non-target sharp binaries
echo "  Stripping non-target sharp binaries..."
SHARP_DIR="$GATEWAY_BUNDLE/node_modules/@img"
if [ -d "$SHARP_DIR" ]; then
  OS="$(uname -s)"
  KEEP_PATTERN=""
  case "$OS" in
    Darwin) KEEP_PATTERN="darwin" ;;
    Linux) KEEP_PATTERN="linux" ;;
  esac

  for dir in "$SHARP_DIR"/*/; do
    dirname=$(basename "$dir")
    if [ -z "$KEEP_PATTERN" ]; then
      continue
    fi
    case "$dirname" in
      *"$KEEP_PATTERN"*|colour) ;; # keep target platform packages + pure JS deps
      *) echo "    Removing @img/$dirname"; rm -rf "$dir" ;;
    esac
  done
fi

# 7. Clean up unnecessary files to reduce bundle size
echo "  Cleaning up docs, tests, examples..."
find "$GATEWAY_BUNDLE/node_modules" -name "*.md" -delete 2>/dev/null || true
find "$GATEWAY_BUNDLE/node_modules" -name "*.d.ts" -delete 2>/dev/null || true
find "$GATEWAY_BUNDLE/node_modules" -name "CHANGELOG*" -delete 2>/dev/null || true
find "$GATEWAY_BUNDLE/node_modules" -name ".github" -type d -exec rm -rf {} + 2>/dev/null || true
find "$GATEWAY_BUNDLE/node_modules" -name "test" -type d -exec rm -rf {} + 2>/dev/null || true
find "$GATEWAY_BUNDLE/node_modules" -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true
find "$GATEWAY_BUNDLE/node_modules" -name "example" -type d -exec rm -rf {} + 2>/dev/null || true
find "$GATEWAY_BUNDLE/node_modules" -name "examples" -type d -exec rm -rf {} + 2>/dev/null || true

BUNDLE_SIZE=$(du -sh "$GATEWAY_BUNDLE" | cut -f1)
echo "==> Gateway bundle complete: $BUNDLE_SIZE"
