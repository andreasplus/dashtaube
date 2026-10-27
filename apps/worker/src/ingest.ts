import { parseTaubeEvent, toNotificationDraft, type ReceivedVia } from "@dashtaube/core";
import { insertNotification } from "./db.js";
import type { Env } from "./env.js";
import { publish } from "./live.js";

export type IngestResult =
  | { ok: true; id: string; duplicate: boolean; updated: boolean; url: string }
  | { ok: false; status: 400; errors: string[] };

/**
 * Der eine Weg, auf dem Meldungen in Dashtaube landen: prüfen, speichern, live verteilen.
 * Webhook, Claude-Code-Hook und MCP rufen alle diese Funktion auf.
 */
export async function ingest(
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
  options: { sourceId: string; input: unknown; via: ReceivedVia; raw?: unknown; origin: string; upsert?: boolean },
): Promise<IngestResult> {
  const parsed = parseTaubeEvent(options.input);
  if (!parsed.ok) return { ok: false, status: 400, errors: parsed.errors };

  const draft = toNotificationDraft(parsed.value);
  const { notification, duplicate, updated } = await insertNotification(
    env.DB,
    options.sourceId,
    draft,
    options.via,
    options.raw ?? options.input,
    { upsert: options.upsert ?? false },
  );
  if (!duplicate) ctx.waitUntil(publish(env, { type: "notification.created", notification }));
  else if (updated) ctx.waitUntil(publish(env, { type: "notification.changed", notification }));
  return { ok: true, id: notification.id, duplicate, updated, url: `${options.origin}/n/${notification.id}` };
}
