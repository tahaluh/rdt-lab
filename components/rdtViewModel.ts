import type { PacketState, RdtEvent, RunRecord } from "@/rdt/events";

export type PacketView = {
  packetId: number;
  state: PacketState;
  events: RdtEvent[];
};

export type Stats = {
  totalPackets: number;
  packetsSent: number;
  packetsReceived: number;
  acksReceived: number;
  losses: number;
  corruptions: number;
  retransmissions: number;
  duplicates: number;
  timeouts: number;
  bytesSent: number;
  usefulBytes: number;
  overheadBytes: number;
  efficiency: number;
  retransmissionRate: number;
  overheadRate: number;
  successRate: number;
  elapsedMs: number;
  throughput: number;
  currentSpeed: number;
  avgRtt: number;
  ok?: boolean;
};

const priority: Record<PacketState, number> = {
  pending: 0,
  created: 1,
  sent: 2,
  received: 3,
  acknowledged: 4,
  lost: 5,
  corrupted: 6,
  retransmitted: 7,
  duplicated: 8
};

function stateFromEvent(type: RdtEvent["type"]): PacketState | null {
  if (type === "PACKET_CREATED") return "created";
  if (type === "PACKET_SENT") return "sent";
  if (type === "PACKET_RECEIVED" || type === "PACKET_WRITTEN") return "received";
  if (type === "PACKET_LOST") return "lost";
  if (type === "PACKET_CORRUPTED") return "corrupted";
  if (type === "RETRANSMISSION") return "retransmitted";
  if (type === "DUPLICATE_RECEIVED") return "duplicated";
  if (type === "ACK_RECEIVED") return "acknowledged";
  return null;
}

export function buildPackets(run: RunRecord | null, events: RdtEvent[]): PacketView[] {
  const total = run ? Math.ceil(run.fileSize / run.payloadSize) || 1 : 0;
  const packetEvents = new Map<number, RdtEvent[]>();
  for (const event of events) {
    if (event.packetId == null) continue;
    packetEvents.set(event.packetId, [...(packetEvents.get(event.packetId) ?? []), event]);
  }
  return Array.from({ length: total }, (_, packetId) => {
    const eventsForPacket = packetEvents.get(packetId) ?? [];
    const state = eventsForPacket.reduce<PacketState>((current, event) => {
      const next = stateFromEvent(event.type);
      return next && priority[next] >= priority[current] ? next : current;
    }, "pending");
    return { packetId, state, events: eventsForPacket };
  });
}

export function buildStats(run: RunRecord | null, events: RdtEvent[]): Stats {
  const elapsedMs = run ? (run.finishedAt ?? Date.now()) - run.startedAt : 0;
  const totalPackets = run ? Math.ceil(run.fileSize / run.payloadSize) || 1 : 0;
  const packetsSent = events.filter((event) => event.type === "PACKET_SENT").length;
  const packetsReceived = events.filter((event) => event.type === "PACKET_RECEIVED").length;
  const acksReceived = events.filter((event) => event.type === "ACK_RECEIVED").length;
  const retransmissions = events.filter((event) => event.type === "RETRANSMISSION").length;
  const timeouts = events.filter((event) => event.type === "TIMEOUT").length;
  const acknowledgedBytes = run ? Math.min(run.fileSize, acksReceived * run.payloadSize) : 0;
  const bytesSent = run ? packetsSent * run.payloadSize : 0;
  const usefulBytes = run ? Math.min(run.fileSize, acksReceived * run.payloadSize) : 0;
  const overheadBytes = Math.max(0, bytesSent - usefulBytes);
  const rtts = events
    .map((event) => (typeof event.metadata?.rttMs === "number" ? event.metadata.rttMs : null))
    .filter((rtt): rtt is number => rtt != null);
  const hashEvent = [...events].reverse().find((event) => event.type === "HASH_VERIFIED");
  return {
    totalPackets,
    packetsSent,
    packetsReceived,
    acksReceived,
    losses: events.filter((event) => event.type === "PACKET_LOST" || event.type === "ACK_LOST").length,
    corruptions: events.filter((event) => event.type === "PACKET_CORRUPTED").length,
    retransmissions,
    duplicates: events.filter((event) => event.type === "DUPLICATE_RECEIVED").length,
    timeouts,
    bytesSent,
    usefulBytes,
    overheadBytes,
    efficiency: bytesSent > 0 ? (usefulBytes / bytesSent) * 100 : 0,
    retransmissionRate: packetsSent > 0 ? (retransmissions / packetsSent) * 100 : 0,
    overheadRate: bytesSent > 0 ? (overheadBytes / bytesSent) * 100 : 0,
    successRate: totalPackets > 0 ? (acksReceived / totalPackets) * 100 : 0,
    elapsedMs,
    throughput: run && elapsedMs > 0 ? run.fileSize / (elapsedMs / 1000) : 0,
    currentSpeed: elapsedMs > 0 ? acknowledgedBytes / (elapsedMs / 1000) : 0,
    avgRtt: rtts.length ? rtts.reduce((sum, rtt) => sum + rtt, 0) / rtts.length : 0,
    ok: typeof hashEvent?.metadata?.ok === "boolean" ? Boolean(hashEvent.metadata.ok) : undefined
  };
}
