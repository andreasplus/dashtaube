import {
  newId,
  type InboxView,
  type Notification,
  type NotificationDraft,
  type NotificationStatus,
  type ReceivedVia,
  type Source,
  type SourceKind,
} from "@dashtaube/core";

interface NotificationRow {
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
  tags: string;
  url: string | null;
  links: string;
  actions: string;
  received_via: ReceivedVia;
  status: NotificationStatus;
  snooze_until: number | null;
  agent: string | null;
  project: string | null;
  session: string | null;
  needs_input: number;
  group_key: string | null;
  occurred_at: number | null;
  created_at: number;
  updated_at: number;
  title_highlight?: string | null;
  body_snippet?: string | null;
}

function parseJsonArray<T>(value: string | null): T[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNotification(row: NotificationRow): Notification {
  const n: Notification = {
    ...row,
    tags: parseJsonArray(row.tags),
    links: parseJsonArray(row.links),
    actions: parseJsonArray(row.actions),
    needs_input: row.needs_input === 1,
  };
  if (row.title_highlight === undefined) delete n.title_highlight;
  if (row.body_snippet === undefined) delete n.body_snippet;
  return n;
}

const NOTIFICATION_COLUMNS = `n.id, n.source_id, s.name AS source_name, s.kind AS source_kind, s.icon AS source_icon,
  s.color AS source_color, n.external_id, n.type, n.title, n.body, n.priority, n.tags, n.url, n.links, n.actions,
  n.received_via, n.status, n.snooze_until, n.agent, n.project, n.session, n.needs_input, n.group_key,
  n.occurred_at, n.created_at, n.updated_at`;

// ---------------------------------------------------------------- Meldungen

export interface InsertResult {
  notification: Notification;
  duplicate: boolean;
}

export async function insertNotification(
  db: D1Database,
  sourceId: string,
  draft: NotificationDraft,
  via: ReceivedVia,
  raw: unknown,
  now = Date.now(),
): Promise<InsertResult> {
  const id = newId("ntf", now);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, source_id, external_id, type, title, body, priority, tags, url, links,
        actions, received_via, status, agent, project, session, needs_input, group_key, occurred_at, created_at,
        updated_at, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      sourceId,
      draft.external_id,
      draft.type,
      draft.title,
      draft.body,
      draft.priority,
      JSON.stringify(draft.tags),
      draft.url,
      JSON.stringify(draft.links),
      JSON.stringify(draft.actions),
      via,
      draft.agent,
      draft.project,
      draft.session,
      draft.needs_input ? 1 : 0,
      draft.group_key,
      draft.occurred_at,
      now,
      now,
      raw === undefined ? null : JSON.stringify(raw).slice(0, 100_000),
    )
    .run();

  if (result.meta.changes === 0 && draft.external_id) {
    const existing = await db
      .prepare(
        `SELECT ${NOTIFICATION_COLUMNS} FROM notifications n JOIN sources s ON s.id = n.source_id
         WHERE n.source_id = ? AND n.external_id = ?`,
      )
      .bind(sourceId, draft.external_id)
      .first<NotificationRow>();
    if (existing) return { notification: toNotification(existing), duplicate: true };
  }
  const created = await getNotification(db, id);
  if (!created) throw new Error("Meldung konnte nicht gespeichert werden.");
  return { notification: created, duplicate: false };
}

export async function getNotification(db: D1Database, id: string): Promise<Notification | null> {
  const row = await db
    .prepare(`SELECT ${NOTIFICATION_COLUMNS} FROM notifications n JOIN sources s ON s.id = n.source_id WHERE n.id = ?`)
    .bind(id)
    .first<NotificationRow>();
  return row ? toNotification(row) : null;
}

export interface ListOptions {
  view: InboxView;
  sourceId?: string | undefined;
  minPriority?: number | undefined;
  needsInput?: boolean | undefined;
  /** Fertige FTS5-Abfrage aus `buildFtsQuery`. */
  ftsQuery?: string | null | undefined;
  cursor?: string | undefined;
  limit: number;
  now?: number;
}

export interface ListResult {
  items: Notification[];
  next_cursor: string | null;
}

function viewCondition(view: InboxView, now: number): { sql: string; params: unknown[] } {
  switch (view) {
    case "inbox":
      return { sql: "n.status IN ('new', 'read') AND (n.snooze_until IS NULL OR n.snooze_until <= ?)", params: [now] };
    case "snoozed":
      return { sql: "n.status IN ('new', 'read') AND n.snooze_until > ?", params: [now] };
    case "done":
      return { sql: "n.status = 'done'", params: [] };
    case "archived":
      return { sql: "n.status = 'archived'", params: [] };
    case "all":
      return { sql: "1 = 1", params: [] };
  }
}

