import { Activity, ArrowDown, ArrowUp, Cpu, Radio, Smartphone, Users } from "lucide-react";
import type { Client, Overview as OverviewData } from "./api";
import { bytes, duration, providerLabel, rate, transportLabel } from "./format";
import { TrafficChart } from "./TrafficChart";
import { Badge, Card, StatCard } from "./ui";

export function Overview({ data, clients }: { data: OverviewData | null; clients: Client[] }) {
  const s = data?.stats ?? {};
  const online = clients.flatMap((c) =>
    c.locations.flatMap((l) => l.runtime.peers.map((p) => ({ client: c.name, loc: l, peer: p }))),
  );
  const today = data?.traffic.at(-1);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Клиенты"
          value={data ? `${s.active_clients ?? 0} / ${s.clients ?? 0}` : "…"}
          sub="активные / всего"
        />
        <StatCard
          icon={<Radio className="h-4 w-4" />}
          label="Локации"
          value={data ? `${s.running ?? 0} / ${s.locations ?? 0}` : "…"}
          sub="работают / всего"
        />
        <StatCard icon={<Smartphone className="h-4 w-4" />} label="Устройства онлайн" value={data ? s.peers ?? 0 : "…"} />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Скорость сейчас"
          value={
            <span className="flex items-center gap-3 text-xl">
              <span className="inline-flex items-center gap-1">
                <ArrowDown className="h-4 w-4 text-primary" />
                {rate(s.rate_down)}
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <ArrowUp className="h-4 w-4" />
                {rate(s.rate_up)}
              </span>
            </span>
          }
          sub={today ? `сегодня ${bytes(today.down + today.up)}` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Трафик за 30 дней</h2>
          {data ? <TrafficChart data={data.traffic} /> : <div className="h-40" />}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Cpu className="h-4 w-4 text-muted-foreground" /> Сервер
          </h2>
          <dl className="tabular grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Версия</dt>
            <dd className="text-right">{data?.version ?? "…"}</dd>
            <dt className="text-muted-foreground">Аптайм панели</dt>
            <dd className="text-right">{data ? duration(data.uptime) : "…"}</dd>
            <dt className="text-muted-foreground">Память панели</dt>
            <dd className="text-right">{bytes(data?.memory.sys)}</dd>
            <dt className="text-muted-foreground">Память туннелей</dt>
            <dd className="text-right">{data ? (s.workers_mem ? bytes(s.workers_mem) : "—") : "…"}</dd>
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="border-b border-border px-4 py-3 font-semibold">Подключённые устройства</h2>
        {online.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Сейчас никто не подключён.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Клиент</th>
                  <th className="px-4 py-2 font-medium">Локация</th>
                  <th className="px-4 py-2 font-medium">Канал</th>
                  <th className="px-4 py-2 font-medium">Устройство</th>
                  <th className="px-4 py-2 text-right font-medium">Скорость ↓</th>
                </tr>
              </thead>
              <tbody>
                {online.map(({ client, loc, peer }) => (
                  <tr key={peer.session} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{client}</td>
                    <td className="px-4 py-2.5">{loc.name || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone="ok">
                        {providerLabel[loc.endpoint.provider]} · {transportLabel[loc.endpoint.transport]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground" title={peer.device}>
                      {peer.device.slice(0, 8)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">{rate(loc.runtime.rate_down)}</td>
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
