import { useState } from "react";
import { ChevronDown, ChevronRight, KeyRound, TriangleAlert } from "lucide-react";
import type { Client, ClientInput, Endpoint, Location, LocationInput, Meta, Support } from "./api";
import { GB, providerLabel, transportLabel } from "./format";
import { useLang } from "./i18n";
import { Button, Field, Input, Select, Toggle, cx } from "./ui";

// ---------- client ----------

export function ClientForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Client;
  onSubmit: (c: ClientInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { tr } = useLang();
  const [name, setName] = useState(initial?.name ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [speed, setSpeed] = useState(String(initial?.speed_mbps || ""));
  const [traffic, setTraffic] = useState(initial?.traffic_limit ? String(+(initial.traffic_limit / GB).toFixed(2)) : "");
  const [expires, setExpires] = useState(initial?.expires_at ?? "");
  const [refresh, setRefresh] = useState(initial?.refresh ?? "");
  const [conns, setConns] = useState(String(initial ? initial.max_conns : 3));
  const [devices, setDevices] = useState(String(initial?.max_devices || ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const addDays = (days: number) => {
    const base = expires && new Date(expires) > new Date() ? new Date(expires) : new Date();
    base.setDate(base.getDate() + days);
    setExpires(base.toISOString().slice(0, 10));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        name,
        note,
        enabled,
        speed_mbps: Math.max(0, parseInt(speed) || 0),
        traffic_limit: Math.max(0, Math.round((parseFloat(traffic.replace(",", ".")) || 0) * GB)),
        expires_at: expires,
        refresh,
        max_conns: Math.max(0, parseInt(conns) || 0),
        max_devices: Math.max(0, parseInt(devices) || 0),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const noLimit = tr("0 или пусто — без ограничения", "0 or empty — unlimited");

  return (
    <form className="space-y-4" onSubmit={submit}>
      {!initial && (
        <div className="rounded-[10px] border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm">
          <span className="font-medium">{tr("Шаг 1 из 2 — клиент.", "Step 1 of 2 — client.")}</span>{" "}
          <span className="text-muted-foreground">
            {tr(
              "На следующем шаге выберете сервис для подключения: WB Stream, Яндекс Телемост или Jitsi.",
              "Next you will pick the service to connect through: WB Stream, Yandex Telemost or Jitsi.",
            )}
          </span>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Имя", "Name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("например, phone-anna", "e.g. phone-anna")} autoFocus required />
        </Field>
        <Field label={tr("Заметка", "Note")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("необязательно", "optional")} />
        </Field>
        <Field label={tr("Скорость, Мбит/с", "Speed, Mbit/s")} hint={noLimit}>
          <Input inputMode="numeric" value={speed} onChange={(e) => setSpeed(e.target.value)} placeholder={tr("без лимита", "unlimited")} />
        </Field>
        <Field label={tr("Лимит трафика, ГБ", "Traffic limit, GB")} hint={noLimit}>
          <Input inputMode="decimal" value={traffic} onChange={(e) => setTraffic(e.target.value)} placeholder={tr("без лимита", "unlimited")} />
        </Field>
        <Field
          label={tr("Одновременных подключений", "Simultaneous connections")}
          hint={tr("сколько устройств могут быть подключены сразу; 0 — без ограничения", "devices connected at the same time; 0 — unlimited")}
        >
          <Input inputMode="numeric" value={conns} onChange={(e) => setConns(e.target.value)} />
        </Field>
        <Field
          label={tr("Лимит устройств", "Device limit")}
          hint={tr("сколько приложений olcbox могут добавить подписку; пусто — без ограничения", "how many olcbox installs may add the subscription; empty — unlimited")}
        >
          <Input inputMode="numeric" value={devices} onChange={(e) => setDevices(e.target.value)} placeholder={tr("без лимита", "unlimited")} />
        </Field>
        <Field
          label={tr("Действует до", "Valid until")}
          hint={
            <span className="flex flex-wrap gap-2">
              {[30, 90, 365].map((d) => (
                <button key={d} type="button" className="text-primary hover:underline" onClick={() => addDays(d)}>
                  +{d} {tr("дн.", "d")}
                </button>
              ))}
              <button type="button" className="hover:underline" onClick={() => setExpires("")}>
                {tr("бессрочно", "no expiry")}
              </button>
            </span>
          }
        >
          <div className="relative">
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={expires ? "" : "text-transparent focus:text-foreground"} />
            {!expires && <span className="pointer-events-none absolute left-3 top-2 text-sm text-dim">{tr("бессрочно", "no expiry")}</span>}
          </div>
        </Field>
        <Field label={tr("Обновление подписки", "Subscription refresh")} hint={tr("например 30m, 6h, 1d; пусто — как в настройках", "e.g. 30m, 6h, 1d; empty — panel default")}>
          <Input value={refresh} onChange={(e) => setRefresh(e.target.value)} placeholder={tr("по умолчанию", "default")} />
        </Field>
      </div>
      <Toggle checked={enabled} onChange={setEnabled} label={tr("Клиент включён", "Client enabled")} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" onClick={onCancel}>
          {tr("Отмена", "Cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {initial ? tr("Сохранить", "Save") : tr("Далее: выбрать сервис →", "Next: pick a service →")}
        </Button>
      </div>
    </form>
  );
}

// ---------- location ----------

const optionHints: Record<string, { ru: string; en: string; placeholder: string }> = {
  "vp8-fps": { ru: "FPS", en: "FPS", placeholder: "30" },
  "vp8-batch": { ru: "Кадров за тик", en: "Frames per tick", placeholder: "64" },
  fps: { ru: "FPS", en: "FPS", placeholder: "30" },
  batch: { ru: "Кадров за тик", en: "Frames per tick", placeholder: "64" },
  frag: { ru: "Размер фрагмента, байт", en: "Fragment size, bytes", placeholder: "900" },
  "ack-ms": { ru: "Таймаут ACK, мс", en: "ACK timeout, ms", placeholder: "2000" },
  "video-w": { ru: "Ширина", en: "Width", placeholder: "1920" },
  "video-h": { ru: "Высота", en: "Height", placeholder: "1080" },
  "video-fps": { ru: "FPS", en: "FPS", placeholder: "30" },
  "video-codec": { ru: "Кодек", en: "Codec", placeholder: "qrcode" },
  "video-qr-size": { ru: "Фрагмент QR, байт", en: "QR fragment, bytes", placeholder: "0" },
  "video-qr-recovery": { ru: "Коррекция QR", en: "QR recovery", placeholder: "low" },
  "video-tile-module": { ru: "Размер тайла, px", en: "Tile size, px", placeholder: "4" },
  "video-tile-rs": { ru: "Reed-Solomon, %", en: "Reed-Solomon, %", placeholder: "0" },
};

const supportTone: Record<Support, string> = { works: "text-success", unstable: "text-warning", broken: "text-destructive" };

function splitJitsi(room: string) {
  const bare = room.replace(/^https?:\/\//, "");
  const i = bare.indexOf("/");
  return i < 0 ? { host: bare, name: "" } : { host: bare.slice(0, i), name: bare.slice(i + 1) };
}

export function LocationForm({
  meta,
  initial,
  defaultJitsi,
  onSubmit,
  onCancel,
}: {
  meta: Meta;
  initial?: Location;
  defaultJitsi: string;
  onSubmit: (l: LocationInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { tr, lang } = useLang();
  const ep = initial?.endpoint;
  const [name, setName] = useState(initial?.name ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [provider, setProvider] = useState(ep?.provider ?? "wbstream");
  const [transport, setTransport] = useState(ep?.transport ?? meta.recommended_transport["wbstream"]);
  const [room, setRoom] = useState(ep && ep.provider !== "jitsi" ? ep.room : "");
  const initialJitsi = ep?.provider === "jitsi" ? splitJitsi(ep.room) : { host: defaultJitsi, name: "" };
  const [jitsiHost, setJitsiHost] = useState(initialJitsi.host);
  const [jitsiRoom, setJitsiRoom] = useState(initialJitsi.name);
  const [key, setKey] = useState(ep?.key ?? "");
  const [dns, setDns] = useState(ep?.dns ?? meta.default_dns);
  const [token, setToken] = useState(ep?.provider_token ?? "");
  const [options, setOptions] = useState<Record<string, string>>(ep?.options ?? {});
  const [proxy, setProxy] = useState({
    addr: ep?.proxy?.addr ?? "",
    port: ep?.proxy?.port ? String(ep.proxy.port) : "",
    user: ep?.proxy?.user ?? "",
    pass: ep?.proxy?.pass ?? "",
  });
  const [advanced, setAdvanced] = useState(Boolean(ep?.proxy?.addr || ep?.provider_token));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const supportText: Record<Support, string> = {
    works: tr("работает", "works"),
    unstable: tr("нестабильно", "unstable"),
    broken: tr("не работает", "broken"),
  };
  const roomHelp: Record<string, string> = {
    wbstream: tr(
      "Создайте комнату на stream.wb.ru и вставьте ссылку-приглашение целиком или только ID. Транспорт — VP8.",
      "Create a room on stream.wb.ru and paste the invite link or just its ID. Transport: VP8.",
    ),
    telemost: tr(
      "Создайте встречу на telemost.yandex.ru и вставьте ссылку https://telemost.yandex.ru/j/… целиком или только номер.",
      "Create a meeting on telemost.yandex.ru and paste the https://telemost.yandex.ru/j/… link or just its number.",
    ),
    jitsi: tr(
      "Выберите сервер Jitsi, который открывается из сети клиента. Имя комнаты можно не указывать — будет создано случайное.",
      "Pick a Jitsi server reachable from the client's network. Leave the room empty to get a random one.",
    ),
  };

  const support = meta.matrix[provider]?.[transport] ?? "works";

  const pickProvider = (p: string) => {
    setProvider(p);
    setTransport(meta.recommended_transport[p]);
    setOptions({});
  };

  const randomKey = () => {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    setKey(Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const host = jitsiHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const endpoint: Endpoint = {
      provider,
      transport,
      room: provider === "jitsi" ? (jitsiRoom.trim() ? `https://${host}/${jitsiRoom.trim()}` : host) : room.trim(),
      key: key.trim(),
      dns: dns.trim(),
      provider_token: token.trim() || undefined,
      options: Object.fromEntries(Object.entries(options).filter(([k, v]) => v.trim() && (meta.option_keys[transport] ?? []).includes(k))),
      proxy: proxy.addr.trim()
        ? { addr: proxy.addr.trim(), port: parseInt(proxy.port) || 1080, user: proxy.user || undefined, pass: proxy.pass || undefined }
        : null,
    };
    try {
      await onSubmit({ name, enabled, endpoint });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const optionKeys = meta.option_keys[transport] ?? [];

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Название", "Name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("например, NL · WB", "e.g. NL · WB")} autoFocus />
        </Field>
        <Field label={tr("Сервис", "Service")}>
          <Select value={provider} onChange={(e) => pickProvider(e.target.value)}>
            {meta.providers.map((p) => (
              <option key={p} value={p}>
                {providerLabel(p, lang)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div>
        <div className="mb-1.5 text-[13px] font-medium">{tr("Транспорт", "Transport")}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {meta.transports.map((t) => {
            const s = meta.matrix[provider]?.[t] ?? "works";
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTransport(t);
                  setOptions({});
                }}
                className={cx(
                  "rounded-[10px] border px-3 py-2 text-left text-sm transition-colors",
                  transport === t ? "border-primary/70 bg-primary/10" : "border-border hover:bg-muted",
                )}
              >
                <div className="font-medium">{transportLabel[t] ?? t}</div>
                <div className={cx("text-xs", supportTone[s])}>{supportText[s]}</div>
              </button>
            );
          })}
        </div>
        {support !== "works" && (
          <p className="mt-2 flex items-start gap-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {provider === "wbstream" && transport === "datachannel"
              ? tr(
                  "WB Stream + DataChannel работает только с токеном модератора (раздел «Дополнительно»).",
                  "WB Stream + DataChannel needs a moderator token (see Advanced).",
                )
              : `${providerLabel(provider, lang)} + ${transportLabel[transport]}: ${supportText[support]}.`}
          </p>
        )}
      </div>

      {provider === "jitsi" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Сервер Jitsi", "Jitsi server")} hint={roomHelp.jitsi}>
            <Input list="jitsi-instances" value={jitsiHost} onChange={(e) => setJitsiHost(e.target.value)} required />
            <datalist id="jitsi-instances">
              {meta.jitsi_instances.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </Field>
          <Field label={tr("Комната", "Room")}>
            <Input value={jitsiRoom} onChange={(e) => setJitsiRoom(e.target.value)} placeholder={tr("случайная", "random")} />
          </Field>
        </div>
      ) : (
        <Field label={provider === "telemost" ? tr("Ссылка на встречу Телемоста", "Telemost meeting link") : tr("Ссылка на комнату WB Stream", "WB Stream room link")} hint={roomHelp[provider]}>
          <Input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            required
            className="font-mono"
            placeholder={provider === "telemost" ? "https://telemost.yandex.ru/j/…" : "https://stream.wb.ru/…"}
          />
        </Field>
      )}

      <Field label={tr("Ключ шифрования", "Encryption key")} hint={tr("64 hex-символа. Пусто — будет создан автоматически.", "64 hex characters. Leave empty to generate.")}>
        <div className="flex gap-2">
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder={tr("авто", "auto")} className="font-mono text-xs" />
          <Button type="button" onClick={randomKey} icon={<KeyRound className="h-4 w-4" />}>
            {tr("Новый", "New")}
          </Button>
        </div>
      </Field>

      {optionKeys.length > 0 && (
        <div>
          <div className="mb-1.5 text-[13px] font-medium">{tr("Параметры транспорта", "Transport options")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {optionKeys.map((k) => (
              <Field key={k} label={optionHints[k] ? (lang === "ru" ? optionHints[k].ru : optionHints[k].en) : k}>
                {k === "video-codec" || k === "video-qr-recovery" ? (
                  <Select value={options[k] ?? ""} onChange={(e) => setOptions({ ...options, [k]: e.target.value })}>
                    <option value="">{tr("по умолчанию", "default")}</option>
                    {(k === "video-codec" ? ["qrcode", "tile"] : ["low", "medium", "high", "highest"]).map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                ) : (
                  <Input inputMode="numeric" value={options[k] ?? ""} onChange={(e) => setOptions({ ...options, [k]: e.target.value })} placeholder={optionHints[k]?.placeholder} />
                )}
              </Field>
            ))}
          </div>
        </div>
      )}

      <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => setAdvanced(!advanced)}>
        {advanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {tr("Дополнительно", "Advanced")}
      </button>
      {advanced && (
        <div className="space-y-4 rounded-[10px] border border-border p-4">
          <Field label="DNS" hint={tr("через него сервер резолвит адреса сайтов", "the server resolves site names through it")}>
            <Input value={dns} onChange={(e) => setDns(e.target.value)} />
          </Field>
          {provider === "wbstream" && (
            <Field
              label={tr("Токен аккаунта WB Stream", "WB Stream account token")}
              hint={tr("нужен только для DataChannel (права модератора); иначе гостевой вход", "only for DataChannel (moderator rights); otherwise guest login")}
            >
              <Input value={token} onChange={(e) => setToken(e.target.value)} className="font-mono text-xs" />
            </Field>
          )}
          <div>
            <div className="mb-1.5 text-[13px] font-medium">{tr("Выходной SOCKS5-прокси", "Outbound SOCKS5 proxy")}</div>
            <p className="mb-2 text-xs text-dim">
              {tr("Если указан, сервер выходит в интернет через него, а не напрямую.", "When set, the server reaches the internet through it.")}
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Input className="sm:col-span-2" value={proxy.addr} onChange={(e) => setProxy({ ...proxy, addr: e.target.value })} placeholder={tr("адрес", "address")} />
              <Input value={proxy.port} onChange={(e) => setProxy({ ...proxy, port: e.target.value })} placeholder={tr("порт", "port")} inputMode="numeric" />
              <div />
              <Input value={proxy.user} onChange={(e) => setProxy({ ...proxy, user: e.target.value })} placeholder={tr("логин", "user")} />
              <Input value={proxy.pass} onChange={(e) => setProxy({ ...proxy, pass: e.target.value })} placeholder={tr("пароль", "password")} type="password" />
            </div>
          </div>
        </div>
      )}

      <Toggle checked={enabled} onChange={setEnabled} label={tr("Локация включена", "Location enabled")} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" onClick={onCancel}>
          {tr("Отмена", "Cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {initial ? tr("Сохранить", "Save") : tr("Добавить", "Add")}
        </Button>
      </div>
    </form>
  );
}
