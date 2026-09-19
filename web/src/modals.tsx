import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ExternalLink, Pause, Play, RefreshCw } from "lucide-react";
import { api, type Client, type DayTraffic, type LogLine } from "./api";
import { TrafficChart } from "./TrafficChart";
import { Button, CopyButton, Modal, useToast } from "./ui";

export function QRImage({ text, size = 280 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [text, size]);
  return src ? (
    <img src={src} width={size} height={size} alt="QR-код" className="rounded-md bg-white p-2" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-md bg-muted" />
  );
}

export function QRModal({ title, text, hint, onClose }: { title: string; text: string; hint?: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <QRImage text={text} />
        {hint && <p className="text-center text-sm text-muted-foreground">{hint}</p>}
        <div className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{text}</code>
          <CopyButton text={text} />
        </div>
      </div>
    </Modal>
  );
}

export function SubscriptionModal({ client, onClose, onRotated }: { client: Client; onClose: () => void; onRotated: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState(client.sub_url);
  const [subText, setSubText] = useState("");
  // Prefetch the subscription body so "copy as text" works synchronously
  // (Safari drops clipboard writes that happen after an await).
  useEffect(() => {
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then(setSubText)
      .catch(() => setSubText(""));
  }, [url]);
  const active = client.status === "active" && client.locations.some((l) => l.enabled);
  const rotate = async () => {
    if (!window.confirm("Старая ссылка перестанет работать. Выдать новую?")) return;
    try {
      const res = await api.rotateSub(client.id);
      setUrl(res.sub_url);
      onRotated();
      toast("Ссылка подписки обновлена");
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title={`Подписка · ${client.name}`} onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <QRImage text={url} />
        <p className="text-center text-sm text-muted-foreground">
          Добавьте ссылку в клиент с поддержкой olcrtc (owenclave, olcbox). Подписка сама обновит список локаций и остаток трафика.
        </p>
        <div className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{url}</code>
          <CopyButton text={url} />
        </div>
        {!active && (
          <p className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            В подписке сейчас нет ни одной активной локации — olcbox её не примет. Добавьте клиенту включённую локацию
            {client.status !== "active" ? " и проверьте, что клиент активен (срок, лимит трафика)" : ""}.
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <a
            href={"olcbox://add?url=" + encodeURIComponent(url)}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ExternalLink className="h-4 w-4" />
            Открыть в olcbox
          </a>
          <CopyButton text={"olcbox://add?url=" + encodeURIComponent(url)} label="Ссылка для olcbox" />
          <Button size="sm" variant="ghost" onClick={rotate} icon={<RefreshCw className="h-4 w-4" />}>
            Выдать новую ссылку
          </Button>
        </div>
        {active && subText.includes("olcrtc://") && (
          <div className="w-full rounded-md border border-border p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Импорт без доступа к серверу</span>
              <CopyButton text={subText} label="Скопировать для olcbox" />
            </div>
            <p className="text-xs text-muted-foreground">
              Если телефон не может открыть ссылку подписки (мобильный интернет с белыми списками, сертификат), скопируйте
              подписку текстом и в olcbox выберите импорт из буфера обмена. Все локации добавятся сразу, но сами обновляться
              не будут — после изменений скопируйте заново.
            </p>
          </div>
        )}
        {!url.startsWith("https://") || !/\/\/[a-z]/i.test(url) ? (
          <p className="text-center text-xs text-warning">
            Адрес без домена и доверенного сертификата: в olcbox при импорте включите «Allow insecure requests». Надёжнее —
            домен с Let's Encrypt.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export function LogsModal({ locationId, title, onClose }: { locationId: number; title: string; onClose: () => void }) {
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
    <Modal title={`Логи · ${title}`} onClose={onClose} wide>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">последние {lines.length} строк, обновление раз в 2 с</span>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setPaused(!paused)} icon={paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}>
            {paused ? "Продолжить" : "Пауза"}
          </Button>
          <CopyButton text={text} label="Копировать" />
        </div>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-[60vh] overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-5"
      >
        {lines.length === 0 ? (
          <span className="text-muted-foreground">Логов пока нет.</span>
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
                      : undefined
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
  const [data, setData] = useState<DayTraffic[] | null>(null);
  const [days, setDays] = useState(30);
  useEffect(() => {
    api.clientTraffic(client.id, days).then(setData).catch(() => setData([]));
  }, [client.id, days]);
  return (
    <Modal title={`Трафик · ${client.name}`} onClose={onClose} wide>
      <div className="mb-4 flex gap-2">
        {[7, 30, 90].map((d) => (
          <Button key={d} size="sm" variant={d === days ? "primary" : "default"} onClick={() => setDays(d)}>
            {d} дн.
          </Button>
        ))}
      </div>
      {data ? <TrafficChart data={data} height={200} /> : <div className="h-52" />}
    </Modal>
  );
}
