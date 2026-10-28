import type { LiveEvent } from "@dashtaube/core/notification";
import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Eine WebSocket-Verbindung zu /v1/live für die ganze App. App hält sie mit
 * `useLiveConnection` offen, Seiten und das Klingeln hören mit `useLive` mit.
 */

const listeners = new Set<(event: LiveEvent) => void>();
const connectionListeners = new Set<() => void>();
let connected = false;

function setConnected(value: boolean): void {
  connected = value;
  for (const notify of connectionListeners) notify();
}

function subscribeConnection(notify: () => void): () => void {
  connectionListeners.add(notify);
  return () => connectionListeners.delete(notify);
}

/** Hält die Verbindung offen, solange `enabled` gilt, und verbindet sich bei Abbruch neu. */
export function useLiveConnection(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/v1/live`);
      socket.onopen = () => {
        attempts = 0;
        setConnected(true);
        ping = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), 30_000);
      };
      socket.onmessage = (message) => {
        if (message.data === "pong") return;
        let event: LiveEvent;
        try {
          event = JSON.parse(message.data as string) as LiveEvent;
        } catch {
          return; // unbekanntes Format ignorieren
        }
        for (const listener of listeners) listener(event);
      };
      socket.onclose = () => {
        setConnected(false);
        clearInterval(ping);
        if (stopped) return;
        attempts++;
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)));
      };
    };
    connect();

    // Nach dem Aufwachen des Geräts sofort neu verbinden.
    const onVisible = () => {
      if (document.visibilityState === "visible" && socket?.readyState === WebSocket.CLOSED) {
        clearTimeout(retry);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    };
  }, [enabled]);
}

/** Hört auf Live-Ereignisse und gibt zurück, ob die Verbindung steht. */
export function useLive(onEvent: (event: LiveEvent) => void): boolean {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const listener = (event: LiveEvent) => handler.current(event);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return useSyncExternalStore(subscribeConnection, () => connected);
}
