import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { X, Check, Copy } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "default" | "primary" | "danger" | "ghost";

export function Button({
  variant = "default",
  size = "md",
  icon,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; icon?: ReactNode }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md text-sm transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
  const sizes = { sm: "h-8 px-2.5", md: "h-9 px-3" };
  const variants: Record<Variant, string> = {
    default: "border border-border bg-muted hover:bg-muted/70",
    primary: "bg-primary font-medium text-primary-foreground hover:bg-primary/90",
    danger: "border border-destructive/40 text-destructive hover:bg-destructive/10",
    ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ title, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      title={title}
      aria-label={title}
      className={cx(
        "grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, className }: { children?: ReactNode; className?: string }) {
  return <section className={cx("rounded-lg border border-border bg-card", className)}>{children}</section>;
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cx("w-full rounded-lg border border-border bg-card shadow-2xl", wide ? "max-w-4xl" : "max-w-xl")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton title="Закрыть" onClick={onClose}>
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
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary";

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
        className={cx("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted border border-border")}
      >
        <span
          className={cx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
      {label}
    </label>
  );
}

type Tone = "ok" | "warn" | "bad" | "muted";

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    ok: "bg-primary/15 text-primary",
    warn: "bg-warning/15 text-warning",
    bad: "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function StatCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="tabular mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export function Progress({ value, tone = "ok" }: { value: number; tone?: Tone }) {
  const color = tone === "bad" ? "bg-destructive" : tone === "warn" ? "bg-warning" : "bg-primary";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cx("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
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
              "pointer-events-auto max-w-sm rounded-md border px-4 py-2.5 text-sm shadow-lg",
              t.error ? "border-destructive/40 bg-card text-destructive" : "border-border bg-card",
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

export function CopyButton({ text, label, size = "sm" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context; fall back for plain-http panels.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    toast("Скопировано");
    setTimeout(() => setDone(false), 1500);
  };
  if (!label) {
    return (
      <IconButton title="Копировать" onClick={copy}>
        {done ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
      </IconButton>
    );
  }
  return (
    <Button size={size} onClick={copy} icon={done ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}>
      {label}
    </Button>
  );
}

// --- confirm dialog ---

export function useConfirm() {
  const [state, setState] = useState<{ text: string; resolve: (ok: boolean) => void } | null>(null);
  const confirm = (text: string) => new Promise<boolean>((resolve) => setState({ text, resolve }));
  const dialog = state && (
    <Modal
      title="Подтверждение"
      onClose={() => {
        state.resolve(false);
        setState(null);
      }}
    >
      <p className="text-sm">{state.text}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button
          onClick={() => {
            state.resolve(false);
            setState(null);
          }}
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          autoFocus
          onClick={() => {
            state.resolve(true);
            setState(null);
          }}
        >
          Да
        </Button>
      </div>
    </Modal>
  );
  return { confirm, dialog };
}
