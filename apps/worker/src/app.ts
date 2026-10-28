import {
  INBOX_VIEWS,
  LIMITS,
  NOTIFICATION_STATUSES,
  buildFtsQuery,
  claudeCodeHookToEvent,
  formatIssues,
  generateToken,
  generateWebhookSecret,
  sha256Hex,
  STOPLOSS_TYPE_PREFIX,
  stoplossIdFromExternal,
  stoplossToEvents,
  verifyWebhook,
} from "@dashtaube/core";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireSession, requireToken, login, logout, hasSession, SESSION_COOKIE, type AppEnv } from "./auth.js";
import { authorizeRoutes } from "./authorize.js";
import {
  countNotifications,
  createSource,
  deleteSource,
  getNotification,
  getNotificationRefs,
  getSourceRow,
  listNotifications,
  listSources,
  replaceToken,
  setSigningSecret,
  updateNotifications,
  updateSource,
} from "./db.js";
import { appVersion, OWNER_ID, type Env } from "./env.js";
import { ingest, type IngestResult } from "./ingest.js";
import { liveFetch, publish } from "./live.js";
import { getCookie } from "hono/cookie";

const app = new Hono<AppEnv>();

const limitBody = bodyLimit({
  maxSize: LIMITS.requestBytes,
  onError: (c) => c.json({ error: `Anfrage ist größer als ${LIMITS.requestBytes / 1024} KB.` }, 413),
});

function origin(c: Context<AppEnv>): string {
  return new URL(c.req.url).origin;
}

async function readJson(c: Context<AppEnv>): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false, response: c.json({ error: "Body ist kein gültiges JSON." }, 400) };
  }
}

function ingestResponse(c: Context<AppEnv>, result: IngestResult): Response {
  if (!result.ok) return c.json({ error: "Meldung ist ungültig.", details: result.errors }, 400);
  const { ok: _ok, ...body } = result;
  return c.json(body, result.duplicate ? 200 : 201);
}

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Interner Fehler." }, 500);
});

// ------------------------------------------------------------------ öffentlich

app.get("/v1/health", (c) => c.json({ ok: true, name: "dashtaube", version: appVersion(c.env) }));

// ------------------------------------------------------------------ Eingang mit Token

const notify = async (c: Context<AppEnv>) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const result = await ingest(c.env, c.executionCtx, {
    sourceId: c.get("source").id,
    input: body.value,
    via: "push",
    origin: origin(c),
  });
  return ingestResponse(c, result);
};
app.post("/v1/notify", limitBody, requireToken, notify);
app.post("/api/notify", limitBody, requireToken, notify);

/** Nimmt die Eingabe eines Claude-Code-Hooks unverändert an (stdin → curl). */
app.post("/v1/hooks/claude-code", limitBody, requireToken, async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const result = await ingest(c.env, c.executionCtx, {
    sourceId: c.get("source").id,
    input: claudeCodeHookToEvent(body.value),
    raw: body.value,
    via: "push",
    origin: origin(c),
  });
  return ingestResponse(c, result);
});

/**
 * Erinnerungen vom Stop-Loss-Rechner (statistikplus.de). Kommt dieselbe ID erneut,
 * wird die Meldung aktualisiert statt doppelt angelegt.
 */
app.post("/v1/hooks/stoploss", limitBody, requireToken, async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const events = stoplossToEvents(body.value);
  if (!events.ok) return c.json({ error: "Erinnerungen sind ungültig.", details: events.errors }, 400);
  const ids: string[] = [];
  let neu = 0;
  let aktualisiert = 0;
  const raw = (body.value as { erinnerungen: unknown[] }).erinnerungen;
  for (const [index, event] of events.value.entries()) {
    const result = await ingest(c.env, c.executionCtx, {
      sourceId: c.get("source").id,
      input: event,
      raw: raw[index],
      via: "push",
      origin: origin(c),
      upsert: true,
    });
    if (!result.ok) return c.json({ error: "Erinnerung ist ungültig.", details: result.errors }, 400);
    ids.push(result.id);
    if (!result.duplicate) neu++;
    else if (result.updated) aktualisiert++;
  }
  return c.json({ angenommen: ids.length, neu, aktualisiert, ids });
});

