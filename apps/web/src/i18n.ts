import de from "./messages/de.json";
import en from "./messages/en.json";

export type MessageKey = keyof typeof de;

const catalogs: Record<string, Record<string, string>> = { de, en };
export const locale = navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
const messages = catalogs[locale] ?? de;

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = messages[key] ?? (de as Record<string, string>)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
const timeFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" });
const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

export function formatDate(ms: number): string {
  return dateFormat.format(ms);
}

/** Kurz für die Liste: "gerade eben", "vor 5 Min.", "14:32", "3. Okt." */
export function formatShort(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return t("time.justNow");
  if (diff < 60 * 60_000) return relative.format(-Math.round(diff / 60_000), "minute");
  const date = new Date(ms);
  if (new Date(now).toDateString() === date.toDateString()) return timeFormat.format(date);
  return dayFormat.format(date);
}
