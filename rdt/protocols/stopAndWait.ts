import crypto from "node:crypto";
import { createRun, listEvents, updateRunFinished } from "../../server/db";
import { eventBus } from "../../server/websocket";
import { fileHash } from "../checksum";
import { hashFilePath, readInputFile } from "../fileUtils";
import type { Protocol, RunConfig, RunRecord } from "../events";
import { makePacket, type RdtPacket } from "../packet";
import { RdtUdpClient } from "../udpClient";
import { RdtUdpServer } from "../udpServer";
import { artificialDelay, sleep } from "../unreliableChannel";

declare global {
  // Next dev may evaluate route modules separately; active UDP runs must stay process-wide.
  // eslint-disable-next-line no-var
  var __rdtActiveRuns: Map<string, AbortController> | undefined;
}

const activeRuns = (globalThis.__rdtActiveRuns ??= new Map<string, AbortController>());

const protocolNames: Record<Protocol, string> = {
  UDP: "UDP puro",
  STOP_AND_WAIT: "Stop-and-Wait",
  GO_BACK_N: "Go-Back-N",
  SELECTIVE_REPEAT: "Selective Repeat"
};

export async function startTransportRun(config: RunConfig): Promise<RunRecord> {
  const runId = crypto.randomUUID();
  const input = await readInputFile(config.fileName);
  const originalHash = fileHash(input);
  const run: RunRecord = {
    id: runId,
    protocol: config.protocol,
    fileName: config.fileName,
    fileSize: input.byteLength,
    payloadSize: config.payloadSize,
    packetLossRate: config.packetLossRate,
    ackLossRate: config.ackLossRate,
    corruptionRate: config.corruptionRate,
    artificialDelayMs: config.artificialDelayMs,
    timeoutMs: config.timeoutMs,
    status: "running",
    startedAt: Date.now(),
    originalHash
  };
  createRun(run, config);
  const controller = new AbortController();
  activeRuns.set(runId, controller);
  eventBus.emitRdt({
    runId,
    protocol: config.protocol,
    type: "RUN_STARTED",
    message: `[RUN] ${protocolNames[config.protocol]} started for ${config.fileName}`,
    metadata: { config, fileSize: input.byteLength }
  });
  eventBus.broadcast({ type: "run-started", runId });

  void executeRun(runId, config, input, originalHash, controller.signal).finally(() => activeRuns.delete(runId));
  return run;
}

export async function startStopAndWait(config: RunConfig): Promise<RunRecord> {
  return startTransportRun({ ...config, protocol: "STOP_AND_WAIT", windowSize: 1 });
}

export function isRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

