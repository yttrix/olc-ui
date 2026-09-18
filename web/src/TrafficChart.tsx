import { useState } from "react";
import type { DayTraffic } from "./api";
import { bytes } from "./format";

// Daily traffic as bars (download stacked under upload), hover for details.
export function TrafficChart({ data, height = 160 }: { data: DayTraffic[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.down + d.up));
  const total = data.reduce((s, d) => s + d.down + d.up, 0);
  const shown = hover === null ? null : data[hover];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary" /> Загрузка
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary/40" /> Отдача
          </span>
        </div>
        <div className="tabular text-sm text-muted-foreground">
          {shown ? (
            <>
              <span className="text-foreground">{new Date(shown.day).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
              {" · "}↓ {bytes(shown.down)} · ↑ {bytes(shown.up)}
            </>
          ) : (
            <>
              Всего за {data.length} дн.: <span className="text-foreground">{bytes(total)}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-end gap-[3px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const hDown = (d.down / max) * height;
          const hUp = (d.up / max) * height;
          return (
            <div
              key={d.day}
              className="group flex h-full flex-1 flex-col justify-end"
              onMouseEnter={() => setHover(i)}
              title={`${d.day}: ↓ ${bytes(d.down)} ↑ ${bytes(d.up)}`}
            >
              <div
                className={`rounded-t-[2px] bg-primary/40 ${hover === i ? "opacity-100" : "opacity-90"}`}
                style={{ height: Math.max(hUp, 0) }}
              />
              <div
                className={`bg-primary ${hover === i ? "opacity-100" : "opacity-85"} ${hUp < 1 ? "rounded-t-[2px]" : ""}`}
                style={{ height: Math.max(hDown, d.down + d.up > 0 ? 2 : 1) }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{data[0] && new Date(data[0].day).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
        <span>сегодня</span>
      </div>
    </div>
  );
}
