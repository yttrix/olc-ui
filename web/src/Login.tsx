import { useState } from "react";
import { LogIn } from "lucide-react";
import { api } from "./api";
import { Button, Card, Field, Input } from "./ui";
import { Logo } from "./Logo";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(user, pass);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-lg font-semibold">olc-ui</h1>
            <p className="text-sm text-muted-foreground">Вход в панель</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Логин">
            <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
          </Field>
          <Field label="Пароль">
            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" autoFocus />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy} icon={<LogIn className="h-4 w-4" />}>
            Войти
          </Button>
        </form>
      </Card>
    </div>
  );
}
