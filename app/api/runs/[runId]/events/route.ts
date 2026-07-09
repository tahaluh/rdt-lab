import { NextResponse } from "next/server";
import { getRun, listEvents } from "@/server/db";
import { eventBus } from "@/server/websocket";
import type { RdtEventType } from "@/rdt/events";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { runId: string } }) {
  return NextResponse.json({ events: listEvents(params.runId) });
}

export async function POST(request: Request, { params }: { params: { runId: string } }) {
  const run = getRun(params.runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const body = await request.json() as {
    events?: Array<{
      type?: RdtEventType;
      packetId?: number;
      seq?: number;
      message?: string;
      metadata?: Record<string, unknown>;
    }>;
  };

  const allowedTypes = new Set<RdtEventType>(["PACKET_SENT", "ACK_RECEIVED", "TIMER_STARTED", "TIMEOUT", "RETRANSMISSION"]);
  const events = (body.events ?? []).filter((event) => event.type && allowedTypes.has(event.type));
  for (const event of events) {
    eventBus.emitRdt({
      runId: params.runId,
      protocol: run.protocol,
      type: event.type as RdtEventType,
      packetId: Number(event.packetId ?? 0),
      seq: Number(event.seq ?? event.packetId ?? 0),
      message: event.message ?? `[CLIENT] ${event.type} packet ${event.packetId ?? 0}`,
      metadata: { ...(event.metadata ?? {}), externalClient: true }
    });
  }

  return NextResponse.json({ accepted: events.length });
}
