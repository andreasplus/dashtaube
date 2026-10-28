import { signWebhook } from "@dashtaube/core";
import { describe, expect, it } from "vitest";
import { call, createSource, loginSession, notify, ORIGIN } from "./helpers.js";

describe("Login", () => {
  it("lehnt falsches Passwort ab und schützt das Dashboard", async () => {
    const wrong = await call("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "falsch" }),
    });
    expect(wrong.status).toBe(401);
    expect((await call("/v1/notifications")).status).toBe(401);
  });

  it("lehnt ändernde Anfragen von fremdem Origin ab", async () => {
    const session = await loginSession();
    const response = await session.ui("/v1/sources", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(response.status).toBe(403);
  });
});

describe("POST /v1/notify", () => {
  it("speichert eine Meldung und zeigt sie in der Inbox", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "Skripte" });
    const response = await notify(token, {
      title: "Backup fertig",
      body: "Alles **gut**",
      priority: 2,
      tags: ["backup"],
      project: "nas",
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; url: string };
    expect(created.id).toMatch(/^ntf_/);
    expect(created.url).toBe(`${ORIGIN}/n/${created.id}`);

    const list = await session.json<{ items: Array<Record<string, unknown>> }>("/v1/notifications");
    expect(list.items[0]).toMatchObject({
      id: created.id,
      title: "Backup fertig",
      source_name: "Skripte",
      tags: ["backup"],
      status: "new",
      needs_input: false,
      received_via: "push",
    });
  });

  it("prüft Token, JSON, Schema und Größe", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "Prüfung" });
    expect((await notify("dt_falsch", { title: "x" })).status).toBe(401);
    expect((await notify(token, "{kaputt")).status).toBe(400);
    const invalid = await notify(token, { priority: 7 });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { details: string[] }).details.join()).toMatch(/title/);
    expect((await notify(token, { title: "x", body: "a".repeat(70_000) })).status).toBe(413);
  });

  it("erkennt doppelte IDs vom selben Sender", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "Dedupe" });
    const first = (await (await notify(token, { id: "job-1", title: "A" })).json()) as { id: string };
    const second = await notify(token, { id: "job-1", title: "A" });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ id: first.id, duplicate: true });
  });

  it("alte Tokens gelten nach dem Rotieren nicht mehr", async () => {
    const session = await loginSession();
    const { id, token } = await createSource(session, { name: "Rotation" });
    const rotated = await session.json<{ token: string }>(`/v1/sources/${id}/token`, { method: "POST" });
    expect((await notify(token, { title: "alt" })).status).toBe(401);
    expect((await notify(rotated.token, { title: "neu" })).status).toBe(201);
  });
});

describe("Claude-Code-Hook", () => {
  it("nimmt die Hook-Eingabe unverändert an", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "Claude Code", kind: "claude_code" });
    const response = await notify(
      token,
      {
        hook_event_name: "Notification",
        session_id: "sess-1",
        cwd: "/home/a/dashtaube",
        message: "Claude needs your permission to use Bash",
        notification_type: "permission_prompt",
      },
      "/v1/hooks/claude-code",
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const notification = await session.json(`/v1/notifications/${id}`);
    expect(notification).toMatchObject({ project: "dashtaube", session: "sess-1", needs_input: true, priority: 4 });
  });
});

describe("Signierte Webhooks (Posttaube)", () => {
  it("akzeptiert gültige Signaturen, erkennt Wiederholungen und lehnt falsche ab", async () => {
    const session = await loginSession();
    const source = await createSource(session, { name: "Posttaube", kind: "posttaube" });
    expect(source.webhook_url).toBe(`${ORIGIN}/v1/webhooks/${source.id}`);
    const body = JSON.stringify({
      specversion: "taube/1",
      type: "posttaube.review.requested",
      title: "Mail an Anna wartet auf Freigabe",
      url: "https://posttaube.example/review/1",
    });
    const headers = await signWebhook(source.signing_secret!, "msg_1", body);
    const send = (h: Record<string, string>, b = body) =>
      call(`/v1/webhooks/${source.id}`, { method: "POST", headers: { "content-type": "application/json", ...h }, body: b });

    const ok = await send({ ...headers });
    expect(ok.status).toBe(201);
    const { id } = (await ok.json()) as { id: string };
    expect(await session.json(`/v1/notifications/${id}`)).toMatchObject({
      priority: 4,
      needs_input: true,
      tags: ["posttaube", "freigabe"],
      external_id: "msg_1",
    });

    const retry = await send({ ...headers });
    expect(await retry.json()).toMatchObject({ id, duplicate: true });

    expect((await send({ ...headers }, body.replace("Anna", "Bob"))).status).toBe(401);
    expect((await send({})).status).toBe(401);
  });
});

