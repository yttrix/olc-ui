#!/usr/bin/env bash
# olc-ui server menu. Installed as /usr/local/bin/olc-ui.
#
#   olc-ui                 interactive menu
#   olc-ui status|start|stop|restart|log|update|uninstall
#   olc-ui ssl             choose HTTPS certificate (Let's Encrypt IP / domain, own files, self-signed, none)
#   olc-ui backup          save a backup to /root/olc-ui-backups
#   olc-ui restore <file>  restore clients from a backup
#   olc-ui password|port|path
#
# Binary subcommands (panel, worker, client, admin, info, cert, version) are
# passed to /usr/local/lib/olc-ui/olc-ui.
set -uo pipefail

REPO="${OLCUI_REPO:-yttrix/olc-ui}"
BIN=/usr/local/lib/olc-ui/olc-ui
ENV_FILE=/etc/olc-ui/olc-ui.env
SVC_USER=olcui
BACKUP_DIR=/root/olc-ui-backups

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_dim=$'\e[2m'; c_acc=$'\e[36m'; c_off=$'\e[0m'

env_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
LANG_UI="${OLCUI_LANG:-$(env_get OLCUI_LANG)}"
[ -z "$LANG_UI" ] && case "${LANG:-}" in ru*) LANG_UI=ru ;; *) LANG_UI=en ;; esac

