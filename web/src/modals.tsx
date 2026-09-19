import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Ban, ExternalLink, Pause, Play, RefreshCw, Smartphone, Trash2, Undo2 } from "lucide-react";
import { api, type Client, type DayTraffic, type Device, type LogLine } from "./api";
import { ago, dateTime } from "./format";
import { useLang } from "./i18n";
import { TrafficChart } from "./TrafficChart";
import { Badge, Button, CopyButton, Empty, IconButton, Modal, cx, useConfirm, useToast } from "./ui";

export function QRImage({ text, size = 280 }: { text: string; size?: number }) {
  const { tr } = useLang();
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [text, size]);
  return src ? (
    <img src={src} width={size} height={size} alt={tr("QR-код", "QR code")} className="rounded-xl bg-white p-2" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-xl bg-muted" />
  );
}

export function QRModal({ title, text, hint, onClose }: { title: string; text: string; hint?: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <QRImage text={text} />
        {hint && <p className="text-center text-sm text-muted-foreground">{hint}</p>}
        <div className="flex w-full items-center gap-2 rounded-[10px] border border-border bg-background-2 px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{text}</code>
          <CopyButton text={text} />
        </div>
      </div>
    </Modal>
  );
}

export function SubscriptionModal({ client, onClose, onRotated }: { client: Client; onClose: () => void; onRotated: () => void }) {
  const { tr } = useLang();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [url, setUrl] = useState(client.sub_url);
  const [subText, setSubText] = useState("");
  const limited = client.max_devices > 0;
  // Prefetch the subscription body so "copy as text" works synchronously
  // (Safari drops clipboard writes that happen after an await). Clients with
  // a device limit refuse requests without an app HWID, by design.
  useEffect(() => {
    if (limited) return;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then(setSubText)
      .catch(() => setSubText(""));
  }, [url, limited]);
  const active = client.status === "active" && client.locations.some((l) => l.enabled);
  const deepLink = "olcbox://add?url=" + encodeURIComponent(url);

  const rotate = async () => {
    if (!(await confirm(tr("Старая ссылка перестанет работать. Выдать новую?", "The old link will stop working. Issue a new one?")))) return;
    try {
      const res = await api.rotateSub(client.id);
      setUrl(res.sub_url);
      onRotated();
      toast(tr("Ссылка подписки обновлена", "Subscription link changed"));
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <Modal title={`${tr("Подписка", "Subscription")} · ${client.name}`} onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <QRImage text={url} />
        <p className="text-center text-sm text-muted-foreground">
          {tr(
            "Добавьте ссылку в приложение olcbox. Подписка сама обновит список локаций и остаток трафика.",
            "Add the link to the olcbox app. The subscription keeps locations and remaining traffic up to date.",
          )}
        </p>
        {!active && (
          <p className="w-full rounded-[10px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {tr(
              "В подписке сейчас нет ни одной активной локации — olcbox её не примет. Добавьте включённую локацию и проверьте срок и лимит трафика.",
              "The subscription has no active location, olcbox will reject it. Add an enabled location and check expiry and traffic limit.",
            )}
          </p>
        )}
        <div className="flex w-full items-center gap-2 rounded-[10px] border border-border bg-background-2 px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{url}</code>
          <CopyButton text={url} />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <a
            href={deepLink}
            className="inline-flex h-8 items-center gap-2 rounded-[10px] bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ExternalLink className="h-4 w-4" />
            {tr("Открыть в olcbox", "Open in olcbox")}
          </a>
          <CopyButton text={deepLink} label={tr("Ссылка для olcbox", "olcbox link")} />
          <Button size="sm" variant="ghost" onClick={rotate} icon={<RefreshCw className="h-4 w-4" />}>
            {tr("Выдать новую ссылку", "Issue a new link")}
          </Button>
        </div>
        {limited ? (
          <p className="w-full text-center text-xs text-dim">
            {tr(
              `Лимит устройств: ${client.devices} из ${client.max_devices}. Подписку можно добавить только в приложении olcbox.`,
              `Device limit: ${client.devices} of ${client.max_devices}. The subscription can be added in the olcbox app only.`,
            )}
          </p>
        ) : (
          active &&
          subText.includes("olcrtc://") && (
            <div className="w-full rounded-[10px] border border-border p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{tr("Импорт без доступа к серверу", "Import without server access")}</span>
                <CopyButton text={subText} label={tr("Скопировать для olcbox", "Copy for olcbox")} />
              </div>
              <p className="text-xs text-dim">
                {tr(
                  "Если телефон не открывает ссылку (белые списки в мобильной сети, сертификат), скопируйте подписку текстом и импортируйте в olcbox из буфера обмена. Такие локации сами не обновляются.",
                  "If the phone cannot open the link (whitelisted mobile network, certificate), copy the subscription as text and import it in olcbox from the clipboard. Such locations do not auto-update.",
                )}
              </p>
            </div>
          )
        )}
        {!url.startsWith("https://") && (
          <p className="text-center text-xs text-warning">
            {tr(
              "Панель без HTTPS: в olcbox при импорте включите «Allow insecure requests». Надёжнее — сертификат Let's Encrypt (меню olc-ui на сервере).",
              "The panel has no HTTPS: enable \"Allow insecure requests\" in olcbox. Better: a Let's Encrypt certificate (olc-ui menu on the server).",
            )}
          </p>
        )}
      </div>
      {dialog}
    </Modal>
  );
}

