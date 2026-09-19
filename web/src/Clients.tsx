import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Edit3,
  KeyRound,
  Link2,
  MoreHorizontal,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Shuffle,
  Terminal,
  Trash2,
  Users,
} from "lucide-react";
import { api, type Client, type Location, type Meta } from "./api";
import { bytes, daysLeft, providerLabel, rate, since, statusLabel, transportLabel } from "./format";
import { ClientForm, LocationForm } from "./forms";
import { ClientTrafficModal, LogsModal, QRModal, SubscriptionModal } from "./modals";
import { Badge, Button, Card, CopyButton, Empty, IconButton, Input, Modal, Progress, cx, useConfirm, useToast } from "./ui";

type Dialog =
  | { kind: "createClient" }
  | { kind: "editClient"; client: Client }
  | { kind: "createLocation"; client: Client; step2?: boolean }
  | { kind: "editLocation"; location: Location }
  | { kind: "qr"; location: Location }
  | { kind: "sub"; client: Client }
  | { kind: "logs"; location: Location }
  | { kind: "traffic"; client: Client };

const clientTone = { active: "ok", disabled: "muted", expired: "bad", traffic_exceeded: "bad" } as const;

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
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [query, setQuery] = useState("");
  const close = () => setDialog(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.note.toLowerCase().includes(q) ||
        c.locations.some((l) => l.name.toLowerCase().includes(q) || l.endpoint.room.toLowerCase().includes(q)),
    );
  }, [clients, query]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await reload();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const del = async (text: string, fn: () => Promise<unknown>, ok: string) => {
    if (await confirm(text)) await run(fn, ok);
  };

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="font-semibold">Клиенты</h2>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск" className="pl-8" />
            </div>
            <Button variant="primary" onClick={() => setDialog({ kind: "createClient" })} icon={<Plus className="h-4 w-4" />}>
              Клиент
            </Button>
          </div>
        </div>

        {clients.length === 0 ? (
          <Empty icon={<Users className="h-8 w-8" />} title="Клиентов пока нет">
            Создайте клиента и добавьте ему локацию: сервис звонков (WB Stream, Телемост или Jitsi), транспорт и комнату. Панель сама
            запустит туннель и выдаст ссылку подписки.
          </Empty>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((c) => {
              const open = !collapsed[c.id];
              const running = c.locations.filter((l) => l.runtime.status === "running").length;
              const peers = c.locations.reduce((n, l) => n + l.runtime.peers.length, 0);
              const left = daysLeft(c.expires_at);
              const usage = c.traffic_limit ? (c.used_bytes / c.traffic_limit) * 100 : 0;
              return (
                <div key={c.id}>
                  <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-center">
                    <button
                      className="flex min-w-0 items-center gap-3 text-left"
                      onClick={() => setCollapsed({ ...collapsed, [c.id]: open })}
                      aria-expanded={open}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground">
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold">{c.name}</span>
                          <Badge tone={clientTone[c.status]}>{statusLabel[c.status]}</Badge>
                          {peers > 0 && <Badge tone="ok">{peers} онлайн</Badge>}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {running}/{c.locations.length} локаций работают
                          {c.speed_mbps ? ` · ${c.speed_mbps} Мбит/с` : ""}
                          {left !== null ? ` · ${left >= 0 ? `ещё ${left} дн.` : "срок истёк"}` : ""}
                          {c.note ? ` · ${c.note}` : ""}
                        </span>
                      </span>
                    </button>

                    <div className="tabular space-y-1.5 text-xs">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Трафик</span>
                        <span>
                          <span className="text-foreground">{bytes(c.used_bytes)}</span>
                          {c.traffic_limit ? ` из ${bytes(c.traffic_limit)}` : " · без лимита"}
                        </span>
                      </div>
                      <Progress value={c.traffic_limit ? usage : 0} tone={usage >= 100 ? "bad" : usage >= 85 ? "warn" : "ok"} />
                    </div>

                    <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                      <Button size="sm" onClick={() => setDialog({ kind: "sub", client: c })} icon={<Link2 className="h-4 w-4" />}>
                        Подписка
                      </Button>
                      <IconButton title="Трафик по дням" onClick={() => setDialog({ kind: "traffic", client: c })}>
                        <BarChart3 className="h-4 w-4" />
                      </IconButton>
                      <IconButton title="Изменить" onClick={() => setDialog({ kind: "editClient", client: c })}>
                        <Edit3 className="h-4 w-4" />
                      </IconButton>
                      <ClientMenu
                        onReset={() => del(`Обнулить счётчик трафика клиента «${c.name}»?`, () => api.resetUsage(c.id), "Трафик обнулён")}
                        onDelete={() =>
                          del(`Удалить клиента «${c.name}» со всеми локациями? Туннели будут остановлены.`, () => api.deleteClient(c.id), "Клиент удалён")
                        }
                      />
                    </div>
                  </div>

                  {open && (
                    <div className="px-4 pb-4">
                      <LocationsTable
                        locations={c.locations}
                        onAdd={() => setDialog({ kind: "createLocation", client: c })}
                        onEdit={(l) => setDialog({ kind: "editLocation", location: l })}
                        onQR={(l) => setDialog({ kind: "qr", location: l })}
                        onLogs={(l) => setDialog({ kind: "logs", location: l })}
                        onRestart={(l) => run(() => api.restartLocation(l.id), "Перезапускаю")}
                        onRotateKey={(l) =>
                          del("Сгенерировать новый ключ? Клиентам нужно будет обновить подписку.", () => api.rotateKey(l.id), "Ключ обновлён")
                        }
                        onNewRoom={(l) =>
                          del("Создать новую комнату Jitsi? Клиентам нужно будет обновить подписку.", () => api.newRoom(l.id), "Комната обновлена")
                        }
                        onDelete={(l) => del(`Удалить локацию «${l.name || l.endpoint.room}»?`, () => api.deleteLocation(l.id), "Локация удалена")}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Ничего не найдено.</p>}
          </div>
        )}
      </Card>

      {dialog?.kind === "createClient" && (
        <Modal title="Новый клиент · шаг 1 из 2" onClose={close}>
          <ClientForm
            onCancel={close}
            onSubmit={async (input) => {
              const created = await api.createClient(input);
              await reload();
              setDialog({ kind: "createLocation", client: created, step2: true });
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "editClient" && (
        <Modal title={`Клиент · ${dialog.client.name}`} onClose={close}>
          <ClientForm
            initial={dialog.client}
            onCancel={close}
            onSubmit={async (input) => {
              await api.updateClient(dialog.client.id, input);
              await reload();
              toast("Сохранено");
              close();
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "createLocation" && meta && (
        <Modal
          title={dialog.step2 ? `Шаг 2 из 2 · подключение для «${dialog.client.name}»` : `Новая локация · ${dialog.client.name}`}
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
              toast("Локация добавлена, туннель запускается");
              close();
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "editLocation" && meta && (
        <Modal title={`Локация · ${dialog.location.name || dialog.location.endpoint.room}`} onClose={close} wide>
          <LocationForm
            meta={meta}
            initial={dialog.location}
            defaultJitsi={defaultJitsi}
            onCancel={close}
            onSubmit={async (input) => {
              await api.updateLocation(dialog.location.id, input);
              await reload();
              toast("Сохранено, туннель перезапускается");
              close();
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "qr" && (
        <QRModal
          title={`Ссылка · ${dialog.location.name || providerLabel[dialog.location.endpoint.provider]}`}
          text={dialog.location.uri}
          hint="Одна локация в формате olcrtc://. Для нескольких локаций удобнее подписка."
          onClose={close}
        />
      )}
      {dialog?.kind === "sub" && <SubscriptionModal client={dialog.client} onClose={close} onRotated={reload} />}
      {dialog?.kind === "logs" && (
        <LogsModal locationId={dialog.location.id} title={dialog.location.name || dialog.location.endpoint.room} onClose={close} />
      )}
      {dialog?.kind === "traffic" && <ClientTrafficModal client={dialog.client} onClose={close} />}
      {confirmDialog}
    </>
  );
}

function ClientMenu({ onReset, onDelete }: { onReset: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconButton title="Ещё" onClick={() => setOpen(!open)}>
        <MoreHorizontal className="h-4 w-4" />
      </IconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-card p-1 shadow-xl">
            <MenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={() => (setOpen(false), onReset())}>
              Обнулить трафик
            </MenuItem>
            <MenuItem icon={<Trash2 className="h-4 w-4" />} danger onClick={() => (setOpen(false), onDelete())}>
              Удалить клиента
            </MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon, children, danger, onClick }: { icon: React.ReactNode; children: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-muted",
        danger && "text-destructive",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function runtimeBadge(l: Location) {
  const rt = l.runtime;
  if (rt.status === "running") return <Badge tone={rt.peers.length ? "ok" : "muted"}>{rt.peers.length ? "Подключено" : "Ждёт клиента"}</Badge>;
  if (rt.status === "restarting") return <Badge tone="warn">Перезапуск</Badge>;
  return <Badge tone={rt.reason === "disabled" ? "muted" : "bad"}>{statusLabel[rt.reason ?? "stopped"] ?? "Остановлен"}</Badge>;
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
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      {locations.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Локация</th>
                <th className="px-3 py-2 font-medium">Канал</th>
                <th className="px-3 py-2 font-medium">Комната</th>
                <th className="px-3 py-2 font-medium">Состояние</th>
                <th className="px-3 py-2 text-right font-medium">Скорость</th>
                <th className="px-3 py-2 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id} className={cx("border-b border-border/60 last:border-0", !l.enabled && "opacity-60")}>
                  <td className="px-3 py-2.5 font-medium">{l.name || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {providerLabel[l.endpoint.provider]} <span className="text-muted-foreground">· {transportLabel[l.endpoint.transport]}</span>
                  </td>
                  <td className="max-w-[240px] px-3 py-2.5">
                    <span className="block truncate font-mono text-xs text-muted-foreground" title={l.endpoint.room}>
                      {l.endpoint.room.replace(/^https:\/\//, "")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      {runtimeBadge(l)}
                      {l.runtime.status === "running" && (
                        <span className="text-[11px] text-muted-foreground">
                          {l.runtime.started_at ? `${since(l.runtime.started_at)}` : ""}
                          {l.runtime.rtt_ms ? ` · ${l.runtime.rtt_ms} мс` : ""}
                          {l.runtime.restarts ? ` · перезапусков ${l.runtime.restarts}` : ""}
                        </span>
                      )}
                      {l.runtime.status === "restarting" && l.runtime.last_error && (
                        <span className="max-w-[260px] truncate text-[11px] text-destructive" title={l.runtime.last_error}>
                          {l.runtime.last_error}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-xs">
                    <div className="inline-flex items-center gap-1">
                      <ArrowDown className="h-3 w-3 text-primary" />
                      {rate(l.runtime.rate_down)}
                    </div>
                    <div className="inline-flex items-center gap-1 pl-2 text-muted-foreground">
                      <ArrowUp className="h-3 w-3" />
                      {rate(l.runtime.rate_up)}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-0.5">
                      <CopyButton text={l.uri} />
                      <IconButton title="QR-код" onClick={() => onQR(l)}>
                        <QrCode className="h-4 w-4" />
                      </IconButton>
                      <IconButton title="Логи" onClick={() => onLogs(l)}>
                        <Terminal className="h-4 w-4" />
                      </IconButton>
                      <IconButton title="Перезапустить" onClick={() => onRestart(l)}>
                        <RefreshCw className="h-4 w-4" />
                      </IconButton>
                      <IconButton title="Новый ключ" onClick={() => onRotateKey(l)}>
                        <KeyRound className="h-4 w-4" />
                      </IconButton>
                      {l.endpoint.provider === "jitsi" && (
                        <IconButton title="Новая комната" onClick={() => onNewRoom(l)}>
                          <Shuffle className="h-4 w-4" />
                        </IconButton>
                      )}
                      <IconButton title="Изменить" onClick={() => onEdit(l)}>
                        <Edit3 className="h-4 w-4" />
                      </IconButton>
                      <IconButton title="Удалить" className="hover:text-destructive" onClick={() => onDelete(l)}>
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
      <button
        onClick={onAdd}
        className={cx(
          "flex w-full items-center justify-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
          locations.length > 0 && "border-t border-border",
        )}
      >
        <Plus className="h-4 w-4" />
        {locations.length === 0 ? "Добавить подключение: WB Stream, Телемост или Jitsi" : "Добавить локацию"}
      </button>
    </div>
  );
}