/** Signierte Webhooks (Standard Webhooks, HMAC-SHA256), z. B. von Posttaube. */
app.post("/v1/webhooks/:sourceId", limitBody, async (c) => {
  const source = await getSourceRow(c.env.DB, c.req.param("sourceId"));
  if (!source?.signing_secret) return c.json({ error: "Unbekannte Quelle oder Webhook nicht eingerichtet." }, 404);
  const raw = await c.req.text();
  const verified = await verifyWebhook(source.signing_secret, c.req.raw.headers, raw);
  if (!verified.ok) return c.json({ error: verified.reason }, 401);
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return c.json({ error: "Body ist kein gültiges JSON." }, 400);
  }
  // Ohne eigene ID dient die webhook-id zur Erkennung von Wiederholungen.
  if (input && typeof input === "object" && !("id" in input)) {
    input = { ...input, id: verified.id };
  }
  const result = await ingest(c.env, c.executionCtx, { sourceId: source.id, input, via: "push", origin: origin(c) });
  return ingestResponse(c, result);
});

// ------------------------------------------------------------------ Login

app.get("/v1/session", async (c) =>
  c.json({ authenticated: await hasSession(c.env, getCookie(c, SESSION_COOKIE)), version: appVersion(c.env) }),
);

app.post("/v1/session", limitBody, async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const parsed = z.object({ password: z.string().min(1).max(500) }).safeParse(body.value);
  if (!parsed.success) return c.json({ error: "Passwort fehlt." }, 400);
  const result = await login(c, parsed.data.password);
  return result.ok ? c.json({ authenticated: true }) : c.json({ error: result.error }, result.status);
});

app.delete("/v1/session", async (c) => {
  await logout(c);
  return c.json({ authenticated: false });
});

// ------------------------------------------------------------------ Dashboard (Sitzung)

const ui = new Hono<AppEnv>();
ui.use("*", requireSession);

ui.get("/live", (c) => {
  // Ein WebSocket-Handshake trägt den Origin der Seite. Fremde Seiten weisen wir ab.
  const requestOrigin = c.req.header("origin");
  if (requestOrigin && requestOrigin !== origin(c)) return c.json({ error: "Fremder Origin." }, 403);
  return liveFetch(c.env, c.req.raw);
});

