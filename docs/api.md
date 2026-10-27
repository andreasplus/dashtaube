# Dashtaube-API

Alle Endpunkte liegen unter `/v1`. Quellen authentifizieren sich mit ihrem Token, das Dashboard mit einem Sitzungs-Cookie.

## Meldungen schicken

### `POST /v1/notify`

```
Authorization: Bearer dt_…
Content-Type: application/json
```

Body: ein [Taube-Event](#taube-event-schema-v1). Antwort:

| Status | Bedeutung |
|---|---|
| `201` | `{ "id": "ntf_…", "duplicate": false, "url": "https://…/n/ntf_…" }` |
| `200` | Gleiche `id` von derselben Quelle kam schon einmal: `{ "id": …, "duplicate": true }` |
| `400` | Ungültig, mit `details` pro Feld |
| `401` | Token fehlt, ist falsch oder wurde ersetzt |
| `413` | Body größer als 64 KB |

`POST /api/notify` ist ein Alias.

### `POST /v1/hooks/claude-code`

Nimmt die Eingabe eines Claude-Code-Hooks unverändert an (Token wie oben). Siehe [Claude-Code-Connector](../connectors/claude-code/README.md).

### `POST /v1/hooks/stoploss`

Erinnerungen vom Stop-Loss-Rechner (Token wie oben). Gleiche `id` aktualisiert die bestehende Meldung. Siehe [Stop-Loss-Connector](../connectors/stoploss/README.md).

### `POST /v1/webhooks/{sourceId}`

Signierte Webhooks nach [Standard Webhooks](https://www.standardwebhooks.com) statt Token. Siehe [Posttaube](posttaube.md).

### MCP: `POST /mcp`

Remote-MCP-Server (Streamable HTTP) mit OAuth 2.1. Siehe [MCP](mcp.md).

## Taube-Event-Schema (v1)

Definiert und versioniert in [`packages/core/src/event.ts`](../packages/core/src/event.ts). Unbekannte Felder werden ignoriert.

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `specversion` | `"taube/1"` | | Version des Schemas |
| `id` | string ≤ 200 | | ID beim Sender. Gleiche ID von derselben Quelle = dieselbe Meldung (Wiederholungen sind sicher). |
| `source` | string ≤ 100 | | Name des Tools, nur zur Info. Die Quelle bestimmt das Token. |
| `type` | string ≤ 100 | | Art, z. B. `posttaube.review.requested`, `claude_code.stop`. Bekannte Typen setzen Standardwerte. |
| `title` | string ≤ 300 | ✔ | Eine Zeile |
| `body` | string ≤ 20 000 | | Markdown |
| `priority` | 1–5 | | 1 sehr niedrig, 3 normal (Standard), 5 dringend |
| `tags` | string[] ≤ 20 | | Kleinbuchstaben, Ziffern, `_ . : / -` |
| `url` | http(s)-URL | | Hauptlink, Knopf „Öffnen“ |
| `links` | `{label, url}[]` ≤ 10 | | Weitere Links |
| `actions` | `{label, url, id?, style?}[]` ≤ 5 | | Knöpfe. Dashtaube ruft sie **nie selbst auf**, sie öffnen die Seite des Senders. `style`: `primary`, `default`, `danger`. |
| `occurred_at` | ISO 8601 mit Zeitzone | | Wann es passiert ist |
| `agent` | string ≤ 200 | | z. B. `claude-code`, `ChatGPT` |
| `project` | string ≤ 200 | | Projekt oder Repository |
| `session` | string ≤ 200 | | Sitzung oder Lauf |
| `needs_input` | boolean | | Wartet der Agent auf dich? |
| `group_key` | string ≤ 200 | | Für spätere Gruppierung |

Gespeichert werden zusätzlich `received_via` (`push`, später `pull`/`email`), `status` (`new`, `read`, `done`, `archived`), `snooze_until`, `created_at` und der Original-Body.

## Dashboard-API (Sitzung)

Für das eigene Dashboard, mit Cookie und gleichem `Origin`:

| Methode | Pfad | |
|---|---|---|
| `GET/POST/DELETE` | `/v1/session` | Status, Login `{password}`, Logout |
| `GET` | `/v1/notifications` | `view` (`inbox`, `snoozed`, `done`, `archived`, `all`), `source`, `min_priority`, `needs_input`, `q` (Volltext), `cursor`, `limit` |
| `GET/PATCH` | `/v1/notifications/{id}` | `PATCH {status?, snooze_until?}` |
| `POST` | `/v1/notifications/bulk` | `{ids, patch}` |
| `GET` | `/v1/counts` | Zähler und Quellen |
| `GET/POST` | `/v1/sources` | Quellen; `POST {name, kind, icon?, color?}` gibt Token (und bei `posttaube` Signatur-Geheimnis) einmalig zurück |
| `PATCH/DELETE` | `/v1/sources/{id}` | |
| `POST` | `/v1/sources/{id}/token` | Token rotieren |
| `POST` | `/v1/sources/{id}/signing-secret` | Signatur-Geheimnis rotieren |
| `POST` | `/v1/sources/{id}/disconnect` | MCP-Verbindung trennen |
| `POST` | `/v1/sources/{id}/test` | Testmeldung |
| `GET` | `/v1/live` | WebSocket mit `notification.created`, `notification.updated`, `sources.changed` |
