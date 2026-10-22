# Sicherheit

## Lücke melden

Bitte melde Sicherheitslücken **nicht** als öffentliches Issue, sondern über [GitHub Security Advisories](https://github.com/andreasplus/dashtaube/security/advisories/new). Wir antworten innerhalb von 7 Tagen.

Unterstützt wird jeweils der aktuelle Stand von `main`.

## Wie Dashtaube Daten schützt

- **Tokens** der Quellen und **Sitzungs-Cookies** werden nur als SHA-256-Hash gespeichert und sind nur einmal sichtbar.
- **Signatur-Geheimnisse** für Webhooks liegen im Klartext in D1, weil sie zum Prüfen der HMAC-Signatur gebraucht werden. Wer Zugriff auf deine D1-Datenbank hat, könnte damit Meldungen fälschen.
- **OAuth** (MCP): Tokens und Codes nur als Hash in KV, Verbindungsdaten verschlüsselt (`@cloudflare/workers-oauth-provider`). Zustimmungsseite mit Bindung an den Browser und ohne Framing.
- **Login:** ein Passwort pro Instanz (`ADMIN_PASSWORD`), Vergleich in konstanter Zeit, Sperre nach 10 Fehlversuchen in 15 Minuten pro IP.
- **CSRF:** Cookies mit `SameSite=Lax` und `HttpOnly`; ändernde Dashboard-Anfragen müssen vom eigenen Origin kommen.
- **Inhalte** von Meldungen werden als Markdown mit DOMPurify bereinigt angezeigt. Links öffnen in neuem Tab ohne Referrer. Dashtaube ruft Links aus Meldungen nie selbst auf.
- **Eingaben** werden einmal mit `zod` geprüft, Requests sind auf 64 KB begrenzt.
