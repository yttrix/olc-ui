import type { Lang } from "./i18n";

export const GB = 1024 ** 3;

export function bytes(n?: number, lang: Lang = "ru"): string {
  if (n === undefined || n === null) return "…";
  const units = lang === "ru" ? ["Б", "КБ", "МБ", "ГБ", "ТБ"] : ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function rate(bps: number | undefined, lang: Lang = "ru"): string {
  if (!bps) return lang === "ru" ? "0 Мбит/с" : "0 Mb/s";
  const mbit = (bps * 8) / 1_000_000;
  if (mbit >= 1) return `${mbit.toFixed(mbit >= 10 ? 0 : 1)} ${lang === "ru" ? "Мбит/с" : "Mb/s"}`;
  return `${Math.round((bps * 8) / 1000)} ${lang === "ru" ? "Кбит/с" : "Kb/s"}`;
}

export function duration(sec: number, lang: Lang = "ru"): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const [dd, hh, mm] = lang === "ru" ? ["д", "ч", "мин"] : ["d", "h", "min"];
  if (d) return `${d} ${dd} ${h} ${hh}`;
  if (h) return `${h} ${hh} ${m} ${mm}`;
  return `${m} ${mm}`;
}

export function dateTime(unix: number, lang: Lang = "ru"): string {
  return new Date(unix * 1000).toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", { dateStyle: "short", timeStyle: "short" });
}

export function shortDate(day: string, lang: Lang = "ru"): string {
  return new Date(day).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short" });
}

// ago renders "5 min ago" style relative times.
export function ago(unix: number, lang: Lang = "ru"): string {
  if (!unix) return lang === "ru" ? "не подключался" : "never";
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return lang === "ru" ? "только что" : "just now";
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  return rtf.format(-Math.floor(s / 86400), "day");
}

export function daysLeft(expires: string): number | null {
  if (!expires) return null;
  const end = new Date(expires + "T23:59:59");
  return Math.ceil((end.getTime() - Date.now()) / 86400000);
}

export const providerLabel = (p: string, lang: Lang = "ru") =>
  ({ wbstream: "WB Stream", telemost: lang === "ru" ? "Телемост" : "Telemost", jitsi: "Jitsi" })[p] ?? p;

export const providerMark: Record<string, { text: string; cls: string }> = {
  wbstream: { text: "WB", cls: "bg-[#c14cf0] text-white" },
  telemost: { text: "Т", cls: "bg-[#ffcc33] text-[#111]" },
  jitsi: { text: "J", cls: "bg-[#4a9dff] text-white" },
};

export const transportLabel: Record<string, string> = {
  datachannel: "DataChannel",
  vp8channel: "VP8",
  seichannel: "SEI (H264)",
  videochannel: "Video (QR)",
};

export function statusLabel(s: string, lang: Lang = "ru"): string {
  const ru: Record<string, string> = {
    active: "Активен",
    disabled: "Отключён",
    expired: "Истёк срок",
    traffic_exceeded: "Лимит трафика",
    running: "Работает",
    restarting: "Перезапуск",
    stopped: "Остановлен",
    pending: "Ожидание",
  };
  const en: Record<string, string> = {
    active: "Active",
    disabled: "Disabled",
    expired: "Expired",
    traffic_exceeded: "Traffic limit",
    running: "Running",
    restarting: "Restarting",
    stopped: "Stopped",
    pending: "Pending",
  };
  return (lang === "ru" ? ru : en)[s] ?? s;
}
