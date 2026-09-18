# Разбор olcrtc и olcrtc-manager-panel

Исходники: `_ref/olcrtc`, `_ref/olcrtc-manager-panel` (склонированы 2026-09-18).

## 1. olcrtc: общая схема

```
приложение -> SOCKS5 127.0.0.1:8808 -> olcrtc cnc (клиент)
  -> WebRTC-звонок через SFU сервиса (WB Stream / Телемост / Jitsi)
  -> olcrtc srv (VPS за границей) -> TCP dial -> интернет
```

Обе стороны заходят в ОДНУ комнату как обычные участники звонка. DPI видит WebRTC
к IP сервиса из белого списка. Внутри — свои зашифрованные данные.

Стек внутри туннеля (снизу вверх):

| Слой | Пакет | Что делает |
|---|---|---|
| auth | `internal/auth/{wbstream,telemost,jitsi}` | HTTP-флоу получения credentials комнаты |
| engine | `internal/engine/{livekit,goolom,jitsi}` | сигналинг SFU + pion PeerConnection |
| transport | `internal/transport/{datachannel,vp8channel,seichannel,videochannel}` | как байты кладутся в WebRTC |
| muxconn | `internal/muxconn` | message-link -> byte stream + AEAD на каждое сообщение |
| crypto | `internal/crypto` | XChaCha20-Poly1305, HKDF, replay-окно |
| smux | `xtaci/smux` | мультиплексирование TCP-стримов |
| handshake/control | `internal/handshake`, `internal/control` | HELLO/WELCOME, ping/pong liveness |
| client/server | `internal/client` (SOCKS5), `internal/server` (dial) | точки входа/выхода |

## 2. Провайдеры (auth)

### WB Stream -> engine `livekit`
1. `POST https://stream.wb.ru/auth/api/v1/auth/user/guest-register`
   body `{displayName, device:{deviceName:"Linux", deviceType:"PARTICIPANT_DEVICE_TYPE_WEB_DESKTOP"}}` -> `accessToken`
   (если задан `auth.token` — шаг пропускается, используется токен аккаунта)
2. `POST /api-room/api/v1/room/{roomID}/join` с `Authorization: Bearer <accessToken>`
3. `GET /api-room-manager/v2/room/{roomID}/connection-details?deviceType=...&displayName=...` -> `roomToken`, `serverUrl` (default `wss://rtc-el-02.wb.ru`)
4. Дальше обычный LiveKit SDK (`owenewans/owenlivekit` — форк livekit server-sdk-go) `ConnectToRoomWithToken`.
- Гостевой токен: `canPublishData=false` -> datachannel НЕ работает, нужен vp8channel. Комнату создают руками на stream.wb.ru.

### Телемост -> engine `goolom` (проприетарный SFU Яндекса)
1. `GET https://cloud-api.yandex.ru/telemost_front/v2/telemost/conferences/{urlencoded https://telemost.yandex.ru/j/ID}/connection?next_gen_media_platform_allowed=true&display_name=...&waiting_room_supported=true`
   заголовки как у Firefox + `Client-Instance-Id`, `X-Telemost-Client-Version: 187.1.0`, `Idempotency-Key`, Origin/Referer telemost.yandex.ru
   -> `room_id`, `peer_id`, `credentials`, `client_configuration.media_server_url`
2. WebSocket на media_server_url, JSON-протокол: `hello` (participantMeta, capabilitiesOffer, sdkInfo "browser 5.27.0", disablePublisher/Subscriber), ответы `ack`/`pong`, `serverHello` (ICE/TURN + telemetry config), `subscriberSdpOffer` -> `subscriberSdpAnswer`, затем `publisherSdpOffer` c `tracks`, `webrtcIceCandidate` с target SUBSCRIBER/PUBLISHER, `setSlots`.
3. ДВА PeerConnection: subscriber и publisher. STUN `stun.rtc.yandex.net:3478`. Keepalive: WS ping 30с, app ping 5с. Телеметрия POST каждые ~20с (имитация браузера).
4. На каждый reconnect нужны свежие credentials (refresh).
- DataChannel в Телемосте убрали -> только vp8channel (videochannel медленно).

### Jitsi -> engine `jitsi` (библиотека `zarazaex69/j`: XMPP MUC + Jingle + colibri-ws)
- Без регистрации, room.id = `https://host/room`. datachannel через `EndpointMessage` bridge. Для РФ белых списков скорее не нужен.

## 3. Транспорты

| Transport | Суть | Совместимость |
|---|---|---|
| datachannel | SCTP DataChannel, 12 KiB сообщения | Jitsi +, WB только с модераторским токеном, Телемост - |
| **vp8channel** | KCP (xtaci/kcp-go) поверх VP8-кадров видеотрека | Телемост +, WB +, Jitsi + |
| seichannel | данные в H264 SEI NAL + ACK/retry | WB +, Jitsi + |
| videochannel | QR/тайлы, реально кодирует VP8 на Go | медленно, экспериментально |