# m "русский" "english"
m() { if [ "$LANG_UI" = ru ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
say()  { printf '%s==>%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%s!!%s  %s\n' "$c_warn" "$c_off" "$*"; }
err()  { printf '%s%s%s %s\n' "$c_err" "$(m "Ошибка:" "Error:")" "$c_off" "$*" >&2; }
die()  { err "$*"; exit 1; }

# ask VAR "prompt" default — reads from the terminal even when piped.
ask() {
  local __var="$1" __prompt="$2" __def="${3:-}" __ans=""
  if [ -n "${OLCUI_YES:-}" ] || [ ! -r /dev/tty ]; then
    __ans="$__def"
  else
    if [ -n "$__def" ]; then
      read -rp "$__prompt [$__def]: " __ans </dev/tty || true
    else
      read -rp "$__prompt: " __ans </dev/tty || true
    fi
    __ans="${__ans:-$__def}"
  fi
  printf -v "$__var" '%s' "$__ans"
}

need_root() { [ "$(id -u)" -eq 0 ] || die "$(m "запустите от root: sudo olc-ui" "run as root: sudo olc-ui")"; }

env_set() {
  local key="$1" val="$2"
  touch "$ENV_FILE"
  if grep -q "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$val|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
  fi
}
env_del() { [ -f "$ENV_FILE" ] && sed -i "/^$1=/d" "$ENV_FILE"; }

# bin runs the binary as the service user with the service environment.
bin() {
  local envs=()
  [ -f "$ENV_FILE" ] && mapfile -t envs < <(grep -E '^[A-Z_]+=' "$ENV_FILE")
  if [ "$(id -u)" -eq 0 ] && id "$SVC_USER" >/dev/null 2>&1; then
    runuser -u "$SVC_USER" -- env "${envs[@]}" "$BIN" "$@"
  else
    env "${envs[@]}" "$BIN" "$@"
  fi
}

public_ip() {
  curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null ||
    curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null ||
    hostname -I 2>/dev/null | awk '{print $1}'
}

port() { local l; l=$(env_get OLCUI_LISTEN); echo "${l##*:}"; }

panel_url() {
  local tls host path
  tls=$(env_get OLCUI_TLS)
  host=$(env_get OLCUI_TLS_HOST)
  [ -z "$host" ] && host=$(public_ip)
  path=$(bin info 2>/dev/null | sed -n 's/^path=//p')
  if [ "$tls" = off ]; then echo "http://$host:$(port)$path"; else echo "https://$host:$(port)$path"; fi
}

fw_open() {
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$1/tcp" >/dev/null && say "$(m "открыт порт $1 в ufw" "opened port $1 in ufw")"
  fi
}

port_busy() { ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; }

restart_if_running() { systemctl is-active --quiet olc-ui && systemctl restart olc-ui; }

# ---------- SSL ----------

grant_read() { # let the service user read a certificate outside its data dir
  local f="$1" d
  command -v setfacl >/dev/null || { apt-get install -y -qq acl >/dev/null 2>&1 || true; }
  command -v setfacl >/dev/null || return 1
  setfacl -m "u:$SVC_USER:r" "$(readlink -f "$f")" 2>/dev/null
  d=$(dirname "$(readlink -f "$f")")
  while [ "$d" != / ]; do
    setfacl -m "u:$SVC_USER:x" "$d" 2>/dev/null
    d=$(dirname "$d")
  done
  # certbot writes renewals as new files in archive/: default ACLs cover them.
  setfacl -d -m "u:$SVC_USER:r" "$(dirname "$(readlink -f "$f")")" 2>/dev/null
  setfacl -m "u:$SVC_USER:x" "$(dirname "$f")" 2>/dev/null
  return 0
}

issue_acme() {
  local host="$1"
  if port_busy 80; then
    err "$(m "порт 80 занят: $(ss -Hltnp 'sport = :80' | awk '{print $NF}' | head -1). Let's Encrypt проверяет сервер через порт 80 — освободите его (например, остановите nginx) и повторите: olc-ui ssl" \
             "port 80 is busy: $(ss -Hltnp 'sport = :80' | awk '{print $NF}' | head -1). Let's Encrypt validates through port 80 — free it (e.g. stop nginx) and retry: olc-ui ssl")"
    return 1
  fi
  fw_open 80
  say "$(m "получаю сертификат Let's Encrypt для $host…" "requesting a Let's Encrypt certificate for $host…")"
  local data envs=()
  data=$(env_get OLCUI_DATA); data=${data:-/var/lib/olc-ui}
  mapfile -t envs < <(grep -E '^[A-Z_]+=' "$ENV_FILE")
  # Port 80 needs root here; the running service renews with CAP_NET_BIND_SERVICE.
  if env "${envs[@]}" OLCUI_TLS=acme OLCUI_TLS_HOST="$host" "$BIN" cert 2>&1 | grep -v '\[INFO\]'; then :; fi
  chown -R "$SVC_USER:$SVC_USER" "$data/acme" 2>/dev/null
  [ -s "$data/acme/cert.pem" ] && openssl x509 -in "$data/acme/cert.pem" -noout -checkend 0 >/dev/null 2>&1 &&
    openssl x509 -in "$data/acme/cert.pem" -noout -text 2>/dev/null | grep -q "$host"
}

ssl_setup() {
  need_root
  local ip choice host cert key
  ip=$(public_ip)
  echo
  echo "$(m "Выберите HTTPS-сертификат для панели и подписок:" "Choose the HTTPS certificate for the panel and subscriptions:")"
  echo "  ${c_acc}1${c_off}. $(m "Let's Encrypt на IP-адрес — без домена, продлевается сам (рекомендуется)" "Let's Encrypt for the IP address — no domain needed, auto-renews (recommended)")"
  echo "  ${c_acc}2${c_off}. $(m "Let's Encrypt на домен — если есть домен, указывающий на сервер" "Let's Encrypt for a domain pointing to this server")"
  echo "  ${c_acc}3${c_off}. $(m "Свой сертификат — указать пути к файлам" "Your own certificate — paths to files")"
  echo "  ${c_acc}4${c_off}. $(m "Самоподписанный — браузер покажет предупреждение" "Self-signed — browsers show a warning")"
  echo "  ${c_acc}5${c_off}. $(m "Без SSL — только за nginx/Caddy" "No SSL — behind nginx/Caddy only")"
  echo "  ${c_dim}$(m "Для 1 и 2 порт 80 должен быть свободен и открыт." "Options 1 and 2 need port 80 free and open.")${c_off}"
  case "${OLCUI_SSL:-}" in
    ip) choice=1 ;; domain) choice=2 ;; custom) choice=3 ;; self) choice=4 ;; none) choice=5 ;;
    *) ask choice "$(m "Вариант" "Option")" 1 ;;
  esac

  case "$choice" in
    1)
      ask host "$(m "Публичный IPv4 сервера" "Server public IPv4")" "$ip"
      if issue_acme "$host"; then
        env_set OLCUI_TLS acme; env_set OLCUI_TLS_HOST "$host"
        say "$(m "сертификат для $host получен" "certificate for $host issued")"
      else
        warn "$(m "не удалось получить сертификат — оставляю самоподписанный. Повторить: olc-ui ssl" "could not issue a certificate — keeping self-signed. Retry: olc-ui ssl")"
        env_set OLCUI_TLS self; env_set OLCUI_TLS_HOST "$host"
      fi
      ;;
    2)
      ask host "$(m "Домен (например vpn.example.com)" "Domain (e.g. vpn.example.com)")" "${OLCUI_DOMAIN:-}"
      [ -z "$host" ] && { err "$(m "домен не указан" "no domain given")"; return 1; }
      local resolved
      resolved=$(getent ahostsv4 "$host" 2>/dev/null | awk 'NR==1{print $1}')
      if [ "$resolved" != "$ip" ]; then
        warn "$(m "домен $host указывает на ${resolved:-ничего}, а IP сервера $ip. Исправьте DNS A-запись, иначе Let's Encrypt откажет." "$host resolves to ${resolved:-nothing}, but this server is $ip. Fix the DNS A record or Let's Encrypt will refuse.")"
      fi
      if issue_acme "$host"; then
        env_set OLCUI_TLS acme; env_set OLCUI_TLS_HOST "$host"
        say "$(m "сертификат для $host получен" "certificate for $host issued")"
      else
        warn "$(m "не удалось получить сертификат — оставляю самоподписанный. Повторить: olc-ui ssl" "could not issue a certificate — keeping self-signed. Retry: olc-ui ssl")"
        env_set OLCUI_TLS self; env_set OLCUI_TLS_HOST "$host"
      fi
      ;;
    3)
      ask host "$(m "Домен сертификата (для адреса панели)" "Certificate domain (for the panel URL)")" "${OLCUI_DOMAIN:-}"
      ask cert "$(m "Путь к сертификату (fullchain.pem)" "Certificate path (fullchain.pem)")" "${OLCUI_CERT:-/etc/letsencrypt/live/$host/fullchain.pem}"
      ask key "$(m "Путь к ключу (privkey.pem)" "Private key path (privkey.pem)")" "${OLCUI_KEY:-/etc/letsencrypt/live/$host/privkey.pem}"
      [ -s "$cert" ] && [ -s "$key" ] || { err "$(m "файлы не найдены" "files not found")"; return 1; }
      grant_read "$cert"; grant_read "$key"
      env_set OLCUI_TLS files; env_set OLCUI_CERT "$cert"; env_set OLCUI_KEY "$key"; env_set OLCUI_TLS_HOST "$host"
      say "$(m "сертификат подключён; обновления файлов (certbot) подхватываются сами" "certificate set; file renewals (certbot) are picked up automatically")"
      ;;
    4)
      env_set OLCUI_TLS self; env_set OLCUI_TLS_HOST "$ip"
      ;;
    5)
      local local_only
      ask local_only "$(m "Слушать только 127.0.0.1 (доступ через nginx или SSH-туннель)? y/n" "Listen on 127.0.0.1 only (access via nginx or SSH tunnel)? y/n")" y
      env_set OLCUI_TLS off; env_set OLCUI_TLS_HOST "$ip"
      if [ "$local_only" = y ] || [ "$local_only" = Y ]; then env_set OLCUI_LISTEN "127.0.0.1:$(port)"; else env_set OLCUI_LISTEN ":$(port)"; fi
      ;;
    *) err "$(m "неизвестный вариант" "unknown option")"; return 1 ;;
  esac
  [ "${1:-}" = norestart ] || restart_if_running
}

