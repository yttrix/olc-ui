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

**[English version below](#english)**

## Возможности

- Клиенты с квотами: скорость, трафик, срок действия, **до 3 одновременных подключений** (настраивается), **лимит устройств** по HWID приложения — как в Happ/Incy.
- У клиента одна или несколько локаций (сервис + транспорт + комната). Каждая работает в отдельном процессе с автоперезапуском. Одна комната не может использоваться дважды.
- Подписки для [olcbox](https://github.com/alananisimov/olcbox) (Android, iOS, macOS, Windows, Linux): ссылка, QR-код, «Открыть в olcbox» в один клик.
- Дашборд в стиле Remnawave: трафик за сегодня/неделю/месяц с изменением к прошлому периоду, онлайн, график по дням, таблица клиентов с сортировкой и фильтрами.
- **Резервная копия** в один клик и восстановление на новом сервере.
- **HTTPS от Let's Encrypt на IP-адрес** (без домена) или на домен, свой сертификат, самоподписанный — выбирается при установке, продлевается без перезапуска.
- Меню управления `olc-ui` на сервере, как у 3x-ui.
- Интерфейс на русском и английском.
- Один бинарник без зависимостей: панель встроена, база — SQLite. Вход по паролю (bcrypt, ограничение попыток), панель на случайном секретном пути.

## Установка

На VPS с Debian/Ubuntu (amd64 или arm64), от root:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/yttrix/olc-ui/main/scripts/install.sh)
```

Установщик спросит язык, порт и способ получения HTTPS-сертификата:

1. **Let's Encrypt на IP-адрес** — рекомендуется: без домена, без предупреждений браузера, olcbox принимает подписку без галочек. Нужен открытый порт 80.
2. **Let's Encrypt на домен** — если есть домен, указывающий на сервер. При переезде на новый сервер подписки клиентов продолжают работать.
3. **Свой сертификат** — пути к файлам (например, от certbot); обновления файлов подхватываются сами.
4. **Самоподписанный** — браузер покажет предупреждение, в olcbox нужно включить «Allow insecure requests».
5. **Без SSL** — только за nginx/Caddy.

В конце выводятся адрес панели, логин и пароль. Обновление — та же команда: клиенты, настройки и пароль сохраняются.

### Меню управления

После установки на сервере доступна команда `olc-ui`:

```text
olc-ui              меню: статус, перезапуск, логи, сброс пароля, порт, путь, SSL, копии, обновление, удаление
olc-ui status       адрес панели и состояние
olc-ui ssl          выбрать или перевыпустить сертификат
olc-ui backup       сохранить копию в /root/olc-ui-backups
olc-ui restore FILE восстановить клиентов из копии
olc-ui password     сбросить логин и пароль
olc-ui update       обновить
```

Без вопросов (например, в скриптах):

```sh
curl -fsSL https://raw.githubusercontent.com/yttrix/olc-ui/main/scripts/install.sh | \
  sudo env OLCUI_YES=1 OLCUI_LANG=ru OLCUI_PORT=2053 OLCUI_SSL=ip bash
```

| Переменная | Значение |
|---|---|
| `OLCUI_LANG` | `ru` или `en` |
| `OLCUI_PORT` | порт панели (по умолчанию случайный) |
| `OLCUI_SSL` | `ip`, `domain`, `custom`, `self`, `none` |
| `OLCUI_DOMAIN` | домен для `domain` / `custom` |
| `OLCUI_CERT`, `OLCUI_KEY` | пути к файлам для `custom` |
| `OLCUI_VERSION` | конкретный релиз, например `v0.2.0` |
| `OLCUI_FROM_SOURCE=1` | собрать из исходников вместо скачивания релиза |

Файлы: настройки `/etc/olc-ui/olc-ui.env`, данные `/var/lib/olc-ui`, логи `journalctl -u olc-ui -f`.

### Перенос на новый сервер

1. На старой панели: **Настройки → Резервная копия → Скачать копию** (или `olc-ui backup`).
2. На новом сервере установите olc-ui и выберите в панели **Восстановить из копии** (или `olc-ui restore файл`).
3. Туннели поднимутся с теми же комнатами и ключами. Если у сервера другой IP и нет домена — клиентам нужно добавить подписку заново.

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
4. Не получается добавить по ссылке (например, телефон в мобильной сети с белыми списками не видит сервер) —
   нажмите **«Скопировать для olcbox»** и импортируйте текст из буфера обмена.
   Подробнее: [Подписка не добавляется](docs/providers.md#подписка-не-добавляется-в-olcbox).

На Android также подходит [owenclave](https://github.com/owenewans/owenclave/releases/latest) — он принимает
те же ссылки `olcrtc://` и подписки.

## Как пользоваться

> **Пошаговая инструкция с решением проблем: [Подключение WB Stream и Яндекс Телемоста](docs/providers.md).**

1. **Клиенты → Клиент**: имя и, при желании, лимиты.
2. **Добавить локацию**: выберите сервис и транспорт.
   - **WB Stream** — создайте комнату на [stream.wb.ru](https://stream.wb.ru), вставьте ссылку на неё, транспорт **VP8**.
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

---

<a id="english"></a>

## English

**olc-ui** is a web panel for olcrtc tunnels over video-call services (**WB Stream**, **Yandex Telemost**, **Jitsi**).
Client traffic looks like an ordinary video call to a whitelisted service; inside is an encrypted TCP tunnel.

**Install** (Debian/Ubuntu, amd64/arm64, as root):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/yttrix/olc-ui/main/scripts/install.sh)
```

The installer asks for the language, the port and the HTTPS certificate: Let's Encrypt for the **IP address** (no domain
needed, recommended), Let's Encrypt for a domain, your own certificate files, self-signed, or no SSL behind a proxy.
Certificates renew automatically without restarting the panel. Re-run the same command to update.

**Features:** clients with speed/traffic/expiry limits, up to 3 simultaneous connections per client and an optional device
(HWID) limit, locations on WB Stream / Telemost / Jitsi, subscriptions and QR codes for the
[olcbox](https://github.com/alananisimov/olcbox/releases/latest) app, a Remnawave-style dashboard, sortable client table,
one-click backup and restore, `olc-ui` server menu (status, password, port, path, SSL, backup, update), Russian and English UI.

**Clients:** use [olcbox](https://github.com/alananisimov/olcbox/releases/latest) on Android, iOS, macOS, Windows and Linux:
open *Subscription* in the panel and tap *Open in olcbox* or scan the QR code.

See [docs/providers.md](docs/providers.md) (Russian) for creating WB Stream and Telemost rooms.
