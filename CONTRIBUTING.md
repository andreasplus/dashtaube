# Mitmachen

Schön, dass du helfen willst! Dashtaube ist ein kleines Projekt, Beiträge jeder Größe sind willkommen.

## Loslegen

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev        # http://localhost:8787
pnpm test
```

Du brauchst Node 22 und pnpm 10. Ein Cloudflare-Konto brauchst du nur zum Deployen.

## Regeln

- **Issues zuerst** für größere Änderungen, damit wir uns vorher abstimmen. Das Backlog liegt in den [Issues](https://github.com/andreasplus/dashtaube/issues).
- **Pull Requests** auf einem eigenen Branch, mit `Closes #…` für das Issue.
- **Tests:** Logik gehört nach `packages/core` und bekommt dort einen Test. Neue Endpunkte bekommen einen Test in `apps/worker/test`.
- **Vor dem PR:** `pnpm lint && pnpm typecheck && pnpm test`. Die CI prüft dasselbe.
- **UI-Texte** stehen in `apps/web/src/messages/{de,en}.json`. Wir duzen.
- **Sicherheit:** Tokens nur gehasht speichern, Eingaben einmal mit `zod` prüfen, Links aus Meldungen nie serverseitig aufrufen.
- **Schema-Änderungen:** Das Taube-Event-Schema ist öffentliche API. Felder nur hinzufügen, nie umbenennen oder entfernen, ohne die Version zu erhöhen.
- **Datenbank:** neue Migration in `apps/worker/migrations/` (`000N_beschreibung.sql`) und in `apps/worker/src/migrate.ts` eintragen, bestehende nie ändern.

Mit deinem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE) steht, und hältst dich an den [Verhaltenskodex](CODE_OF_CONDUCT.md).