# ---------- actions ----------

status() {
  local st
  st=$(systemctl is-active olc-ui 2>/dev/null)
  echo
  printf '  %s: %s\n' "$(m "Служба" "Service")" "$([ "$st" = active ] && echo "${c_ok}$(m "работает" "running")${c_off}" || echo "${c_err}${st}${c_off}")"
  printf '  %s: %s\n' "$(m "Версия" "Version")" "$("$BIN" version 2>/dev/null | awk '{print $2}')"
  printf '  %s: %s\n' "$(m "Панель" "Panel")" "$(panel_url)"
  printf '  %s: %s\n' "$(m "Логин" "Login")" "$(bin info 2>/dev/null | sed -n 's/^user=//p')"
  printf '  %s: %s\n' "SSL" "$(env_get OLCUI_TLS) $(env_get OLCUI_TLS_HOST)"
  printf '  %s: %s\n' "$(m "Настройки" "Config")" "$ENV_FILE"
  echo
}

reset_password() {
  need_root
  local user pass out
  ask user "$(m "Логин" "Login")" "$(bin info 2>/dev/null | sed -n 's/^user=//p')"
  ask pass "$(m "Новый пароль (пусто — случайный)" "New password (empty — random)")" ""
  if [ -n "$pass" ]; then out=$(bin admin -user "$user" -pass "$pass"); else out=$(bin admin -user "$user"); fi
  say "$(m "логин" "login"): $(printf '%s\n' "$out" | sed -n 's/^user=//p')  $(m "пароль" "password"): $(printf '%s\n' "$out" | sed -n 's/^pass=//p')"
}

