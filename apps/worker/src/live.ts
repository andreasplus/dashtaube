import { DurableObject } from "cloudflare:workers";
import type { LiveEvent } from "@dashtaube/core";
import type { Env } from "./env.js";

/**
 * Ein Durable Object pro Instanz verteilt neue und geänderte Meldungen an alle offenen
 * Dashboards. Es nutzt WebSocket-Hibernation: Solange nichts passiert, schläft es und
 * kostet nichts. Ping/Pong beantwortet die Laufzeit, ohne es aufzuwecken.
 */
export class InboxHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket erwartet", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message: string): number {
    let sent = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
        sent++;
      } catch {
        // Verbindung ist schon zu, die Laufzeit räumt sie auf.
      }
    }
    return sent;
  }

  override async webSocketMessage(): Promise<void> {
    // Das Dashboard schickt außer "ping" nichts.
  }

  override async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    try {
      socket.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // schon geschlossen
    }
  }
}

function hub(env: Env) {
  return env.INBOX_HUB.get(env.INBOX_HUB.idFromName("owner"));
}

export function liveFetch(env: Env, request: Request): Promise<Response> {
  return hub(env).fetch(request);
}

export async function publish(env: Env, event: LiveEvent): Promise<void> {
  try {
    await hub(env).broadcast(JSON.stringify(event));
  } catch (error) {
    console.warn("Live-Update fehlgeschlagen", error);
  }
}
