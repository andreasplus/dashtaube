import type { Notification } from "@dashtaube/core/notification";
import { t } from "./i18n";
import { navigate } from "./router";

/**
 * Macht auf neue Meldungen von Quellen aufmerksam, bei denen "Klingeln" eingeschaltet ist:
 * Ton, Desktop-Benachrichtigung, blinkender Tab-Titel und ein roter Punkt im Favicon.
 * Was pro Quelle gilt, speichert der Server. Ob dieser Browser einen Ton spielt, merkt sich der Browser.
 */

const SOUND_KEY = "dashtaube.alerts.sound";
const CLAIM_KEY = "dashtaube.alerts.last";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // privates Fenster o. Ä.: dann eben ohne Speicher
  }
}

export function soundEnabled(): boolean {
  return read(SOUND_KEY) !== "off";
}

export function setSoundEnabled(on: boolean): void {
  write(SOUND_KEY, on ? "on" : "off");
}

// ---------------------------------------------------------------- Ton

let audio: AudioContext | null = null;

/** Browser spielen Ton erst nach einer Interaktion. Beim ersten Klick oder Tastendruck freischalten. */
function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, unlockAudio, { passive: true });

/** Kurzer Zwei-Ton-Gong, ohne Audiodatei. */
export function playChime(): void {
  unlockAudio();
  const ctx = audio;
  if (!ctx) return;
  const play = () => {
    if (ctx.state !== "running") return;
    const start = ctx.currentTime;
    for (const [frequency, offset] of [
      [880, 0],
      [1318.5, 0.16],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const at = start + offset;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.65);
    }
  };
  if (ctx.state === "running") play();
  else ctx.resume().then(play, () => undefined);
}

// ---------------------------------------------------------------- Desktop-Benachrichtigung

export type Permission = NotificationPermission | "unsupported";

export function notificationPermission(): Permission {
  return "Notification" in window ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<Permission> {
  if (!("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
}

function showDesktop(n: Notification): void {
  if (notificationPermission() !== "granted") return;
  try {
    const shown = new window.Notification(n.title, {
      body: [n.source_name, n.body?.slice(0, 160)].filter(Boolean).join(" · "),
      tag: n.id,
      icon: "/favicon.svg",
      requireInteraction: n.needs_input,
    });
    shown.onclick = () => {
      window.focus();
      navigate(`/n/${encodeURIComponent(n.id)}`);
      shown.close();
    };
  } catch {
    // z. B. Chrome auf Android: dort gehen Benachrichtigungen nur über einen Service Worker.
  }
}

// ---------------------------------------------------------------- Tab-Titel und Favicon

let baseTitle = document.title;
let pending: Notification[] = [];
let blink: ReturnType<typeof setInterval> | undefined;
let blinkOn = false;
let originalIcon: string | null = null;

function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>("link[rel='icon']");
}

function setBadge(on: boolean): void {
  const link = iconLink();
  if (!link) return;
  originalIcon ??= link.href;
  if (!on) {
    link.href = originalIcon;
    return;
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4f5bd5"/>' +
    '<path d="M14 38c6-14 18-22 32-22-3 4-4 8-3 12 4 1 6 4 7 8-8 0-12 6-22 6-6 0-11-1-14-4z" fill="#fff"/>' +
    '<circle cx="41" cy="25" r="2" fill="#4f5bd5"/><circle cx="50" cy="14" r="13" fill="#ef4444" stroke="#fff" stroke-width="3"/></svg>';
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function render(): void {
  const latest = pending[0];
  document.title = latest && blinkOn ? `🔔 ${latest.title}` : baseTitle;
}

/** Inbox setzt hier den normalen Titel, z. B. "(3) Dashtaube". */
export function setBaseTitle(title: string): void {
  baseTitle = title;
  render();
}

function attentionNeeded(): boolean {
  return document.visibilityState === "hidden" || !document.hasFocus();
}

function startAttention(n: Notification): void {
  pending = [n, ...pending.filter((p) => p.id !== n.id)];
  setBadge(true);
  if (!blink) {
    blinkOn = true;
    blink = setInterval(() => {
      blinkOn = !blinkOn;
      render();
    }, 1000);
  }
  render();
}

function clearAttention(): void {
  if (pending.length === 0 || attentionNeeded()) return;
  pending = [];
  clearInterval(blink);
  blink = undefined;
  blinkOn = false;
  setBadge(false);
  render();
}
document.addEventListener("visibilitychange", clearAttention);
window.addEventListener("focus", clearAttention);

// ---------------------------------------------------------------- Auslöser

/**
 * Mehrere offene Tabs bekommen dieselbe Meldung. Nur einer soll klingeln und die
 * Desktop-Benachrichtigung zeigen.
 */
function claim(id: string): boolean {
  if (read(CLAIM_KEY) === id) return false;
  write(CLAIM_KEY, id);
  return true;
}

/** Für eine neue Meldung von einer Quelle mit eingeschaltetem Klingeln. */
export function announce(n: Notification): void {
  if (n.status !== "new" || (n.snooze_until !== null && n.snooze_until > Date.now())) return;
  if (claim(n.id)) {
    if (soundEnabled()) playChime();
    if (attentionNeeded()) showDesktop(n);
  }
  if (attentionNeeded()) startAttention(n);
}

/** Zum Ausprobieren auf der Quellen-Seite. */
export function testAlert(): void {
  playChime();
  if (notificationPermission() === "granted") {
    try {
      new window.Notification(t("alerts.testTitle"), { body: t("alerts.testBody"), icon: "/favicon.svg" });
    } catch {
      // siehe showDesktop
    }
  }
}
