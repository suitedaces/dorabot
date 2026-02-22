#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

GATEWAY_PORT="${GATEWAY_PORT:-18889}"
GATEWAY_CLIENT_HOST="${GATEWAY_CLIENT_HOST:-localhost}"
WEB_HOST="${WEB_HOST:-localhost}"
WEB_PORT="${WEB_PORT:-5173}"
TOKEN_PATH="${HOME}/.dorabot/gateway-token"
SOCKET_PATH="${HOME}/.dorabot/gateway.sock"

PROXY_SCRIPT_FILE="$(mktemp /tmp/dorabot-gateway-proxy.XXXXXX.js)"
GATEWAY_LOG="${HOME}/.dorabot/logs/gateway-web.log"
PROXY_LOG="${HOME}/.dorabot/logs/gateway-proxy.log"
GATEWAY_PID=""
PROXY_PID=""
DESKTOP_ENV_FILE="${ROOT_DIR}/desktop/.env.local"
DESKTOP_ENV_BACKUP=""
RESTORE_DESKTOP_ENV=0

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
  if [[ -n "${PROXY_PID}" ]] && kill -0 "${PROXY_PID}" >/dev/null 2>&1; then
    kill "${PROXY_PID}" >/dev/null 2>&1 || true
    wait "${PROXY_PID}" 2>/dev/null || true
  fi
  if [[ "${RESTORE_DESKTOP_ENV}" -eq 1 ]]; then
    if [[ -n "${DESKTOP_ENV_BACKUP}" && -f "${DESKTOP_ENV_BACKUP}" ]]; then
      mv -f "${DESKTOP_ENV_BACKUP}" "${DESKTOP_ENV_FILE}" || true
    else
      rm -f "${DESKTOP_ENV_FILE}" || true
    fi
  fi
  rm -f "${PROXY_SCRIPT_FILE}"
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

wait_for_unix_health() {
  local socket_path="$1"
  local attempts="${2:-80}"
  local delay="${3:-0.25}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if [[ -S "${socket_path}" ]] && curl --unix-socket "${socket_path}" -fsS "http://localhost/health" >/dev/null 2>&1; then
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

main() {
  cd "${ROOT_DIR}"
  require_cmd npm
  require_cmd curl
  check_node_version

  mkdir -p "${HOME}/.dorabot/logs"

  if [[ ! -f "dist/index.js" ]]; then
    log "Building gateway (dist/index.js not found)..."
    npm run build
  fi

  log "Starting gateway on unix://${SOCKET_PATH}"
  node dist/index.js -g > "${GATEWAY_LOG}" 2>&1 &
  GATEWAY_PID=$!

  if ! wait_for_unix_health "${SOCKET_PATH}"; then
    tail -n 80 "${GATEWAY_LOG}" >&2 || true
    die "Gateway failed to become healthy on unix socket ${SOCKET_PATH}."
  fi

  cat > "${PROXY_SCRIPT_FILE}" <<'EOF'
const net = require('node:net');

const host = process.env.DORABOT_PROXY_HOST || '127.0.0.1';
const port = Number(process.env.DORABOT_PROXY_PORT || '18889');
const socketPath = process.env.DORABOT_SOCKET_PATH || '';

if (!socketPath) {
  console.error('[proxy] missing DORABOT_SOCKET_PATH');
  process.exit(1);
}

const server = net.createServer((client) => {
  const upstream = net.createConnection({ path: socketPath });

  const closeBoth = () => {
    if (!client.destroyed) client.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };

  client.on('error', closeBoth);
  upstream.on('error', closeBoth);
  client.on('close', () => { if (!upstream.destroyed) upstream.end(); });
  upstream.on('close', () => { if (!client.destroyed) client.end(); });

  client.pipe(upstream);
  upstream.pipe(client);
});

server.on('error', (err) => {
  console.error(`[proxy] ${err?.message || String(err)}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`[proxy] listening on ${host}:${port} -> ${socketPath}`);
});
EOF

  log "Starting gateway TCP proxy on ${GATEWAY_CLIENT_HOST}:${GATEWAY_PORT}"
  DORABOT_PROXY_HOST="${GATEWAY_CLIENT_HOST}" \
  DORABOT_PROXY_PORT="${GATEWAY_PORT}" \
  DORABOT_SOCKET_PATH="${SOCKET_PATH}" \
  node "${PROXY_SCRIPT_FILE}" > "${PROXY_LOG}" 2>&1 &
  PROXY_PID=$!

  if ! wait_for_http_health "http://${GATEWAY_CLIENT_HOST}:${GATEWAY_PORT}/health"; then
    tail -n 80 "${GATEWAY_LOG}" >&2 || true
    tail -n 80 "${PROXY_LOG}" >&2 || true
    die "Gateway proxy failed to become healthy."
  fi

  if ! wait_for_token; then
    tail -n 80 "${GATEWAY_LOG}" >&2 || true
    die "Gateway token not found at ${TOKEN_PATH}."
  fi

  local token
  token="$(tr -d '\r\n' < "${TOKEN_PATH}")"
  [[ -n "${token}" ]] || die "Gateway token is empty."

  if [[ -f "${DESKTOP_ENV_FILE}" ]]; then
    DESKTOP_ENV_BACKUP="$(mktemp /tmp/dorabot-desktop-env.XXXXXX)"
    cp "${DESKTOP_ENV_FILE}" "${DESKTOP_ENV_BACKUP}"
  fi
  cat > "${DESKTOP_ENV_FILE}" <<EOF
VITE_GATEWAY_URL=ws://${GATEWAY_CLIENT_HOST}:${GATEWAY_PORT}
VITE_GATEWAY_TOKEN=${token}
EOF
  RESTORE_DESKTOP_ENV=1

  export VITE_GATEWAY_URL="ws://${GATEWAY_CLIENT_HOST}:${GATEWAY_PORT}"
  export VITE_GATEWAY_TOKEN="${token}"

  log "Gateway ready."
  log "Web UI: http://localhost:${WEB_PORT}"
  log "Gateway URL for web client: ${VITE_GATEWAY_URL}"
  log "Gateway log: ${GATEWAY_LOG}"
  log "Proxy log: ${PROXY_LOG}"

  npm -C desktop run web -- --host "${WEB_HOST}" --port "${WEB_PORT}"
}

main "$@"
