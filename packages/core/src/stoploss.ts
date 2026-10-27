import { z } from "zod";
import { formatIssues, type ParseResult, type TaubeEventInput } from "./event.js";

/**
 * Eingang für den Stop-Loss-Rechner (statistikplus.de). Er schickt werktags abends
 * die fälligen Erinnerungen als Liste. Jede Erinnerung hat eine feste `id`; kommt sie
 * wieder, wird die bestehende Meldung aktualisiert.
 */
const erinnerungSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().trim().min(1).max(100)]),
  art: z
    .string()
    .trim()
    .max(50)
    .regex(/^[a-z0-9_]+$/i)
    .default("erinnerung"),
  faellig: z.iso.date().optional().nullable(),
  ueberfaellig: z.boolean().optional().default(false),
  titel: z.string().trim().min(1).max(300),
  text: z.string().max(20_000).optional().nullable(),
  symbol: z.string().trim().max(50).optional().nullable(),
  broker_stop: z.number().optional().nullable(),
  link: z.url({ protocol: /^https?$/ }).max(2048).optional().nullable(),
});

export const stoplossPayloadSchema = z.object({
  quelle: z.string().max(50).optional(),
  erinnerungen: z.array(erinnerungSchema).max(200),
});

export type StoplossPayload = z.infer<typeof stoplossPayloadSchema>;

export const STOPLOSS_TYPE_PREFIX = "stoploss.";
const EXTERNAL_PREFIX = "stoploss-";

/** `stoploss-17` → `"17"`, sonst `null`. */
export function stoplossIdFromExternal(externalId: string | null): string | null {
  return externalId?.startsWith(EXTERNAL_PREFIX) ? externalId.slice(EXTERNAL_PREFIX.length) : null;
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

export function stoplossToEvents(input: unknown): ParseResult<TaubeEventInput[]> {
  const parsed = stoplossPayloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error) };

  const events = parsed.data.erinnerungen.map((e): TaubeEventInput => {
    const details: string[] = [];
    if (e.faellig) details.push(`**Fällig:** ${formatDate(e.faellig)}${e.ueberfaellig ? " (überfällig)" : ""}`);
    if (e.symbol) details.push(`**Symbol:** ${e.symbol}`);
    if (e.broker_stop != null) details.push(`**Stop beim Broker:** ${e.broker_stop.toLocaleString("de-DE")}`);
    const body = [e.text?.trim(), details.join("  \n")].filter(Boolean).join("\n\n");
    return {
      specversion: "taube/1",
      id: `${EXTERNAL_PREFIX}${e.id}`,
      source: "stoploss",
      type: `${STOPLOSS_TYPE_PREFIX}${e.art.toLowerCase()}`,
      title: e.titel,
      ...(body ? { body } : {}),
      priority: e.ueberfaellig ? 5 : 4,
      needs_input: true,
      tags: ["stoploss", e.art.toLowerCase().replace(/_/g, "-"), ...(e.ueberfaellig ? ["ueberfaellig"] : [])],
      ...(e.link ? { url: e.link } : {}),
      ...(e.symbol ? { project: e.symbol } : {}),
      group_key: `stoploss:${e.id}`,
    };
  });
  return { ok: true, value: events };
}
