import type { ReactNode } from "react";
import { t } from "../i18n";
import { navigate } from "../router";
import { Logo } from "./Logo";

export function Header({
  children,
  live,
  active,
  onLogout,
}: {
  children?: ReactNode;
  live?: boolean | undefined;
  active: "inbox" | "sources";
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <a
        className="brand"
        href="/"
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
      >
        <Logo size={28} />
        <span>{t("app.name")}</span>
      </a>
      <div className="topbar-center">{children}</div>
      <nav className="topbar-nav">
        {live !== undefined && (
          <span className={`live ${live ? "on" : "off"}`} title={live ? t("live.on") : t("live.off")}>
            <span className="dot" />
            <span className="live-label">{live ? t("live.on") : t("live.off")}</span>
          </span>
        )}
        <a
          href="/sources"
          className={active === "sources" ? "active" : ""}
          onClick={(e) => {
            e.preventDefault();
            navigate("/sources");
          }}
        >
          {t("nav.sources")}
        </a>
        <button className="link" onClick={onLogout}>
          {t("nav.logout")}
        </button>
      </nav>
    </header>
  );
}
