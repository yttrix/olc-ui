import { useEffect, useRef, useState } from "react";
import { DatabaseBackup, Download, KeyRound, Lock, ScrollText, Settings as SettingsIcon, ShieldCheck, Upload } from "lucide-react";
import { api, type AuditEntry, type Meta, type Settings as SettingsData, type TLSStatus } from "./api";
import { dateTime } from "./format";
import { useLang } from "./i18n";
import { Badge, Button, Card, Field, Input, PanelHeader, useConfirm, useToast } from "./ui";

export function Settings({ meta, onSaved, onRestored }: { meta: Meta | null; onSaved: (s: SettingsData) => void; onRestored: () => void }) {
  const { tr, lang } = useLang();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [s, setS] = useState<SettingsData | null>(null);
  const [tls, setTls] = useState<TLSStatus | null>(null);
  const [pw, setPw] = useState({ old: "", user: "", next: "", repeat: "" });
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.settings().then((v) => {
      setS(v);
      setPw((p) => ({ ...p, user: v.user ?? "" }));
    });
    api.system().then((v) => setTls(v.tls)).catch(() => {});
  }, []);

  if (!s) return <Card className="h-64" />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = await api.saveSettings(s);
      setS(saved);
      onSaved(saved);
      toast(tr("Настройки сохранены", "Settings saved"));
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.repeat) {
      toast(tr("Пароли не совпадают", "Passwords do not match"), true);
      return;
    }
    try {
      await api.password(pw.old, pw.user, pw.next);
      toast(tr("Пароль изменён, войдите заново", "Password changed, sign in again"));
      window.dispatchEvent(new Event("olc:unauthorized"));
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const restore = async (file: File) => {
    const ok = await confirm(
      tr(
        `Восстановить из «${file.name}»? Все текущие клиенты и локации будут заменены данными из копии. Логин, пароль и адрес панели останутся прежними.`,
        `Restore from "${file.name}"? All current clients and locations will be replaced by the backup. Login, password and panel address stay the same.`,
      ),
    );
    if (!ok) return;
    setRestoring(true);
    try {
      const sum = await api.restore(file);
      onRestored();
      toast(tr(`Восстановлено: клиентов ${sum.clients}, локаций ${sum.locations}. Туннели запускаются.`, `Restored ${sum.clients} clients and ${sum.locations} locations. Tunnels are starting.`));
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setRestoring(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const tlsMode: Record<string, string> = {
    acme: "Let's Encrypt",
    self: tr("Самоподписанный", "Self-signed"),
    files: tr("Свой сертификат", "Custom certificate"),
    off: tr("Без SSL", "No SSL"),
  };
  const daysLeft = tls?.not_after ? Math.floor((tls.not_after * 1000 - Date.now()) / 86400000) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <PanelHeader icon={<SettingsIcon />} title={tr("Панель и подписки", "Panel and subscriptions")} />
        <form className="space-y-4 p-5" onSubmit={save}>
          <Field label={tr("Название", "Name")} hint={tr("показывается в подписке и в комментарии ссылок", "shown in subscriptions and link comments")}>
            <Input value={s.panel_name} onChange={(e) => setS({ ...s, panel_name: e.target.value })} />
          </Field>
          <Field
            label={tr("Публичный адрес для подписок", "Public address for subscriptions")}
            hint={tr("домен или IP:порт, по которому клиенты открывают /sub/…; пусто — адрес из браузера", "domain or IP:port clients use for /sub/…; empty — the address in your browser")}
          >
            <Input value={s.public_host} onChange={(e) => setS({ ...s, public_host: e.target.value })} placeholder="vpn.example.com:2053" />
          </Field>
          <Field label={tr("Интервал обновления подписки", "Subscription refresh interval")} hint={tr("например 30m, 6h, 1d", "e.g. 30m, 6h, 1d")}>
            <Input value={s.sub_refresh} onChange={(e) => setS({ ...s, sub_refresh: e.target.value })} />
          </Field>
          <Field label={tr("Сервер Jitsi по умолчанию", "Default Jitsi server")} hint={tr("для новых локаций Jitsi", "for new Jitsi locations")}>
            <Input list="jitsi-default" value={s.jitsi_instance} onChange={(e) => setS({ ...s, jitsi_instance: e.target.value })} />
            <datalist id="jitsi-default">{meta?.jitsi_instances.map((h) => <option key={h} value={h} />)}</datalist>
          </Field>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-xs text-dim">
              {tr("Путь панели", "Panel path")}: <code className="font-mono">{s.base_path}</code> · {s.version}
            </span>
            <Button type="submit" variant="primary">
              {tr("Сохранить", "Save")}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <PanelHeader icon={<Lock />} title={tr("Администратор", "Administrator")} />
        <form className="space-y-4 p-5" onSubmit={changePassword}>
          <Field label={tr("Логин", "Login")}>
            <Input value={pw.user} onChange={(e) => setPw({ ...pw, user: e.target.value })} autoComplete="username" />
          </Field>
          <Field label={tr("Текущий пароль", "Current password")}>
            <Input type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} autoComplete="current-password" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Новый пароль", "New password")} hint={tr("не короче 8 символов", "at least 8 characters")}>
              <Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required />
            </Field>
            <Field label={tr("Ещё раз", "Repeat")}>
              <Input type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} autoComplete="new-password" required />
            </Field>
          </div>
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" variant="primary" icon={<KeyRound className="h-4 w-4" />}>
              {tr("Сменить пароль", "Change password")}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <PanelHeader icon={<DatabaseBackup />} title={tr("Резервная копия", "Backup")} />
        <div className="space-y-4 p-5 text-sm">
          <p className="text-muted-foreground">
            {tr(
              "Копия содержит всех клиентов, локации с комнатами и ключами, устройства, статистику трафика и настройки подписок. На новом сервере установите панель и восстановите копию — туннели поднимутся с теми же комнатами и ключами.",
              "A backup holds all clients, locations with rooms and keys, devices, traffic statistics and subscription settings. Install the panel on a new server and restore it: tunnels come back with the same rooms and keys.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={api.backupURL()}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="h-4 w-4" />
              {tr("Скачать копию", "Download backup")}
            </a>
            <Button icon={<Upload className="h-4 w-4" />} disabled={restoring} onClick={() => fileRef.current?.click()}>
              {restoring ? tr("Восстанавливаю…", "Restoring…") : tr("Восстановить из копии", "Restore from backup")}
            </Button>
            <input ref={fileRef} type="file" accept=".db,application/octet-stream" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
          </div>
          <p className="rounded-[10px] border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {tr(
              "Ссылки подписок у клиентов содержат адрес панели. Если у нового сервера другой IP, подписки нужно будет добавить заново — с доменом этого не требуется. Логин, пароль и путь панели при восстановлении не меняются.",
              "Subscription links contain the panel address. If the new server has a different IP, clients must re-add subscriptions; with a domain they keep working. Login, password and panel path are not changed by a restore.",
            )}
          </p>
        </div>
      </Card>

      <Card>
        <PanelHeader icon={<ShieldCheck />} title={tr("Сертификат HTTPS", "HTTPS certificate")} />
        <div className="space-y-3 p-5 text-sm">
          {tls ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">{tr("Режим", "Mode")}</dt>
                <dd>{tlsMode[tls.mode] ?? tls.mode}</dd>
                {tls.host && (
                  <>
                    <dt className="text-muted-foreground">{tr("Адрес", "Host")}</dt>
                    <dd className="font-mono text-xs">{tls.host}</dd>
                  </>
                )}
                {tls.issuer && (
                  <>
                    <dt className="text-muted-foreground">{tr("Выдан", "Issuer")}</dt>
                    <dd>{tls.issuer}</dd>
                  </>
                )}
                {tls.not_after ? (
                  <>
                    <dt className="text-muted-foreground">{tr("Действует до", "Valid until")}</dt>
                    <dd>
                      {dateTime(tls.not_after, lang)}{" "}
                      {daysLeft !== null && daysLeft < 3650 && <Badge tone={daysLeft <= 1 ? "warning" : "success"}>{tr(`${daysLeft} дн.`, `${daysLeft} d`)}</Badge>}
                    </dd>
                  </>
                ) : null}
              </dl>
              {tls.mode === "acme" && (
                <p className="text-xs text-dim">
                  {tr(
                    "Сертификат продлевается автоматически без перезапуска панели. Для продления должен быть открыт порт 80.",
                    "The certificate renews automatically without restarting the panel. Port 80 must stay open for renewals.",
                  )}
                </p>
              )}
              {tls.last_error && <p className="rounded-[10px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{tls.last_error}</p>}
            </>
          ) : (
            <div className="h-20" />
          )}
          <p className="text-xs text-dim">
            {tr("Сменить режим (Let's Encrypt на IP или домен, свой сертификат) можно на сервере командой", "Change the mode (Let's Encrypt for IP or domain, custom certificate) on the server with")}{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">olc-ui</code> → {tr("«SSL-сертификат»", "\"SSL certificate\"")}.
          </p>
        </div>
      </Card>
      {dialog}
    </div>
  );
}

