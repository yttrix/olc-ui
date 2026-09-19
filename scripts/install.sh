#!/usr/bin/env bash
# olc-ui installer for Debian/Ubuntu and other systemd Linux servers.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/yttrix/olc-ui/main/scripts/install.sh)
#
# Re-running it updates olc-ui and keeps clients, settings and the password.
#
# Unattended install (environment variables):
#   OLCUI_LANG=ru|en        installer and menu language
#   OLCUI_PORT=2053         panel port (default: random free port)
#   OLCUI_SSL=ip|domain|custom|self|none
#   OLCUI_DOMAIN=vpn.example.com          for OLCUI_SSL=domain|custom
#   OLCUI_CERT=/path/fullchain.pem  OLCUI_KEY=/path/privkey.pem   for custom
#   OLCUI_VERSION=v0.2.0    release to install (default: latest)
#   OLCUI_FROM_SOURCE=1     build from source instead of downloading a release
#   OLCUI_YES=1             accept defaults for every question
set -euo pipefail

REPO="${OLCUI_REPO:-yttrix/olc-ui}"
LIB_DIR=/usr/local/lib/olc-ui
BIN=$LIB_DIR/olc-ui
MENU=/usr/local/bin/olc-ui
DATA=/var/lib/olc-ui
ENV_DIR=/etc/olc-ui
ENV_FILE=$ENV_DIR/olc-ui.env
UNIT=/etc/systemd/system/olc-ui.service
SVC_USER=olcui
GO_VERSION=1.26.8
NODE_VERSION=v24.21.0

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_dim=$'\e[2m'; c_acc=$'\e[36m'; c_b=$'\e[1m'; c_off=$'\e[0m'

LANG_UI="${OLCUI_LANG:-}"
[ -z "$LANG_UI" ] && [ -f "$ENV_FILE" ] && LANG_UI=$(sed -n 's/^OLCUI_LANG=//p' "$ENV_FILE" | tail -1)
m() { if [ "${LANG_UI:-en}" = ru ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
say()  { printf '%s==>%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%s!!%s  %s\n' "$c_warn" "$c_off" "$*"; }
die()  { printf '%s%s%s %s\n' "$c_err" "$(m "Ошибка:" "Error:")" "$c_off" "$*" >&2; exit 1; }

ask() {
  local __var="$1" __prompt="$2" __def="${3:-}" __ans=""
  if [ -n "${OLCUI_YES:-}" ] || [ ! -r /dev/tty ]; then
    __ans="$__def"
  else
    read -rp "$__prompt [$__def]: " __ans </dev/tty || true
    __ans="${__ans:-$__def}"
  fi
  printf -v "$__var" '%s' "$__ans"
}

[ "$(id -u)" -eq 0 ] || die "$(m "запустите от root" "run as root"): sudo bash <(curl -fsSL https://raw.githubusercontent.com/$REPO/main/scripts/install.sh)"
[ "$(uname -s)" = Linux ] || die "Linux only"
command -v systemctl >/dev/null || die "systemd is required"
case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac

upgrade=0
[ -f "$ENV_FILE" ] && upgrade=1

if [ -z "$LANG_UI" ]; then
  if [ -n "${OLCUI_YES:-}" ] || [ ! -r /dev/tty ]; then
    case "${LANG:-}" in ru*) LANG_UI=ru ;; *) LANG_UI=en ;; esac
  else
    echo "  1. Русский"
    echo "  2. English"
    read -rp "Язык / Language [1]: " l </dev/tty || true
    if [ "${l:-1}" = 2 ]; then LANG_UI=en; else LANG_UI=ru; fi
  fi
fi

echo
echo "${c_acc}${c_b}olc-ui${c_off} — $(m "панель туннелей через WB Stream, Телемост и Jitsi" "tunnel panel over WB Stream, Telemost and Jitsi")"
echo

pkg_install() {
  if command -v apt-get >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q "$@"
  elif command -v yum >/dev/null; then yum install -y -q "$@"
  elif command -v pacman >/dev/null; then pacman -Sy --noconfirm --needed "$@" >/dev/null
  elif command -v apk >/dev/null; then apk add --quiet "$@"
  else die "cannot install packages ($*)"; fi
}

