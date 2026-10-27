import { afterEach, describe, expect, it, vi } from "vitest";
import { createSource, loginSession, notify } from "./helpers.js";

const PATH = "/v1/hooks/stoploss";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    quelle: "stoploss",
    erinnerungen: [
      {
        id: 1,
        art: "stop_ablauf",
        faellig: "2026-10-30",
        ueberfaellig: false,
        titel: "Stop-Order Tokio Marine läuft ab",
        text: "Die Stop-Order bei 2,99 EUR für Tokio Marine (8766.T) gilt bis 31.10.2026.",
        symbol: "8766.T",
        broker_stop: 2.99,
        link: "https://statistikplus.de/stoploss/",
        ...overrides,
      },
    ],
  };
}

type Item = { id: string; title: string; body: string; priority: number; status: string; tags: string[] };

describe("POST /v1/hooks/stoploss", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lehnt fehlenden oder falschen Schlüssel mit 401 ab", async () => {
    expect((await notify("dt_falsch", payload(), PATH)).status).toBe(401);
  });

  it("legt Erinnerungen an und aktualisiert sie bei gleicher ID", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "Stop-Loss" });

    const first = await notify(token, payload(), PATH);
    expect(first.status).toBe(200);
    const created = (await first.json()) as { angenommen: number; neu: number; ids: string[] };
    expect(created).toMatchObject({ angenommen: 1, neu: 1, aktualisiert: 0 });

    const item = await session.json<Item>(`/v1/notifications/${created.ids[0]}`);
    expect(item.title).toBe("Stop-Order Tokio Marine läuft ab");
    expect(item.body).toContain("**Fällig:** 30.10.2026");
    expect(item.body).toContain("2,99");
    expect(item.tags).toContain("stop-ablauf");

    // Erledigt markieren, dann am nächsten Abend erneut geliefert, jetzt überfällig.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await session.ui(`/v1/notifications/${created.ids[0]}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    });
    const second = await notify(token, payload({ ueberfaellig: true, titel: "Stop-Order Tokio Marine abgelaufen" }), PATH);
    const repeated = (await second.json()) as { ids: string[] };
    expect(repeated).toMatchObject({ angenommen: 1, neu: 0, aktualisiert: 1 });
    expect(repeated.ids[0]).toBe(created.ids[0]);

    const updated = await session.json<Item>(`/v1/notifications/${created.ids[0]}`);
    expect(updated.title).toBe("Stop-Order Tokio Marine abgelaufen");
    expect(updated.priority).toBe(5);
    expect(updated.status).toBe("done");

    // Suche findet den neuen Titel, nicht doppelt.
    const search = await session.json<{ items: Item[] }>(`/v1/notifications?q=abgelaufen&view=all`);
    expect(search.items.map((n) => n.id)).toEqual([created.ids[0]]);
  });

  it("meldet „erledigt“ an den Stop-Loss-Rechner zurück", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "Stop-Loss" });
    const response = await notify(token, payload({ id: 42 }), PATH);
    const { ids } = (await response.json()) as { ids: string[] };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const patch = await session.ui(`/v1/notifications/${ids[0]}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    });
    expect(patch.status).toBe(200);

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://stoploss.example/erinnerungen.php");
    expect(new Headers(init?.headers).get("x-key")).toBe("rueckmelde-schluessel");
    expect(String(init?.body)).toBe("erledigt=42");
  });

  it("lehnt ungültige Erinnerungen mit 400 ab", async () => {
    const session = await loginSession();
    const { token } = await createSource(session, { name: "Stop-Loss" });
    const response = await notify(token, { erinnerungen: [{ id: 1 }] }, PATH);
    expect(response.status).toBe(400);
  });
});
