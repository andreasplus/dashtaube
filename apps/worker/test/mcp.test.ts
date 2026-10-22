import { describe, expect, it } from "vitest";
import { call, loginSession, notify, createSource, ORIGIN } from "./helpers.js";

async function pkce() {
  const verifier = "v".repeat(20) + crypto.randomUUID().replace(/-/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

function cookiesFrom(response: Response): string[] {
  return response.headers.getSetCookie().map((c) => c.split(";")[0]!);
}

/** Spielt den kompletten OAuth-Ablauf durch, wie ChatGPT oder Claude ihn machen. */
async function connect(clientName: string, sourceName: string) {
  const redirectUri = "https://chatgpt.example/callback";
  const registered = await call("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
  });
  expect(registered.status).toBe(201);
  const { client_id } = (await registered.json()) as { client_id: string };

  const { verifier, challenge } = await pkce();
  const params = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirectUri,
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${ORIGIN}/mcp`,
  });

  // Ohne Anmeldung geht es zum Login.
  const anonymous = await call(`/authorize?${params}`, { redirect: "manual" });
  expect(anonymous.status).toBe(302);
  expect(anonymous.headers.get("location")).toMatch(/^\/login\?next=/);

  const session = await loginSession();
  const consent = await call(`/authorize?${params}`, { headers: { cookie: session.cookie } });
  expect(consent.status).toBe(200);
  const html = await consent.text();
  expect(html).toContain("mit Dashtaube verbinden?");
  expect(html).not.toContain("<script");
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1]!;
  const consentCookies = cookiesFrom(consent);

  const approved = await call(`/authorize?${params}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: [session.cookie, ...consentCookies].join("; "),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ handle, decision: "approve", name: sourceName }),
  });
  expect(approved.status).toBe(302);
  const location = new URL(approved.headers.get("location")!);
  expect(location.origin + location.pathname).toBe(redirectUri);
  const code = location.searchParams.get("code")!;

  const token = await call("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: `${ORIGIN}/mcp`,
    }),
  });
  expect(token.status).toBe(200);
  const { access_token } = (await token.json()) as { access_token: string };
  return { access_token, session, client_id };
}

function rpc(accessToken: string, method: string, params: unknown = {}, id = 1) {
  return call("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

describe("MCP mit OAuth", () => {
  it("verlangt ein Token und veröffentlicht die Metadaten", async () => {
    const response = await call("/mcp", { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/resource_metadata/);
    const meta = await call("/.well-known/oauth-protected-resource/mcp");
    expect(await meta.json()).toMatchObject({ resource: `${ORIGIN}/mcp` });
    const as = await call("/.well-known/oauth-authorization-server");
    expect(await as.json()).toMatchObject({ authorization_endpoint: `${ORIGIN}/authorize` });
  });

  it("ChatGPT verbindet sich und meldet sich per post_notification", async () => {
    const { access_token, session } = await connect("ChatGPT", "ChatGPT Agent");

    const init = await rpc(access_token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    expect(await init.json()).toMatchObject({ result: { serverInfo: { name: "dashtaube" } } });

    const tools = (await (await rpc(access_token, "tools/list", {}, 2)).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(tools.result.tools.map((t) => t.name)).toEqual(["post_notification"]);

    const posted = (await (
      await rpc(
        access_token,
        "tools/call",
        { name: "post_notification", arguments: { title: "Recherche fertig", needs_input: true, priority: 4 } },
        3,
      )
    ).json()) as { result: { structuredContent: { id: string }; isError?: boolean } };
    expect(posted.result.isError).toBeFalsy();
    const notification = await session.json(`/v1/notifications/${posted.result.structuredContent.id}`);
    expect(notification).toMatchObject({
      title: "Recherche fertig",
      source_name: "ChatGPT Agent",
      source_kind: "mcp",
      agent: "ChatGPT",
      needs_input: true,
    });

    // Nach dem Trennen gilt das Token nicht mehr.
    const sources = await session.json<{ sources: Array<{ id: string; name: string }> }>("/v1/sources");
    const source = sources.sources.find((s) => s.name === "ChatGPT Agent")!;
    expect(await session.json(`/v1/sources/${source.id}/disconnect`, { method: "POST" })).toEqual({ revoked: 1 });
    expect((await rpc(access_token, "tools/list", {}, 4)).status).toBe(401);
  });

  it("jede neu registrierte KI bekommt eine eigene Quelle", async () => {
    const first = await connect("Claude", "Claude");
    const sourcesBefore = await first.session.json<{ sources: Array<{ kind: string }> }>("/v1/sources");
    await connect("Claude", "Claude");
    const sourcesAfter = await first.session.json<{ sources: Array<{ kind: string }> }>("/v1/sources");
    expect(sourcesAfter.sources.filter((s) => s.kind === "mcp").length).toBe(
      sourcesBefore.sources.filter((s) => s.kind === "mcp").length + 1,
    );
  });
});

describe("Live-Updates", () => {
  it("schickt neue Meldungen über den WebSocket", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "Live" });
    const response = await call("/v1/live", { headers: { cookie: session.cookie, upgrade: "websocket" } });
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    const received = new Promise<{ type: string; notification: { title: string } }>((resolve) =>
      socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string))),
    );
    await notify(token, { title: "Live dabei" });
    const message = await received;
    expect(message.type).toBe("notification.created");
    expect(message.notification.title).toBe("Live dabei");
    socket.close();
  });

  it("verlangt eine Sitzung", async () => {
    expect((await call("/v1/live", { headers: { upgrade: "websocket" } })).status).toBe(401);
  });
});
