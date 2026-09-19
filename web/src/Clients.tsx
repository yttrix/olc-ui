import { Fragment, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronRight,
  CircleSlash,
  Edit3,
  KeyRound,
  Link2,
  MoreHorizontal,
  PieChart,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Shuffle,
  Smartphone,
  Terminal,
  TimerOff,
  Trash2,
  Users,
} from "lucide-react";
import { api, type Client, type ClientStatus, type Location, type Meta } from "./api";
import { ago, bytes, daysLeft, providerLabel, rate, statusLabel, transportLabel } from "./format";
import { ClientForm, LocationForm } from "./forms";
import { useLang } from "./i18n";
import { ClientTrafficModal, DevicesModal, LogsModal, QRModal, SubscriptionModal } from "./modals";
import {
  Badge,
  Button,
  Card,
  CopyButton,
  Empty,
  IconButton,
  Input,
  Modal,
  PanelHeader,
  Pill,
  Progress,
  ProviderMark,
  Select,
  SortHeader,
  StatCard,
  cx,
  useConfirm,
  useToast,
} from "./ui";

type Dialog =
  | { kind: "createClient" }
  | { kind: "editClient"; client: Client }
  | { kind: "createLocation"; client: Client; step2?: boolean }
  | { kind: "editLocation"; location: Location }
  | { kind: "qr"; location: Location }
  | { kind: "sub"; client: Client }
  | { kind: "logs"; location: Location }
  | { kind: "traffic"; client: Client }
  | { kind: "devices"; client: Client };

type SortKey = "name" | "status" | "expires" | "traffic" | "devices" | "online";

const statusTone = { active: "success", disabled: "muted", expired: "destructive", traffic_exceeded: "warning" } as const;
const statusIcon = {
  active: <Activity />,
  disabled: <CircleSlash />,
  expired: <TimerOff />,
  traffic_exceeded: <PieChart />,
};
const statusOrder: Record<ClientStatus, number> = { active: 0, traffic_exceeded: 1, expired: 2, disabled: 3 };