### vp8channel (главный для WB/Телемоста)
Каждый VP8 sample:
```
[0..20)  валидный VP8 keyframe 16x16 (SFU проверяет битстрим)
[20..24) binding token (hash client-id)
[24..28) src epoch    [28..32) dst epoch (0 = broadcast)
[32..36) CRC32(token|src|dst)
[36..)   KCP-пакет(ы); при батче префикс "OLKB" + [u16 len][pkt]...
```
- Два KCP-плана: data и control (control epoch со старшим битом 0x80000000), control всегда отправляется раньше data.
- KCP: conv 0xC0FFEE01, MTU 1400, окно 4096, NoDelay(1,5,2,1), stream mode, 4-байтный length-prefix.
- Писатель тикает с FPS (default 30), batch до 64 пакетов/тик; раз в 2с принудительный чистый keyframe, чтобы SFU не перестал форвардить трек.
- Приём: сборка VP8 из RTP (reorder buffer), проверка seq, marker bit.
- src/dst epoch позволяют серверу обслуживать нескольких клиентов в одной комнате (SFU шлёт всем всё).

## 4. Крипто и протокол

- PSK 32 байта (64 hex, `openssl rand -hex 32`).
- HKDF-SHA256 -> ключи `olcrtc/v2/client-to-server` и `olcrtc/v2/server-to-client`.
- Запись: `"OLC2" | counter u64 BE | prefix 16B | ciphertext | tag 16B` (overhead 44 B). Nonce XChaCha = prefix||counter.
- AAD разделяет data/control. Replay-окно 64 на sender prefix, до 256 prefix (LRU).
- smux поверх; первый стрим control: `CLIENT_HELLO{version:3, device_id, challenge}` -> `SERVER_WELCOME{session_id, peer_id, challenge}` (4-байтный len + JSON).
- Liveness: ping/pong по control, interval 10s, timeout 15s, 4 промаха -> rebuild.
- Каждое TCP-соединение = smux stream: клиент пишет JSON `{"cmd":"connect","addr":..,"port":..}`, сервер отвечает 1 байт ack (OK / host unreachable), дальше bidirectional copy.
- Сервер может ходить наружу через upstream SOCKS5 (`socks.proxy_*`).

## 5. Конфиг, URI, подписки

YAML: `mode` (srv/cnc/gen), `auth.provider`, `auth.token`, `room.id`, `crypto.key|key_file`, `net.transport`, `net.dns`, `socks.*`, `vp8.fps/batch_size`, `sei.*`, `video.*`, `liveness.*`, `lifecycle.max_session_duration`, `traffic.*`, `profiles[]`+`failover` (перебор провайдеров по очереди).

URI: `olcrtc://<provider>?<transport><k=v&..>@<roomID>#<key>$<comment>`
Подписка: plain text, `#name/#update/#refresh/#used/#available...`, строки URI, под ними `##name/##ip/##comment...`.

Встраивание: `pkg/olcrtc/client` (SOCKS5-клиент), `pkg/olcrtc/tunnel` (сервер), `mobile` (gomobile, Android).

Зависимости: Go 1.26+, pion/webrtc v4, owenlivekit, kcp-go, smux, x/crypto, zarazaex69/j, gorilla/websocket. Лицензия WTFPL.

Статус апстрима: автор пишет, что проект будет влит в owenewans/snolc, PR/issues не принимаются — по сути EoL.

## 6. olcrtc-manager-panel

Go-бинарник (один `main.go`, ~3.9k строк) + React/Vite/Tailwind SPA, встроенная через `web/dist`.

- Модель: `Config{name, port, refresh, clients[]}`; `Client{client-id, refresh, quota{speed_mbps, traffic_gb, used_bytes, expires_at}, locations[]}`; `Location{name, endpoint{room_id,key}, carrier, transport{type,payload}, dns, proxy}`.
- На каждую локацию запускается отдельный `olcrtc srv` с временным YAML, внутри своего network namespace (`ip netns`, veth, NAT MASQUERADE, `tc` для лимита скорости). Трафик считается по `tx_bytes` veth.
- Supervisor: StartAll / Reload (перезапуск только изменённых) / Restart, лог-буфер 500 строк, парсинг `Current peers count: N, Devices: [...]` из логов olcrtc.
- QuotaEnforcer: превышение трафика или срока -> остановка локации.
- HTTP: `/admin` (SPA), `/api/auth/{login,setup,logout,me,password}` (cookie-сессия + Basic, rate limit), `/api/state`, `/api/metrics`, `/api/audit`, `/api/logs/...`, `/api/actions/{restart,regenerate-room,rotate-key}`, `/api/tools/generate-room`, `/api/clients[/..]`, `/api/settings`, `/-/reload` (loopback), `/<sub-path>/<client-id>/` — подписка.
- Установка: `scripts/install.sh` (собирает olcrtc и менеджер, systemd, HTTPS самоподписанный, случайный порт, генерит логин/пароль в `panel.env`).
- UI: тёмная тема (bg hsl(220 20% 8%), card hsl(220 18% 11%), primary бирюзовый hsl(172 72% 44%)), шапка с метриками памяти, 4 stat-карточки (Профиль/Клиенты/Инстансы/Peers), список клиентов-аккордеонов с таблицей локаций (Room/Provider/Transport/DNS/Статус/Peers + Restart/Логи/OlcBox/QR/Edit/Удалить), модалки создания/редактирования, QR, настройки, логи. Иконки lucide-react. Весь UI в одном `src/main.tsx` (~2.1k строк).
