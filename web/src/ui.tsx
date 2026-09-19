import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { X, Check, Copy, ChevronUp, ChevronDown } from "lucide-react";
import { useLang } from "./i18n";
import { providerLabel, providerMark } from "./format";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "default" | "primary" | "danger" | "ghost" | "success";

export function Button({
  variant = "default",
  size = "md",
  icon,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; icon?: ReactNode }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[10px] text-sm transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary whitespace-nowrap";
  const sizes = { sm: "h-8 px-2.5", md: "h-9 px-3.5" };
  const variants: Record<Variant, string> = {
    default: "border border-border-strong bg-background-2 text-foreground hover:bg-muted",
    primary: "bg-primary font-medium text-primary-foreground hover:bg-primary/90",
    success: "border border-success/30 bg-success/10 text-success hover:bg-success/15",
    danger: "border border-destructive/35 text-destructive hover:bg-destructive/10",
    ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  title,
  children,
  className,
  tone,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "success" }) {
  return (
    <button
      title={title}
      aria-label={title}
      className={cx(
        "grid h-8 w-8 shrink-0 place-items-center rounded-[9px] transition-colors disabled:opacity-50",
        tone === "primary" && "border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15",
        tone === "success" && "border border-success/30 bg-success/10 text-success hover:bg-success/15",
        !tone && "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, className }: { children?: ReactNode; className?: string }) {
  return <section className={cx("rounded-xl border border-border bg-card", className)}>{children}</section>;
}

export function PanelHeader({ icon, title, children }: { icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5">
      <IconTile tone="primary" size="sm">
        {icon}
      </IconTile>
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 mt-7 text-base font-semibold first:mt-0">{children}</h2>;
}

type Tone = "primary" | "success" | "warning" | "destructive" | "sky" | "violet" | "muted";

const tileTone: Record<Tone, string> = {
  primary: "bg-primary/[0.12] text-primary",
  success: "bg-success/[0.12] text-success",
  warning: "bg-warning/[0.12] text-warning",
  destructive: "bg-destructive/[0.12] text-destructive",
  sky: "bg-sky/[0.12] text-sky",
  violet: "bg-violet/[0.12] text-violet",
  muted: "bg-muted text-muted-foreground",
};

export function IconTile({ tone, size = "md", children }: { tone: Tone; size?: "sm" | "md"; children: ReactNode }) {
  return (
    <div className={cx("grid shrink-0 place-items-center rounded-xl [&_svg]:h-5 [&_svg]:w-5", size === "md" ? "h-11 w-11" : "h-9 w-9", tileTone[tone])}>
      {children}
    </div>
  );
}

export function StatCard({
  icon,
  tone = "primary",
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  tone?: Tone;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-gradient-to-b from-card to-background-2 p-4 transition-colors hover:border-border-strong">
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="min-w-0">
        <div className="truncate text-[13px] text-muted-foreground">{label}</div>
        <div className="tabular mt-0.5 truncate text-[21px] font-bold leading-tight">{value}</div>
        {sub && <div className="mt-0.5 truncate text-xs text-dim">{sub}</div>}
      </div>
    </div>
  );
}

export function Delta({ now, prev, label }: { now: number; prev: number; label: string }) {
  const { lang } = useLang();
  if (!prev && !now) return <span>{label}</span>;
  const diff = now - prev;
  const up = diff >= 0;
  const abs = Math.abs(diff);
  const units = lang === "ru" ? ["Б", "КБ", "МБ", "ГБ", "ТБ"] : ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = abs;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (
    <span>
      <span className={up ? "text-success" : "text-destructive"}>
        {up ? "↗" : "↘"} {v.toFixed(i ? 1 : 0)} {units[i]}
      </span>{" "}
      {label}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { tr } = useLang();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-[2px] sm:p-8" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cx("w-full rounded-xl border border-border-strong bg-card shadow-2xl", wide ? "max-w-4xl" : "max-w-xl")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton title={tr("Закрыть", "Close")} onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-dim">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-9 w-full rounded-[10px] border border-border bg-background-2 px-3 text-sm outline-none placeholder:text-dim focus:border-primary/70";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputClass, "pr-8", props.className)}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-primary" : "border border-border-strong bg-muted")}
      >
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

type PillTone = "success" | "warning" | "destructive" | "muted" | "primary";

const pillTone: Record<PillTone, string> = {
  success: "border-success/30 bg-success/[0.08] text-success",
  warning: "border-warning/30 bg-warning/[0.08] text-warning",
  destructive: "border-destructive/30 bg-destructive/[0.08] text-destructive",
  muted: "border-border-strong bg-muted/50 text-muted-foreground",
  primary: "border-primary/30 bg-primary/[0.08] text-primary",
};

// Pill is the uppercase status badge (ACTIVE / EXPIRED ...).
export function Pill({ tone, icon, children }: { tone: PillTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide [&_svg]:h-3.5 [&_svg]:w-3.5", pillTone[tone])}>
      {icon}
      {children}
    </span>
  );
}

export function Badge({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", pillTone[tone])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function ProviderMark({ provider, withName }: { provider: string; withName?: boolean }) {
  const { lang } = useLang();
  const m = providerMark[provider] ?? { text: "?", cls: "bg-muted" };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cx("grid h-5 w-5 place-items-center rounded-md text-[9px] font-extrabold", m.cls)}>{m.text}</span>
      {withName && <span className="font-medium">{providerLabel(provider, lang)}</span>}
    </span>
  );
}

export function Progress({ value, tone = "primary" }: { value: number; tone?: "primary" | "warning" | "destructive" }) {
  const color = tone === "destructive" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-primary";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
      <div className={cx("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      <div className="text-dim">{icon}</div>
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function SortHeader<K extends string>({
  label,
  k,
  sort,
  setSort,
  className,
}: {
  label: string;
  k: K;
  sort: { key: K; dir: 1 | -1 };
  setSort: (s: { key: K; dir: 1 | -1 }) => void;
  className?: string;
}) {
  const on = sort.key === k;
  return (
    <th className={cx("px-3 py-2.5 font-medium", className)}>
      <button
        className={cx("inline-flex items-center gap-1 hover:text-foreground", on && "text-foreground")}
        onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : 1 })}
      >
        {label}
        {on ? sort.dir === 1 ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
      </button>
    </th>
  );
}

// --- toasts ---

type Toast = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = (text: string, error = false) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { id, text, error }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), error ? 6000 : 2500);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto max-w-sm rounded-[10px] border px-4 py-2.5 text-sm shadow-lg",
              t.error ? "border-destructive/40 bg-card text-destructive" : "border-border-strong bg-card",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text).catch(() => {
    // Clipboard API needs a secure context; fall back for plain-http panels.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

export function CopyButton({ text, label, size = "sm" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const toast = useToast();
  const { tr } = useLang();
  const [done, setDone] = useState(false);
  const copy = async () => {
    await copyText(text);
    setDone(true);
    toast(tr("Скопировано", "Copied"));
    setTimeout(() => setDone(false), 1500);
  };
  if (!label) {
    return (
      <IconButton title={tr("Копировать", "Copy")} onClick={copy}>
        {done ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </IconButton>
    );
  }
  return (
    <Button size={size} onClick={copy} icon={done ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}>
      {label}
    </Button>
  );
}

// --- confirm dialog ---

export function useConfirm() {
  const { tr } = useLang();
  const [state, setState] = useState<{ text: string; resolve: (ok: boolean) => void } | null>(null);
  const confirm = (text: string) => new Promise<boolean>((resolve) => setState({ text, resolve }));
  const done = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const dialog = state && (
    <Modal title={tr("Подтверждение", "Confirm")} onClose={() => done(false)}>
      <p className="text-sm">{state.text}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={() => done(false)}>{tr("Отмена", "Cancel")}</Button>
        <Button variant="primary" autoFocus onClick={() => done(true)}>
          {tr("Да", "Yes")}
        </Button>
      </div>
    </Modal>
  );
  return { confirm, dialog };
}