export function encodeCursor(n: Pick<Notification, "created_at" | "id">): string {
  return `${n.created_at}_${n.id}`;
}

function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  const match = /^(\d+)_(ntf_[0-9A-Z]+)$/.exec(cursor);
  return match ? { createdAt: Number(match[1]), id: match[2]! } : null;
}

export async function listNotifications(db: D1Database, options: ListOptions): Promise<ListResult> {
  const now = options.now ?? Date.now();
  const where: string[] = [];
  const params: unknown[] = [];
  const view = viewCondition(options.view, now);
  where.push(view.sql);
  params.push(...view.params);
  if (options.sourceId) {
    where.push("n.source_id = ?");
    params.push(options.sourceId);
  }
  if (options.minPriority) {
    where.push("n.priority >= ?");
    params.push(options.minPriority);
  }
  if (options.needsInput !== undefined) {
    where.push("n.needs_input = ?");
    params.push(options.needsInput ? 1 : 0);
  }
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (cursor) {
    where.push("(n.created_at < ? OR (n.created_at = ? AND n.id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  let select = NOTIFICATION_COLUMNS;
  let from = "notifications n JOIN sources s ON s.id = n.source_id";
  if (options.ftsQuery) {
    // Markierungen U+E000/U+E001, siehe HIGHLIGHT_START/END in @dashtaube/core.
    select += `, highlight(notifications_fts, 0, char(57344), char(57345)) AS title_highlight,
      snippet(notifications_fts, 1, char(57344), char(57345), '…', 24) AS body_snippet`;
    from += " JOIN notifications_fts ON notifications_fts.rowid = n.rowid";
    where.unshift("notifications_fts MATCH ?");
    params.unshift(options.ftsQuery);
  }

  const { results } = await db
    .prepare(
      `SELECT ${select} FROM ${from} WHERE ${where.join(" AND ")}
       ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
    )
    .bind(...params, options.limit + 1)
    .all<NotificationRow>();

  const items = results.slice(0, options.limit).map(toNotification);
  const last = items.at(-1);
  return { items, next_cursor: results.length > options.limit && last ? encodeCursor(last) : null };
}

export interface NotificationPatch {
  status?: NotificationStatus | undefined;
  snooze_until?: number | null | undefined;
}

export async function updateNotifications(
  db: D1Database,
  ids: string[],
  patch: NotificationPatch,
  now = Date.now(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.snooze_until !== undefined) {
    sets.push("snooze_until = ?");
    params.push(patch.snooze_until);
  }
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(`UPDATE notifications SET ${sets.join(", ")} WHERE id IN (${placeholders})`)
    .bind(...params, ...ids)
    .run();
  return result.meta.changes;
}

export interface Counts {
  inbox: number;
  unread: number;
  needs_input: number;
  snoozed: number;
  done: number;
  archived: number;
}

export async function countNotifications(db: D1Database, now = Date.now()): Promise<Counts> {
  const row = await db
    .prepare(
      `SELECT
        coalesce(sum(CASE WHEN status IN ('new','read') AND (snooze_until IS NULL OR snooze_until <= ?1) THEN 1 END), 0) AS inbox,
        coalesce(sum(CASE WHEN status = 'new' AND (snooze_until IS NULL OR snooze_until <= ?1) THEN 1 END), 0) AS unread,
        coalesce(sum(CASE WHEN status IN ('new','read') AND needs_input = 1 AND (snooze_until IS NULL OR snooze_until <= ?1) THEN 1 END), 0) AS needs_input,
        coalesce(sum(CASE WHEN status IN ('new','read') AND snooze_until > ?1 THEN 1 END), 0) AS snoozed,
        coalesce(sum(CASE WHEN status = 'done' THEN 1 END), 0) AS done,
        coalesce(sum(CASE WHEN status = 'archived' THEN 1 END), 0) AS archived
       FROM notifications`,
    )
    .bind(now)
    .first<Counts>();
  return row ?? { inbox: 0, unread: 0, needs_input: 0, snoozed: 0, done: 0, archived: 0 };
}

// ---------------------------------------------------------------- Quellen

interface SourceRow {
  id: string;
  name: string;
  kind: SourceKind;
  icon: string | null;
  color: string | null;
  signing_secret: string | null;
  oauth_client_id: string | null;
  created_at: number;
}

export async function listSources(db: D1Database, now = Date.now()): Promise<Source[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.icon, s.color, s.signing_secret IS NOT NULL AS has_signing_secret, s.created_at,
        t.prefix AS token_prefix, t.created_at AS token_created_at, t.last_used_at AS token_last_used_at,
        (SELECT count(*) FROM notifications n WHERE n.source_id = s.id) AS notification_count,
        (SELECT count(*) FROM notifications n WHERE n.source_id = s.id AND n.status = 'new'
          AND (n.snooze_until IS NULL OR n.snooze_until <= ?)) AS unread_count
       FROM sources s
       LEFT JOIN tokens t ON t.source_id = s.id AND t.revoked_at IS NULL
       ORDER BY s.name COLLATE NOCASE`,
    )
    .bind(now)
    .all<Omit<Source, "has_signing_secret"> & { has_signing_secret: number }>();
  return results.map((row) => ({ ...row, has_signing_secret: row.has_signing_secret === 1 }));
}

export async function getSourceRow(db: D1Database, id: string): Promise<SourceRow | null> {
  return db.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first<SourceRow>();
}

export async function getSourceByClientId(db: D1Database, clientId: string): Promise<SourceRow | null> {
  return db.prepare("SELECT * FROM sources WHERE oauth_client_id = ?").bind(clientId).first<SourceRow>();
}

export interface NewSource {
  name: string;
  kind: SourceKind;
  icon?: string | null | undefined;
  color?: string | null | undefined;
  signing_secret?: string | null | undefined;
  oauth_client_id?: string | null | undefined;
}

export async function createSource(db: D1Database, source: NewSource, now = Date.now()): Promise<string> {
  const id = newId("src", now);
  await db
    .prepare(
      `INSERT INTO sources (id, name, kind, icon, color, signing_secret, oauth_client_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      source.name,
      source.kind,
      source.icon ?? null,
      source.color ?? null,
      source.signing_secret ?? null,
      source.oauth_client_id ?? null,
      now,
    )
    .run();
  return id;
}

export async function updateSource(
  db: D1Database,
  id: string,
  patch: { name?: string | undefined; icon?: string | null | undefined; color?: string | null | undefined },
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of ["name", "icon", "color"] as const) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (sets.length === 0) return true;
  const result = await db
    .prepare(`UPDATE sources SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...params, id)
    .run();
  return result.meta.changes > 0;
}

export async function setSigningSecret(db: D1Database, id: string, secret: string | null): Promise<void> {
  await db.prepare("UPDATE sources SET signing_secret = ? WHERE id = ?").bind(secret, id).run();
}

export async function deleteSource(db: D1Database, id: string): Promise<boolean> {
  // Meldungen zuerst löschen, damit der FTS-Trigger sicher läuft.
  const [, , result] = await db.batch([
    db.prepare("DELETE FROM notifications WHERE source_id = ?").bind(id),
    db.prepare("DELETE FROM tokens WHERE source_id = ?").bind(id),
    db.prepare("DELETE FROM sources WHERE id = ?").bind(id),
  ]);
  return (result?.meta.changes ?? 0) > 0;
}

// ---------------------------------------------------------------- Tokens

/** Legt ein neues Token an und sperrt alle bisherigen der Quelle (Rotation). */
export async function replaceToken(
  db: D1Database,
  sourceId: string,
  tokenHash: string,
  prefix: string,
  now = Date.now(),
): Promise<void> {
  await db.batch([
    db.prepare("UPDATE tokens SET revoked_at = ? WHERE source_id = ? AND revoked_at IS NULL").bind(now, sourceId),
    db
      .prepare("INSERT INTO tokens (id, source_id, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(newId("tok", now), sourceId, tokenHash, prefix, now),
  ]);
}

export async function findSourceByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<{ token_id: string; source: SourceRow } | null> {
  const row = await db
    .prepare(
      `SELECT t.id AS token_id, s.* FROM tokens t JOIN sources s ON s.id = t.source_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
    )
    .bind(tokenHash)
    .first<SourceRow & { token_id: string }>();
  if (!row) return null;
  const { token_id, ...source } = row;
  return { token_id, source };
}

export async function touchToken(db: D1Database, tokenId: string, now = Date.now()): Promise<void> {
  await db.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").bind(now, tokenId).run();
}
