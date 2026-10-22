import type { TaubeAction, TaubeLink } from "./event.js";

export const NOTIFICATION_STATUSES = ["new", "read", "done", "archived"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const RECEIVED_VIA = ["push", "pull", "email"] as const;
export type ReceivedVia = (typeof RECEIVED_VIA)[number];

/** Ansichten der Inbox. */
export const INBOX_VIEWS = ["inbox", "snoozed", "done", "archived", "all"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const SOURCE_KINDS = ["generic", "claude_code", "posttaube", "mcp"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Eine gespeicherte Meldung, so wie die API sie ausliefert. */
export interface Notification {
  id: string;
  source_id: string;
  source_name: string;
  source_kind: SourceKind;
  source_icon: string | null;
  source_color: string | null;
  external_id: string | null;
  type: string | null;
  title: string;
  body: string | null;
  priority: number;
  tags: string[];
  url: string | null;
  links: TaubeLink[];
  actions: TaubeAction[];
  received_via: ReceivedVia;
  status: NotificationStatus;
  snooze_until: number | null;
  agent: string | null;
  project: string | null;
  session: string | null;
  needs_input: boolean;
  group_key: string | null;
  occurred_at: number | null;
  created_at: number;
  updated_at: number;
  /** Nur bei Suchtreffern: Titel und Ausschnitt mit Markierungen, siehe `HIGHLIGHT_START`. */
  title_highlight?: string | null;
  body_snippet?: string | null;
}

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  icon: string | null;
  color: string | null;
  has_signing_secret: boolean;
  created_at: number;
  token_prefix: string | null;
  token_created_at: number | null;
  token_last_used_at: number | null;
  notification_count: number;
  unread_count: number;
}

/** Live-Ereignisse über den WebSocket. */
export type LiveEvent =
  | { type: "notification.created"; notification: Notification }
  | { type: "notification.updated"; ids: string[]; patch: { status?: NotificationStatus; snooze_until?: number | null } }
  | { type: "sources.changed" };
