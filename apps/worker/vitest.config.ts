import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname, "../..");

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      // Wie wrangler: .sql-Dateien als Text importieren.
      {
        name: "sql-as-text",
        transform(code: string, id: string) {
          return id.endsWith(".sql") ? { code: `export default ${JSON.stringify(code)};`, map: null } : undefined;
        },
      },
      cloudflareTest({
        wrangler: { configPath: path.join(root, "wrangler.jsonc") },
        miniflare: {
          bindings: {
            ADMIN_PASSWORD: "test-passwort-1234",
            TEST_MIGRATIONS: migrations,
            STOPLOSS_ERLEDIGT_URL: "https://stoploss.example/erinnerungen.php",
            STOPLOSS_ERLEDIGT_KEY: "rueckmelde-schluessel",
          },
          d1Databases: ["FRESH_DB"],
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
