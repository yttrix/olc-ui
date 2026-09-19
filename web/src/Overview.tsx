import {
  Activity,
  ArrowDown,
  CalendarDays,
  CircleSlash,
  Clock,
  Cpu,
  Gauge,
  HardDrive,
  PieChart,
  Radio,
  RefreshCw,
  Smartphone,
  TimerOff,
  Users,
} from "lucide-react";
import type { Client, Overview as OverviewData } from "./api";
import { bytes, duration, rate, transportLabel } from "./format";
import { useLang } from "./i18n";
import { TrafficChart } from "./TrafficChart";
import { Card, Delta, ProviderMark, SectionTitle, StatCard } from "./ui";

export function Overview({ data, clients }: { data: OverviewData | null; clients: Client[] }) {
  const { tr, lang } = useLang();
  const s = data?.stats ?? {};
  const t = data?.totals ?? {};
  const n = (v: number | undefined) => (data ? v ?? 0 : "…");
  const online = clients.flatMap((c) => c.locations.flatMap((l) => l.runtime.peers.map((p) => ({ client: c.name, loc: l, peer: p }))));

  return (
    <div>
      <SectionTitle>{tr("Сервер", "Server")}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Radio />} label={tr("Туннели работают", "Tunnels running")} value={data ? `${s.running ?? 0} / ${s.locations ?? 0}` : "…"} />
        <StatCard icon={<HardDrive />} tone="sky" label={tr("Память туннелей", "Tunnels memory")} value={data ? (s.workers_mem ? bytes(s.workers_mem, lang) : "—") : "…"} />
        <StatCard icon={<Cpu />} tone="success" label={tr("Память панели", "Panel memory")} value={bytes(data?.memory.sys, lang)} />
        <StatCard icon={<Clock />} tone="warning" label={tr("Аптайм", "Uptime")} value={data ? duration(data.uptime, lang) : "…"} sub={data?.version} />
      </div>

      <SectionTitle>{tr("Трафик", "Traffic")}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<CalendarDays />}
          label={tr("Сегодня", "Today")}
          value={bytes(t.today, lang)}
          sub={data && <Delta now={t.today} prev={t.yesterday} label={tr("ко вчера", "vs yesterday")} />}
        />
        <StatCard
          icon={<RefreshCw />}
          tone="success"
          label={tr("7 дней", "7 days")}
          value={bytes(t.week, lang)}
          sub={data && <Delta now={t.week} prev={t.prev_week} label={tr("к прошлой неделе", "vs last week")} />}
        />
        <StatCard
          icon={<PieChart />}
          tone="violet"
          label={tr("30 дней", "30 days")}
          value={bytes(t.month, lang)}
          sub={data && <Delta now={t.month} prev={t.prev_month} label={tr("к прошлому месяцу", "vs last month")} />}
        />
        <StatCard
          icon={<Gauge />}
          tone="sky"
          label={tr("Скорость сейчас", "Speed now")}
          value={
            <span className="inline-flex items-center gap-1">
              <ArrowDown className="h-4 w-4 text-primary" />
              {rate(s.rate_down, lang)}
            </span>
          }
          sub={`↑ ${rate(s.rate_up, lang)}`}
        />
      </div>

      <Card className="mt-3 p-4">
        <h3 className="mb-3 font-semibold">{tr("Трафик за 30 дней", "Traffic, last 30 days")}</h3>
        {data ? <TrafficChart data={data.traffic} /> : <div className="h-44" />}
      </Card>

      <SectionTitle>{tr("Онлайн", "Online")}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Activity />} tone="success" label={tr("Устройств сейчас", "Devices now")} value={n(s.peers)} />
        <StatCard icon={<Clock />} label={tr("Клиентов онлайн сегодня", "Clients online today")} value={n(s.online_today)} />
        <StatCard icon={<Users />} tone="violet" label={tr("Онлайн за неделю", "Online this week")} value={n(s.online_week)} />
        <StatCard icon={<CircleSlash />} tone="destructive" label={tr("Ни разу не подключались", "Never connected")} value={n(s.never_online)} />
      </div>

      <SectionTitle>{tr("Клиенты", "Clients")}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={<Users />} label={tr("Всего", "Total")} value={n(s.clients)} />
        <StatCard icon={<Activity />} tone="success" label={tr("Активны", "Active")} value={n(s.status_active)} />
        <StatCard icon={<TimerOff />} tone="destructive" label={tr("Истёк срок", "Expired")} value={n(s.status_expired)} />
        <StatCard icon={<PieChart />} tone="warning" label={tr("Лимит трафика", "Traffic limit")} value={n(s.status_traffic_exceeded)} />
        <StatCard icon={<CircleSlash />} tone="muted" label={tr("Отключены", "Disabled")} value={n(s.status_disabled)} />
      </div>

      <SectionTitle>{tr("Подключённые устройства", "Connected devices")}</SectionTitle>
      <Card>
        {online.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{tr("Сейчас никто не подключён.", "Nobody is connected right now.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{tr("Клиент", "Client")}</th>
                  <th className="px-4 py-2.5 font-medium">{tr("Локация", "Location")}</th>
                  <th className="px-4 py-2.5 font-medium">{tr("Канал", "Channel")}</th>
                  <th className="px-4 py-2.5 font-medium">{tr("Устройство", "Device")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{tr("Скорость", "Speed")}</th>
                </tr>
              </thead>
              <tbody>
                {online.map(({ client, loc, peer }) => (
                  <tr key={peer.session} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-semibold">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-success shadow-[0_0_8px_hsl(var(--success))]" />
                      {client}
                    </td>
                    <td className="px-4 py-2.5">{loc.name || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <ProviderMark provider={loc.endpoint.provider} withName />
                        <span className="text-muted-foreground">· {transportLabel[loc.endpoint.transport]}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground" title={peer.device}>
                      <Smartphone className="mr-1 inline h-3.5 w-3.5" />
                      {peer.device.slice(0, 8)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">{rate(loc.runtime.rate_down, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