const listQuery = z.object({
  view: z.enum(INBOX_VIEWS).default("inbox"),
  source: z.string().max(64).optional(),
  min_priority: z.coerce.number().int().min(1).max(5).optional(),
  needs_input: z.enum(["true", "false"]).optional(),
  q: z.string().max(500).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

ui.get("/notifications", async (c) => {
  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Ungültige Filter.", details: formatIssues(parsed.error) }, 400);
  const q = parsed.data;
  const ftsQuery = q.q ? buildFtsQuery(q.q) : null;
  const result = await listNotifications(c.env.DB, {
    view: q.view,
    sourceId: q.source,
    minPriority: q.min_priority,
    needsInput: q.needs_input === undefined ? undefined : q.needs_input === "true",
    ftsQuery,
    cursor: q.cursor,
    limit: q.limit,
  });
  return c.json(result);
});

ui.get("/notifications/:id", async (c) => {
  const notification = await getNotification(c.env.DB, c.req.param("id"));
  return notification ? c.json(notification) : c.json({ error: "Meldung nicht gefunden." }, 404);
});

const MAX_SNOOZE_MS = 366 * 24 * 60 * 60 * 1000;
const patchSchema = z
  .object({
    status: z.enum(NOTIFICATION_STATUSES).optional(),
    snooze_until: z
      .number()
      .int()
      .nullable()
      .optional()
      .refine((v) => v == null || (v > Date.now() && v < Date.now() + MAX_SNOOZE_MS), "Zeitpunkt muss in der Zukunft liegen."),
  })
  .refine((v) => v.status !== undefined || v.snooze_until !== undefined, "Nichts zu ändern.");

async function applyPatch(c: Context<AppEnv>, ids: string[], value: unknown) {
  const parsed = patchSchema.safeParse(value);
  if (!parsed.success) return c.json({ error: "Ungültige Änderung.", details: formatIssues(parsed.error) }, 400);
  const patch = parsed.data;
  // Wer eine Meldung erledigt oder archiviert, will sie nicht später wieder sehen.
  const fullPatch = patch.status === "done" || patch.status === "archived" ? { ...patch, snooze_until: null } : patch;
  const changed = await updateNotifications(c.env.DB, ids, fullPatch);
  if (changed > 0) {
    c.executionCtx.waitUntil(publish(c.env, { type: "notification.updated", ids, patch: fullPatch }));
    if (patch.status === "done") c.executionCtx.waitUntil(reportStoplossDone(c.env, ids));
  }
  return c.json({ changed });
}

/** Meldet erledigte Stop-Loss-Erinnerungen an den Stop-Loss-Rechner zurück, falls eingerichtet. */
async function reportStoplossDone(env: Env, ids: string[]): Promise<void> {
  if (!env.STOPLOSS_ERLEDIGT_URL || !env.STOPLOSS_ERLEDIGT_KEY) return;
  const refs = await getNotificationRefs(env.DB, ids);
  for (const ref of refs) {
    if (!ref.type?.startsWith(STOPLOSS_TYPE_PREFIX)) continue;
    const id = stoplossIdFromExternal(ref.external_id);
    if (!id) continue;
    try {
      const response = await fetch(env.STOPLOSS_ERLEDIGT_URL, {
        method: "POST",
        headers: { "x-key": env.STOPLOSS_ERLEDIGT_KEY },
        body: new URLSearchParams({ erledigt: id }),
      });
      if (!response.ok) console.warn(`Stop-Loss-Rückmeldung für ${id}: HTTP ${response.status}`);
    } catch (error) {
      console.warn(`Stop-Loss-Rückmeldung für ${id} fehlgeschlagen`, error);
    }
  }
}

ui.patch("/notifications/:id", limitBody, async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  return applyPatch(c, [c.req.param("id")], body.value);
});

ui.post("/notifications/bulk", limitBody, async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const parsed = z
    .object({ ids: z.array(z.string().max(64)).min(1).max(200), patch: z.unknown() })
    .safeParse(body.value);
  if (!parsed.success) return c.json({ error: "Ungültige Anfrage.", details: formatIssues(parsed.error) }, 400);
  return applyPatch(c, parsed.data.ids, parsed.data.patch);
});

ui.get("/counts", async (c) => {
  const [counts, sources] = await Promise.all([countNotifications(c.env.DB), listSources(c.env.DB)]);
  return c.json({ ...counts, sources });
});

// ------------------------------------------------------------------ Quellen

const colorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .nullable()
  .optional();
const iconSchema = z.string().trim().max(16).nullable().optional();

ui.get("/sources", async (c) => c.json({ sources: await listSources(c.env.DB) }));

ui.post("/sources", limitBody, async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      kind: z.enum(["generic", "claude_code", "posttaube"]).default("generic"),
      icon: iconSchema,
      color: colorSchema,
      alert: z.boolean().optional(),
    })
    .safeParse(body.value);
  if (!parsed.success) return c.json({ error: "Ungültige Quelle.", details: formatIssues(parsed.error) }, 400);

  const signingSecret = parsed.data.kind === "posttaube" ? generateWebhookSecret() : null;
  const id = await createSource(c.env.DB, { ...parsed.data, signing_secret: signingSecret });
  const token = generateToken();
  await replaceToken(c.env.DB, id, await sha256Hex(token), token.slice(0, 8));
  c.executionCtx.waitUntil(publish(c.env, { type: "sources.changed" }));
  return c.json(
    {
      id,
      token,
      ...(signingSecret ? { signing_secret: signingSecret, webhook_url: `${origin(c)}/v1/webhooks/${id}` } : {}),
    },
    201,
  );
});

