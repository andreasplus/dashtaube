# Posttaube → Dashtaube

Posttaube schickt Ereignisse, die bisher als Mail an den Nutzer gingen, als **signierten Webhook** an dessen Dashtaube-Instanz. Gegenstück im Posttaube-Backlog: FB-06 / API-11.

## Einrichten (Nutzer)

1. In Dashtaube unter *Quellen* eine Quelle der Art **„Posttaube (signierter Webhook)“** anlegen.
2. **Webhook-Adresse** (`https://<instanz>/v1/webhooks/src_…`) und **Signatur-Geheimnis** (`whsec_…`) in Posttaube eintragen.
3. In Posttaube pro Ereignis wählen: Dashtaube, Mail oder beides. Mail bleibt Fallback, wenn Dashtaube nicht antwortet.

## Format (Posttaube)

```
POST /v1/webhooks/{sourceId}
Content-Type: application/json
webhook-id: msg_2f1c…            eindeutig pro Ereignis, bei Wiederholung gleich
webhook-timestamp: 1761140000    Unix-Sekunden, max. 5 Minuten Abweichung
webhook-signature: v1,<base64(HMAC-SHA256(key, "{webhook-id}.{webhook-timestamp}.{body}"))>
```

`key` ist der Base64-dekodierte Teil nach `whsec_`. Das ist exakt [Standard Webhooks](https://www.standardwebhooks.com), Posttaube kann also die Bibliothek `standardwebhooks` nutzen oder `sendSignedEvent()` aus `@dashtaube/client`:

```ts
import { sendSignedEvent } from "@dashtaube/client";

await sendSignedEvent(user.dashtaubeWebhookUrl, user.dashtaubeSecret, {
  specversion: "taube/1",
  id: `review-${draft.id}`,
  type: "posttaube.review.requested",
  title: `Mail an ${draft.to} wartet auf Freigabe`,
  body: `**Betreff:** ${draft.subject}\n\nGeschrieben von ${draft.agentName} über *${gateway.name}*.`,
  url: `https://posttaube.app/review/${draft.id}`,
  actions: [{ label: "Prüfen und freigeben", url: `https://posttaube.app/review/${draft.id}`, style: "primary" }],
});
```

Der Body ist ein [Taube-Event](api.md#taube-event-schema-v1). Fehlt `id`, nimmt Dashtaube die `webhook-id`; Wiederholungen mit derselben ID ergeben keine doppelte Meldung (Antwort `200` mit `duplicate: true`).

**Wichtig:** Freigabe-Links nur als Link, nie als Aktion, die per GET etwas auslöst (RV-04-Lehre). Dashtaube ruft Links nie selbst auf.

## Ereignistypen und Standardwerte

| `type` | Posttaube | Priorität | Wartet auf dich | Tags |
|---|---|---|---|---|
| `posttaube.review.requested` | RV-04 Freigabe nötig | 4 | ja | `posttaube`, `freigabe` |
| `posttaube.send.failed` | RET-04 Senden fehlgeschlagen | 4 | | `posttaube`, `fehler` |
| `posttaube.mailbox.broken` | MBX-08 Postfach nicht erreichbar | 5 | ja | `posttaube`, `postfach` |
| `posttaube.limit.reached` | RL-04 Limit erreicht | 4 | | `posttaube`, `limit` |
| `posttaube.reply.received` | READ-08 Neue Antworten | 3 | | `posttaube`, `antwort` |
| `posttaube.digest` | RV-09 Zusammenfassung | 2 | | `posttaube`, `digest` |

Was Posttaube selbst setzt (`priority`, `needs_input`, weitere `tags`), gewinnt.

## Antworten

| Status | Was Posttaube tun sollte |
|---|---|
| `201`, `200` | Fertig |
| `400` | Payload-Fehler, nicht wiederholen, loggen |
| `401` | Signatur oder Zeit falsch. Nicht wiederholen, Nutzer auf falsches Geheimnis hinweisen, Mail-Fallback |
| `404` | Quelle gelöscht. Nutzer informieren, Mail-Fallback |
| `413` | Body > 64 KB, kürzen |
| `5xx` / Timeout | Mit Backoff wiederholen (gleiche `webhook-id`), danach Mail-Fallback |
