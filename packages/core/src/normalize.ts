import type { TaubeEvent } from "./event.js";

/** Standardwerte für bekannte Event-Typen. Was der Sender selbst setzt, gewinnt. */
export interface TypeDefaults {
  priority?: number;
  needs_input?: boolean;
  tags?: string[];
}

/**
 * Posttaube-Ereignisse, die bisher als Mail an den Nutzer gingen.
 * Die Kürzel verweisen auf das Posttaube-Backlog.
 */
export const POSTTAUBE_TYPES = {
  /** RV-04: Eine Mail wartet auf Freigabe. */
  "posttaube.review.requested": { priority: 4, needs_input: true, tags: ["posttaube", "freigabe"] },
  /** RET-04: Senden ist endgültig fehlgeschlagen. */
  "posttaube.send.failed": { priority: 4, tags: ["posttaube", "fehler"] },
  /** MBX-08: Ein Postfach ist nicht mehr erreichbar (z. B. App-Passwort ungültig). */
  "posttaube.mailbox.broken": { priority: 5, needs_input: true, tags: ["posttaube", "postfach"] },
  /** RL-04: Ein Versandlimit ist erreicht. */
  "posttaube.limit.reached": { priority: 4, tags: ["posttaube", "limit"] },
  /** READ-08: Neue Antworten sind eingegangen. */
  "posttaube.reply.received": { priority: 3, tags: ["posttaube", "antwort"] },
  /** RV-09: Zusammenfassung. */
  "posttaube.digest": { priority: 2, tags: ["posttaube", "digest"] },
} satisfies Record<string, TypeDefaults>;

export type PosttaubeType = keyof typeof POSTTAUBE_TYPES;

export function defaultsForType(type: string | undefined): TypeDefaults {
  if (!type) return {};
  return (POSTTAUBE_TYPES as Record<string, TypeDefaults>)[type] ?? {};
}

/** Die Werte, die Dashtaube für eine neue Meldung speichert. */
export interface NotificationDraft {
  external_id: string | null;
  type: string | null;
  title: string;
  body: string | null;
  priority: number;
  tags: string[];
  url: string | null;
  links: TaubeEvent["links"] & {};
  actions: TaubeEvent["actions"] & {};
  agent: string | null;
  project: string | null;
  session: string | null;
  needs_input: boolean;
  group_key: string | null;
  occurred_at: number | null;
}

/** Macht aus einem geprüften Taube-Event die zu speichernde Meldung. */
export function toNotificationDraft(event: TaubeEvent): NotificationDraft {
  const defaults = defaultsForType(event.type);
  const tags = [...new Set([...(defaults.tags ?? []), ...(event.tags ?? [])])].slice(0, 20);
  const occurred = event.occurred_at ? Date.parse(event.occurred_at) : NaN;
  return {
    external_id: event.id ?? null,
    type: event.type ?? null,
    title: event.title,
    body: event.body?.trim() ? event.body : null,
    priority: event.priority ?? defaults.priority ?? 3,
    tags,
    url: event.url ?? null,
    links: event.links ?? [],
    actions: event.actions ?? [],
    agent: event.agent ?? null,
    project: event.project ?? null,
    session: event.session ?? null,
    needs_input: event.needs_input ?? defaults.needs_input ?? false,
    group_key: event.group_key ?? null,
    occurred_at: Number.isFinite(occurred) ? occurred : null,
  };
}
