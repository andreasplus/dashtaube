import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS, splitSql } from "../src/migrate.js";

const fresh = (env as unknown as { FRESH_DB: D1Database }).FRESH_DB;

describe("Migrationen im Worker", () => {
  it("zerlegt die Migration und hält Trigger zusammen", () => {
    const statements = splitSql(MIGRATIONS[0]!.sql);
    const triggers = statements.filter((s) => /^CREATE TRIGGER/i.test(s));
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers) expect(trigger).toMatch(/END;$/);
    expect(statements.some((s) => s.startsWith("--"))).toBe(false);
  });

  it("legt eine leere Datenbank vollständig an und ist danach ein No-op", async () => {
    expect(await applyMigrations(fresh)).toEqual(["0001_init.sql", "0002_fts_update.sql"]);
    const { results } = await fresh
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') ORDER BY name")
      .all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const name of ["sources", "tokens", "notifications", "notifications_fts", "sessions", "login_failures", "notifications_fts_insert", "notifications_fts_update"]) {
      expect(names).toContain(name);
    }
    expect(await applyMigrations(fresh)).toEqual([]);
  });

  it("erkennt Migrationen, die wrangler schon angewendet hat", async () => {
    // Die Test-Datenbank DB wurde im Setup mit wrangler-kompatiblen Migrationen angelegt.
    expect(await applyMigrations((env as unknown as { DB: D1Database }).DB)).toEqual([]);
  });
});
