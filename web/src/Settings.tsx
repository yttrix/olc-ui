import { useEffect, useState } from "react";
import { api, type AuditEntry, type Meta, type Settings as SettingsData } from "./api";
import { dateTime } from "./format";
import { Button, Card, Field, Input, useToast } from "./ui";

export function Settings({ meta, onSaved }: { meta: Meta | null; onSaved: (s: SettingsData) => void }) {
  const toast = useToast();
  const [s, setS] = useState<SettingsData | null>(null);
  const [pw, setPw] = useState({ old: "", user: "", next: "", repeat: "" });

  useEffect(() => {
    api.settings().then((v) => {
      setS(v);
      setPw((p) => ({ ...p, user: v.user ?? "" }));
    });
  }, []);

  if (!s) return <Card className="h-64" />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = await api.saveSettings(s);
      setS(saved);
      onSaved(saved);
      toast("Настройки сохранены");
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.repeat) {
      toast("Пароли не совпадают", true);
      return;
    }
    try {
      await api.password(pw.old, pw.user, pw.next);
      toast("Пароль изменён, войдите заново");
      window.dispatchEvent(new Event("olc:unauthorized"));
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Панель и подписки</h2>
        <form className="space-y-4" onSubmit={save}>
          <Field label="Название" hint="показывается в подписке и в комментарии ссылок">
            <Input value={s.panel_name} onChange={(e) => setS({ ...s, panel_name: e.target.value })} />
          </Field>
          <Field
            label="Публичный адрес для подписок"
            hint="домен или IP:порт, по которому клиенты открывают /sub/…; пусто — адрес из браузера"
          >
            <Input value={s.public_host} onChange={(e) => setS({ ...s, public_host: e.target.value })} placeholder="vpn.example.com:2053" />
          </Field>
          <Field label="Интервал обновления подписки" hint="например 30m, 6h, 1d">
            <Input value={s.sub_refresh} onChange={(e) => setS({ ...s, sub_refresh: e.target.value })} />
          </Field>
          <Field label="Сервер Jitsi по умолчанию" hint="для новых локаций Jitsi">
            <Input list="jitsi-default" value={s.jitsi_instance} onChange={(e) => setS({ ...s, jitsi_instance: e.target.value })} />
            <datalist id="jitsi-default">
              {meta?.jitsi_instances.map((h) => <option key={h} value={h} />)}
            </datalist>
          </Field>
          <div className="flex items-center justify-between border-t border-border pt-4">
            <span className="text-xs text-muted-foreground">
              Путь панели: <code className="font-mono">{s.base_path}</code> · версия {s.version}
            </span>
            <Button type="submit" variant="primary">
              Сохранить
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Администратор</h2>
        <form className="space-y-4" onSubmit={changePassword}>
          <Field label="Логин">
            <Input value={pw.user} onChange={(e) => setPw({ ...pw, user: e.target.value })} autoComplete="username" />
          </Field>
          <Field label="Текущий пароль">
            <Input type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} autoComplete="current-password" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Новый пароль" hint="не короче 8 символов">
              <Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required />
            </Field>
            <Field label="Ещё раз">
              <Input type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} autoComplete="new-password" required />
            </Field>
          </div>
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" variant="primary">
              Сменить пароль
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

const actionLabel: Record<string, string> = {
  login: "Вход",
  login_failed: "Неудачный вход",
  password_changed: "Смена пароля",
  client_created: "Клиент создан",
  client_updated: "Клиент изменён",
  client_deleted: "Клиент удалён",
  usage_reset: "Трафик обнулён",
  sub_rotated: "Новая ссылка подписки",
  location_created: "Локация добавлена",
  location_updated: "Локация изменена",
  location_deleted: "Локация удалена",
  location_restarted: "Перезапуск локации",
  key_rotated: "Новый ключ",
  room_regenerated: "Новая комната",
  settings_updated: "Настройки изменены",
};

export function Audit() {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    api.audit().then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <Card>
      <h2 className="border-b border-border px-4 py-3 font-semibold">Журнал действий</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Время</th>
              <th className="px-4 py-2 font-medium">Действие</th>
              <th className="px-4 py-2 font-medium">Детали</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((e, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                <td className="tabular whitespace-nowrap px-4 py-2 text-muted-foreground">{dateTime(e.ts)}</td>
                <td className={`px-4 py-2 ${e.action === "login_failed" ? "text-destructive" : ""}`}>{actionLabel[e.action] ?? e.action}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items?.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Записей нет.</p>}
      </div>
    </Card>
  );
}
