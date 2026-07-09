import { RdtUdpClient } from "../rdt/udpClient";
import { makePacket, type RdtAck, type RdtPacket } from "../rdt/packet";
import { artificialDelay, sleep } from "../rdt/unreliableChannel";
import type { RdtEventType, RunConfig, RunRecord } from "../rdt/events";

type ClientBootstrap = {
  run: RunRecord;
  config: RunConfig;
  serverHost: string;
  serverPort: number;
  fileBase64: string;
};

type TelemetryEvent = {
  type: RdtEventType;
  packetId?: number;
  seq?: number;
  message: string;
  metadata?: Record<string, unknown>;
};

const UDP_FAST_SEND_BURST_SIZE = 24;

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): never {
  console.error("Usage: npm run udp:client -- --base-url https://example.com --run RUN_ID [--host HOST] [--port PORT]");
  process.exit(1);
}

async function fetchBootstrap(baseUrl: string, runId: string): Promise<ClientBootstrap> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/runs/${runId}/client`, { cache: "no-store" });
  const data = await response.json() as ClientBootstrap & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function postTelemetry(baseUrl: string, runId: string, events: TelemetryEvent[]): Promise<void> {
  if (!events.length) return;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/runs/${runId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events })
  });
  if (!response.ok) {
    const text = await response.text();
    console.warn(`telemetry failed: ${response.status} ${text.slice(0, 160)}`);
  }
}

function sequenceForPacket(config: RunConfig, packetId: number): number {
  return config.protocol === "STOP_AND_WAIT" ? packetId % 2 : packetId;
}

function createPackets(runId: string, config: RunConfig, payload: Buffer): RdtPacket[] {
  const totalPackets = Math.ceil(payload.byteLength / config.payloadSize) || 1;
  return Array.from({ length: totalPackets }, (_, packetId) => {
    const start = packetId * config.payloadSize;
    const chunk = payload.subarray(start, Math.min(start + config.payloadSize, payload.byteLength));
    return makePacket(runId, packetId, sequenceForPacket(config, packetId), chunk, packetId === totalPackets - 1);
  });
}

function packetSentEvent(packet: RdtPacket, host: string, port: number, attempt: number, config: RunConfig): TelemetryEvent {
  return {
    type: "PACKET_SENT",
    packetId: packet.packetId,
    seq: packet.seq,
    message: `[CLIENT] Packet ${packet.packetId} sent seq=${packet.seq}`,
    metadata: { externalClient: true, destinationHost: host, destinationPort: port, attempt, windowSize: config.windowSize }
  };
}

async function sendPacket(
  telemetry: TelemetryEvent[],
  config: RunConfig,
  packet: RdtPacket,
  client: RdtUdpClient,
  host: string,
  port: number,
  attempt: number
): Promise<number> {
  const sendAt = Date.now();
  await client.sendPacket(packet, port);
  telemetry.push(packetSentEvent(packet, host, port, attempt, config));
  return sendAt;
}

async function executeUdp(baseUrl: string, runId: string, config: RunConfig, packets: RdtPacket[], client: RdtUdpClient, host: string, port: number): Promise<void> {
  const telemetry: TelemetryEvent[] = [];
  const sendPaceMs = config.demoMode ? Math.min(20, Math.max(2, Math.floor(artificialDelay(config) / 50))) : 0;
  for (const [index, packet] of packets.entries()) {
    await sendPacket(telemetry, config, packet, client, host, port, 1);
    if ((index + 1) % 100 === 0 || index + 1 === packets.length) {
      await postTelemetry(baseUrl, runId, telemetry.splice(0));
      console.log(`sent ${index + 1}/${packets.length}`);
    }
    if (sendPaceMs > 0) await sleep(sendPaceMs);
    if (sendPaceMs === 0 && (index + 1) % UDP_FAST_SEND_BURST_SIZE === 0) await sleep(0);
  }
}

async function executeStopAndWait(baseUrl: string, runId: string, config: RunConfig, packets: RdtPacket[], client: RdtUdpClient, host: string, port: number): Promise<void> {
  const telemetry: TelemetryEvent[] = [];
  for (const packet of packets) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const sendAt = await sendPacket(telemetry, config, packet, client, host, port, attempt);
      telemetry.push({
        type: "TIMER_STARTED",
        packetId: packet.packetId,
        seq: packet.seq,
        message: `[CLIENT] Timer started for packet ${packet.packetId}`,
        metadata: { timeoutMs: config.timeoutMs, externalClient: true }
      });
      await postTelemetry(baseUrl, runId, telemetry.splice(0));

      const ack = await client.waitForAck(packet.packetId, packet.seq, config.timeoutMs);
      if (ack) {
        await postTelemetry(baseUrl, runId, [{
          type: "ACK_RECEIVED",
          packetId: packet.packetId,
          seq: packet.seq,
          message: `[CLIENT] ACK ${packet.seq} received for packet ${packet.packetId}`,
          metadata: { rttMs: Date.now() - sendAt, attempt, externalClient: true }
        }]);
        console.log(`acked ${packet.packetId + 1}/${packets.length}`);
        break;
      }

      await postTelemetry(baseUrl, runId, [
        {
          type: "TIMEOUT",
          packetId: packet.packetId,
          seq: packet.seq,
          message: `[CLIENT] Timeout packet ${packet.packetId}`,
          metadata: { attempt, timeoutMs: config.timeoutMs, externalClient: true }
        },
        {
          type: "RETRANSMISSION",
          packetId: packet.packetId,
          seq: packet.seq,
          message: `[CLIENT] Retransmitting packet ${packet.packetId}`,
          metadata: { nextAttempt: attempt + 1, externalClient: true }
        }
      ]);
    }
  }
}

async function executeGoBackN(baseUrl: string, runId: string, config: RunConfig, packets: RdtPacket[], client: RdtUdpClient, host: string, port: number): Promise<void> {
  const attempts = new Map<number, number>();
  const sendTimes = new Map<number, number>();
  const windowSize = Math.max(1, config.windowSize);
  let base = 0;
  let next = 0;

  while (base < packets.length) {
    const telemetry: TelemetryEvent[] = [];
    while (next < packets.length && next < base + windowSize) {
      const packet = packets[next];
      const attempt = (attempts.get(packet.packetId) ?? 0) + 1;
      attempts.set(packet.packetId, attempt);
      sendTimes.set(packet.packetId, await sendPacket(telemetry, config, packet, client, host, port, attempt));
      next += 1;
    }

    telemetry.push({
      type: "TIMER_STARTED",
      packetId: base,
      seq: packets[base]?.seq,
      message: `[CLIENT] Go-Back-N timer started at base packet ${base}`,
      metadata: { timeoutMs: config.timeoutMs, base, next, externalClient: true }
    });
    await postTelemetry(baseUrl, runId, telemetry);

    const baseSentAt = sendTimes.get(base) ?? Date.now();
    const remainingTimeoutMs = Math.max(0, config.timeoutMs - (Date.now() - baseSentAt));
    const ack = remainingTimeoutMs > 0 ? await client.waitForCumulativeAck(base, remainingTimeoutMs) : null;

    if (ack && ack.packetId < base) continue;
    if (ack && ack.packetId >= base) {
      const previousBase = base;
      const acknowledgedUntil = Math.min(ack.packetId, packets.length - 1);
      const ackEvents: TelemetryEvent[] = [];
      for (let packetId = previousBase; packetId <= acknowledgedUntil; packetId += 1) {
        const packet = packets[packetId];
        ackEvents.push({
          type: "ACK_RECEIVED",
          packetId,
          seq: packet.seq,
          message: `[CLIENT] Cumulative ACK received through packet ${acknowledgedUntil}`,
          metadata: { cumulativeAck: true, ackPacketId: ack.packetId, rttMs: Date.now() - (sendTimes.get(packetId) ?? Date.now()), externalClient: true }
        });
      }
      await postTelemetry(baseUrl, runId, ackEvents);
      base = acknowledgedUntil + 1;
      console.log(`acked through ${base}/${packets.length}`);
      continue;
    }

    const retransmissions: TelemetryEvent[] = [];
    for (let packetId = base; packetId < next; packetId += 1) {
      const packet = packets[packetId];
      const previousAttempt = attempts.get(packet.packetId) ?? 1;
      retransmissions.push(
        {
          type: "TIMEOUT",
          packetId: packet.packetId,
          seq: packet.seq,
          message: `[CLIENT] Timeout packet ${packet.packetId}`,
          metadata: { attempt: previousAttempt, timeoutMs: config.timeoutMs, externalClient: true }
        },
        {
          type: "RETRANSMISSION",
          packetId: packet.packetId,
          seq: packet.seq,
          message: `[CLIENT] Retransmitting packet ${packet.packetId}`,
          metadata: { nextAttempt: previousAttempt + 1, externalClient: true }
        }
      );
      const attempt = previousAttempt + 1;
      attempts.set(packet.packetId, attempt);
      sendTimes.set(packet.packetId, await sendPacket(retransmissions, config, packet, client, host, port, attempt));
    }
    await postTelemetry(baseUrl, runId, retransmissions);
  }
}

function selectiveRepeatAckWaitMs(config: RunConfig, inFlight: Map<number, number>): number {
  if (config.demoMode) return Math.max(50, Math.min(config.timeoutMs, 250));
  if (!inFlight.size) return 0;
  const now = Date.now();
  const nextTimeoutMs = Math.min(...Array.from(inFlight.values()).map((sentAt) => Math.max(0, config.timeoutMs - (now - sentAt))));
  return Math.max(0, nextTimeoutMs);
}

async function executeSelectiveRepeat(baseUrl: string, runId: string, config: RunConfig, packets: RdtPacket[], client: RdtUdpClient, host: string, port: number): Promise<void> {
  const acked = new Set<number>();
  const attempts = new Map<number, number>();
  const sendTimes = new Map<number, number>();
  const inFlight = new Map<number, number>();
  const windowSize = Math.max(1, config.windowSize);
  let nextPacketId = 0;

  const sendSrPacket = async (packet: RdtPacket, retransmission: boolean): Promise<void> => {
    const telemetry: TelemetryEvent[] = [];
    const previousAttempt = attempts.get(packet.packetId) ?? 0;
    if (retransmission) {
      telemetry.push(
        {
          type: "TIMEOUT",
          packetId: packet.packetId,
          seq: packet.seq,
          message: `[CLIENT] Timeout packet ${packet.packetId}`,
          metadata: { attempt: Math.max(1, previousAttempt), timeoutMs: config.timeoutMs, externalClient: true }
        },
        {
          type: "RETRANSMISSION",
          packetId: packet.packetId,
          seq: packet.seq,
          message: `[CLIENT] Retransmitting packet ${packet.packetId}`,
          metadata: { nextAttempt: previousAttempt + 1, externalClient: true }
        }
      );
    }
    const attempt = previousAttempt + 1;
    attempts.set(packet.packetId, attempt);
    const sent = await sendPacket(telemetry, config, packet, client, host, port, attempt);
    sendTimes.set(packet.packetId, sent);
    inFlight.set(packet.packetId, sent);
    telemetry.push({
      type: "TIMER_STARTED",
      packetId: packet.packetId,
      seq: packet.seq,
      message: `[CLIENT] Selective Repeat timer started for packet ${packet.packetId}`,
      metadata: { timeoutMs: config.timeoutMs, attempt, inFlight: inFlight.size, windowSize, externalClient: true }
    });
    await postTelemetry(baseUrl, runId, telemetry);
  };

  const fillWindow = async () => {
    while (nextPacketId < packets.length && inFlight.size < windowSize) {
      await sendSrPacket(packets[nextPacketId], false);
      nextPacketId += 1;
    }
  };

  const applyAck = async (ack: RdtAck): Promise<boolean> => {
    if (ack.packetId < 0 || ack.packetId >= packets.length) return false;
    const packet = packets[ack.packetId];
    const wasNewAck = !acked.has(ack.packetId);
    acked.add(ack.packetId);
    inFlight.delete(ack.packetId);
    if (wasNewAck) {
      await postTelemetry(baseUrl, runId, [{
        type: "ACK_RECEIVED",
        packetId: ack.packetId,
        seq: packet.seq,
        message: `[CLIENT] Selective ACK received for packet ${ack.packetId}`,
        metadata: { selectiveAck: true, rttMs: Date.now() - (sendTimes.get(ack.packetId) ?? Date.now()), inFlight: inFlight.size, windowSize, externalClient: true }
      }]);
      console.log(`acked ${acked.size}/${packets.length}`);
    }
    return wasNewAck;
  };

  const drainAcks = async () => {
    let acceptedAny = false;
    for (const ack of client.drainPendingAcks()) {
      acceptedAny = await applyAck(ack) || acceptedAny;
    }
    if (acceptedAny) await fillWindow();
  };

  while (acked.size < packets.length) {
    await fillWindow();
    await drainAcks();

    for (const [packetId] of Array.from(inFlight)) {
      await drainAcks();
      if (acked.has(packetId)) {
        inFlight.delete(packetId);
        continue;
      }
      const lastSentAt = inFlight.get(packetId);
      if (lastSentAt == null) continue;
      if (Date.now() - lastSentAt < config.timeoutMs) continue;
      await sendSrPacket(packets[packetId], true);
    }

    await drainAcks();
    if (acked.size >= packets.length) break;

    const ack = await client.waitForAnyAck(selectiveRepeatAckWaitMs(config, inFlight));
    if (ack) {
      await applyAck(ack);
      await fillWindow();
    }
  }
}

async function executeProtocol(baseUrl: string, runId: string, config: RunConfig, packets: RdtPacket[], client: RdtUdpClient, host: string, port: number): Promise<void> {
  if (config.protocol === "UDP") await executeUdp(baseUrl, runId, config, packets, client, host, port);
  if (config.protocol === "STOP_AND_WAIT") await executeStopAndWait(baseUrl, runId, config, packets, client, host, port);
  if (config.protocol === "GO_BACK_N") await executeGoBackN(baseUrl, runId, config, packets, client, host, port);
  if (config.protocol === "SELECTIVE_REPEAT") await executeSelectiveRepeat(baseUrl, runId, config, packets, client, host, port);
}

async function main(): Promise<void> {
  const baseUrl = readArg("--base-url");
  const runId = readArg("--run");
  if (!baseUrl || !runId) usage();

  const bootstrap = await fetchBootstrap(baseUrl, runId);
  const host = readArg("--host") ?? bootstrap.serverHost;
  const port = Number(readArg("--port") ?? bootstrap.serverPort);
  if (!host || !Number.isFinite(port)) usage();

  const payload = Buffer.from(bootstrap.fileBase64, "base64");
  const packets = createPackets(runId, bootstrap.config, payload);
  const client = new RdtUdpClient("0.0.0.0", host);

  console.log(`Dashboard bootstrap: run=${bootstrap.run.id} protocol=${bootstrap.config.protocol} file=${bootstrap.run.fileName} bytes=${payload.byteLength}`);
  console.log(`Sending ${packets.length} UDP datagrams to ${host}:${port}`);
  await client.start();
  try {
    await executeProtocol(baseUrl, runId, bootstrap.config, packets, client, host, port);
  } finally {
    client.close();
  }
  console.log("UDP client complete. Watch the dashboard for hash verification.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