export function DevicesModal({ client, onClose, onChanged }: { client: Client; onClose: () => void; onChanged: () => void }) {
  const { tr, lang } = useLang();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const load = () =>
    api
      .devices(client.id)
      .then(setDevices)
      .catch(() => setDevices([]));
  useEffect(() => {
    load();
  }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (d: Device, action: "block" | "unblock" | "delete") => {
    if (action === "delete" && !(await confirm(tr("Забыть устройство? Место освободится, устройство сможет добавить подписку снова.", "Forget this device? The slot is freed and it may add the subscription again."))))
      return;
    if (action === "block" && !(await confirm(tr("Заблокировать устройство? Оно не сможет обновлять подписку.", "Block this device? It will not be able to refresh the subscription."))))
      return;
    try {
      await api.deviceAction(client.id, d.hwid, action);
      await load();
      onChanged();
      toast(tr("Готово", "Done"));
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <Modal title={`${tr("Устройства", "Devices")} · ${client.name}`} onClose={onClose} wide>
      <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-[10px] border border-border bg-background-2 px-3 py-2">
          <div className="text-xs text-dim">{tr("Лимит устройств (подписка)", "Device limit (subscription)")}</div>
          <div className="tabular font-semibold">
            {client.devices} / {client.max_devices || "∞"}
          </div>
        </div>
        <div className="rounded-[10px] border border-border bg-background-2 px-3 py-2">
          <div className="text-xs text-dim">{tr("Одновременных подключений", "Simultaneous connections")}</div>
          <div className="tabular font-semibold">
            {client.locations.reduce((n, l) => n + l.runtime.peers.length, 0)} / {client.max_conns || "∞"}
          </div>
        </div>
      </div>
      {devices === null ? (
        <div className="h-32" />
      ) : devices.length === 0 ? (
        <Empty icon={<Smartphone className="h-8 w-8" />} title={tr("Устройств пока нет", "No devices yet")}>
          {tr("Устройство появится здесь, когда olcbox впервые загрузит подписку.", "A device shows up here once olcbox downloads the subscription.")}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{tr("Устройство", "Device")}</th>
                <th className="px-3 py-2 font-medium">{tr("Приложение", "App")}</th>
                <th className="px-3 py-2 font-medium">IP</th>
                <th className="px-3 py-2 font-medium">{tr("Последний раз", "Last seen")}</th>
                <th className="px-3 py-2 text-right font-medium">{tr("Действия", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.hwid} className={cx("border-b border-border/60 last:border-0", d.blocked && "opacity-70")}>
                  <td className="px-3 py-2.5">
                    <div className="font-mono text-xs" title={d.hwid}>
                      {d.hwid.replace(/^install-/, "").slice(0, 12)}
                    </div>
                    <div className="text-[11px] text-dim">
                      {tr("с", "since")} {dateTime(d.first_seen, lang)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{d.user_agent || "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{d.ip || "—"}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {d.blocked ? <Badge tone="destructive">{tr("Заблокировано", "Blocked")}</Badge> : ago(d.last_seen, lang)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-0.5">
                      {d.blocked ? (
                        <IconButton title={tr("Разблокировать", "Unblock")} onClick={() => act(d, "unblock")}>
                          <Undo2 className="h-4 w-4" />
                        </IconButton>
                      ) : (
                        <IconButton title={tr("Заблокировать", "Block")} onClick={() => act(d, "block")}>
                          <Ban className="h-4 w-4" />
                        </IconButton>
                      )}
                      <IconButton title={tr("Забыть устройство", "Forget device")} className="hover:text-destructive" onClick={() => act(d, "delete")}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-dim">
        {tr(
          "Устройства определяются по идентификатору установки olcbox при загрузке подписки. Лимит одновременных подключений действует на туннель и считает разные устройства.",
          "Devices are identified by the olcbox install ID on subscription download. The simultaneous connection limit applies to the tunnel and counts distinct devices.",
        )}
      </p>
      {dialog}
    </Modal>
  );
}

export function LogsModal({ locationId, title, onClose }: { locationId: number; title: string; onClose: () => void }) {
  const { tr } = useLang();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .logs(locationId)
        .then((l) => alive && setLines(l))
        .catch(() => {});
    load();
    if (paused) return () => void (alive = false);
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [locationId, paused]);

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  const text = lines.map((l) => l.line).join("\n");
  return (
    <Modal title={`${tr("Логи", "Logs")} · ${title}`} onClose={onClose} wide>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-dim">{tr(`последние ${lines.length} строк, обновление раз в 2 с`, `last ${lines.length} lines, refreshed every 2 s`)}</span>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setPaused(!paused)} icon={paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}>
            {paused ? tr("Продолжить", "Resume") : tr("Пауза", "Pause")}
          </Button>
          <CopyButton text={text} label={tr("Копировать", "Copy")} />
        </div>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-[60vh] overflow-auto rounded-[10px] border border-border bg-background-2 p-3 font-mono text-xs leading-5"
      >
        {lines.length === 0 ? (
          <span className="text-dim">{tr("Логов пока нет.", "No logs yet.")}</span>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              className={
                l.line.startsWith("[olc-ui]")
                  ? "text-primary"
                  : /error|failed|fatal/i.test(l.line)
                    ? "text-destructive"
                    : /warn/i.test(l.line)
                      ? "text-warning"
                      : "text-muted-foreground"
              }
            >
              {l.line}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

export function ClientTrafficModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const { tr } = useLang();
  const [data, setData] = useState<DayTraffic[] | null>(null);
  const [days, setDays] = useState(30);
  useEffect(() => {
    api.clientTraffic(client.id, days).then(setData).catch(() => setData([]));
  }, [client.id, days]);
  return (
    <Modal title={`${tr("Трафик", "Traffic")} · ${client.name}`} onClose={onClose} wide>
      <div className="mb-4 flex gap-2">
        {[7, 30, 90].map((d) => (
          <Button key={d} size="sm" variant={d === days ? "primary" : "default"} onClick={() => setDays(d)}>
            {d} {tr("дн.", "days")}
          </Button>
        ))}
      </div>
      {data ? <TrafficChart data={data} height={200} /> : <div className="h-52" />}
    </Modal>
  );
}
