#!/usr/bin/env bash
# olc-ui installer for Debian/Ubuntu/other systemd Linux VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/yttrix/olc-ui/main/scripts/install.sh | sudo bash
#
# Options (environment variables):
#   OLCUI_PORT=2053        panel port (default: random free port on first install)
#   OLCUI_TLS=auto|off     auto = self-signed HTTPS (default), off = plain HTTP (behind a reverse proxy)
#   OLCUI_VERSION=v0.1.0   release tag to install (default: latest)
#   OLCUI_FROM_SOURCE=1    build from source instead of downloading a release
#
#   sudo bash install.sh uninstall   remove the service and binary (data is kept)
set -euo pipefail

REPO="${OLCUI_REPO:-yttrix/olc-ui}"
BIN=/usr/local/bin/olc-ui
DATA=/var/lib/olc-ui
ENV_DIR=/etc/olc-ui
ENV_FILE=$ENV_DIR/olc-ui.env
UNIT=/etc/systemd/system/olc-ui.service
SVC_USER=olcui
GO_VERSION=1.26.8
NODE_VERSION=v24.21.0

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_dim=$'\e[2m'; c_off=$'\e[0m'
say()  { printf '%s==>%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%s!!%s  %s\n' "$c_warn" "$c_off" "$*"; }
die()  { printf '%sERROR:%s %s\n' "$c_err" "$c_off" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root: curl ... | sudo bash"
[ "$(uname -s)" = Linux ] || die "Linux only"
command -v systemctl >/dev/null || die "systemd is required"

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac

if [ "${1:-}" = uninstall ]; then
  systemctl disable --now olc-ui 2>/dev/null || true
  rm -f "$UNIT" "$BIN"
  systemctl daemon-reload
  say "removed service and binary; data left in $DATA and $ENV_DIR (delete manually if not needed)"
  exit 0
fi

pkg_install() {
  if command -v apt-get >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q "$@"
  elif command -v yum >/dev/null; then yum install -y -q "$@"
  elif command -v pacman >/dev/null; then pacman -Sy --noconfirm --needed "$@" >/dev/null
  elif command -v apk >/dev/null; then apk add --quiet "$@"
  else die "cannot install packages ($*): unknown package manager"; fi
}

# need <command>...: install the package providing each missing command.
need() {
  local c pkg
  for c in "$@"; do
    command -v "$c" >/dev/null && continue
    pkg=$c
    [ "$c" = xz ] && command -v apt-get >/dev/null && pkg=xz-utils
    pkg_install "$pkg"
  done
}
need curl tar

download_release() {
  local url
  if [ -n "${OLCUI_VERSION:-}" ]; then
    url="https://github.com/$REPO/releases/download/$OLCUI_VERSION/olc-ui-linux-$ARCH"
  else
    url="https://github.com/$REPO/releases/latest/download/olc-ui-linux-$ARCH"
  fi
  say "downloading $url"
  curl -fL --retry 3 -o "$1" "$url"
}

WORK=""
SWAP=""
cleanup() {
  [ -n "$SWAP" ] && swapoff "$SWAP" 2>/dev/null || true
  [ -n "$WORK" ] && rm -rf "$WORK"
  return 0
}
trap cleanup EXIT

build_from_source() {
  WORK=$(mktemp -d)
  need git
  local mem; mem=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$mem" -lt 1800 ] && [ "$(swapon --show 2>/dev/null | wc -l)" -eq 0 ]; then
    warn "only ${mem} MB RAM and no swap: adding a temporary 2 GB swap file for the build"
    SWAP="$WORK/swap"
    fallocate -l 2G "$SWAP" && chmod 600 "$SWAP" && mkswap -q "$SWAP" && swapon "$SWAP" || SWAP=""
  fi
  say "installing Go $GO_VERSION and Node $NODE_VERSION into a temporary directory"
  curl -fsSL "https://go.dev/dl/go$GO_VERSION.linux-$ARCH.tar.gz" | tar -xz -C "$WORK"
  local narch=x64; [ "$ARCH" = arm64 ] && narch=arm64
  need xz
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$narch.tar.xz" | tar -xJ -C "$WORK"
  export PATH="$WORK/go/bin:$WORK/node-$NODE_VERSION-linux-$narch/bin:$PATH"
  export GOPATH="$WORK/gopath" GOCACHE="$WORK/gocache" GOTOOLCHAIN=local npm_config_cache="$WORK/npm"
  say "cloning https://github.com/$REPO"
  git clone --depth 1 ${OLCUI_VERSION:+--branch "$OLCUI_VERSION"} "https://github.com/$REPO.git" "$WORK/src"
  say "building (this takes a few minutes)"
  (cd "$WORK/src/web" && npm ci --no-audit --no-fund --silent && npm run build --silent)
  local ver; ver=$(cd "$WORK/src" && git describe --tags --always 2>/dev/null || echo source)
  (cd "$WORK/src" && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$ver" -o "$1" ./cmd/olc-ui)
}

tmp_bin=$(mktemp)
if [ -n "${OLCUI_FROM_SOURCE:-}" ] || ! download_release "$tmp_bin"; then
  [ -z "${OLCUI_FROM_SOURCE:-}" ] && warn "no release binary found, building from source"
  build_from_source "$tmp_bin"
fi
chmod 0755 "$tmp_bin"
"$tmp_bin" version >/dev/null || die "downloaded binary does not run on this system"

upgrade=0
[ -f "$ENV_FILE" ] && upgrade=1
systemctl stop olc-ui 2>/dev/null || true
install -m 0755 "$tmp_bin" "$BIN"
rm -f "$tmp_bin"
say "installed $("$BIN" version)"

id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$SVC_USER"
install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$DATA"
install -d -m 0755 "$ENV_DIR"

port_free() { ! ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; }
if [ $upgrade -eq 0 ]; then
  PORT="${OLCUI_PORT:-}"
  if [ -z "$PORT" ]; then
    for _ in $(seq 1 50); do
      PORT=$(( (RANDOM % 40000) + 20000 ))
      port_free "$PORT" && break
    done
  fi
  cat > "$ENV_FILE" <<EOF
# olc-ui settings; apply with: systemctl restart olc-ui
OLCUI_DATA=$DATA
OLCUI_LISTEN=:$PORT
OLCUI_TLS=${OLCUI_TLS:-auto}
# OLCUI_TLS=files
# OLCUI_CERT=/etc/letsencrypt/live/example.com/fullchain.pem
# OLCUI_KEY=/etc/letsencrypt/live/example.com/privkey.pem
EOF
  chmod 0644 "$ENV_FILE"
fi
# shellcheck disable=SC1090
. "$ENV_FILE"
PORT="${OLCUI_LISTEN##*:}"

cat > "$UNIT" <<EOF
[Unit]
Description=olc-ui tunnel panel
Documentation=https://github.com/$REPO
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
Group=$SVC_USER
EnvironmentFile=$ENV_FILE
ExecStart=$BIN panel
Restart=always
RestartSec=3
LimitNOFILE=65535
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA
ReadOnlyPaths=-/etc/letsencrypt

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

creds=""
if [ $upgrade -eq 0 ] && [ ! -f "$DATA/olc-ui.db" ]; then
  creds=$(runuser -u "$SVC_USER" -- env $(grep -v '^#' "$ENV_FILE" | xargs) "$BIN" admin -user admin)
else
  creds=$(runuser -u "$SVC_USER" -- env $(grep -v '^#' "$ENV_FILE" | xargs) "$BIN" info)
fi
PANEL_PATH=$(printf '%s\n' "$creds" | sed -n 's/^path=//p')
PANEL_USER=$(printf '%s\n' "$creds" | sed -n 's/^user=//p')
PANEL_PASS=$(printf '%s\n' "$creds" | sed -n 's/^pass=//p')

systemctl enable --now olc-ui >/dev/null
sleep 1
systemctl is-active --quiet olc-ui || { journalctl -u olc-ui -n 30 --no-pager; die "service failed to start"; }

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" >/dev/null && say "opened port $PORT in ufw"
fi

IP=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
scheme=https; [ "${OLCUI_TLS:-auto}" = off ] && scheme=http

echo
say "olc-ui is running"
echo "   Panel:    $scheme://$IP:$PORT$PANEL_PATH"
echo "   Login:    $PANEL_USER"
if [ -n "$PANEL_PASS" ]; then
  echo "   Password: $PANEL_PASS"
  echo "   ${c_dim}(save it now; change it in Settings; forgot it? run: sudo -u $SVC_USER env \$(cat $ENV_FILE | grep -v '^#' | xargs) olc-ui admin)${c_off}"
else
  echo "   Password: unchanged (upgrade)"
fi
[ "$scheme" = https ] && echo "   ${c_dim}The certificate is self-signed: the browser will warn once, that is expected.${c_off}"
echo "   Logs:     journalctl -u olc-ui -f"
echo "   Config:   $ENV_FILE"
