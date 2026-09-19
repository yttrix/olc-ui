import { useState } from "react";
import type { DayTraffic } from "./api";
import { bytes, shortDate } from "./format";
import { useLang } from "./i18n";

// Daily traffic as bars (download stacked under upload), hover for details.
export function TrafficChart({ data, height = 170 }: { data: DayTraffic[]; height?: number }) {
  const { tr, lang } = useLang();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.down + d.up));
  const total = data.reduce((s, d) => s + d.down + d.up, 0);
  const shown = hover === null ? null : data[hover];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary" /> {tr("Загрузка", "Download")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary/40" /> {tr("Отдача", "Upload")}
          </span>
        </div>
        <div className="tabular text-sm text-muted-foreground">
          {shown ? (
            <>
              <span className="text-foreground">{shortDate(shown.day, lang)}</span> · ↓ {bytes(shown.down, lang)} · ↑ {bytes(shown.up, lang)}
            </>
          ) : (
            <>
              {tr("Всего", "Total")}: <span className="font-semibold text-foreground">{bytes(total, lang)}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-end gap-[3px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const hDown = (d.down / max) * height;
          const hUp = (d.up / max) * height;
          const last = i === data.length - 1;
          return (
            <div key={d.day} className="flex h-full flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHover(i)}>
              <div className={`rounded-t-[3px] ${last ? "bg-success/40" : "bg-primary/35"}`} style={{ height: Math.max(hUp, 0) }} />
              <div
                className={`${last ? "bg-success" : "bg-primary"} ${hover === i ? "opacity-100" : "opacity-80"} ${hUp < 1 ? "rounded-t-[3px]" : ""}`}
                style={{ height: Math.max(hDown, d.down + d.up > 0 ? 2 : 1) }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-dim">
        <span>{data[0] && shortDate(data[0].day, lang)}</span>
        <span>{tr("сегодня", "today")}</span>
      </div>
    </div>
  );
}
