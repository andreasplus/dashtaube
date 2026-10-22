import { z } from "zod";

/**
 * Taube-Event-Schema, Version 1.
 *
 * Ein gemeinsames Format für alle Tools des Posttaube-Universums. Wer eine Meldung an
 * Dashtaube schickt (Claude Code, ChatGPT per MCP, Posttaube, eigene Skripte), schickt
 * ein Objekt in dieser Form. Unbekannte Felder werden ignoriert, damit ältere Instanzen
 * neuere Sender verstehen.
 */
export const TAUBE_SPEC_VERSION = "taube/1" as const;

export const LIMITS = {
  title: 300,
  body: 20_000,
  tags: 20,
  tag: 50,
  links: 10,
  actions: 5,
  label: 100,
  url: 2048,
  context: 200,
  /** Größte erlaubte Anfrage in Bytes. */
  requestBytes: 64 * 1024,
} as const;

const httpUrl = z.url({ protocol: /^https?$/, error: "Nur http- und https-Links sind erlaubt." }).max(LIMITS.url);

export const linkSchema = z.object({
  label: z.string().trim().min(1).max(LIMITS.label),
  url: httpUrl,
});

/**
 * Eine Aktion ist ein Link, den das Dashboard als Knopf zeigt. Dashtaube ruft ihn nie
 * selbst auf: Der Knopf öffnet die Seite des Senders, und dort bestätigt der Mensch.
 */
export const actionSchema = linkSchema.extend({
  id: z.string().max(64).optional(),
  style: z.enum(["primary", "default", "danger"]).optional(),
});

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(LIMITS.tag)
  .regex(/^[\p{L}\p{N}_.:/-]+$/u, "Tags bestehen aus Buchstaben, Ziffern und _ . : / -");

const contextField = z.string().trim().min(1).max(LIMITS.context);

export const taubeEventSchema = z.object({
  specversion: z.literal(TAUBE_SPEC_VERSION).optional(),
  /** ID beim Sender. Kommt dieselbe ID von derselben Quelle zweimal, bleibt es eine Meldung. */
  id: z.string().trim().min(1).max(200).optional(),
  /** Name des sendenden Tools, nur zur Information. Die Quelle bestimmt das Token. */
  source: z.string().trim().max(100).optional(),
  /** Art der Meldung, z. B. `posttaube.review.requested` oder `claude_code.stop`. */
  type: z
    .string()
    .trim()
    .max(100)
    .regex(/^[a-z0-9_.-]+$/i)
    .optional(),
  title: z.string().trim().min(1).max(LIMITS.title),
  /** Markdown. */
  body: z.string().max(LIMITS.body).optional(),
  /** 1 = sehr niedrig, 3 = normal, 5 = dringend. */
  priority: z.number().int().min(1).max(5).optional(),
  tags: z.array(tagSchema).max(LIMITS.tags).optional(),
  /** Hauptlink der Meldung. */
  url: httpUrl.optional(),
  links: z.array(linkSchema).max(LIMITS.links).optional(),
  actions: z.array(actionSchema).max(LIMITS.actions).optional(),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
  /** KI-Kontext */
  agent: contextField.optional(),
  project: contextField.optional(),
  session: contextField.optional(),
  /** Wartet der Agent auf eine Antwort oder Freigabe? */
  needs_input: z.boolean().optional(),
  /** Für spätere Gruppierung gleichartiger Meldungen. */
  group_key: z.string().trim().min(1).max(200).optional(),
});

export type TaubeEvent = z.infer<typeof taubeEventSchema>;
export type TaubeEventInput = z.input<typeof taubeEventSchema>;
export type TaubeLink = z.infer<typeof linkSchema>;
export type TaubeAction = z.infer<typeof actionSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message));
}

export function parseTaubeEvent(input: unknown): ParseResult<TaubeEvent> {
  const result = taubeEventSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, errors: formatIssues(result.error) };
}
