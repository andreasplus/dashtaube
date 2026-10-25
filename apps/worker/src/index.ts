import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import app from "./app.js";
import type { Env } from "./env.js";
import { ensureMigrated } from "./migrate.js";
import { mcpHandler } from "./mcp.js";

export { InboxHub } from "./live.js";

/**
 * Die Adresse einer selbst gehosteten Instanz kennen wir erst zur Laufzeit
 * (`*.workers.dev` oder eigene Domain). Deshalb bauen wir den OAuthProvider pro Origin.
 */
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpHandler as never,
      defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) } as ExportedHandler<Env>,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      scopesSupported: ["notify"],
      resourceMetadata: { resource: `${origin}/mcp`, resource_name: "Dashtaube" },
      // MCP-Clients bekommen 30 Tage Refresh, solange sie aktiv sind.
      refreshTokenIdleTTL: 30 * 24 * 60 * 60,
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  async fetch(request, env, ctx) {
    await ensureMigrated(env.DB);
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
