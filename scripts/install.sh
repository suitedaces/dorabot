#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

SKIP_SYSTEM_DEPS=0
NO_LINK=0

usage() {
  cat <<'EOF'
dorabot installer

Usage:
  bash scripts/install.sh [options]

Options:
  --skip-system-deps   Skip OS package installation on Linux
  --no-link            Skip `npm link`
  -h, --help           Show this help
EOF
}

log() {
  printf '[install] %s\n' "$*"
}

warn() {
  printf '[install] warning: %s\n' "$*" >&2
}

die() {
  printf '[install] error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
}

install_linux_deps() {
  if [[ "$SKIP_SYSTEM_DEPS" -eq 1 ]]; then
    log "Skipping Linux system dependencies (--skip-system-deps)"
    return
  fi

  if [[ "$(uname -s)" != "Linux" ]]; then
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    warn "apt-get not found. Install manually: libnotify-bin gnome-screenshot"
    return
  fi

  local packages=(libnotify-bin gnome-screenshot)
  log "Installing Ubuntu dependencies: ${packages[*]}"

  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    apt-get update
    apt-get install -y "${packages[@]}"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y "${packages[@]}"
    return
  fi

  warn "sudo not found. Install manually: ${packages[*]}"
}

check_node_version() {
  require_cmd node
  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [[ "$major" -lt 22 ]]; then
    die "Node.js 22+ is required (current: $(node -v))"
  fi
  log "Node version OK: $(node -v)"
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-system-deps)
        SKIP_SYSTEM_DEPS=1
        ;;
      --no-link)
        NO_LINK=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage
        die "Unknown option: $1"
        ;;
    esac
    shift
  done

  cd "$ROOT_DIR"

  [[ -f package.json ]] || die "Run this from the dorabot repo (package.json not found)"
  [[ -d desktop ]] || die "Run this from the dorabot repo (desktop/ not found)"

  check_node_version
  require_cmd npm
  install_linux_deps

  log "Installing root dependencies..."
  npm install

  log "Installing desktop dependencies..."
  npm -C desktop install

  log "Building gateway/CLI..."
  npm run build

  log "Building desktop..."
  npm -C desktop run build

  if [[ "$NO_LINK" -eq 0 ]]; then
    log "Linking global CLI command..."
    npm link
  else
    log "Skipping npm link (--no-link)"
  fi

  log "Done. Try: dorabot -g"
}

main "$@"
