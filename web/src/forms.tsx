import { useState } from "react";
import { ChevronDown, ChevronRight, KeyRound, TriangleAlert } from "lucide-react";
import type { Client, ClientInput, Endpoint, Location, LocationInput, Meta, Support } from "./api";
import { GB, providerLabel, transportLabel } from "./format";
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
  const [name, setName] = useState(initial?.name ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [speed, setSpeed] = useState(String(initial?.speed_mbps || ""));
  const [traffic, setTraffic] = useState(initial?.traffic_limit ? String(+(initial.traffic_limit / GB).toFixed(2)) : "");
  const [expires, setExpires] = useState(initial?.expires_at ?? "");
  const [refresh, setRefresh] = useState(initial?.refresh ?? "");
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
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      {!initial && (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm">
          <span className="font-medium">Шаг 1 из 2 — клиент.</span>{" "}
          <span className="text-muted-foreground">
            На следующем шаге выберете сервис для подключения: WB Stream, Яндекс Телемост или Jitsi.
          </span>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Имя">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="например, phone-anna" autoFocus required />
        </Field>
        <Field label="Заметка">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" />
        </Field>
        <Field label="Скорость, Мбит/с" hint="0 или пусто — без ограничения">
          <Input inputMode="numeric" value={speed} onChange={(e) => setSpeed(e.target.value)} placeholder="без лимита" />
        </Field>
        <Field label="Лимит трафика, ГБ" hint="0 или пусто — без ограничения">
          <Input inputMode="decimal" value={traffic} onChange={(e) => setTraffic(e.target.value)} placeholder="без лимита" />
        </Field>
        <Field
          label="Действует до"
          hint={
            <span className="flex flex-wrap gap-2">
              {[30, 90, 365].map((d) => (
                <button key={d} type="button" className="text-primary hover:underline" onClick={() => addDays(d)}>
                  +{d} дн.
                </button>
              ))}
              <button type="button" className="hover:underline" onClick={() => setExpires("")}>
                бессрочно
              </button>
            </span>
          }
        >
          <div className="relative">
            <Input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className={expires ? "" : "text-transparent focus:text-foreground"}
            />
            {!expires && (
              <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">бессрочно</span>
            )}
          </div>
        </Field>
        <Field label="Обновление подписки" hint="например 30m, 6h, 1d; пусто — как в настройках">
          <Input value={refresh} onChange={(e) => setRefresh(e.target.value)} placeholder="по умолчанию" />
        </Field>
      </div>
      <Toggle checked={enabled} onChange={setEnabled} label="Клиент включён" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {initial ? "Сохранить" : "Далее: выбрать сервис →"}
        </Button>
      </div>
    </form>
  );
}

// ---------- location ----------

const optionHints: Record<string, { label: string; placeholder: string }> = {
  "vp8-fps": { label: "FPS", placeholder: "30" },
  "vp8-batch": { label: "Кадров за тик", placeholder: "64" },
  fps: { label: "FPS", placeholder: "30" },
  batch: { label: "Кадров за тик", placeholder: "64" },
  frag: { label: "Размер фрагмента, байт", placeholder: "900" },
  "ack-ms": { label: "Таймаут ACK, мс", placeholder: "2000" },
  "video-w": { label: "Ширина", placeholder: "1920" },
  "video-h": { label: "Высота", placeholder: "1080" },
  "video-fps": { label: "FPS", placeholder: "30" },
  "video-codec": { label: "Кодек", placeholder: "qrcode" },
  "video-qr-size": { label: "Фрагмент QR, байт", placeholder: "0 (авто)" },
  "video-qr-recovery": { label: "Коррекция QR", placeholder: "low" },
  "video-tile-module": { label: "Размер тайла, px", placeholder: "4" },
  "video-tile-rs": { label: "Reed-Solomon, %", placeholder: "0" },
};

const supportTone: Record<Support, string> = {
  works: "text-primary",
  unstable: "text-warning",
  broken: "text-destructive",
};
const supportText: Record<Support, string> = { works: "работает", unstable: "нестабильно", broken: "не работает" };

const roomHelp: Record<string, string> = {
  wbstream: "Создайте комнату на stream.wb.ru и вставьте ссылку-приглашение целиком или только ID. Транспорт — VP8.",
  telemost: "Создайте встречу на telemost.yandex.ru и вставьте ссылку https://telemost.yandex.ru/j/… целиком или только номер.",
  jitsi: "Выберите сервер Jitsi, который открывается из сети клиента. Имя комнаты можно не указывать — будет создано случайное.",
};

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
      options: Object.fromEntries(
        Object.entries(options).filter(([k, v]) => v.trim() && (meta.option_keys[transport] ?? []).includes(k)),
      ),
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
        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="например, NL · WB" autoFocus />
        </Field>
        <Field label="Сервис">
          <Select value={provider} onChange={(e) => pickProvider(e.target.value)}>
            {meta.providers.map((p) => (
              <option key={p} value={p}>
                {providerLabel[p] ?? p}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div>
        <div className="mb-1.5 text-sm font-medium">Транспорт</div>
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
                  "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  transport === t ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
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
              ? "WB Stream + DataChannel работает только с токеном модератора (раздел «Дополнительно»)."
              : `${providerLabel[provider]} + ${transportLabel[transport]} ${supportText[support]} по тестам апстрима.`}
          </p>
        )}
      </div>

      {provider === "jitsi" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Сервер Jitsi" hint={roomHelp.jitsi}>
            <Input list="jitsi-instances" value={jitsiHost} onChange={(e) => setJitsiHost(e.target.value)} required />
            <datalist id="jitsi-instances">
              {meta.jitsi_instances.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </Field>
          <Field label="Комната">
            <Input value={jitsiRoom} onChange={(e) => setJitsiRoom(e.target.value)} placeholder="случайная" />
          </Field>
        </div>
      ) : (
        <Field label={provider === "telemost" ? "Ссылка на встречу Телемоста" : "Ссылка на комнату WB Stream"} hint={roomHelp[provider]}>
          <Input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            required
            className="font-mono"
            placeholder={provider === "telemost" ? "https://telemost.yandex.ru/j/…" : "https://stream.wb.ru/…"}
          />
        </Field>
      )}

      <Field label="Ключ шифрования" hint="64 hex-символа. Пусто — будет создан автоматически.">
        <div className="flex gap-2">
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="авто" className="font-mono text-xs" />
          <Button type="button" onClick={randomKey} icon={<KeyRound className="h-4 w-4" />}>
            Новый
          </Button>
        </div>
      </Field>

      {optionKeys.length > 0 && (
        <div>
          <div className="mb-1.5 text-sm font-medium">Параметры транспорта</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {optionKeys.map((k) => (
              <Field key={k} label={optionHints[k]?.label ?? k}>
                {k === "video-codec" || k === "video-qr-recovery" ? (
                  <Select value={options[k] ?? ""} onChange={(e) => setOptions({ ...options, [k]: e.target.value })}>
                    <option value="">по умолчанию</option>
                    {(k === "video-codec" ? ["qrcode", "tile"] : ["low", "medium", "high", "highest"]).map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    inputMode="numeric"
                    value={options[k] ?? ""}
                    onChange={(e) => setOptions({ ...options, [k]: e.target.value })}
                    placeholder={optionHints[k]?.placeholder}
                  />
                )}
              </Field>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setAdvanced(!advanced)}
      >
        {advanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Дополнительно
      </button>
      {advanced && (
        <div className="space-y-4 rounded-md border border-border p-4">
          <Field label="DNS" hint="через него сервер резолвит адреса сайтов">
            <Input value={dns} onChange={(e) => setDns(e.target.value)} />
          </Field>
          {provider === "wbstream" && (
            <Field label="Токен аккаунта WB Stream" hint="нужен только для DataChannel (права модератора); иначе гостевой вход">
              <Input value={token} onChange={(e) => setToken(e.target.value)} className="font-mono text-xs" />
            </Field>
          )}
          <div>
            <div className="mb-1.5 text-sm font-medium">Выходной SOCKS5-прокси</div>
            <p className="mb-2 text-xs text-muted-foreground">Если указан, сервер выходит в интернет через него, а не напрямую.</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Input className="sm:col-span-2" value={proxy.addr} onChange={(e) => setProxy({ ...proxy, addr: e.target.value })} placeholder="адрес" />
              <Input value={proxy.port} onChange={(e) => setProxy({ ...proxy, port: e.target.value })} placeholder="порт" inputMode="numeric" />
              <div />
              <Input value={proxy.user} onChange={(e) => setProxy({ ...proxy, user: e.target.value })} placeholder="логин" />
              <Input value={proxy.pass} onChange={(e) => setProxy({ ...proxy, pass: e.target.value })} placeholder="пароль" type="password" />
            </div>
          </div>
        </div>
      )}

      <Toggle checked={enabled} onChange={setEnabled} label="Локация включена" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {initial ? "Сохранить" : "Добавить"}
        </Button>
      </div>
    </form>
  );
}
