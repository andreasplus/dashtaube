# Claude Code → Dashtaube

Mit diesem Hook meldet sich Claude Code in deiner Dashtaube-Inbox:

| Hook | Wann | In Dashtaube |
|---|---|---|
| `Notification` | Claude braucht eine Erlaubnis oder wartet seit einer Minute auf dich | „Wartet auf dich“, Priorität 4 (Erlaubnis) oder 3 |
| `Stop` | Claude ist mit einer Antwort fertig | „Claude Code ist fertig in ‹Projekt›“, mit der letzten Antwort als Text |
| `SubagentStop` | Ein Subagent ist fertig | Priorität 2 |

Projekt (Ordnername), Sitzungs-ID und „wartet auf Input“ werden automatisch mitgeschickt. Dashtaube wertet die Eingabe des Hooks selbst aus, das Skript braucht deshalb nur `curl` und kein `jq`.

## Einrichten in drei Schritten

1. **Quelle anlegen.** In Dashtaube unter *Quellen* eine neue Quelle der Art „Claude Code (Hook)“ anlegen und das Token kopieren.

2. **Skript ablegen.**

   ```sh
   mkdir -p ~/.claude/hooks
   curl -o ~/.claude/hooks/dashtaube-hook.sh \
     https://raw.githubusercontent.com/andreasplus/dashtaube/main/connectors/claude-code/dashtaube-hook.sh
   chmod +x ~/.claude/hooks/dashtaube-hook.sh
   ```

   Unter Windows ohne Git Bash nimmst du `dashtaube-hook.ps1` und trägst als Befehl
   `powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\.claude\hooks\dashtaube-hook.ps1` ein.

3. **Hooks eintragen.** Den Inhalt von [`settings.example.json`](settings.example.json) in `~/.claude/settings.json` übernehmen (für alle Projekte) oder in `.claude/settings.json` eines Projekts. Adresse und Token anpassen. Wenn du schon Hooks hast, die Einträge ergänzen statt ersetzen.

Danach in Claude Code `/hooks` aufrufen, um zu prüfen, ob die Hooks geladen sind.

## Ohne Skript

Wer keine Datei ablegen will, kann den Befehl direkt eintragen (macOS/Linux):

```json
{
  "type": "command",
  "command": "curl -s --max-time 5 -X POST \"$DASHTAUBE_URL/v1/hooks/claude-code\" -H \"Authorization: Bearer $DASHTAUBE_TOKEN\" -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true"
}
```

## Ausprobieren

```sh
echo '{"hook_event_name":"Notification","cwd":"'"$PWD"'","session_id":"test","message":"Claude wartet auf dich"}' \
  | DASHTAUBE_URL=https://… DASHTAUBE_TOKEN=dt_… ~/.claude/hooks/dashtaube-hook.sh
```

Die Meldung sollte sofort in der Inbox erscheinen.
