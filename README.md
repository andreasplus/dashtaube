# 🕊️ Dashtaube

**Dein zentraler Überblick über alle KI-Benachrichtigungen.** Claude Code, ChatGPT-Agenten, Posttaube und deine eigenen Skripte melden sich an einem Ort: eine Inbox mit Live-Updates, Volltextsuche und Tastaturkürzeln. Teil des Posttaube-Universums.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/andreasplus/dashtaube)

- **Open Source** (MIT) und für **Selbsthosting** gebaut: ein kostenloses Cloudflare-Konto reicht.
- **Serverless:** ein einziger Cloudflare Worker mit D1 (SQLite + FTS5), Durable Objects und KV.
- **Ein Format für alle:** das [Taube-Event-Schema](docs/api.md#taube-event-schema-v1) in `packages/core`.

## Was Dashtaube kann (MVP)

| | |
|---|---|
| **Inbox** | Chronologische Liste, Filter nach Quelle, Priorität und Status, „Wartet auf dich“-Ansicht, Markdown, Live-Updates per WebSocket |
| **Aktionen** | Gelesen, erledigt, archivieren, später (snoozen). Tastatur: `j`/`k`, `e`, `y`, `s`, `u`, `/`, `?` |
| **Suche** | Volltext über Titel, Text, Tags und Quelle (SQLite FTS5) mit markierten Treffern |
| **Quellen** | Eine Quelle pro Tool mit eigenem, rotierbarem Token (nur gehasht gespeichert) |
| **Claude Code** | Fertiger Hook für `Notification`, `Stop` und `SubagentStop` → [Anleitung](connectors/claude-code/README.md) |
| **ChatGPT & Claude per MCP** | Remote-MCP-Server mit OAuth 2.1, Tool `post_notification`, jede KI wird eine eigene Quelle → [Anleitung](docs/mcp.md) |
| **Posttaube** | Signierte Webhooks (Standard Webhooks, HMAC-SHA256) statt Mails → [Spezifikation](docs/posttaube.md) |
| **API** | `POST /v1/notify` mit Token → [API](docs/api.md) |

## In 5 Minuten selbst hosten

1. Auf **Deploy to Cloudflare** oben klicken und mit deinem Cloudflare-Konto anmelden.
2. Cloudflare legt eine Kopie des Repos in deinem GitHub an und erstellt D1-Datenbank, KV-Speicher und Durable Object.
3. Bei **ADMIN_PASSWORD** ein langes Passwort eintragen (z. B. `openssl rand -base64 24`).
4. Deploy abwarten. Die Datenbank-Migrationen laufen dabei automatisch.
5. `https://dashtaube.<dein-konto>.workers.dev` öffnen, anmelden, unter *Quellen* die erste Quelle anlegen und auf *Testmeldung* klicken.

### Ohne Button (mit der Kommandozeile)

```sh
git clone https://github.com/andreasplus/dashtaube && cd dashtaube
pnpm install
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD
pnpm build && pnpm run deploy   # legt D1 und KV beim ersten Mal an und migriert
```

## Eine Meldung schicken

```sh
curl -X POST https://dashtaube.<dein-konto>.workers.dev/v1/notify \
  -H "Authorization: Bearer dt_…" \
  -H "Content-Type: application/json" \
  -d '{"title":"Deploy fertig","body":"Version **1.4** ist live.","priority":3,"tags":["deploy"]}'
```

Aus TypeScript mit `@dashtaube/client`:

```ts
import { createClient } from "@dashtaube/client";

const dashtaube = createClient({ baseUrl: "https://…", token: "dt_…" });
await dashtaube.notify({ title: "Import fertig", priority: 2 });
```

## Entwickeln

```sh
pnpm install
cp .dev.vars.example .dev.vars   # ADMIN_PASSWORD für lokal
pnpm dev                         # baut das Dashboard, migriert die lokale D1 und startet wrangler dev auf :8787
pnpm dev:web                     # optional: Dashboard mit Hot Reload auf :5173 (leitet /v1 an :8787 weiter)
pnpm test                        # Vitest: core in Node, Worker in workerd (D1, DO, KV lokal)
pnpm lint && pnpm typecheck
```

### Aufbau

```
apps/worker      Cloudflare Worker: Hono-API, MCP-Server, OAuth, Durable Object, D1-Migrationen
apps/web         Dashboard (React + Vite), wird als Static Assets im selben Worker ausgeliefert
packages/core    Taube-Event-Schema, Normalisierung, Claude-Code-Mapping, Signaturen, Suche
packages/client  Kleiner Client: notify() mit Token, sendSignedEvent() für signierte Webhooks
connectors/      Fertige Anbindungen (Claude Code)
docs/            API, MCP, Posttaube
```

Mehr dazu in [CONTRIBUTING.md](CONTRIBUTING.md). Sicherheitslücken bitte vertraulich melden, siehe [SECURITY.md](SECURITY.md).

## Lizenz

[MIT](LICENSE)
