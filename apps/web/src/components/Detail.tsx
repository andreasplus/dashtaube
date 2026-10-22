import type { Notification } from "@dashtaube/core/notification";
import { useMemo } from "react";
import type { Patch } from "../api";
import { formatDate, t } from "../i18n";
import { renderMarkdown } from "../markdown";

function snoozeOptions(now = new Date()): Array<{ label: string; at: number }> {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  nextWeek.setHours(8, 0, 0, 0);
  return [
    { label: t("snooze.1h"), at: now.getTime() + 60 * 60_000 },
    { label: t("snooze.3h"), at: now.getTime() + 3 * 60 * 60_000 },
    { label: t("snooze.tomorrow"), at: tomorrow.getTime() },
    { label: t("snooze.nextWeek"), at: nextWeek.getTime() },
  ];
}

export function Detail({
  n,
  snoozeOpen,
  onToggleSnooze,
  onAction,
  onBack,
}: {
  n: Notification;
  snoozeOpen: boolean;
  onToggleSnooze: () => void;
  onAction: (patch: Patch) => void;
  onBack: () => void;
}) {
  const html = useMemo(() => (n.body ? renderMarkdown(n.body) : ""), [n.body]);
  const open = n.status === "new" || n.status === "read";
  const snoozed = n.snooze_until !== null && n.snooze_until > Date.now();

  return (
    <article className="detail-inner">
      <button className="link back" onClick={onBack}>
        ← {t("detail.back")}
      </button>
      <div className="detail-source">
        <span className="swatch" style={{ background: n.source_color ?? "var(--muted)" }} />
        {n.source_icon && <span>{n.source_icon}</span>}
        <span>{n.source_name}</span>
        <span className={`badge prio p${n.priority}`}>{t(`priority.${n.priority}` as "priority.3")}</span>
        {n.needs_input && open && <span className="badge warn">{t("detail.waiting")}</span>}
      </div>
      <h1>{n.title}</h1>

      <div className="toolbar">
        {n.url && (
          <a className="button primary" href={n.url} target="_blank" rel="noopener noreferrer">
            {t("detail.open")} ↗
          </a>
        )}
        {open ? (
          <>
            <button onClick={() => onAction({ status: "done" })} title="e">
              ✓ {t("detail.done")}
            </button>
            <div className="menu-anchor">
              <button onClick={onToggleSnooze} title="s" aria-expanded={snoozeOpen}>
                ⏰ {t("detail.snooze")}
              </button>
              {snoozeOpen && (
                <div className="menu" role="menu">
                  {snoozeOptions().map((o) => (
                    <button key={o.label} role="menuitem" onClick={() => onAction({ snooze_until: o.at })}>
                      <span>{o.label}</span>
                      <span className="muted small">{formatDate(o.at)}</span>
                    </button>
                  ))}
                  {snoozed && (
                    <button role="menuitem" onClick={() => onAction({ snooze_until: null })}>
                      {t("detail.unsnooze")}
                    </button>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => onAction({ status: "archived" })} title="y">
              {t("detail.archive")}
            </button>
            <button
              className="ghost"
              onClick={() => onAction({ status: n.status === "new" ? "read" : "new" })}
              title="u"
            >
              {n.status === "new" ? t("detail.markRead") : t("detail.markUnread")}
            </button>
          </>
        ) : (
          <button onClick={() => onAction({ status: "read" })}>{t("detail.restore")}</button>
        )}
      </div>

      {snoozed && <p className="muted small">{t("detail.snoozedUntil", { date: formatDate(n.snooze_until!) })}</p>}

      {(n.actions.length > 0 || n.links.length > 0) && (
        <div className="toolbar">
          {n.actions.map((a) => (
            <a
              key={a.url + a.label}
              className={`button ${a.style === "primary" ? "primary" : a.style === "danger" ? "danger" : ""}`}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {a.label}
            </a>
          ))}
          {n.links.map((l) => (
            <a key={l.url + l.label} className="button ghost" href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label} ↗
            </a>
          ))}
        </div>
      )}

      {html && <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />}

      <dl className="meta">
        <dt>{t("detail.received")}</dt>
        <dd>{formatDate(n.created_at)}</dd>
        {n.agent && (
          <>
            <dt>{t("detail.agent")}</dt>
            <dd>{n.agent}</dd>
          </>
        )}
        {n.project && (
          <>
            <dt>{t("detail.project")}</dt>
            <dd>{n.project}</dd>
          </>
        )}
        {n.session && (
          <>
            <dt>{t("detail.session")}</dt>
            <dd>
              <code>{n.session}</code>
            </dd>
          </>
        )}
      </dl>
      {n.tags.length > 0 && (
        <div className="tags">
          {n.tags.map((tag) => (
            <span key={tag} className="chip">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