change_port() {
  need_root
  local p host
  ask p "$(m "Новый порт панели" "New panel port")" "$(port)"
  [[ "$p" =~ ^[0-9]+$ ]] && [ "$p" -ge 1 ] && [ "$p" -le 65535 ] || { err "$(m "неверный порт" "invalid port")"; return 1; }
  host=$(env_get OLCUI_LISTEN); host=${host%:*}
  env_set OLCUI_LISTEN "$host:$p"
  fw_open "$p"
  restart_if_running
  say "$(panel_url)"
}

change_path() {
  need_root
  local p
  ask p "$(m "Новый путь панели (пусто — случайный)" "New panel path (empty — random)")" ""
  [ -z "$p" ] && p="/$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')/"
  bin info -base "$p" >/dev/null
  restart_if_running
  say "$(panel_url)"
}

backup() {
  need_root
  mkdir -p "$BACKUP_DIR"
  local f="$BACKUP_DIR/olc-ui-backup-$(date +%Y-%m-%d-%H%M).db" tmp
  tmp=$(bin backup -o "/var/lib/olc-ui/backup-tmp.db" 2>/dev/null) || { err "$(m "не удалось создать копию" "backup failed")"; return 1; }
  mv "$tmp" "$f" && chmod 600 "$f"
  say "$(m "копия сохранена" "backup saved"): $f"
  echo "  ${c_dim}$(m "скачать на компьютер" "download it"): scp root@$(public_ip):$f .${c_off}"
}

restore() {
  need_root
  local f="${1:-}"
  [ -z "$f" ] && ask f "$(m "Путь к файлу копии" "Backup file path")" "$(ls -1t "$BACKUP_DIR"/*.db 2>/dev/null | head -1)"
  [ -s "$f" ] || { err "$(m "файл не найден" "file not found")"; return 1; }
  local tmp=/var/lib/olc-ui/restore-tmp.db
  cp "$f" "$tmp" && chown "$SVC_USER:$SVC_USER" "$tmp"
  systemctl stop olc-ui 2>/dev/null
  bin restore "$tmp"; local rc=$?
  rm -f "$tmp"
  systemctl start olc-ui
  [ $rc -eq 0 ] && say "$(m "восстановлено, туннели запускаются" "restored, tunnels are starting")"
}

update() {
  need_root
  bash <(curl -fsSL "https://raw.githubusercontent.com/$REPO/main/scripts/install.sh")
}

