# ChatGPT, Claude und andere KIs per MCP verbinden

Dashtaube ist ein Remote-MCP-Server unter `https://<deine-instanz>/mcp` (Streamable HTTP). Die Anmeldung läuft über OAuth 2.1 mit dynamischer Client-Registrierung und PKCE (`@cloudflare/workers-oauth-provider`). Du musst nichts vorab einrichten.

## So verbindest du eine KI

1. **ChatGPT:** *Einstellungen → Apps & Connectors → Erstellen* (Entwicklermodus), als URL `https://<deine-instanz>/mcp` eintragen, Authentifizierung OAuth.
   **Claude:** *Einstellungen → Connectors → Eigenen Connector hinzufügen*, dieselbe URL.
   **Claude Code:** `claude mcp add --transport http dashtaube https://<deine-instanz>/mcp`
2. Die KI öffnet Dashtaube. Wenn du nicht angemeldet bist, meldest du dich zuerst an.
3. Auf der Zustimmungsseite siehst du, welche App sich verbinden will und wohin der Zugang geht. Du kannst den Namen der Quelle anpassen und auf **Erlauben** klicken.
4. Fertig. Die KI erscheint unter *Quellen* als eigene Quelle („KI per MCP“). Dort kannst du sie auch wieder trennen.

## Tool `post_notification`

| Parameter | Typ | Beschreibung |
|---|---|---|
| `title` | string | Pflicht. Kurzer Titel, eine Zeile. |
| `body` | string | Details als Markdown |
| `priority` | 1–5 | Standard 3 |
| `tags` | string[] | Schlagwörter |
| `url` | string | Link zu Ergebnis, Chat oder PR |
| `project` | string | Projekt oder Repository |
| `session` | string | Kennung des Chats oder Laufs |
| `needs_input` | boolean | `true`, wenn die KI auf dich wartet |

Die Antwort enthält die ID und den Link zur Meldung (`structuredContent: {id, url}`).

Der Server ist zustandslos (JSON-Antworten, keine SSE-Streams). Er darf nur Meldungen schicken, nicht lesen. Lesen und Suchen per MCP ist für später geplant (Backlog #36).

`serverInfo.version` enthält Version und Deploy-ID, z. B. `0.1.0+1a2b3c4d`.
