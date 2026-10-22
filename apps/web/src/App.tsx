import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { Inbox } from "./components/Inbox";
import { Login } from "./components/Login";
import { Sources } from "./components/Sources";
import { locale, t } from "./i18n";
import { navigate, usePath } from "./router";

export function App() {
  const path = usePath();
  const [auth, setAuth] = useState<"unknown" | "yes" | "no">("unknown");

  useEffect(() => {
    document.documentElement.lang = locale;
    api
      .session()
      .then((s) => setAuth(s.authenticated ? "yes" : "no"))
      .catch(() => setAuth("no"));
    const onLogout = () => setAuth("no");
    window.addEventListener("dashtaube:logout", onLogout);
    return () => window.removeEventListener("dashtaube:logout", onLogout);
  }, []);

  const onLogin = useCallback(() => {
    // Nach dem Login zurück zur OAuth-Zustimmung, falls wir von dort kamen.
    const next = new URLSearchParams(location.search).get("next");
    if (next && next.startsWith("/authorize?")) {
      location.assign(next);
      return;
    }
    setAuth("yes");
    if (location.pathname === "/login") navigate("/", true);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAuth("no");
  }, []);

  if (auth === "unknown") return <div className="splash">{t("app.name")}</div>;
  if (auth === "no") return <Login onLogin={onLogin} />;
  if (path === "/sources") return <Sources onLogout={logout} />;
  const match = /^\/n\/([^/]+)$/.exec(path);
  return <Inbox selectedId={match ? decodeURIComponent(match[1]!) : null} onLogout={logout} />;
}
