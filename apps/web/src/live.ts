import type { LiveEvent } from "@dashtaube/core/notification";
import { useEffect, useRef, useState } from "react";

/** Hält eine WebSocket-Verbindung zu /v1/live offen und verbindet sich bei Abbruch neu. */
export function useLive(onEvent: (event: LiveEvent) => void, enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

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
        try {
          handler.current(JSON.parse(message.data as string) as LiveEvent);
        } catch {
          // unbekanntes Format ignorieren
        }
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

  return connected;
}
