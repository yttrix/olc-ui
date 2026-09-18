# olc-ui

Веб-панель для туннелей через сервисы видеозвонков: **WB Stream**, **Яндекс Телемост** и **Jitsi**.

Трафик клиента идёт как обычный видеозвонок на IP сервиса из белого списка, а внутри —
зашифрованный TCP-туннель (XChaCha20-Poly1305). Панель ставится на зарубежный VPS одной командой,
запускает серверную сторону туннелей и раздаёт клиентам подписки.

```text
телефон / ПК ─ olcrtc-клиент ─► звонок WB Stream / Телемост / Jitsi ─► olc-ui на VPS ─► интернет
```

В основе лежит ядро [olcrtc](https://github.com/openlibrecommunity/olcrtc) (форк в `core/`, WTFPL).
Интерфейс похож на [olcrtc-manager-panel](https://github.com/BigDaddy3334/olcrtc-manager-panel).

## Возможности

- Клиенты с квотами: лимит скорости, лимит трафика, срок действия, включение и отключение.
- У каждого клиента одна или несколько локаций (сервис + транспорт + комната). Каждая работает в отдельном процессе с автоперезапуском.
- Подписки в формате olcrtc (`/sub/<токен>`), ссылки `olcrtc://` и QR-коды для приложения [olcbox](https://github.com/alananisimov/olcbox) (Android, iOS, macOS, Windows, Linux), импорт в один клик.
- Живой мониторинг: подключённые устройства, скорость, RTT, логи каждой локации, график трафика по дням.
- Учёт трафика и ограничение скорости без root и без iptables.
- Один бинарник без зависимостей: панель встроена, база — SQLite.
- Вход по паролю (bcrypt, сессии, ограничение попыток), панель на случайном секретном пути, HTTPS из коробки.

## Установка

На чистом VPS с Debian/Ubuntu (amd64 или arm64):

```sh
curl -fsSL https://raw.githubusercontent.com/yttrix/olc-ui/main/scripts/install.sh | sudo bash
```

В конце скрипт выведет адрес панели, логин и пароль. Сертификат самоподписанный, поэтому браузер один раз
покажет предупреждение — это нормально.

Опции задаются переменными окружения:

```sh
curl -fsSL https://raw.githubusercontent.com/yttrix/olc-ui/main/scripts/install.sh | sudo env OLCUI_PORT=2053 bash
```

| Переменная | Значение |
|---|---|
| `OLCUI_PORT` | порт панели (по умолчанию случайный) |
| `OLCUI_TLS` | `auto` — самоподписанный HTTPS, `off` — HTTP за reverse proxy |
| `OLCUI_VERSION` | конкретный релиз, например `v0.1.0` |
| `OLCUI_FROM_SOURCE=1` | собрать из исходников вместо скачивания релиза |

Обновление — та же команда. Данные и пароль сохраняются.
Удаление: `sudo bash install.sh uninstall`.

Настройки сервиса: `/etc/olc-ui/olc-ui.env`, данные: `/var/lib/olc-ui`, логи: `journalctl -u olc-ui -f`.

Забыли пароль:

```sh
sudo -u olcui env $(grep -v '^#' /etc/olc-ui/olc-ui.env | xargs) olc-ui admin
```

## Приложение для подключения

Для подключения используйте **[olcbox](https://github.com/alananisimov/olcbox)** — бесплатный клиент olcrtc
для всех платформ. Он совместим с olc-ui по протоколу и понимает её подписки.

**[⬇ Скачать olcbox (последний релиз)](https://github.com/alananisimov/olcbox/releases/latest)**

| Платформа | Какой файл брать | Режим |
|---|---|---|
| Android | `Olcbox-…-android-universal-release.apk` (или `arm64-v8a` для большинства телефонов) | VPN или прокси |
| iOS | `Olcbox-…-ios-unsigned.ipa` — ставится через AltStore / Sideloadly | прокси |
| macOS | `Olcbox-…-macos-arm64.dmg` (Apple Silicon) или `macos-amd64.dmg` (Intel) | системный прокси |
| Windows | `Olcbox-…-windows-amd64.exe` (установщик) или `portable.zip` | VPN |
| Linux | `Olcbox-…-linux-amd64.AppImage` | VPN |

Как добавить подписку:

1. В панели: **Клиенты → Подписка**.
2. На устройстве с установленным olcbox нажмите **«Открыть в olcbox»**, либо скопируйте ссылку подписки
   (или отсканируйте QR) и добавьте её в olcbox вручную.
3. Если панель работает без домена (самоподписанный сертификат), включите в olcbox при импорте
   **Allow insecure requests**.

На Android также подходит [owenclave](https://github.com/owenewans/owenclave/releases/latest) — он принимает
те же ссылки `olcrtc://` и подписки.

## Как пользоваться

1. **Клиенты → Клиент**: имя и, при желании, лимиты.
2. **Добавить локацию**: выберите сервис и транспорт.
   - **WB Stream** — создайте комнату на [stream.wb.ru](https://stream.wb.ru), вставьте её ID, транспорт **VP8**.
   - **Телемост** — создайте встречу на [telemost.yandex.ru](https://telemost.yandex.ru), вставьте ссылку, транспорт **VP8**.
   - **Jitsi** — выберите сервер, который открывается у клиента; комната и ключ создаются автоматически.
3. **Подписка** — «Открыть в olcbox», QR-код или ссылка (см. «Приложение для подключения»).

Совместимость (по тестам olcrtc):

| Транспорт | Телемост | WB Stream | Jitsi |
|---|:-:|:-:|:-:|
| DataChannel | — | только с токеном модератора | ✓ |
| VP8 | ✓ | ✓ | ✓ |
| SEI (H264) | — | ✓ | ✓ |
| Video (QR) | ✓ медленно | ✓ | ✓ |

> Перед использованием проверьте, что выбранный сервис звонков работает в сети клиента.

## Проверка туннеля без приложения

Бинарник умеет работать клиентом и поднимать локальный SOCKS5:

```sh
olc-ui client -listen 127.0.0.1:8808 'olcrtc://jitsi?datachannel@https://meet.example.org/room#<key>'
curl --socks5-hostname 127.0.0.1:8808 https://icanhazip.com   # должен вернуть IP сервера
```

## Разработка

Нужны Go 1.26+ и Node 20+.

```sh
make build          # фронтенд + бинарник в build/olc-ui
make run            # панель на http://127.0.0.1:18080/p/ (данные в build/data)
cd web && npm run dev   # фронтенд с hot reload на :5173, API проксируется в make run
make test
make cross          # linux amd64 + arm64
```

Релиз: `git tag v0.1.0 && git push --tags` — GitHub Actions соберёт бинарники, установщик скачает их сам.

### Устройство

| Путь | Что внутри |
|---|---|
| `cmd/olc-ui` | точка входа: `panel`, `worker`, `client`, `admin`, `info` |
| `internal/api` | HTTP API, вход, подписки |
| `internal/supervisor` | запуск воркеров, перезапуски, логи, учёт трафика и квоты |
| `internal/worker` | один туннель-сервер в отдельном процессе (JSON-события в stdout) |
| `internal/meter` | счётчик байтов и ограничитель скорости исходящих соединений |
| `internal/store` | SQLite: клиенты, локации, трафик по дням, журнал |
| `internal/spec` | описание точки подключения, валидация, формат `olcrtc://` |
| `web/` | React + Tailwind интерфейс, встраивается в бинарник |
| `core/` | форк ядра olcrtc (+ хук `WrapEgress` для учёта трафика) |
