#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-18889}"
GATEWAY_CLIENT_HOST="${GATEWAY_CLIENT_HOST:-127.0.0.1}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_PORT="${WEB_PORT:-5173}"
TOKEN_PATH="${HOME}/.dorabot/gateway-token"

CONFIG_FILE="$(mktemp /tmp/dorabot-web-config.XXXXXX.json)"
GATEWAY_LOG="${HOME}/.dorabot/logs/gateway-web.log"
GATEWAY_PID=""

log() {
  printf '[dev:web] %s\n' "$*"
}

die() {
  printf '[dev:web] error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${GATEWAY_PID}" ]] && kill -0 "${GATEWAY_PID}" >/dev/null 2>&1; then
    kill "${GATEWAY_PID}" >/dev/null 2>&1 || true
    wait "${GATEWAY_PID}" 2>/dev/null || true
  fi
  rm -f "${CONFIG_FILE}"
}

trap cleanup EXIT INT TERM

require_cmd() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || die "Missing required command: ${cmd}"
}

check_node_version() {
  require_cmd node
  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [[ "${major}" -lt 22 ]]; then
    die "Node.js 22+ is required (current: $(node -v))"
  fi
}

wait_for_http_health() {
  local url="$1"
  local attempts="${2:-80}"
  local delay="${3:-0.25}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${delay}"
  done
  return 1
}

wait_for_token() {
  local attempts="${1:-80}"
  local delay="${2:-0.25}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if [[ -s "${TOKEN_PATH}" ]]; then
      return 0
    fi
    sleep "${delay}"
  done
  return 1
}

build_allowed_origins_json() {
  local origins=()
  local ip
  origins+=("http://localhost:${WEB_PORT}")
  origins+=("http://127.0.0.1:${WEB_PORT}")

  # Allow opening the web UI through local network IPs too.
  if command -v hostname >/dev/null 2>&1; then
    while read -r ip; do
      [[ -z "${ip}" ]] && continue
      origins+=("http://${ip}:${WEB_PORT}")
    done < <(hostname -I 2>/dev/null | tr ' ' '\n' | awk 'NF')
  fi

  printf '%s\n' "${origins[@]}" | awk '!seen[$0]++' | sed 's/^/      "/; s/$/",/'
}

main() {
  cd "${ROOT_DIR}"
  require_cmd npm
  require_cmd curl
  check_node_version

  mkdir -p "${HOME}/.dorabot/logs"

  # Keep this config temporary: no TLS for browser compatibility in web mode.
  local origins_json
  origins_json="$(build_allowed_origins_json | sed '$ s/,$//')"

  cat > "${CONFIG_FILE}" <<EOF
{
  "gateway": {
    "host": "${GATEWAY_HOST}",
    "port": ${GATEWAY_PORT},
    "tls": false,
    "allowedOrigins": [
${origins_json}
    ]
  }
}
EOF

  if [[ ! -f "dist/index.js" ]]; then
    log "Building gateway (dist/index.js not found)..."
    npm run build
  fi

  log "Starting gateway on ws://${GATEWAY_HOST}:${GATEWAY_PORT}"
  node dist/index.js -g -c "${CONFIG_FILE}" > "${GATEWAY_LOG}" 2>&1 &
  GATEWAY_PID=$!

  if ! wait_for_http_health "http://${GATEWAY_HOST}:${GATEWAY_PORT}/health"; then
    tail -n 80 "${GATEWAY_LOG}" >&2 || true
    die "Gateway failed to become healthy."
  fi

  if ! wait_for_token; then
    tail -n 80 "${GATEWAY_LOG}" >&2 || true
    die "Gateway token not found at ${TOKEN_PATH}."
  fi

  local token
  token="$(tr -d '\r\n' < "${TOKEN_PATH}")"
  [[ -n "${token}" ]] || die "Gateway token is empty."

  export VITE_GATEWAY_URL="ws://${GATEWAY_CLIENT_HOST}:${GATEWAY_PORT}"
  export VITE_GATEWAY_TOKEN="${token}"

  log "Gateway ready."
  log "Web UI: http://localhost:${WEB_PORT}"
  log "Gateway URL for web client: ${VITE_GATEWAY_URL}"
  log "Gateway log: ${GATEWAY_LOG}"

  npm -C desktop run web -- --host "${WEB_HOST}" --port "${WEB_PORT}"
}

main "$@"