const actionLabel: Record<string, [string, string]> = {
  login: ["Вход", "Sign in"],
  login_failed: ["Неудачный вход", "Failed sign-in"],
  password_changed: ["Смена пароля", "Password changed"],
  client_created: ["Клиент создан", "Client created"],
  client_updated: ["Клиент изменён", "Client updated"],
  client_deleted: ["Клиент удалён", "Client deleted"],
  usage_reset: ["Трафик обнулён", "Traffic reset"],
  sub_rotated: ["Новая ссылка подписки", "Subscription link changed"],
  location_created: ["Локация добавлена", "Location added"],
  location_updated: ["Локация изменена", "Location updated"],
  location_deleted: ["Локация удалена", "Location deleted"],
  location_restarted: ["Перезапуск локации", "Location restarted"],
  key_rotated: ["Новый ключ", "Key rotated"],
  room_regenerated: ["Новая комната", "Room changed"],
  settings_updated: ["Настройки изменены", "Settings updated"],
  backup_downloaded: ["Скачана резервная копия", "Backup downloaded"],
  backup_restored: ["Восстановление из копии", "Backup restored"],
  device_block: ["Устройство заблокировано", "Device blocked"],
  device_unblock: ["Устройство разблокировано", "Device unblocked"],
  device_delete: ["Устройство удалено", "Device removed"],
};

export function Audit() {
  const { tr, lang } = useLang();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    api.audit().then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <Card>
      <PanelHeader icon={<ScrollText />} title={tr("Журнал действий", "Audit log")} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">{tr("Время", "Time")}</th>
              <th className="px-4 py-2.5 font-medium">{tr("Действие", "Action")}</th>
              <th className="px-4 py-2.5 font-medium">{tr("Детали", "Details")}</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((e, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                <td className="tabular whitespace-nowrap px-4 py-2.5 text-muted-foreground">{dateTime(e.ts, lang)}</td>
                <td className={`px-4 py-2.5 ${e.action === "login_failed" ? "text-destructive" : ""}`}>
                  {actionLabel[e.action] ? actionLabel[e.action][lang === "ru" ? 0 : 1] : e.action}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items?.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{tr("Записей нет.", "No entries.")}</p>}
      </div>
    </Card>
  );
}
