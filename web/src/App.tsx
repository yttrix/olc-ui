import { useCallback, useEffect, useState } from "react";
import { LayoutDashboard, LogOut, Moon, ScrollText, Settings as SettingsIcon, Sun, Users } from "lucide-react";
import { api, type Client, type Meta, type Overview as OverviewData } from "./api";
import { Clients } from "./Clients";
import { Login } from "./Login";
import { Logo } from "./Logo";
import { Overview } from "./Overview";
import { Audit, Settings } from "./Settings";
import { cx, IconButton } from "./ui";

type Tab = "overview" | "clients" | "audit" | "settings";

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Обзор", icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "clients", label: "Клиенты", icon: <Users className="h-4 w-4" /> },
  { id: "audit", label: "Журнал", icon: <ScrollText className="h-4 w-4" /> },
  { id: "settings", label: "Настройки", icon: <SettingsIcon className="h-4 w-4" /> },
];

function tabFromHash(): Tab {
  const h = window.location.hash.slice(1) as Tab;
  return tabs.some((t) => t.id === h) ? h : "overview";
}

function useTheme() {
  const read = () => {
    try {
      return localStorage.getItem("olc-theme");
    } catch {
      return null;
    }
  };
  const [theme, setTheme] = useState<string | null>(read);
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem("olc-theme", theme);
      else localStorage.removeItem("olc-theme");
    } catch {
      /* storage may be unavailable */
    }
  }, [theme]);
  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return { dark, toggle: () => setTheme(dark ? "light" : "dark") };
}

export function App() {
  const [auth, setAuth] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [panelName, setPanelName] = useState("olc-ui");
  const [jitsi, setJitsi] = useState("");
  const theme = useTheme();

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
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="hidden font-semibold sm:inline">{panelName}</span>
          </div>
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                className={cx(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-colors",
                  tab === t.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.icon}
                <span className="hidden md:inline">{t.label}</span>
              </button>
            ))}
          </nav>
          <IconButton title={theme.dark ? "Светлая тема" : "Тёмная тема"} onClick={theme.toggle}>
            {theme.dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconButton>
          <IconButton title="Выйти" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-5">
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
          />
        )}
      </main>
    </div>
  );
}
