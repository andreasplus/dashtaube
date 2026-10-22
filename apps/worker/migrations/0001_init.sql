-- Dashtaube: Grundschema (Quellen, Tokens, Meldungen, Volltextsuche, Login)

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'generic' CHECK (kind IN ('generic', 'claude_code', 'posttaube', 'mcp')),
  icon TEXT,
  color TEXT,
  -- Geheimnis für signierte Webhooks (whsec_…). Muss zum Prüfen der HMAC-Signatur im Klartext vorliegen.
  signing_secret TEXT,
  -- Bei MCP-Verbindungen: die OAuth-Client-ID der KI, damit eine erneute Verbindung dieselbe Quelle nutzt.
  oauth_client_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX sources_oauth_client ON sources (oauth_client_id) WHERE oauth_client_id IS NOT NULL;

-- API-Tokens: nur der SHA-256-Hash wird gespeichert.
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX tokens_source ON tokens (source_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  external_id TEXT,
  type TEXT,
  title TEXT NOT NULL,
  body TEXT,
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  tags TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  links TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  received_via TEXT NOT NULL CHECK (received_via IN ('push', 'pull', 'email')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'done', 'archived')),
  snooze_until INTEGER,
  agent TEXT,
  project TEXT,
  session TEXT,
  needs_input INTEGER NOT NULL DEFAULT 0,
  group_key TEXT,
  occurred_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  raw TEXT
);
CREATE INDEX notifications_created ON notifications (created_at DESC, id DESC);
CREATE INDEX notifications_status ON notifications (status, created_at DESC);
CREATE INDEX notifications_source ON notifications (source_id, created_at DESC);
CREATE UNIQUE INDEX notifications_external ON notifications (source_id, external_id) WHERE external_id IS NOT NULL;

-- Volltextsuche über Titel, Text, Tags und Quelle. rowid = notifications.rowid.
CREATE VIRTUAL TABLE notifications_fts USING fts5 (
  title,
  body,
  tags,
  source,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER notifications_fts_insert AFTER INSERT ON notifications BEGIN
  INSERT INTO notifications_fts (rowid, title, body, tags, source)
  VALUES (
    new.rowid,
    new.title,
    coalesce(new.body, ''),
    (SELECT coalesce(group_concat(value, ' '), '') FROM json_each(new.tags)),
    coalesce((SELECT name FROM sources WHERE id = new.source_id), '')
  );
END;

CREATE TRIGGER notifications_fts_delete AFTER DELETE ON notifications BEGIN
  DELETE FROM notifications_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER sources_fts_rename AFTER UPDATE OF name ON sources BEGIN
  UPDATE notifications_fts SET source = new.name
  WHERE rowid IN (SELECT rowid FROM notifications WHERE source_id = new.id);
END;

-- Dashboard-Sitzungen (Single-User). Gespeichert wird nur der Hash des Cookies.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Fehlgeschlagene Logins, für eine einfache Sperre gegen Durchprobieren.
CREATE TABLE login_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_failures_ip ON login_failures (ip, at);
