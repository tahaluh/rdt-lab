import { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { saveEvent } from "./db";
import type { Protocol, RdtEvent } from "../rdt/events";

type SocketMessage =
  | { type: "event"; event: RdtEvent }
  | { type: "run-started"; runId: string }
  | { type: "run-finished"; runId: string };

class RdtEventBus extends EventEmitter {
  emitRdt(event: Omit<RdtEvent, "timestamp" | "protocol"> & { timestamp?: number; protocol?: Protocol }): RdtEvent {
    const enriched = saveEvent({
      protocol: event.protocol ?? "STOP_AND_WAIT",
      timestamp: Date.now(),
      ...event
    });
    this.emit("event", enriched);
    return enriched;
  }

  broadcast(message: SocketMessage): void {
    this.emit("broadcast", message);
  }
}

declare global {
  // Next dev bundles API routes separately; keep one event bus for the whole Node process.
  // eslint-disable-next-line no-var
  var __rdtEventBus: RdtEventBus | undefined;
}

export const eventBus = (globalThis.__rdtEventBus ??= new RdtEventBus());

export function attachWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  const send = (client: WebSocket, message: SocketMessage) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  };

  eventBus.on("event", (event: RdtEvent) => {
    for (const client of wss.clients) {
      send(client, { type: "event", event });
    }
  });

  eventBus.on("broadcast", (message: SocketMessage) => {
    for (const client of wss.clients) {
      send(client, message);
    }
  });

  return wss;
}
