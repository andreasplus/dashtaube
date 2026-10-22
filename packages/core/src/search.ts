/** Markierungen für Suchtreffer (Zeichen aus dem Private-Use-Bereich, kommen in Texten praktisch nie vor). */
export const HIGHLIGHT_START = "";
export const HIGHLIGHT_END = "";

const MAX_TERMS = 12;

/**
 * Baut aus einer freien Sucheingabe eine sichere FTS5-Abfrage. Jedes Wort wird als
 * Phrase in Anführungszeichen gesetzt, damit Sonderzeichen wie `-`, `:` oder `*` keine
 * FTS5-Syntaxfehler auslösen. Alle Wörter müssen vorkommen; das letzte Wort darf ein
 * Wortanfang sein, damit die Suche schon beim Tippen trifft.
 */
export function buildFtsQuery(input: string): string | null {
  const terms = input
    .normalize("NFC")
    .split(/\s+/)
    .map((term) => term.replace(/["\p{Cc}]/gu, "").trim())
    .filter((term) => /[\p{L}\p{N}]/u.test(term))
    .slice(0, MAX_TERMS);
  if (terms.length === 0) return null;
  return terms.map((term, i) => `"${term}"${i === terms.length - 1 ? "*" : ""}`).join(" ");
}

/** Escaped HTML und wandelt die Treffer-Markierungen in `<mark>` um. */
export function highlightToHtml(text: string): string {
  return text
    .replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    .replaceAll(HIGHLIGHT_START, "<mark>")
    .replaceAll(HIGHLIGHT_END, "</mark>");
}