uninstall() {
  need_root
  local yes wipe
  ask yes "$(m "Удалить olc-ui? y/n" "Uninstall olc-ui? y/n")" n
  [ "$yes" = y ] || [ "$yes" = Y ] || return 0
  systemctl disable --now olc-ui 2>/dev/null
  rm -f /etc/systemd/system/olc-ui.service
  systemctl daemon-reload
  ask wipe "$(m "Удалить также базу клиентов и настройки (/var/lib/olc-ui, /etc/olc-ui)? y/n" "Also delete the client database and settings (/var/lib/olc-ui, /etc/olc-ui)? y/n")" n
  if [ "$wipe" = y ] || [ "$wipe" = Y ]; then rm -rf /var/lib/olc-ui /etc/olc-ui; fi
  rm -rf /usr/local/lib/olc-ui
  say "$(m "olc-ui удалён" "olc-ui removed")"
  rm -f /usr/local/bin/olc-ui
  exit 0
}

menu() {
  while true; do
    echo
    echo "${c_acc}╭──────────────────────────────────────────╮${c_off}"
    echo "${c_acc}│${c_off}  olc-ui · $(m "меню управления" "management menu")"
    echo "${c_acc}╰──────────────────────────────────────────╯${c_off}"
    echo "   1. $(m "Статус и адрес панели" "Status and panel address")"
    echo "   2. $(m "Перезапустить" "Restart")      3. $(m "Остановить" "Stop")      4. $(m "Запустить" "Start")"
    echo "   5. $(m "Логи" "Logs")"
    echo "   ${c_dim}──${c_off}"
    echo "   6. $(m "Сбросить логин и пароль" "Reset login and password")"
    echo "   7. $(m "Сменить порт" "Change port")"
    echo "   8. $(m "Сменить путь панели" "Change panel path")"
    echo "   9. $(m "SSL-сертификат" "SSL certificate")"
    echo "   ${c_dim}──${c_off}"
    echo "  10. $(m "Создать резервную копию" "Create backup")"
    echo "  11. $(m "Восстановить из копии" "Restore from backup")"
    echo "  12. $(m "Обновить olc-ui" "Update olc-ui")"
    echo "  13. $(m "Удалить olc-ui" "Uninstall olc-ui")"
    echo "  14. $(m "Язык: English" "Language: Русский")"
    echo "   0. $(m "Выход" "Exit")"
    local n
    ask n "$(m "Выберите пункт" "Choose")" ""
    case "$n" in
      1) status ;;
      2) systemctl restart olc-ui && say "$(m "перезапущено" "restarted")" ;;
      3) systemctl stop olc-ui && say "$(m "остановлено" "stopped")" ;;
      4) systemctl start olc-ui && say "$(m "запущено" "started")" ;;
      5) journalctl -u olc-ui -n 100 -f ;;
      6) reset_password ;;
      7) change_port ;;
      8) change_path ;;
      9) ssl_setup ;;
      10) backup ;;
      11) restore ;;
      12) update ;;
      13) uninstall ;;
      14) if [ "$LANG_UI" = ru ]; then LANG_UI=en; else LANG_UI=ru; fi; env_set OLCUI_LANG "$LANG_UI" ;;
      0 | q | "") exit 0 ;;
    esac
  done
}

case "${1:-}" in
  "") need_root; menu ;;
  status) status ;;
  start | stop | restart) need_root; systemctl "$1" olc-ui ;;
  log | logs) journalctl -u olc-ui -n 100 -f ;;
  ssl) shift; ssl_setup "$@" ;;
  backup) backup ;;
  restore) shift; restore "$@" ;;
  password) reset_password ;;
  port) change_port ;;
  path) change_path ;;
  update) update ;;
  uninstall) uninstall ;;
  panel | worker | client | admin | info | cert | version | -v | --version) bin "$@" ;;
  help | -h | --help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "$(m "неизвестная команда" "unknown command"): $1" ;;
esac
