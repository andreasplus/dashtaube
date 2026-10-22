import { exports } from "cloudflare:workers";

export const ORIGIN = "https://dashtaube.example";

export function call(path: string, init: RequestInit = {}): Promise<Response> {
  return (exports as unknown as { default: Fetcher }).default.fetch(new Request(`${ORIGIN}${path}`, init));
}

/** Meldet sich an und gibt ein Hilfsobjekt für Dashboard-Anfragen zurück. */
export async function loginSession() {
  const response = await call("/v1/session", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ password: "test-passwort-1234" }),
  });
  if (response.status !== 200) throw new Error(`Login fehlgeschlagen: ${response.status}`);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const ui = (path: string, init: RequestInit = {}) =>
    call(path, {
      ...init,
      headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...(init.headers ?? {}) },
    });
  return {
    cookie,
    ui,
    async json<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
      const r = await ui(path, init);
      return (await r.json()) as T;
    },
  };
}

export async function createSource(session: Awaited<ReturnType<typeof loginSession>>, body: Record<string, unknown>) {
  const response = await session.ui("/v1/sources", { method: "POST", body: JSON.stringify(body) });
  if (response.status !== 201) throw new Error(`Quelle anlegen: ${response.status} ${await response.text()}`);
  return (await response.json()) as { id: string; token: string; signing_secret?: string; webhook_url?: string };
}

export function notify(token: string, body: unknown, path = "/v1/notify") {
  return call(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