ui.patch("/sources/:id", limitBody, async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      icon: iconSchema,
      color: colorSchema,
      alert: z.boolean().optional(),
    })
    .safeParse(body.value);
  if (!parsed.success) return c.json({ error: "Ungültige Änderung.", details: formatIssues(parsed.error) }, 400);
  const ok = await updateSource(c.env.DB, c.req.param("id"), parsed.data);
  if (!ok) return c.json({ error: "Quelle nicht gefunden." }, 404);
  c.executionCtx.waitUntil(publish(c.env, { type: "sources.changed" }));
  return c.json({ ok: true });
});

/** Trennt alle OAuth-Verbindungen (MCP), die in diese Quelle posten. */
async function revokeConnections(c: Context<AppEnv>, sourceId: string): Promise<number> {
  let revoked = 0;
  let cursor: string | undefined;
  do {
    const page = await c.env.OAUTH_PROVIDER.listUserGrants(OWNER_ID, cursor ? { cursor } : undefined);
    for (const grant of page.items) {
      if (grant.metadata?.sourceId === sourceId) {
        await c.env.OAUTH_PROVIDER.revokeGrant(grant.id, OWNER_ID);
        revoked++;
      }
    }
    cursor = page.cursor;
  } while (cursor);
  return revoked;
}

ui.delete("/sources/:id", async (c) => {
  const id = c.req.param("id");
  const source = await getSourceRow(c.env.DB, id);
  if (!source) return c.json({ error: "Quelle nicht gefunden." }, 404);
  if (source.kind === "mcp") await revokeConnections(c, id);
  await deleteSource(c.env.DB, id);
  c.executionCtx.waitUntil(publish(c.env, { type: "sources.changed" }));
  return c.json({ ok: true });
});

ui.post("/sources/:id/token", async (c) => {
  const id = c.req.param("id");
  if (!(await getSourceRow(c.env.DB, id))) return c.json({ error: "Quelle nicht gefunden." }, 404);
  const token = generateToken();
  await replaceToken(c.env.DB, id, await sha256Hex(token), token.slice(0, 8));
  return c.json({ token });
});

ui.post("/sources/:id/signing-secret", async (c) => {
  const id = c.req.param("id");
  if (!(await getSourceRow(c.env.DB, id))) return c.json({ error: "Quelle nicht gefunden." }, 404);
  const secret = generateWebhookSecret();
  await setSigningSecret(c.env.DB, id, secret);
  return c.json({ signing_secret: secret, webhook_url: `${origin(c)}/v1/webhooks/${id}` });
});

ui.post("/sources/:id/disconnect", async (c) => {
  const id = c.req.param("id");
  if (!(await getSourceRow(c.env.DB, id))) return c.json({ error: "Quelle nicht gefunden." }, 404);
  return c.json({ revoked: await revokeConnections(c, id) });
});

ui.post("/sources/:id/test", async (c) => {
  const id = c.req.param("id");
  const source = await getSourceRow(c.env.DB, id);
  if (!source) return c.json({ error: "Quelle nicht gefunden." }, 404);
  const result = await ingest(c.env, c.executionCtx, {
    sourceId: id,
    input: {
      type: "dashtaube.test",
      title: `Testmeldung für ${source.name}`,
      body: "Wenn du das liest, kommt alles an. **Markdown** geht auch.",
      tags: ["test"],
    },
    via: "push",
    origin: origin(c),
  });
  return ingestResponse(c, result);
});

app.route("/v1", ui);

// ------------------------------------------------------------------ OAuth-Zustimmung

app.route("/", authorizeRoutes);

// ------------------------------------------------------------------ Rest

app.all("/v1/*", (c) => c.json({ error: "Nicht gefunden." }, 404));
app.all("/api/*", (c) => c.json({ error: "Nicht gefunden." }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
