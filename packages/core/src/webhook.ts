import { base64ToBytes, bytesToBase64, randomBytes, timingSafeEqual } from "./crypto.js";

/**
 * Signierte Webhooks nach dem Standard-Webhooks-Format (https://www.standardwebhooks.com):
 *
 *   webhook-id: msg_…
 *   webhook-timestamp: 1730000000            (Sekunden)
 *   webhook-signature: v1,<base64(HMAC-SHA256(secret, "<id>.<timestamp>.<body>"))>
 *
 * Das Geheimnis hat die Form `whsec_<base64>`. Posttaube kann dafür die Bibliothek
 * `standardwebhooks` nutzen oder `signWebhook` aus `@dashtaube/client`.
 */
export const WEBHOOK_SECRET_PREFIX = "whsec_";
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function generateWebhookSecret(): string {
  return WEBHOOK_SECRET_PREFIX + bytesToBase64(randomBytes(32));
}

function secretKeyBytes(secret: string): Uint8Array {
  const raw = secret.startsWith(WEBHOOK_SECRET_PREFIX) ? secret.slice(WEBHOOK_SECRET_PREFIX.length) : secret;
  return base64ToBytes(raw);
}

async function hmacBase64(secret: string, content: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secretKeyBytes(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return bytesToBase64(new Uint8Array(signature));
}

export interface SignedHeaders {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
}

export async function signWebhook(
  secret: string,
  id: string,
  body: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): Promise<SignedHeaders> {
  const signature = await hmacBase64(secret, `${id}.${timestampSeconds}.${body}`);
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestampSeconds),
    "webhook-signature": `v1,${signature}`,
  };
}

export type VerifyResult = { ok: true; id: string } | { ok: false; reason: string };

export async function verifyWebhook(
  secret: string,
  headers: { get(name: string): string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) return { ok: false, reason: "Signatur-Header fehlen." };
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: "webhook-timestamp ist ungültig." };
  if (Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "webhook-timestamp liegt zu weit von der aktuellen Zeit entfernt." };
  }
  const expected = await hmacBase64(secret, `${id}.${ts}.${body}`);
  for (const part of signatures.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version === "v1" && value && timingSafeEqual(value, expected)) return { ok: true, id };
  }
  return { ok: false, reason: "Signatur stimmt nicht." };
}
