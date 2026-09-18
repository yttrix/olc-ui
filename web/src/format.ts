import type { ClientStatus } from "./api";

export const GB = 1024 ** 3;

export function bytes(n?: number): string {
  if (n === undefined || n === null) return "…";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function rate(bps?: number): string {
  if (!bps) return "0";
  const mbit = (bps * 8) / 1_000_000;
  if (mbit >= 1) return `${mbit.toFixed(mbit >= 10 ? 0 : 1)} Мбит/с`;
  return `${Math.round((bps * 8) / 1000)} Кбит/с`;
}

export function duration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} д ${h} ч`;
  if (h) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

export function dateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
}

export function since(unix: number): string {
  return duration(Math.max(0, Date.now() / 1000 - unix));
}

export const providerLabel: Record<string, string> = {
  wbstream: "WB Stream",
  telemost: "Телемост",
  jitsi: "Jitsi",
};

export const transportLabel: Record<string, string> = {
  datachannel: "DataChannel",
  vp8channel: "VP8",
  seichannel: "SEI (H264)",
  videochannel: "Video (QR)",
};

export const statusLabel: Record<ClientStatus | string, string> = {
  active: "Активен",
  disabled: "Отключён",
  expired: "Истёк срок",
  traffic_exceeded: "Лимит трафика",
  running: "Работает",
  restarting: "Перезапуск",
  stopped: "Остановлен",
  pending: "Ожидание",
};

export function daysLeft(expires: string): number | null {
  if (!expires) return null;
  const end = new Date(expires + "T23:59:59");
  return Math.ceil((end.getTime() - Date.now()) / 86400000);
}

export function shortId(s: string): string {
  return s.length > 12 ? s.slice(0, 8) + "…" : s;
}
