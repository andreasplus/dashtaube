import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { t } from "../i18n";
import { Logo } from "./Logo";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onLogin();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">
          <Logo />
          <div>
            <h1>{t("app.name")}</h1>
            <p className="muted">{t("app.tagline")}</p>
          </div>
        </div>
        <label htmlFor="password">{t("login.password")}</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || !password}>
          {t("login.submit")}
        </button>
        <p className="muted small">{t("login.hint")}</p>
      </form>
    </div>
  );
}
