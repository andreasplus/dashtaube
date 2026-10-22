import type { Notification } from "@dashtaube/core/notification";
import { highlightToHtml } from "@dashtaube/core/search";
import { formatDate, formatShort, t } from "../i18n";

/** Erste Zeilen des Markdown-Texts, grob von Syntax befreit, für die Vorschau. */
function preview(body: string | null): string {
  if (!body) return "";
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~[\]()!-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function NotificationRow({ n, selected, onSelect }: { n: Notification; selected: boolean; onSelect: () => void }) {
  const snippet = n.body_snippet ? highlightToHtml(n.body_snippet) : null;
  return (
    <button
      id={`row-${n.id}`}
      className={`row prio-${n.priority} ${n.status === "new" ? "unread" : ""} ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-current={selected}
    >
      <div className="row-top">
        <span className="row-source">
          <span className="swatch" style={{ background: n.source_color ?? "var(--muted)" }} />
          {n.source_icon && <span>{n.source_icon}</span>}
          {n.source_name}
          {n.project && <span className="chip">{n.project}</span>}
        </span>
        <time dateTime={new Date(n.created_at).toISOString()} title={formatDate(n.created_at)}>
          {formatShort(n.created_at)}
        </time>
      </div>
      <div className="row-title">
        {n.needs_input && n.status !== "done" && n.status !== "archived" && (
          <span className="badge warn">{t("detail.waiting")}</span>
        )}
        {n.priority >= 4 && <span className={`badge prio p${n.priority}`}>{t(`priority.${n.priority}` as "priority.4")}</span>}
        {n.title_highlight ? <span dangerouslySetInnerHTML={{ __html: highlightToHtml(n.title_highlight) }} /> : <span>{n.title}</span>}
      </div>
      {snippet ? (
        <div className="row-body" dangerouslySetInnerHTML={{ __html: snippet }} />
      ) : (
        n.body && <div className="row-body">{preview(n.body)}</div>
      )}
    </button>
  );
}