export function Clients({
  clients,
  meta,
  defaultJitsi,
  reload,
}: {
  clients: Client[];
  meta: Meta | null;
  defaultJitsi: string;
  reload: () => Promise<void>;
}) {
  const { tr, lang } = useLang();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const close = () => setDialog(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: clients.length };
    clients.forEach((x) => (c[x.status] = (c[x.status] ?? 0) + 1));
    return c;
  }, [clients]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const peersOf = (c: Client) => c.locations.reduce((n, l) => n + l.runtime.peers.length, 0);
    const list = clients.filter(
      (c) =>
        (!statusFilter || c.status === statusFilter) &&
        (!providerFilter || c.locations.some((l) => l.endpoint.provider === providerFilter)) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.note.toLowerCase().includes(q) ||
          c.locations.some((l) => l.name.toLowerCase().includes(q) || l.endpoint.room.toLowerCase().includes(q))),
    );
    const val = (c: Client): number | string => {
      switch (sort.key) {
        case "name":
          return c.name.toLowerCase();
        case "status":
          return statusOrder[c.status];
        case "expires":
          return c.expires_at || "9999";
        case "traffic":
          return c.used_bytes;
        case "devices":
          return c.devices;
        case "online":
          return peersOf(c) > 0 ? Number.MAX_SAFE_INTEGER : c.last_online;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [clients, query, statusFilter, providerFilter, sort]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await reload();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const ask = async (text: string, fn: () => Promise<unknown>, ok: string) => {
    if (await confirm(text)) await run(fn, ok);
  };

  const headers: [string, SortKey | null][] = [
    [tr("Клиент", "Client"), "name"],
    [tr("Статус", "Status"), "status"],
    [tr("Подключения", "Connections"), null],
    [tr("Истекает", "Expires"), "expires"],
    [tr("Трафик", "Traffic"), "traffic"],
    [tr("Устройства", "Devices"), "devices"],
    [tr("Онлайн", "Online"), "online"],
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={<Users />} label={tr("Всего", "Total")} value={counts.all} />
        <StatCard icon={<Activity />} tone="success" label={tr("Активны", "Active")} value={counts.active ?? 0} />
        <StatCard icon={<TimerOff />} tone="destructive" label={tr("Истёк срок", "Expired")} value={counts.expired ?? 0} />
        <StatCard icon={<PieChart />} tone="warning" label={tr("Лимит трафика", "Traffic limit")} value={counts.traffic_exceeded ?? 0} />
        <StatCard icon={<CircleSlash />} tone="muted" label={tr("Отключены", "Disabled")} value={counts.disabled ?? 0} />
      </div>

      <Card className="mt-4">
        <PanelHeader icon={<Users />} title={tr("Клиенты", "Clients")}>
          <IconButton title={tr("Обновить", "Refresh")} tone="primary" onClick={() => run(reload, tr("Обновлено", "Refreshed"))}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
          <IconButton title={tr("Новый клиент", "New client")} tone="success" onClick={() => setDialog({ kind: "createClient" })}>
            <Plus className="h-4 w-4" />
          </IconButton>
        </PanelHeader>

        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-dim" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Поиск по имени, заметке, комнате", "Search name, note, room")} className="pl-8" />
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-52">
            <option value="">{tr("Все статусы", "All statuses")}</option>
            {(["active", "expired", "traffic_exceeded", "disabled"] as const).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s, lang)}
              </option>
            ))}
          </Select>
          <Select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="sm:w-52">
            <option value="">{tr("Все сервисы", "All services")}</option>
            {(meta?.providers ?? ["wbstream", "telemost", "jitsi"]).map((p) => (
              <option key={p} value={p}>
                {providerLabel(p, lang)}
              </option>
            ))}
          </Select>
        </div>

        {clients.length === 0 ? (
          <Empty icon={<Users className="h-8 w-8" />} title={tr("Клиентов пока нет", "No clients yet")}>
            {tr(
              "Создайте клиента и добавьте ему подключение: WB Stream, Телемост или Jitsi. Панель сама запустит туннель и выдаст ссылку подписки.",
              "Create a client and add a connection: WB Stream, Telemost or Jitsi. The panel starts the tunnel and issues a subscription link.",
            )}
            <div className="mt-4">
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ kind: "createClient" })}>
                {tr("Создать клиента", "Create client")}
              </Button>
            </div>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="w-8" />
                  {headers.map(([label, key]) =>
                    key ? (
                      <SortHeader key={label} label={label} k={key} sort={sort} setSort={setSort} />
                    ) : (
                      <th key={label} className="px-3 py-2.5 font-medium">
                        {label}
                      </th>
                    ),
                  )}
                  <th className="px-3 py-2.5 text-right font-medium">{tr("Действия", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const isOpen = open[c.id] ?? false;
                  const peers = c.locations.reduce((n, l) => n + l.runtime.peers.length, 0);
                  const left = daysLeft(c.expires_at);
                  const usage = c.traffic_limit ? (c.used_bytes / c.traffic_limit) * 100 : 0;
                  const providers = [...new Set(c.locations.map((l) => l.endpoint.provider))];
                  const speed = c.locations.reduce((n, l) => n + l.runtime.rate_down, 0);
                  return (
                    <Fragment key={c.id}>
                      <tr
                        className={cx("cursor-pointer border-b border-border/60 transition-colors hover:bg-primary/[0.03]", isOpen && "bg-primary/[0.03]")}
                        onClick={() => setOpen({ ...open, [c.id]: !isOpen })}
                      >
                        <td className="pl-3 text-dim">
                          <ChevronRight className={cx("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span
                              className={cx(
                                "h-2.5 w-2.5 shrink-0 rounded-full",
                                peers > 0 ? "bg-success shadow-[0_0_10px_hsl(var(--success)/0.7)]" : "bg-destructive/80",
                              )}
                            />
                            <div className="min-w-0">
                              <div className="truncate font-semibold">{c.name}</div>
                              <div className="truncate text-xs text-dim">{c.note || (peers > 0 ? tr("в сети", "online") : ago(c.last_online, lang))}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <Pill tone={statusTone[c.status]} icon={statusIcon[c.status]}>
                            {statusLabel(c.status, lang)}
                          </Pill>
                        </td>
                        <td className="px-3 py-2.5">
                          {providers.length ? (
                            <span className="inline-flex flex-wrap gap-3">
                              {providers.map((p) => (
                                <ProviderMark key={p} provider={p} withName />
                              ))}
                            </span>
                          ) : (
                            <span className="text-dim">{tr("нет", "none")}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {left === null ? (
                            <span className="text-dim">{tr("бессрочно", "never")}</span>
                          ) : left < 0 ? (
                            <span className="text-destructive">{tr(`истёк ${-left} дн. назад`, `${-left}d ago`)}</span>
                          ) : (
                            <span className={left <= 3 ? "text-warning" : "text-muted-foreground"}>{tr(`через ${left} дн.`, `in ${left}d`)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="tabular text-xs">
                            {bytes(c.used_bytes, lang)} <span className="text-dim">/ {c.traffic_limit ? bytes(c.traffic_limit, lang) : "∞"}</span>
                          </div>
                          {c.traffic_limit > 0 && (
                            <div className="mt-1.5 w-32">
                              <Progress value={usage} tone={usage >= 100 ? "destructive" : usage >= 85 ? "warning" : "primary"} />
                            </div>
                          )}
                        </td>
                        <td className="tabular px-3 py-2.5 text-xs">
                          <span className={c.max_devices && c.devices >= c.max_devices ? "text-warning" : undefined}>{c.devices}</span>
                          <span className="text-dim"> / {c.max_devices || "∞"}</span>
                        </td>
                        <td className="tabular px-3 py-2.5 text-xs">
                          {peers > 0 ? (
                            <span className="text-success">
                              {peers} · {rate(speed, lang)}
                            </span>
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-0.5">
                            <Button size="sm" onClick={() => setDialog({ kind: "sub", client: c })} icon={<Link2 className="h-4 w-4" />}>
                              {tr("Подписка", "Subscription")}
                            </Button>
                            <IconButton title={tr("Устройства", "Devices")} onClick={() => setDialog({ kind: "devices", client: c })}>
                              <Smartphone className="h-4 w-4" />
                            </IconButton>
                            <IconButton title={tr("Трафик по дням", "Daily traffic")} onClick={() => setDialog({ kind: "traffic", client: c })}>
                              <BarChart3 className="h-4 w-4" />
                            </IconButton>
                            <IconButton title={tr("Изменить", "Edit")} onClick={() => setDialog({ kind: "editClient", client: c })}>
                              <Edit3 className="h-4 w-4" />
                            </IconButton>
                            <ClientMenu
                              onReset={() => ask(tr(`Обнулить трафик клиента «${c.name}»?`, `Reset traffic of "${c.name}"?`), () => api.resetUsage(c.id), tr("Трафик обнулён", "Traffic reset"))}
                              onDelete={() =>
                                ask(
                                  tr(`Удалить клиента «${c.name}» со всеми локациями? Туннели будут остановлены.`, `Delete "${c.name}" with all locations? Tunnels will stop.`),
                                  () => api.deleteClient(c.id),
                                  tr("Клиент удалён", "Client deleted"),
                                )
                              }
                            />
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-border/60 bg-background-2/60">
                          <td colSpan={9} className="px-4 py-3">
                            <LocationsTable
                              locations={c.locations}
                              onAdd={() => setDialog({ kind: "createLocation", client: c })}
                              onEdit={(l) => setDialog({ kind: "editLocation", location: l })}
                              onQR={(l) => setDialog({ kind: "qr", location: l })}
                              onLogs={(l) => setDialog({ kind: "logs", location: l })}
                              onRestart={(l) => run(() => api.restartLocation(l.id), tr("Перезапускаю", "Restarting"))}
                              onRotateKey={(l) =>
                                ask(tr("Сгенерировать новый ключ? Клиенту нужно будет обновить подписку.", "Generate a new key? The client must refresh the subscription."), () => api.rotateKey(l.id), tr("Ключ обновлён", "Key rotated"))
                              }
                              onNewRoom={(l) =>
                                ask(tr("Создать новую комнату Jitsi? Клиенту нужно будет обновить подписку.", "Create a new Jitsi room? The client must refresh the subscription."), () => api.newRoom(l.id), tr("Комната обновлена", "Room changed"))
                              }
                              onDelete={(l) => ask(tr(`Удалить локацию «${l.name || l.endpoint.room}»?`, `Delete location "${l.name || l.endpoint.room}"?`), () => api.deleteLocation(l.id), tr("Локация удалена", "Location deleted"))}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{tr("Ничего не найдено.", "Nothing found.")}</p>}
          </div>
        )}
      </Card>

      {dialog?.kind === "createClient" && (
        <Modal title={tr("Новый клиент · шаг 1 из 2", "New client · step 1 of 2")} onClose={close}>
          <ClientForm
            onCancel={close}
            onSubmit={async (input) => {
              const created = await api.createClient(input);
              await reload();
              setOpen((o) => ({ ...o, [created.id]: true }));
              setDialog({ kind: "createLocation", client: created, step2: true });
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "editClient" && (
        <Modal title={`${tr("Клиент", "Client")} · ${dialog.client.name}`} onClose={close}>
          <ClientForm
            initial={dialog.client}
            onCancel={close}
            onSubmit={async (input) => {
              await api.updateClient(dialog.client.id, input);
              await reload();
              toast(tr("Сохранено", "Saved"));
              close();
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "createLocation" && meta && (
        <Modal
          title={
            dialog.step2
              ? tr(`Шаг 2 из 2 · подключение для «${dialog.client.name}»`, `Step 2 of 2 · connection for "${dialog.client.name}"`)
              : `${tr("Новая локация", "New location")} · ${dialog.client.name}`
          }
          onClose={close}
          wide
        >
          <LocationForm
            meta={meta}
            defaultJitsi={defaultJitsi}
            onCancel={close}
            onSubmit={async (input) => {
              await api.createLocation(dialog.client.id, input);
              await reload();
              toast(tr("Локация добавлена, туннель запускается", "Location added, tunnel is starting"));
              close();
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "editLocation" && meta && (
        <Modal title={`${tr("Локация", "Location")} · ${dialog.location.name || dialog.location.endpoint.room}`} onClose={close} wide>
          <LocationForm
            meta={meta}
            initial={dialog.location}
            defaultJitsi={defaultJitsi}
            onCancel={close}
            onSubmit={async (input) => {
              await api.updateLocation(dialog.location.id, input);
              await reload();
              toast(tr("Сохранено, туннель перезапускается", "Saved, tunnel is restarting"));
              close();
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "qr" && (
        <QRModal
          title={`${tr("Ссылка", "Link")} · ${dialog.location.name || providerLabel(dialog.location.endpoint.provider, lang)}`}
          text={dialog.location.uri}
          hint={tr("Одна локация в формате olcrtc://. Для нескольких локаций удобнее подписка.", "A single location as olcrtc://. A subscription is handier for several locations.")}
          onClose={close}
        />
      )}
      {dialog?.kind === "sub" && <SubscriptionModal client={dialog.client} onClose={close} onRotated={reload} />}
      {dialog?.kind === "logs" && <LogsModal locationId={dialog.location.id} title={dialog.location.name || dialog.location.endpoint.room} onClose={close} />}
      {dialog?.kind === "traffic" && <ClientTrafficModal client={dialog.client} onClose={close} />}
      {dialog?.kind === "devices" && <DevicesModal client={dialog.client} onClose={close} onChanged={reload} />}
      {confirmDialog}
    </>
  );
}

function ClientMenu({ onReset, onDelete }: { onReset: () => void; onDelete: () => void }) {
  const { tr } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconButton title={tr("Ещё", "More")} onClick={() => setOpen(!open)}>
        <MoreHorizontal className="h-4 w-4" />
      </IconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-[10px] border border-border-strong bg-card p-1 shadow-xl">
            <MenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={() => (setOpen(false), onReset())}>
              {tr("Обнулить трафик", "Reset traffic")}
            </MenuItem>
            <MenuItem icon={<Trash2 className="h-4 w-4" />} danger onClick={() => (setOpen(false), onDelete())}>
              {tr("Удалить клиента", "Delete client")}
            </MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon, children, danger, onClick }: { icon: React.ReactNode; children: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted", danger && "text-destructive")}>
      {icon}
      {children}
    </button>
  );
}

function LocationsTable({
  locations,
  onAdd,
  onEdit,
  onQR,
  onLogs,
  onRestart,
  onRotateKey,
  onNewRoom,
  onDelete,
}: {
  locations: Location[];
  onAdd: () => void;
  onEdit: (l: Location) => void;
  onQR: (l: Location) => void;
  onLogs: (l: Location) => void;
  onRestart: (l: Location) => void;
  onRotateKey: (l: Location) => void;
  onNewRoom: (l: Location) => void;
  onDelete: (l: Location) => void;
}) {
  const { tr, lang } = useLang();
  const state = (l: Location) => {
    const rt = l.runtime;
    if (rt.status === "running")
      return rt.peers.length ? (
        <Badge tone="success">{tr(`Подключено: ${rt.peers.length}`, `Connected: ${rt.peers.length}`)}</Badge>
      ) : (
        <Badge tone="muted">{tr("Ждёт клиента", "Waiting for client")}</Badge>
      );
    if (rt.status === "restarting") return <Badge tone="warning">{tr("Перезапуск", "Restarting")}</Badge>;
    return <Badge tone={rt.reason === "disabled" ? "muted" : "destructive"}>{statusLabel(rt.reason ?? "stopped", lang)}</Badge>;
  };
  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-card">
      {locations.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">{tr("Локация", "Location")}</th>
              <th className="px-3 py-2 font-medium">{tr("Канал", "Channel")}</th>
              <th className="px-3 py-2 font-medium">{tr("Комната", "Room")}</th>
              <th className="px-3 py-2 font-medium">{tr("Состояние", "State")}</th>
              <th className="px-3 py-2 text-right font-medium">{tr("Скорость", "Speed")}</th>
              <th className="px-3 py-2 text-right font-medium">{tr("Действия", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id} className={cx("border-b border-border/60 last:border-0", !l.enabled && "opacity-60")}>
                <td className="px-3 py-2.5 font-medium">{l.name || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <ProviderMark provider={l.endpoint.provider} withName />
                    <span className="text-muted-foreground">· {transportLabel[l.endpoint.transport]}</span>
                  </span>
                </td>
                <td className="max-w-[220px] px-3 py-2.5">
                  <span className="block truncate font-mono text-xs text-muted-foreground" title={l.endpoint.room}>
                    {l.endpoint.room.replace(/^https:\/\//, "")}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    {state(l)}
                    {l.runtime.status === "running" && (l.runtime.rtt_ms || l.runtime.restarts) ? (
                      <span className="text-[11px] text-dim">
                        {l.runtime.rtt_ms ? `RTT ${l.runtime.rtt_ms} ms` : ""}
                        {l.runtime.restarts ? ` · ${tr("перезапусков", "restarts")} ${l.runtime.restarts}` : ""}
                      </span>
                    ) : null}
                    {l.runtime.status === "restarting" && l.runtime.last_error && (
                      <span className="max-w-[260px] truncate text-[11px] text-destructive" title={l.runtime.last_error}>
                        {l.runtime.last_error}
                      </span>
                    )}
                  </div>
                </td>
                <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-xs">
                  <span className="inline-flex items-center gap-1 text-primary">
                    <ArrowDown className="h-3 w-3" />
                    {rate(l.runtime.rate_down, lang)}
                  </span>
                  <span className="inline-flex items-center gap-1 pl-2 text-muted-foreground">
                    <ArrowUp className="h-3 w-3" />
                    {rate(l.runtime.rate_up, lang)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-0.5">
                    <CopyButton text={l.uri} />
                    <IconButton title={tr("QR-код", "QR code")} onClick={() => onQR(l)}>
                      <QrCode className="h-4 w-4" />
                    </IconButton>
                    <IconButton title={tr("Логи", "Logs")} onClick={() => onLogs(l)}>
                      <Terminal className="h-4 w-4" />
                    </IconButton>
                    <IconButton title={tr("Перезапустить", "Restart")} onClick={() => onRestart(l)}>
                      <RefreshCw className="h-4 w-4" />
                    </IconButton>
                    <IconButton title={tr("Новый ключ", "New key")} onClick={() => onRotateKey(l)}>
                      <KeyRound className="h-4 w-4" />
                    </IconButton>
                    {l.endpoint.provider === "jitsi" && (
                      <IconButton title={tr("Новая комната", "New room")} onClick={() => onNewRoom(l)}>
                        <Shuffle className="h-4 w-4" />
                      </IconButton>
                    )}
                    <IconButton title={tr("Изменить", "Edit")} onClick={() => onEdit(l)}>
                      <Edit3 className="h-4 w-4" />
                    </IconButton>
                    <IconButton title={tr("Удалить", "Delete")} className="hover:text-destructive" onClick={() => onDelete(l)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        onClick={onAdd}
        className={cx(
          "flex w-full items-center justify-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
          locations.length > 0 && "border-t border-border",
        )}
      >
        <Plus className="h-4 w-4" />
        {locations.length === 0
          ? tr("Добавить подключение: WB Stream, Телемост или Jitsi", "Add a connection: WB Stream, Telemost or Jitsi")
          : tr("Добавить локацию", "Add location")}
      </button>
    </div>
  );
}
