# Stop-Loss-Rechner (statistikplus.de)

Der Stop-Loss-Rechner schickt werktags abends die fälligen Erinnerungen an Dashtaube. Jede Erinnerung wird eine Meldung in der Inbox. Kommt dieselbe `id` noch einmal, wird die Meldung aktualisiert (Titel, Text, Priorität), nicht doppelt angelegt. Ihr Status bleibt dabei erhalten: Was du erledigt hast, bleibt erledigt.

## Einrichten

1. Im Dashboard unter **Quellen** eine Quelle „Stop-Loss“ anlegen und den Token (`dt_…`) kopieren. Er wird nur einmal angezeigt und lässt sich dort jederzeit erneuern.
2. In der `config.php` des Stop-Loss-Rechners:

   ```php
   'erinnerung_kanaele'     => ['mail', 'webhook'],
   'erinnerung_webhook'     => 'https://<deine-instanz>.workers.dev/v1/hooks/stoploss',
   'erinnerung_webhook_key' => 'dt_…',
   ```

3. Testen:

   ```sh
   curl -X POST https://<deine-instanz>.workers.dev/v1/hooks/stoploss \
     -H "Authorization: Bearer dt_…" -H "Content-Type: application/json" \
     -d '{"quelle":"stoploss","erinnerungen":[{"id":999,"art":"stop_ablauf","faellig":"2026-10-30","ueberfaellig":false,"titel":"Test","text":"Testerinnerung","symbol":null,"broker_stop":null,"link":"https://statistikplus.de/stoploss/"}]}'
   ```

   Antwort `200` mit `{"angenommen":1,"neu":1,"aktualisiert":0,"ids":[…]}`, und „Test“ steht in der Inbox.

## Was ankommt

`POST /v1/hooks/stoploss` mit `Authorization: Bearer <Token>`. Falscher oder fehlender Token → `401`, ungültige Daten → `400` mit Details.

| Feld | Pflicht | In Dashtaube |
|---|---|---|
| `id` | ja | Erkennung von Wiederholungen (`stoploss-<id>`) |
| `art` | | Typ `stoploss.<art>` und Tag, z. B. `stop-ablauf` |
| `faellig` | | „Fällig: TT.MM.JJJJ“ im Text |
| `ueberfaellig` | | Priorität 5 statt 4, Tag `ueberfaellig` |
| `titel` | ja | Titel |
| `text` | | Text |
| `symbol` | | Projekt (Filter) und im Text |
| `broker_stop` | | „Stop beim Broker“ im Text |
| `link` | | Link „Öffnen“ |

Erinnerungen sind immer als „wartet auf dich“ markiert.

## Optional: „Erledigt“ zurückmelden

Setzt du im Dashboard eine Stop-Loss-Erinnerung auf erledigt, meldet Dashtaube das an den Stop-Loss-Rechner (`POST`, Header `X-Key`, Formular `erledigt=<id>`). Dafür zwei Secrets im Worker setzen (Cloudflare → Worker → Einstellungen → Variablen und Secrets):

| Secret | Wert |
|---|---|
| `STOPLOSS_ERLEDIGT_URL` | `https://statistikplus.de/stoploss/erinnerungen.php` |
| `STOPLOSS_ERLEDIGT_KEY` | `erinnerung_key` aus der `config.php` |

Fehlt eines davon, wird nichts zurückgemeldet. Schlägt die Rückmeldung fehl, steht das im Worker-Log; die Meldung bleibt trotzdem erledigt.