describe("Suche und Aktionen", () => {
  it("findet Meldungen per Volltext mit Markierung", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "CI" });
    await notify(token, { title: "Build fehlgeschlagen", body: "Der Deploy von dashtaube ist rot.", tags: ["deploy"] });
    await notify(token, { title: "Kaffee ist alle" });

    const result = await session.json<{ items: Array<{ title: string; title_highlight: string; body_snippet: string }> }>(
      `/v1/notifications?view=all&q=${encodeURIComponent("fehlgeschl")}`,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title_highlight).toBe("Build fehlgeschlagen");

    const byTag = await session.json<{ items: unknown[] }>(`/v1/notifications?view=all&q=deploy`);
    expect(byTag.items).toHaveLength(1);
    const bySource = await session.json<{ items: unknown[] }>(`/v1/notifications?view=all&q=CI`);
    expect(bySource.items.length).toBeGreaterThanOrEqual(2);
    const weird = await session.ui(`/v1/notifications?q=${encodeURIComponent('"AND OR * (')}`);
    expect(weird.status).toBe(200);
  });

  it("markiert, erledigt und snoozt", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "Aktionen" });
    const { id } = (await (await notify(token, { title: "Bitte prüfen" })).json()) as { id: string };

    const patch = (body: unknown) => session.ui(`/v1/notifications/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    expect((await patch({ status: "read" })).status).toBe(200);
    expect((await patch({ snooze_until: Date.now() - 1000 })).status).toBe(400);
    expect((await patch({ snooze_until: Date.now() + 3_600_000 })).status).toBe(200);

    const inbox = await session.json<{ items: Array<{ id: string }> }>("/v1/notifications?view=inbox");
    expect(inbox.items.some((n) => n.id === id)).toBe(false);
    const snoozed = await session.json<{ items: Array<{ id: string }> }>("/v1/notifications?view=snoozed");
    expect(snoozed.items.some((n) => n.id === id)).toBe(true);

    expect((await patch({ status: "done" })).status).toBe(200);
    const done = await session.json<{ items: Array<{ id: string; snooze_until: number | null }> }>(
      "/v1/notifications?view=done",
    );
    expect(done.items.find((n) => n.id === id)?.snooze_until).toBeNull();

    const counts = await session.json<{ done: number }>("/v1/counts");
    expect(counts.done).toBeGreaterThanOrEqual(1);
  });

  it("blättert mit Cursor", async () => {
    const session = await loginSession();
    const { id: sourceId, token } = await createSource(session, { name: "Viele" });
    for (let i = 0; i < 5; i++) await notify(token, { title: `Meldung ${i}` });
    const first = await session.json<{ items: Array<{ title: string }>; next_cursor: string }>(
      `/v1/notifications?view=all&source=${sourceId}&limit=3`,
    );
    expect(first.items).toHaveLength(3);
    const second = await session.json<{ items: Array<{ title: string }>; next_cursor: string | null }>(
      `/v1/notifications?view=all&source=${sourceId}&limit=3&cursor=${first.next_cursor}`,
    );
    expect(second.items).toHaveLength(2);
    expect(second.next_cursor).toBeNull();
  });
});

describe("Quellen", () => {
  it("merkt sich pro Quelle, ob das Dashboard klingeln soll", async () => {
    const session = await loginSession();
    const leise = await createSource(session, { name: "Leise" });
    const laut = await createSource(session, { name: "Laut", alert: true });

    const alertOf = async (id: string) =>
      (await session.json<{ sources: Array<{ id: string; alert: boolean }> }>("/v1/sources")).sources.find(
        (s) => s.id === id,
      )?.alert;
    expect(await alertOf(leise.id)).toBe(false);
    expect(await alertOf(laut.id)).toBe(true);

    const patch = (id: string, body: unknown) =>
      session.ui(`/v1/sources/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    expect((await patch(leise.id, { alert: true })).status).toBe(200);
    expect((await patch(laut.id, { alert: false })).status).toBe(200);
    expect((await patch(laut.id, { alert: "ja" })).status).toBe(400);
    expect(await alertOf(leise.id)).toBe(true);
    expect(await alertOf(laut.id)).toBe(false);
  });
});
