import { newId, signWebhook, type TaubeEventInput } from "@dashtaube/core";

export type { TaubeEventInput } from "@dashtaube/core";

export interface NotifyResult {
  id: string;
  duplicate: boolean;
  url: string;
}

export interface DashtaubeClientOptions {
  /** Adresse deiner Instanz, z. B. `https://dashtaube.deinname.workers.dev`. */
  baseUrl: string;
  /** API-Token der Quelle (`dt_…`). */
  token?: string;
  fetch?: typeof fetch;
}

async function readResult(response: Response): Promise<NotifyResult> {
  const data = (await response.json().catch(() => ({}))) as Partial<NotifyResult> & { error?: string };
  if (!response.ok || !data.id) {
    throw new Error(`Dashtaube antwortet mit ${response.status}: ${data.error ?? "unbekannter Fehler"}`);
  }
  return data as NotifyResult;
}

/** Schickt eine Meldung mit Token: `notify({ title, body, priority })`. */
export function createClient(options: DashtaubeClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");
  return {
    async notify(event: TaubeEventInput): Promise<NotifyResult> {
      if (!options.token) throw new Error("Für notify() fehlt das Token.");
      const response = await doFetch(`${base}/v1/notify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
        body: JSON.stringify(event),
      });
      return readResult(response);
    },
  };
}

/**
 * Schickt ein Event als signierten Webhook (Standard Webhooks, HMAC-SHA256).
 * So postet Posttaube an die Dashtaube-Instanz eines Nutzers.
 *
 * @param webhookUrl Die Webhook-Adresse der Quelle, z. B. `https://…/v1/webhooks/src_…`.
 * @param secret Das Signatur-Geheimnis der Quelle (`whsec_…`).
 */
export async function sendSignedEvent(
  webhookUrl: string,
  secret: string,
  event: TaubeEventInput,
  fetchImpl: typeof fetch = fetch,
): Promise<NotifyResult> {
  const body = JSON.stringify(event);
  const headers = await signWebhook(secret, event.id ?? newId("msg"), body);
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  return readResult(response);
}
