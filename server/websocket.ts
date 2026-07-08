import { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { saveEvent } from "./db";
import type { Protocol, RdtEvent } from "../rdt/events";

type SocketMessage =
  | { type: "event"; event: RdtEvent }
  | { type: "events"; events: RdtEvent[] }
  | { type: "run-started"; runId: string }
  | { type: "run-finished"; runId: string };

const EVENT_BATCH_INTERVAL_MS = 25;
const EVENT_BATCH_MAX_SIZE = 80;

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
  let eventQueue: RdtEvent[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const send = (client: WebSocket, message: SocketMessage) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  };

  const broadcastToAll = (message: SocketMessage) => {
    for (const client of wss.clients) {
      send(client, message);
    }
  };

  const flushEvents = () => {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    if (!eventQueue.length) return;
    const events = eventQueue;
    eventQueue = [];
    broadcastToAll(events.length === 1 ? { type: "event", event: events[0] } : { type: "events", events });
  };

  eventBus.on("event", (event: RdtEvent) => {
    eventQueue.push(event);
    if (eventQueue.length >= EVENT_BATCH_MAX_SIZE) {
      flushEvents();
      return;
    }
    batchTimer ??= setTimeout(flushEvents, EVENT_BATCH_INTERVAL_MS);
  });

  eventBus.on("broadcast", (message: SocketMessage) => {
    broadcastToAll(message);
  });

  return wss;
}
