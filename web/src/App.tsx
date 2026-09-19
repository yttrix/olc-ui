import { useCallback, useEffect, useState } from "react";
import { LayoutDashboard, LogOut, ScrollText, Settings as SettingsIcon, Users } from "lucide-react";
import { api, type Client, type Meta, type Overview as OverviewData } from "./api";
import { Clients } from "./Clients";
import { LangSwitch, useLang } from "./i18n";
import { Login } from "./Login";
import { Logo } from "./Logo";
import { Overview } from "./Overview";
import { Audit, Settings } from "./Settings";
import { cx, IconButton } from "./ui";

type Tab = "overview" | "clients" | "audit" | "settings";

function tabFromHash(): Tab {
  const h = window.location.hash.slice(1);
  return (["overview", "clients", "audit", "settings"] as Tab[]).includes(h as Tab) ? (h as Tab) : "overview";
}

export function App() {
  const { tr } = useLang();
  const [auth, setAuth] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [panelName, setPanelName] = useState("olc-ui");
  const [version, setVersion] = useState("");
  const [jitsi, setJitsi] = useState("");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: tr("Главная", "Dashboard"), icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: "clients", label: tr("Клиенты", "Clients"), icon: <Users className="h-4 w-4" /> },
    { id: "audit", label: tr("Журнал", "Audit log"), icon: <ScrollText className="h-4 w-4" /> },
    { id: "settings", label: tr("Настройки", "Settings"), icon: <SettingsIcon className="h-4 w-4" /> },
  ];

  useEffect(() => {
    api.me().then((m) => setAuth(m.authenticated)).catch(() => setAuth(false));
    const onUnauth = () => setAuth(false);
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("olc:unauthorized", onUnauth);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("olc:unauthorized", onUnauth);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const reload = useCallback(async () => {
    const [c, o] = await Promise.all([api.clients(), api.overview()]);
    setClients(c);
    setOverview(o);
    setPanelName(o.name);
    setVersion(o.version);
  }, []);

  useEffect(() => {
    if (!auth) return;
    api.meta().then(setMeta).catch(() => {});
    api.settings().then((s) => setJitsi(s.jitsi_instance)).catch(() => {});
    reload().catch(() => {});
    // Live runtime (peers, speed) refreshes every 3 s while the tab is visible.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") reload().catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [auth, reload]);

  useEffect(() => {
    document.title = panelName === "olc-ui" ? "olc-ui" : `${panelName} · olc-ui`;
  }, [panelName]);

  if (auth === null) return null;
  if (!auth) return <Login onLogin={() => setAuth(true)} />;

  const go = (t: Tab) => {
    window.location.hash = t;
    setTab(t);
  };
  const logout = async () => {
    await api.logout().catch(() => {});
    setAuth(false);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 pt-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo size={32} />
            <span className="truncate text-lg font-bold tracking-tight">{panelName}</span>
          </div>
          <div className="flex-1" />
          {version && <span className="hidden h-8 items-center rounded-[9px] border border-border-strong bg-background-2 px-2.5 font-mono text-xs text-muted-foreground sm:inline-flex">{version}</span>}
          <LangSwitch />
          <IconButton title={tr("Выйти", "Sign out")} tone="primary" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </IconButton>
        </div>
        <nav className="mx-auto flex max-w-[1320px] gap-1 overflow-x-auto px-3 sm:px-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              className={cx(
                "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 pb-3 pt-3.5 text-sm transition-colors",
                tab === t.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 py-5 sm:px-5">
        {tab === "overview" && <Overview data={overview} clients={clients} />}
        {tab === "clients" && <Clients clients={clients} meta={meta} defaultJitsi={jitsi} reload={reload} />}
        {tab === "audit" && <Audit />}
        {tab === "settings" && (
          <Settings
            meta={meta}
            onSaved={(s) => {
              setPanelName(s.panel_name || "olc-ui");
              setJitsi(s.jitsi_instance);
            }}
            onRestored={reload}
          />
        )}
      </main>
    </div>
  );
}
