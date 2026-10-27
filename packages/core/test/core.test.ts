import { describe, expect, it } from "vitest";
import {
  buildFtsQuery,
  claudeCodeHookToEvent,
  generateToken,
  generateWebhookSecret,
  highlightToHtml,
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  newId,
  parseTaubeEvent,
  projectFromCwd,
  sha256Hex,
  signWebhook,
  timingSafeEqual,
  toNotificationDraft,
  verifyWebhook,
} from "../src/index.js";

describe("Taube-Event", () => {
  it("akzeptiert ein minimales Event und setzt Standardwerte", () => {
    const parsed = parseTaubeEvent({ title: "  Build fertig  " });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const draft = toNotificationDraft(parsed.value);
    expect(draft).toMatchObject({ title: "Build fertig", priority: 3, tags: [], needs_input: false, body: null });
  });

  it("lehnt fehlenden Titel, falsche Priorität und javascript-Links ab", () => {
    const parsed = parseTaubeEvent({ priority: 9, url: "javascript:alert(1)" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join("\n")).toMatch(/title/);
    expect(parsed.errors.join("\n")).toMatch(/priority/);
    expect(parsed.errors.join("\n")).toMatch(/url/);
  });

  it("normalisiert Tags und ignoriert unbekannte Felder", () => {
    const parsed = parseTaubeEvent({ title: "x", tags: ["Deploy", "deploy"], foo: 1 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(toNotificationDraft(parsed.value).tags).toEqual(["deploy"]);
    expect("foo" in parsed.value).toBe(false);
  });

  it("nutzt Posttaube-Standards je Typ, Werte des Senders gewinnen", () => {
    const review = parseTaubeEvent({ type: "posttaube.review.requested", title: "Mail an Anna wartet" });
    expect(review.ok && toNotificationDraft(review.value)).toMatchObject({
      priority: 4,
      needs_input: true,
      tags: ["posttaube", "freigabe"],
    });
    const custom = parseTaubeEvent({ type: "posttaube.review.requested", title: "x", priority: 5, tags: ["kunde"] });
    expect(custom.ok && toNotificationDraft(custom.value)).toMatchObject({
      priority: 5,
      tags: ["posttaube", "freigabe", "kunde"],
    });
  });

  it("wandelt occurred_at in Millisekunden", () => {
    const parsed = parseTaubeEvent({ title: "x", occurred_at: "2026-10-22T10:00:00+02:00" });
    expect(parsed.ok && toNotificationDraft(parsed.value).occurred_at).toBe(Date.parse("2026-10-22T08:00:00Z"));
  });
});

describe("Claude-Code-Hooks", () => {
  it("Notification wartet auf Input", () => {
    const event = claudeCodeHookToEvent({
      hook_event_name: "Notification",
      session_id: "abc",
      cwd: "/home/andreas/code/dashtaube",
      message: "Claude needs your permission to use Bash",
      notification_type: "permission_prompt",
    });
    expect(event).toMatchObject({
      type: "claude_code.notification",
      title: "Claude needs your permission to use Bash",
      project: "dashtaube",
      session: "abc",
      needs_input: true,
      priority: 4,
    });
    expect(parseTaubeEvent(event).ok).toBe(true);
  });

  it("Stop meldet fertig mit letzter Antwort", () => {
    const event = claudeCodeHookToEvent({
      hook_event_name: "Stop",
      cwd: "C:\\Users\\a\\posttaube",
      last_assistant_message: "Alles erledigt.",
    });
    expect(event).toMatchObject({ title: "Claude Code ist fertig in posttaube", body: "Alles erledigt.", needs_input: false });
    expect(parseTaubeEvent(event).ok).toBe(true);
  });

  it("kommt mit Unsinn zurecht", () => {
    expect(parseTaubeEvent(claudeCodeHookToEvent(null)).ok).toBe(true);
    expect(parseTaubeEvent(claudeCodeHookToEvent({ hook_event_name: "PreCompact" })).ok).toBe(true);
    expect(projectFromCwd("/")).toBeUndefined();
  });
});

describe("Webhook-Signaturen", () => {
  it("prüft gültige Signaturen und lehnt veränderte ab", async () => {
    const secret = generateWebhookSecret();
    const body = JSON.stringify({ title: "Hallo" });
    const headers = await signWebhook(secret, "msg_1", body);
    const h = new Headers({ ...headers });
    expect(await verifyWebhook(secret, h, body)).toEqual({ ok: true, id: "msg_1" });
    expect((await verifyWebhook(secret, h, body + " ")).ok).toBe(false);
    expect((await verifyWebhook(generateWebhookSecret(), h, body)).ok).toBe(false);
  });

  it("lehnt alte Zeitstempel ab", async () => {
    const secret = generateWebhookSecret();
    const headers = await signWebhook(secret, "msg_1", "{}", 1_000);
    const result = await verifyWebhook(secret, new Headers({ ...headers }), "{}", 1_000 + 3600);
    expect(result.ok).toBe(false);
  });

  it("entspricht dem Testvektor von Standard Webhooks", async () => {
    // https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/src/index.test.ts
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const headers = await signWebhook(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", '{"test": 2432232314}', 1614265330);
    expect(headers["webhook-signature"]).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });
});

describe("Hilfsfunktionen", () => {
  it("Tokens und IDs", async () => {
    const token = generateToken();
    expect(token).toMatch(/^dt_[A-Za-z0-9_-]{32}$/);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const a = newId("ntf", 1000);
    const b = newId("ntf", 2000);
    expect(a < b).toBe(true);
    expect(a).toMatch(/^ntf_[0-9A-Z]{26}$/);
    expect(timingSafeEqual("a", "a")).toBe(true);
    expect(timingSafeEqual("a", "ab")).toBe(false);
  });

  it("baut sichere FTS5-Abfragen", () => {
    expect(buildFtsQuery("")).toBeNull();
    expect(buildFtsQuery("  ** -- ")).toBeNull();
    expect(buildFtsQuery("build fehl")).toBe('"build" "fehl"*');
    expect(buildFtsQuery('source:"x" OR')).toBe('"source:x" "OR"*');
  });

  it("escaped Treffer vor dem Markieren", () => {
    expect(highlightToHtml(`<b>${HIGHLIGHT_START}Build${HIGHLIGHT_END}</b>`)).toBe("&#60;b&#62;<mark>Build</mark>&#60;/b&#62;");
  });
});

describe("Stop-Loss-Eingang", () => {
  const beispiel = {
    quelle: "stoploss",
    erinnerungen: [
      {
        id: 1,
        art: "stop_ablauf",
        faellig: "2026-10-30",
        ueberfaellig: false,
        titel: "Stop-Order Tokio Marine läuft ab",
        text: "Die Stop-Order bei 2,99 EUR für Tokio Marine (8766.T) gilt bis 31.10.2026. Bitte beim Broker neu setzen.",
        symbol: "8766.T",
        broker_stop: 2.99,
        link: "https://statistikplus.de/stoploss/",
      },
      { id: 999, art: "stop_ablauf", faellig: "2026-10-30", ueberfaellig: true, titel: "Test", text: "Testerinnerung", symbol: null, broker_stop: null, link: "https://statistikplus.de/stoploss/" },
    ],
  };

  it("macht aus jeder Erinnerung ein gültiges Taube-Event", async () => {
    const { stoplossToEvents } = await import("../src/index.js");
    const result = stoplossToEvents(beispiel);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toMatchObject({
      id: "stoploss-1",
      type: "stoploss.stop_ablauf",
      priority: 4,
      needs_input: true,
      project: "8766.T",
      url: "https://statistikplus.de/stoploss/",
      tags: ["stoploss", "stop-ablauf"],
    });
    expect(result.value[0]!.body).toContain("**Fällig:** 30.10.2026");
    expect(result.value[0]!.body).toContain("2,99");
    expect(result.value[1]).toMatchObject({ priority: 5, tags: ["stoploss", "stop-ablauf", "ueberfaellig"] });
    for (const event of result.value) expect(parseTaubeEvent(event).ok).toBe(true);
  });

  it("lehnt kaputte Lieferungen mit Feldangaben ab", async () => {
    const { stoplossToEvents, stoplossIdFromExternal } = await import("../src/index.js");
    const result = stoplossToEvents({ erinnerungen: [{ id: 1 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/titel/);
    expect(stoplossToEvents({}).ok).toBe(false);
    expect(stoplossIdFromExternal("stoploss-17")).toBe("17");
    expect(stoplossIdFromExternal("job-1")).toBeNull();
  });
});
