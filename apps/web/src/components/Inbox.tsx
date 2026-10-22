import type { InboxView, LiveEvent, Notification, NotificationStatus } from "@dashtaube/core/notification";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Counts, type Patch } from "../api";
import { t, type MessageKey } from "../i18n";
import { useLive } from "../live";
import { navigate } from "../router";
import { Detail } from "./Detail";
import { Header } from "./Header";
import { NotificationRow } from "./NotificationRow";

/** "waiting" ist die Inbox, gefiltert auf Meldungen, bei denen eine KI auf dich wartet. */
type View = InboxView | "waiting";

const VIEWS: Array<{ id: View; label: MessageKey; count?: keyof Counts }> = [
  { id: "inbox", label: "nav.inbox", count: "inbox" },
  { id: "waiting", label: "nav.waiting", count: "needs_input" },
  { id: "snoozed", label: "nav.snoozed", count: "snoozed" },
  { id: "done", label: "nav.done" },
  { id: "archived", label: "nav.archived" },
  { id: "all", label: "nav.all" },
];

interface Filters {
  view: View;
  source: string | undefined;
  minPriority: number | undefined;
  q: string;
}

function matches(n: Notification, f: Filters, now = Date.now()): boolean {
  if (f.source && n.source_id !== f.source) return false;
  if (f.minPriority && n.priority < f.minPriority) return false;
  const open = n.status === "new" || n.status === "read";
  const snoozed = n.snooze_until !== null && n.snooze_until > now;
  switch (f.view) {
    case "inbox":
      return open && !snoozed;
    case "waiting":
      return open && !snoozed && n.needs_input;
    case "snoozed":
      return open && snoozed;
    case "done":
      return n.status === "done";
    case "archived":
      return n.status === "archived";
    case "all":
      return true;
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function Inbox({ selectedId, onLogout }: { selectedId: string | null; onLogout: () => void }) {
  const [view, setView] = useState<View>("inbox");
  const [source, setSource] = useState<string | undefined>();
  const [minPriority, setMinPriority] = useState<number | undefined>();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);
  const filters = useMemo<Filters>(() => ({ view, source, minPriority, q }), [view, source, minPriority, q]);

  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const refreshCounts = useCallback(() => {
    api.counts().then(setCounts).catch(() => undefined);
  }, []);

  const load = useCallback(
    async (more = false) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.list({
          view: filters.view === "waiting" ? "inbox" : filters.view,
          needsInput: filters.view === "waiting" ? true : undefined,
          source: filters.source,
          minPriority: filters.minPriority,
          q: filters.q || undefined,
          cursor: more ? (cursor ?? undefined) : undefined,
        });
        setItems((prev) => (more ? [...prev, ...result.items] : result.items));
        setCursor(result.next_cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("error.generic"));
      } finally {
        setLoading(false);
      }
    },
    [filters, cursor],
  );

  useEffect(() => {
    void load(false);
  }, [filters]);

  useEffect(refreshCounts, [refreshCounts]);

  // Ausgewählte Meldung: aus der Liste, sonst nachladen (z. B. bei einem Direktlink).
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const inList = items.find((n) => n.id === selectedId);
    if (inList) {
      setSelected(inList);
      return;
    }
    if (selected?.id === selectedId) return;
    api.get(selectedId).then(setSelected).catch(() => navigate("/", true));
  }, [selectedId, items]);

  const applyLocal = useCallback(
    (ids: string[], patch: Patch) => {
      const update = (n: Notification): Notification => (ids.includes(n.id) ? { ...n, ...patch } : n);
      setItems((prev) => prev.map(update).filter((n) => matches(n, filters) || n.id === selectedId));
      setSelected((prev) => (prev ? update(prev) : prev));
    },
    [filters, selectedId],
  );

  const onLive = useCallback(
    (event: LiveEvent) => {
      if (event.type === "notification.created") {
        const n = event.notification;
        if (!filters.q && matches(n, filters)) {
          setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]));
        }
      } else if (event.type === "notification.updated") {
        applyLocal(event.ids, event.patch);
      }
      refreshCounts();
    },
    [filters, applyLocal, refreshCounts],
  );
  const live = useLive(onLive, true);

  const select = useCallback((n: Notification | null) => {
    setSnoozeOpen(false);
    if (!n) {
      navigate("/");
      return;
    }
    navigate(`/n/${encodeURIComponent(n.id)}`);
    if (n.status === "new") {
      api.patch(n.id, { status: "read" }).catch(() => undefined);
    }
  }, []);

  // Wenn die geöffnete Meldung neu ist, gilt sie als gelesen.
  useEffect(() => {
    if (selected && selected.status === "new") applyLocal([selected.id], { status: "read" });
  }, [selected, applyLocal]);

  /** Ändert eine Meldung und springt weiter, wenn sie aus der Ansicht verschwindet. */
  const act = useCallback(
    async (n: Notification, patch: Patch) => {
      setSnoozeOpen(false);
      const index = items.findIndex((i) => i.id === n.id);
      const after = { ...n, ...patch };
      const leaves = !matches(after, filters);
      if (leaves && selectedId === n.id) {
        const next = items[index + 1] ?? items[index - 1] ?? null;
        if (next && next.id !== n.id) select(next);
        else navigate("/");
      }
      setItems((prev) => prev.map((i) => (i.id === n.id ? after : i)).filter((i) => matches(i, filters)));
      setSelected((prev) => (prev?.id === n.id ? after : prev));
      try {
        await api.patch(n.id, patch);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("error.generic"));
        void load(false);
      }
      refreshCounts();
    },
    [items, filters, selectedId, select, load, refreshCounts],
  );

  const setStatus = useCallback((n: Notification, status: NotificationStatus) => act(n, { status }), [act]);

  const markAllRead = useCallback(async () => {
    const ids = items.filter((n) => n.status === "new").map((n) => n.id);
    if (ids.length === 0) return;
    applyLocal(ids, { status: "read" });
    await api.bulk(ids.slice(0, 200), { status: "read" }).catch(() => undefined);
    refreshCounts();
  }, [items, applyLocal, refreshCounts]);

  // Tastaturkürzel
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if (event.key === "Escape") {
        if (typing) (target as HTMLInputElement).blur();
        else if (showHelp) setShowHelp(false);
        else if (snoozeOpen) setSnoozeOpen(false);
        else select(null);
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = selected ? items.findIndex((n) => n.id === selected.id) : -1;
      switch (event.key) {
        case "j":
        case "ArrowDown": {
          const next = items[index + 1];
          if (next) select(next);
          break;
        }
        case "k":
        case "ArrowUp": {
          const prev = items[Math.max(0, index - 1)];
          if (prev) select(prev);
          break;
        }
        case "Enter":
        case "o":
          if (!selected && items[0]) select(items[0]);
          else if (selected?.url) window.open(selected.url, "_blank", "noopener,noreferrer");
          break;
        case "e":
          if (selected) void setStatus(selected, selected.status === "done" ? "read" : "done");
          break;
        case "y":
        case "#":
          if (selected) void setStatus(selected, selected.status === "archived" ? "read" : "archived");
          break;
        case "u":
          if (selected) void setStatus(selected, "new");
          break;
        case "s":
          if (selected) setSnoozeOpen((open) => !open);
          break;
        case "/":
          searchRef.current?.focus();
          break;
        case "?":
          setShowHelp((s) => !s);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, select, setStatus, showHelp, snoozeOpen]);

  // Ausgewählte Zeile sichtbar halten
  useEffect(() => {
    if (selectedId) document.getElementById(`row-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    const unread = counts?.unread ?? 0;
    document.title = unread > 0 ? `(${unread}) ${t("app.name")}` : t("app.name");
  }, [counts]);

  const changeView = (next: View) => {
    setView(next);
    select(null);
  };

  return (
    <div className={`app ${selected ? "has-selection" : ""}`}>
      <Header live={live} active="inbox" onLogout={onLogout}>
        <input
          ref={searchRef}
          className="search"
          type="search"
          placeholder={t("search.placeholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("search.placeholder")}
        />
      </Header>
      <div className="layout">
        <aside className="sidebar">
          <nav className="views">
            {VIEWS.map((v) => (
              <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => changeView(v.id)}>
                <span>{t(v.label)}</span>
                {v.count && counts && (counts[v.count] as number) > 0 && (
                  <span className={`count ${v.id === "waiting" ? "warn" : ""}`}>{counts[v.count] as number}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="filter-block">
            <label htmlFor="prio">{t("filter.priority")}</label>
            <select
              id="prio"
              value={minPriority ?? ""}
              onChange={(e) => setMinPriority(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">{t("filter.anyPriority")}</option>
              {[2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  {t("filter.minPriority", { n: p })} ({t(`priority.${p}` as MessageKey)})
                </option>
              ))}
            </select>
          </div>
          <div className="sources-block">
            <h3>{t("nav.sourcesHeading")}</h3>
            <button className={!source ? "active" : ""} onClick={() => setSource(undefined)}>
              <span>{t("nav.allSources")}</span>
            </button>
            {counts?.sources.map((s) => (
              <button key={s.id} className={source === s.id ? "active" : ""} onClick={() => setSource(s.id)}>
                <span className="source-name">
                  <span className="swatch" style={{ background: s.color ?? "var(--muted)" }} />
                  {s.icon && <span>{s.icon}</span>}
                  <span>{s.name}</span>
                </span>
                {s.unread_count > 0 && <span className="count">{s.unread_count}</span>}
              </button>
            ))}
          </div>
        </aside>

        <section className="list" aria-label={t("nav.inbox")}>
          <div className="list-toolbar">
            <span className="muted small">{t(VIEWS.find((v) => v.id === view)!.label)}</span>
            {items.some((n) => n.status === "new") && (
              <button className="link small" onClick={markAllRead}>
                {t("list.markAllRead")}
              </button>
            )}
          </div>
          {error && <p className="error pad">{error}</p>}
          {items.map((n) => (
            <NotificationRow key={n.id} n={n} selected={n.id === selectedId} onSelect={() => select(n)} />
          ))}
          {!loading && items.length === 0 && (
            <p className="empty">{filters.q ? t("list.emptySearch", { q: filters.q }) : t("list.empty")}</p>
          )}
          {cursor && (
            <button className="more" disabled={loading} onClick={() => load(true)}>
              {t("list.more")}
            </button>
          )}
        </section>

        <section className="detail">
          {selected ? (
            <Detail
              n={selected}
              snoozeOpen={snoozeOpen}
              onToggleSnooze={() => setSnoozeOpen((o) => !o)}
              onAction={(patch) => act(selected, patch)}
              onBack={() => select(null)}
            />
          ) : (
            <p className="empty">{t("detail.none")}</p>
          )}
        </section>
      </div>

      {showHelp && (
        <div className="overlay" onClick={() => setShowHelp(false)}>
          <div className="card help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("shortcuts.title")}</h2>
            <p>{t("shortcuts.list")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