# need <command>...: install the package providing each missing command.
need() {
  local c pkg
  for c in "$@"; do
    command -v "$c" >/dev/null && continue
    pkg=$c
    [ "$c" = xz ] && command -v apt-get >/dev/null && pkg=xz-utils
    [ "$c" = ss ] && pkg=iproute2
    pkg_install "$pkg"
  done
}
need curl tar openssl ss

WORK=$(mktemp -d)
SWAP=""
cleanup() {
  [ -n "$SWAP" ] && swapoff "$SWAP" 2>/dev/null || true
  rm -rf "$WORK"
  return 0
}
trap cleanup EXIT

release_url() {
  if [ -n "${OLCUI_VERSION:-}" ]; then
    echo "https://github.com/$REPO/releases/download/$OLCUI_VERSION/$1"
  else
    echo "https://github.com/$REPO/releases/latest/download/$1"
  fi
}

download_release() {
  say "$(m "скачиваю" "downloading") $(release_url "olc-ui-linux-$ARCH")"
  curl -fL --retry 3 --progress-bar -o "$WORK/olc-ui" "$(release_url "olc-ui-linux-$ARCH")" || return 1
  curl -fsSL --retry 3 -o "$WORK/olc-ui.sh" "$(release_url olc-ui.sh)" || return 1
  if curl -fsSL --retry 3 -o "$WORK/SHA256SUMS" "$(release_url SHA256SUMS)"; then
    local f want have
    for f in "olc-ui-linux-$ARCH:olc-ui" "olc-ui.sh:olc-ui.sh"; do
      want=$(awk -v n="${f%%:*}" '$2==n{print $1}' "$WORK/SHA256SUMS")
      have=$(sha256sum "$WORK/${f##*:}" | awk '{print $1}')
      [ -z "$want" ] && continue
      [ "$want" = "$have" ] || die "$(m "контрольная сумма не совпала" "checksum mismatch"): ${f%%:*}"
    done
    say "$(m "контрольные суммы совпали" "checksums verified")"
  fi
}

