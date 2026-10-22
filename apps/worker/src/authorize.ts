import { AuthorizationError, CimdFetchError, type ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { hasSession, SESSION_COOKIE, type AppEnv } from "./auth.js";
import { createSource, getSourceByClientId, updateSource } from "./db.js";
import { OWNER_ID, type McpProps } from "./env.js";
import { publish } from "./live.js";

/**
 * Zustimmungsseite für MCP-Verbindungen (OAuth 2.1). Jede KI, die du verbindest
 * (ChatGPT, Claude, …), bekommt eine eigene Quelle in Dashtaube. Verbindest du dieselbe
 * KI erneut, nutzt sie dieselbe Quelle weiter.
 */
export const authorizeRoutes = new Hono<AppEnv>();

const SCOPE = "notify";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(title: string, content: string, status = 200, headers = new Headers()): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'");
  headers.set("X-Frame-Options", "DENY");
  return new Response(
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Dashtaube</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7fb;--card:#fff;--text:#1d2433;--muted:#5d667a;--accent:#4f5bd5;--warn:#b45309;--border:#dfe3ec}
@media (prefers-color-scheme:dark){:root{--bg:#10131a;--card:#181c26;--text:#e6e9f0;--muted:#9aa3b5;--accent:#8b93ff;--warn:#f5a524;--border:#2a3040}}
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--text);display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{background:var(--card);border:1px solid var(--border);border-radius:14px;max-width:460px;width:100%;padding:28px}
h1{font-size:1.3rem;margin:0 0 12px}p{margin:0 0 12px}.muted{color:var(--muted);font-size:.92rem}.warn{color:var(--warn)}
label{display:block;font-size:.9rem;margin:16px 0 4px;color:var(--muted)}input[type=text]{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:inherit;font:inherit}
.row{display:flex;gap:10px;margin-top:20px}button{flex:1;padding:11px;border-radius:8px;border:1px solid var(--border);font:inherit;cursor:pointer;background:transparent;color:inherit}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
</style></head><body><main>${content}</main></body></html>`,
    { status, headers },
  );
}

function errorPage(message: string, status = 400): Response {
  return page("Fehler", `<h1>Das hat nicht geklappt</h1><p>${escape(message)}</p><p class="muted">Starte die Verbindung in deiner KI noch einmal.</p>`, status);
}

function consentPage(details: ConsentDescription, handle: string, suggestedName: string): string {
  const name = escape(details.clientName);
  const verified = details.clientDomain
    ? `Veröffentlicht von <strong>${escape(details.clientDomain)}</strong>.`
    : "Die App hat sich selbst registriert, ihr Name ist nicht geprüft.";
  return `<h1>${name} mit Dashtaube verbinden?</h1>
<p>${name} darf dann Meldungen in deine Inbox schicken. Lesen, ändern oder löschen kann ${name} nichts.</p>
<p class="muted">${verified} Der Zugang geht an <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="warn"><strong>Der Zugang geht an ein Programm auf deinem Computer.</strong> Erlaube das nur, wenn du die Verbindung gerade selbst gestartet hast.</p>' : ""}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <label for="name">Name der Quelle in deiner Inbox</label>
  <input type="text" id="name" name="name" value="${escape(suggestedName)}" maxlength="80" required>
  <div class="row">
    <button type="submit" name="decision" value="deny">Ablehnen</button>
    <button type="submit" name="decision" value="approve" class="primary">Erlauben</button>
  </div>
</form>`;
}

function handleError(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
  if (error instanceof AuthorizationError) return errorPage(error.description);
  if (error instanceof CimdFetchError) return errorPage("Die App konnte nicht überprüft werden.");
  throw error;
}

authorizeRoutes.get("/authorize", async (c) => {
  if (!(await hasSession(c.env, getCookie(c, SESSION_COOKIE)))) {
    const url = new URL(c.req.url);
    return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  }
  try {
    const oauth = c.env.OAUTH_PROVIDER;
    const request = await oauth.parseAuthRequest(c.req.raw);
    const details = await oauth.describeConsent(request);
    const existing = await getSourceByClientId(c.env.DB, request.clientId);
    const consent = await oauth.beginConsent(request);
    return page(
      "Verbindung erlauben",
      consentPage(details, consent.handle, existing?.name ?? details.clientName),
      200,
      consent.headers,
    );
  } catch (error) {
    return handleError(error);
  }
});

authorizeRoutes.post("/authorize", async (c) => {
  if (!(await hasSession(c.env, getCookie(c, SESSION_COOKIE)))) {
    return errorPage("Deine Anmeldung ist abgelaufen.", 401);
  }
  try {
    const oauth = c.env.OAUTH_PROVIDER;
    const form = await c.req.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope: [SCOPE] });
    const client = await oauth.lookupClient(approved.request.clientId);
    const clientName = client?.clientName ?? "KI-Verbindung";
    const name = String(form.get("name") ?? "").trim().slice(0, 80) || clientName;

    let source = await getSourceByClientId(c.env.DB, approved.request.clientId);
    if (source) {
      if (source.name !== name) await updateSource(c.env.DB, source.id, { name });
    } else {
      await createSource(c.env.DB, { name, kind: "mcp", icon: "🤖", oauth_client_id: approved.request.clientId });
      source = await getSourceByClientId(c.env.DB, approved.request.clientId);
    }
    if (!source) throw new Error("Quelle für die Verbindung fehlt.");
    c.executionCtx.waitUntil(publish(c.env, { type: "sources.changed" }));

    const props: McpProps = { sourceId: source.id, clientName };
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: OWNER_ID,
      metadata: { sourceId: source.id, label: name },
      scope: [SCOPE],
      props,
    });
    approved.headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    return handleError(error);
  }
});
