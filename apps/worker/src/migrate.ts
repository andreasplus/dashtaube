import init from "../migrations/0001_init.sql";

/**
 * Alle D1-Migrationen, eingebettet in den Worker. Neue Migrationen hier ergänzen.
 * Die Namen entsprechen den Dateinamen, damit `wrangler d1 migrations apply` und
 * der Worker dieselbe Tabelle `d1_migrations` führen und sich nicht in die Quere kommen.
 */
export const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [{ name: "0001_init.sql", sql: init }];

const TABLE = "d1_migrations";

/**
 * Zerlegt eine Migrationsdatei in einzelne Anweisungen. Kommentarzeilen fallen weg,
 * `CREATE TRIGGER … BEGIN … END;` bleibt als eine Anweisung zusammen.
 */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inTrigger = false;
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    current += `${line}\n`;
    if (!inTrigger && /^CREATE\s+TRIGGER\b/i.test(current.trimStart())) inTrigger = true;
    const done = inTrigger ? /^END;$/i.test(trimmed) : trimmed.endsWith(";");
    if (done) {
      statements.push(current.trim());
      current = "";
      inTrigger = false;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function appliedNames(db: D1Database): Promise<Set<string>> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    )
    .run();
  const { results } = await db.prepare(`SELECT name FROM ${TABLE}`).all<{ name: string }>();
  return new Set(results.map((r) => r.name));
}

/**
 * Bringt die Datenbank auf den neuesten Stand. So läuft Dashtaube auch dann, wenn der
 * Deploy die Migrationen nicht ausgeführt hat (z. B. weil im Deploy-Button nur
 * `npx wrangler deploy` eingetragen ist). Jede Migration läuft als eine Transaktion.
 */
export async function applyMigrations(db: D1Database): Promise<string[]> {
  const applied = await appliedNames(db);
  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    try {
      await db.batch([
        ...splitSql(migration.sql).map((statement) => db.prepare(statement)),
        db.prepare(`INSERT INTO ${TABLE} (name) VALUES (?)`).bind(migration.name),
      ]);
      ran.push(migration.name);
    } catch (error) {
      // Eine zweite Instanz kann gleichzeitig migriert haben. Dann ist alles gut.
      if (!(await appliedNames(db)).has(migration.name)) throw error;
    }
  }
  return ran;
}

let ready: Promise<unknown> | null = null;

/** Einmal pro Isolate: Migrationen prüfen, bevor die erste Anfrage bearbeitet wird. */
export function ensureMigrated(db: D1Database): Promise<unknown> {
  ready ??= applyMigrations(db).catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}
