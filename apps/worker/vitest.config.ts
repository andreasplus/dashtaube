import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname, "../..");

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: path.join(root, "wrangler.jsonc") },
        miniflare: {
          bindings: { ADMIN_PASSWORD: "test-passwort-1234", TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