build_from_source() {
  need git xz
  local mem
  mem=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$mem" -lt 1800 ] && [ "$(swapon --show 2>/dev/null | wc -l)" -eq 0 ]; then
    warn "$(m "мало памяти ($mem МБ): временно добавляю swap 2 ГБ для сборки" "low memory ($mem MB): adding a temporary 2 GB swap for the build")"
    SWAP="$WORK/swap"
    { fallocate -l 2G "$SWAP" && chmod 600 "$SWAP" && mkswap -q "$SWAP" && swapon "$SWAP"; } || SWAP=""
  fi
  say "$(m "ставлю Go и Node во временную папку" "installing Go and Node into a temporary folder")"
  curl -fsSL "https://go.dev/dl/go$GO_VERSION.linux-$ARCH.tar.gz" | tar -xz -C "$WORK"
  local narch=x64
  [ "$ARCH" = arm64 ] && narch=arm64
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$narch.tar.xz" | tar -xJ -C "$WORK"
  export PATH="$WORK/go/bin:$WORK/node-$NODE_VERSION-linux-$narch/bin:$PATH"
  export GOPATH="$WORK/gopath" GOCACHE="$WORK/gocache" GOTOOLCHAIN=local npm_config_cache="$WORK/npm"
  git clone --depth 1 ${OLCUI_VERSION:+--branch "$OLCUI_VERSION"} "https://github.com/$REPO.git" "$WORK/src"
  say "$(m "собираю (несколько минут)" "building (a few minutes)")"
  (cd "$WORK/src/web" && npm ci --no-audit --no-fund --silent && npm run build --silent)
  local ver
  ver=$(cd "$WORK/src" && git describe --tags --always 2>/dev/null || echo source)
  (cd "$WORK/src" && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$ver" -o "$WORK/olc-ui" ./cmd/olc-ui)
  cp "$WORK/src/scripts/olc-ui.sh" "$WORK/olc-ui.sh"
}

if [ -n "${OLCUI_BIN_FILE:-}" ]; then
  # Local build (CI and development): OLCUI_BIN_FILE + OLCUI_MENU_FILE.
  cp "$OLCUI_BIN_FILE" "$WORK/olc-ui"
  cp "${OLCUI_MENU_FILE:-$(dirname "$0")/olc-ui.sh}" "$WORK/olc-ui.sh"
elif [ -n "${OLCUI_FROM_SOURCE:-}" ] || ! download_release; then
  [ -z "${OLCUI_FROM_SOURCE:-}" ] && warn "$(m "готовой сборки нет — собираю из исходников" "no release binary — building from source")"
  build_from_source
fi
chmod 0755 "$WORK/olc-ui" "$WORK/olc-ui.sh"
"$WORK/olc-ui" version >/dev/null || die "$(m "скачанная программа не запускается на этой системе" "the downloaded binary does not run on this system")"

systemctl stop olc-ui 2>/dev/null || true
install -d -m 0755 "$LIB_DIR"
install -m 0755 "$WORK/olc-ui" "$BIN"
# v0.1 kept the binary at /usr/local/bin/olc-ui; that path is now the menu.
install -m 0755 "$WORK/olc-ui.sh" "$MENU"
say "$(m "установлено" "installed") $("$BIN" version)"

id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$SVC_USER"
install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$DATA"
install -d -m 0755 "$ENV_DIR"

if [ $upgrade -eq 0 ]; then
  port=""
  if [ -n "${OLCUI_PORT:-}" ]; then
    port=$OLCUI_PORT
  else
    for _ in $(seq 1 50); do
      port=$(((RANDOM % 40000) + 20000))
      ss -Hltn "sport = :$port" | grep -q . || break
    done
    ask port "$(m "Порт панели" "Panel port")" "$port"
  fi
  cat >"$ENV_FILE" <<EOF
# olc-ui settings. Apply with: systemctl restart olc-ui (or use the menu: olc-ui)
OLCUI_LANG=$LANG_UI
OLCUI_DATA=$DATA
OLCUI_LISTEN=:$port
OLCUI_TLS=self
EOF
  chmod 0644 "$ENV_FILE"
else
  grep -q '^OLCUI_LANG=' "$ENV_FILE" || echo "OLCUI_LANG=$LANG_UI" >>"$ENV_FILE"
  sed -i 's/^OLCUI_TLS=auto$/OLCUI_TLS=self/' "$ENV_FILE"
fi
port=$(sed -n 's/^OLCUI_LISTEN=.*://p' "$ENV_FILE" | tail -1)

cat >"$UNIT" <<EOF
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

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

creds=""
if [ ! -f "$DATA/olc-ui.db" ]; then
  creds=$("$MENU" admin -user admin)
fi

if [ $upgrade -eq 0 ] || [ -n "${OLCUI_SSL:-}" ]; then
  OLCUI_LANG=$LANG_UI "$MENU" ssl norestart ||
    warn "$(m "SSL не настроен — используется самоподписанный. Настроить позже: olc-ui ssl" "SSL not configured — using self-signed. Set it up later: olc-ui ssl")"
fi

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$port/tcp" >/dev/null && say "$(m "открыт порт $port в ufw" "opened port $port in ufw")"
fi

systemctl enable --now olc-ui >/dev/null
sleep 1
systemctl is-active --quiet olc-ui || {
  journalctl -u olc-ui -n 30 --no-pager
  die "$(m "служба не запустилась" "service failed to start")"
}

url=$("$MENU" status 2>/dev/null | sed -n 's/^ *\(Панель\|Panel\): //p')
echo
echo "${c_ok}${c_b}$(m "olc-ui работает" "olc-ui is running")${c_off}"
echo "   $(m "Панель:" "Panel:")    ${c_b}$url${c_off}"
if [ -n "$creds" ]; then
  echo "   $(m "Логин:" "Login:")     $(printf '%s\n' "$creds" | sed -n 's/^user=//p')"
  echo "   $(m "Пароль:" "Password:")    $(printf '%s\n' "$creds" | sed -n 's/^pass=//p')"
  echo "   ${c_dim}$(m "сохраните пароль; сменить можно в панели или olc-ui → 6" "save the password; change it in the panel or olc-ui → 6")${c_off}"
else
  echo "   $(m "Логин и пароль: без изменений" "Login and password: unchanged")"
fi
if [ "$(sed -n 's/^OLCUI_TLS=//p' "$ENV_FILE" | tail -1)" = self ]; then
  echo "   ${c_dim}$(m "сертификат самоподписанный: браузер один раз предупредит. Let's Encrypt: olc-ui ssl" "self-signed certificate: the browser warns once. Let's Encrypt: olc-ui ssl")${c_off}"
fi
echo "   $(m "Меню управления:" "Management menu:") ${c_b}olc-ui${c_off}"
echo
