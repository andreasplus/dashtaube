import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { InboxHub } from "./live.js";

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  INBOX_HUB: DurableObjectNamespace<InboxHub>;
  ASSETS: Fetcher;
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
  /** Passwort für das Dashboard (Secret). */
  ADMIN_PASSWORD?: string;
  /** Optional: Rückmeldung „erledigt“ an den Stop-Loss-Rechner (URL von erinnerungen.php). */
  STOPLOSS_ERLEDIGT_URL?: string;
  /** Optional: Schlüssel für den Header X-Key dieser Rückmeldung (Secret). */
  STOPLOSS_ERLEDIGT_KEY?: string;
  /** Wird vom OAuthProvider gesetzt. */
  OAUTH_PROVIDER: OAuthHelpers;
}

/** Props, die der OAuthProvider für eine MCP-Verbindung an den MCP-Handler gibt. */
export interface McpProps {
  sourceId: string;
  clientName: string;
}

/** Wir haben nur einen Nutzer pro Instanz. */
export const OWNER_ID = "owner";

export const APP_VERSION = "0.1.0";

export function appVersion(env: Env): string {
  const id = env.CF_VERSION_METADATA?.id;
  return id ? `${APP_VERSION}+${id.slice(0, 8)}` : APP_VERSION;
}