export function stopRun(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

async function executeRun(runId: string, config: RunConfig, input: Buffer, originalHash: string, signal: AbortSignal): Promise<void> {
  const server = new RdtUdpServer(runId, config);
  const client = new RdtUdpClient();
  try {
    const serverPort = await server.start();
    await client.start();
    const packets = createPackets(runId, config, input);
    if (config.protocol === "UDP") await executeUdp(runId, config, packets, client, serverPort, signal);
    if (config.protocol === "STOP_AND_WAIT") await executeStopAndWait(runId, config, packets, client, serverPort, signal);
    if (config.protocol === "GO_BACK_N") await executeGoBackN(runId, config, packets, client, serverPort, signal);
    if (config.protocol === "SELECTIVE_REPEAT") await executeSelectiveRepeat(runId, config, packets, client, serverPort, signal);

    const receivedHash = await hashFilePath(server.getOutputPath());
    eventBus.emitRdt({
      runId,
      protocol: config.protocol,
      type: "TRANSFER_FINISHED",
      message: `[RUN] Transfer finished`,
      metadata: { outputPath: server.getOutputPath() }
    });
    eventBus.emitRdt({
      runId,
      protocol: config.protocol,
      type: "HASH_VERIFIED",
      message: originalHash === receivedHash ? `[RUN] SHA-256 hashes match` : `[RUN] SHA-256 mismatch`,
      metadata: { originalHash, receivedHash, ok: originalHash === receivedHash }
    });
    updateRunFinished(runId, originalHash === receivedHash ? "finished" : "failed", originalHash, receivedHash);
    eventBus.broadcast({ type: "run-finished", runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    eventBus.emitRdt({
      runId,
      protocol: config.protocol,
      type: signal.aborted ? "TRANSFER_FINISHED" : "RUN_FAILED",
      message: signal.aborted ? `[RUN] Transfer stopped by user` : `[RUN] Failed: ${message}`,
      metadata: { error: message }
    });
    updateRunFinished(runId, signal.aborted ? "stopped" : "failed", originalHash);
    eventBus.broadcast({ type: "run-finished", runId });
  } finally {
    client.close();
    server.close();
  }
}

function createPackets(runId: string, config: RunConfig, input: Buffer): RdtPacket[] {
  const totalPackets = Math.ceil(input.byteLength / config.payloadSize) || 1;
  return Array.from({ length: totalPackets }, (_, packetId) => {
    const start = packetId * config.payloadSize;
    const payload = input.subarray(start, Math.min(start + config.payloadSize, input.byteLength));
    const seq = sequenceForPacket(config, packetId);
    const packet = makePacket(runId, packetId, seq, payload, packetId === totalPackets - 1);
    eventBus.emitRdt({
      runId,
      protocol: config.protocol,
      packetId,
      seq,
      type: "PACKET_CREATED",
      message: `[CLIENT] Packet ${packetId} created seq=${seq}`,
      metadata: { payloadBytes: payload.byteLength, isLast: packet.isLast, totalPackets }
    });
    return packet;
  });
}

function sequenceForPacket(config: RunConfig, packetId: number): number {
  return config.protocol === "STOP_AND_WAIT" ? packetId % 2 : packetId;
}

async function sendPacket(runId: string, config: RunConfig, packet: RdtPacket, client: RdtUdpClient, serverPort: number, attempt: number): Promise<number> {
  const sendAt = Date.now();
  eventBus.emitRdt({
    runId,
    protocol: config.protocol,
    packetId: packet.packetId,
    seq: packet.seq,
    type: "PACKET_SENT",
    message: `[CLIENT] Packet ${packet.packetId} sent seq=${packet.seq}`,
    metadata: { attempt, windowSize: config.windowSize }
  });
  await client.sendPacket(packet, serverPort);
  return sendAt;
}

async function executeUdp(runId: string, config: RunConfig, packets: RdtPacket[], client: RdtUdpClient, serverPort: number, signal: AbortSignal): Promise<void> {
  const sendTimes = new Map<number, number>();
  const sendPaceMs = Math.min(20, Math.max(2, Math.floor(artificialDelay(config) / 50)));
  for (const packet of packets) {
    if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
    sendTimes.set(packet.packetId, await sendPacket(runId, config, packet, client, serverPort, 1));
    if (sendPaceMs > 0) await sleep(sendPaceMs);
  }
  await resolveUdpPackets(runId, config, packets, sendTimes, signal);
}

async function resolveUdpPackets(runId: string, config: RunConfig, packets: RdtPacket[], sendTimes: Map<number, number>, signal: AbortSignal): Promise<void> {
  const terminalEvents = new Set(["PACKET_LOST", "PACKET_CORRUPTED", "PACKET_RECEIVED", "PACKET_WRITTEN"]);
  const resolved = new Set<number>();
  const timedOut = new Set<number>();
  const deliveryTimeoutMs = Math.min(15000, Math.max(1000, artificialDelay(config) * 3 + 1500));

  while (resolved.size < packets.length) {
    if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
    for (const event of listEvents(runId)) {
      if (event.packetId == null || !terminalEvents.has(event.type)) continue;
      resolved.add(event.packetId);
    }

    const now = Date.now();
    for (const packet of packets) {
      if (resolved.has(packet.packetId) || timedOut.has(packet.packetId)) continue;
      const sentAt = sendTimes.get(packet.packetId) ?? now;
      if (now - sentAt < deliveryTimeoutMs) continue;
      timedOut.add(packet.packetId);
      eventBus.emitRdt({
        runId,
        protocol: config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "TIMEOUT",
        message: `[CLIENT] UDP delivery timeout for packet ${packet.packetId}`,
        metadata: { timeoutMs: deliveryTimeoutMs, reason: "udp_no_ack" }
      });
      eventBus.emitRdt({
        runId,
        protocol: config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "PACKET_LOST",
        message: `[CHANNEL] Packet ${packet.packetId} timed out without delivery confirmation`,
        metadata: { direction: "client_to_server", inferred: true, reason: "udp_delivery_timeout" }
      });
      resolved.add(packet.packetId);
    }

    if (resolved.size < packets.length) await sleep(100);
  }
}

async function executeStopAndWait(runId: string, config: RunConfig, packets: RdtPacket[], client: RdtUdpClient, serverPort: number, signal: AbortSignal): Promise<void> {
  for (const packet of packets) {
    let attempt = 0;
    for (;;) {
      if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
      attempt += 1;
      const sendAt = await sendPacket(runId, config, packet, client, serverPort, attempt);
      eventBus.emitRdt({
        runId,
        protocol: config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "TIMER_STARTED",
        message: `[CLIENT] Timer started for packet ${packet.packetId}`,
        metadata: { timeoutMs: config.timeoutMs }
      });
      const ack = await client.waitForAck(packet.packetId, packet.seq, config.timeoutMs, signal);
      if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
      if (ack) {
        eventBus.emitRdt({
          runId,
          protocol: config.protocol,
          packetId: packet.packetId,
          seq: packet.seq,
          type: "ACK_RECEIVED",
          message: `[CLIENT] ACK ${packet.seq} received for packet ${packet.packetId}`,
          metadata: { rttMs: Date.now() - sendAt, attempt }
        });
        break;
      }
      emitTimeoutAndRetransmission(runId, config, packet, attempt);
    }
  }
}

async function executeGoBackN(runId: string, config: RunConfig, packets: RdtPacket[], client: RdtUdpClient, serverPort: number, signal: AbortSignal): Promise<void> {
  const attempts = new Map<number, number>();
  const sendTimes = new Map<number, number>();
  const windowSize = Math.max(1, config.windowSize);
  let base = 0;
  let next = 0;

  while (base < packets.length) {
    if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
    while (next < packets.length && next < base + windowSize) {
      const packet = packets[next];
      const attempt = (attempts.get(packet.packetId) ?? 0) + 1;
      attempts.set(packet.packetId, attempt);
      sendTimes.set(packet.packetId, await sendPacket(runId, config, packet, client, serverPort, attempt));
      next += 1;
    }

    eventBus.emitRdt({
      runId,
      protocol: config.protocol,
      packetId: base,
      seq: packets[base]?.seq,
      type: "TIMER_STARTED",
      message: `[CLIENT] Go-Back-N timer started at base packet ${base}`,
      metadata: { timeoutMs: config.timeoutMs, base, next }
    });

    const baseSentAt = sendTimes.get(base) ?? Date.now();
    const remainingTimeoutMs = Math.max(0, config.timeoutMs - (Date.now() - baseSentAt));
    const ack = remainingTimeoutMs > 0 ? await client.waitForCumulativeAck(base, remainingTimeoutMs, signal) : null;
    if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
    if (ack && ack.packetId < base) {
      continue;
    }

    if (ack && ack.packetId >= base) {
      const previousBase = base;
      const acknowledgedUntil = Math.min(ack.packetId, packets.length - 1);
      for (let packetId = previousBase; packetId <= acknowledgedUntil; packetId += 1) {
        const packet = packets[packetId];
        eventBus.emitRdt({
          runId,
          protocol: config.protocol,
          packetId,
          seq: packet.seq,
          type: "ACK_RECEIVED",
          message: `[CLIENT] Cumulative ACK received through packet ${acknowledgedUntil}`,
          metadata: { cumulativeAck: true, ackPacketId: ack.packetId, rttMs: Date.now() - (sendTimes.get(packetId) ?? Date.now()) }
        });
      }
      base = acknowledgedUntil + 1;
      continue;
    }

    for (let packetId = base; packetId < next; packetId += 1) {
      const packet = packets[packetId];
      const previousAttempt = attempts.get(packet.packetId) ?? 1;
      emitTimeoutAndRetransmission(runId, config, packet, previousAttempt);
      const attempt = previousAttempt + 1;
      attempts.set(packet.packetId, attempt);
      sendTimes.set(packet.packetId, await sendPacket(runId, config, packet, client, serverPort, attempt));
    }
  }
}

async function executeSelectiveRepeat(runId: string, config: RunConfig, packets: RdtPacket[], client: RdtUdpClient, serverPort: number, signal: AbortSignal): Promise<void> {
  const acked = new Set<number>();
  const attempts = new Map<number, number>();
  const sendTimes = new Map<number, number>();
  const sentAt = new Map<number, number>();
  const windowSize = Math.max(1, config.windowSize);
  let base = 0;
  let nextPacketId = 0;

  while (acked.size < packets.length) {
    if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
    while (acked.has(base)) base += 1;

    while (nextPacketId < packets.length && nextPacketId < base + windowSize) {
      await sendSelectiveRepeatPacket(runId, config, packets[nextPacketId], client, serverPort, attempts, sendTimes, sentAt, false, base, windowSize);
      nextPacketId += 1;
    }

    for (let packetId = base; packetId < Math.min(packets.length, base + windowSize); packetId += 1) {
      if (acked.has(packetId)) continue;
      const lastSentAt = sentAt.get(packetId);
      if (lastSentAt == null || Date.now() - lastSentAt < config.timeoutMs) continue;
      await sendSelectiveRepeatPacket(runId, config, packets[packetId], client, serverPort, attempts, sendTimes, sentAt, true, base, windowSize);
    }

    const ack = await client.waitForAnyAck(Math.max(50, Math.min(config.timeoutMs, 250)), signal);
    if (ack && !acked.has(ack.packetId) && ack.packetId < packets.length) {
      const packet = packets[ack.packetId];
      acked.add(ack.packetId);
      eventBus.emitRdt({
        runId,
        protocol: config.protocol,
        packetId: ack.packetId,
        seq: packet.seq,
        type: "ACK_RECEIVED",
        message: `[CLIENT] Selective ACK received for packet ${ack.packetId}`,
        metadata: { selectiveAck: true, rttMs: Date.now() - (sendTimes.get(ack.packetId) ?? Date.now()) }
      });
    }
  }
}

async function sendSelectiveRepeatPacket(
  runId: string,
  config: RunConfig,
  packet: RdtPacket,
  client: RdtUdpClient,
  serverPort: number,
  attempts: Map<number, number>,
  sendTimes: Map<number, number>,
  sentAt: Map<number, number>,
  retransmission: boolean,
  windowBase: number,
  windowSize: number
): Promise<void> {
  const previousAttempt = attempts.get(packet.packetId) ?? 0;
  if (retransmission) emitTimeoutAndRetransmission(runId, config, packet, Math.max(1, previousAttempt));
  const attempt = previousAttempt + 1;
  attempts.set(packet.packetId, attempt);
  const sent = await sendPacket(runId, config, packet, client, serverPort, attempt);
  sendTimes.set(packet.packetId, sent);
  sentAt.set(packet.packetId, sent);
  eventBus.emitRdt({
    runId,
    protocol: config.protocol,
    packetId: packet.packetId,
    seq: packet.seq,
    type: "TIMER_STARTED",
    message: `[CLIENT] Selective Repeat timer started for packet ${packet.packetId}`,
    metadata: { timeoutMs: config.timeoutMs, attempt, windowBase, windowEnd: windowBase + windowSize - 1, windowSize }
  });
}

function emitTimeoutAndRetransmission(runId: string, config: RunConfig, packet: RdtPacket, attempt: number): void {
  eventBus.emitRdt({
    runId,
    protocol: config.protocol,
    packetId: packet.packetId,
    seq: packet.seq,
    type: "TIMEOUT",
    message: `[CLIENT] Timeout packet ${packet.packetId}`,
    metadata: { attempt, timeoutMs: config.timeoutMs }
  });
  eventBus.emitRdt({
    runId,
    protocol: config.protocol,
    packetId: packet.packetId,
    seq: packet.seq,
    type: "RETRANSMISSION",
    message: `[CLIENT] Retransmitting packet ${packet.packetId}`,
    metadata: { nextAttempt: attempt + 1 }
  });
}
