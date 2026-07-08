import crypto from "node:crypto";
import { createRun, updateRunFinished } from "../../server/db";
import { eventBus } from "../../server/websocket";
import { fileHash } from "../checksum";
import { hashFilePath, readInputFile } from "../fileUtils";
import type { RunConfig, RunRecord } from "../events";
import { makePacket } from "../packet";
import { RdtUdpClient } from "../udpClient";
import { RdtUdpServer } from "../udpServer";

declare global {
  // Next dev may evaluate route modules separately; active UDP runs must stay process-wide.
  // eslint-disable-next-line no-var
  var __rdtActiveRuns: Map<string, AbortController> | undefined;
}

const activeRuns = (globalThis.__rdtActiveRuns ??= new Map<string, AbortController>());

export async function startStopAndWait(config: RunConfig): Promise<RunRecord> {
  const runId = crypto.randomUUID();
  const input = await readInputFile(config.fileName);
  const originalHash = fileHash(input);
  const run: RunRecord = {
    id: runId,
    protocol: "STOP_AND_WAIT",
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
    type: "RUN_STARTED",
    message: `[RUN] Stop-and-Wait started for ${config.fileName}`,
    metadata: { config, fileSize: input.byteLength }
  });
  eventBus.broadcast({ type: "run-started", runId });

  void executeRun(runId, config, input, originalHash, controller.signal).finally(() => activeRuns.delete(runId));
  return run;
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
    let seq: 0 | 1 = 0;
    const totalPackets = Math.ceil(input.byteLength / config.payloadSize) || 1;

    for (let packetId = 0; packetId < totalPackets; packetId += 1) {
      if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
      const start = packetId * config.payloadSize;
      const payload = input.subarray(start, Math.min(start + config.payloadSize, input.byteLength));
      const packet = makePacket(runId, packetId, seq, payload, packetId === totalPackets - 1);
      eventBus.emitRdt({
        runId,
        packetId,
        seq,
        type: "PACKET_CREATED",
        message: `[CLIENT] Packet ${packetId} created seq=${seq}`,
        metadata: { payloadBytes: payload.byteLength, isLast: packet.isLast, totalPackets }
      });

      let attempt = 0;
      for (;;) {
        if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
        attempt += 1;
        const sendAt = Date.now();
        eventBus.emitRdt({
          runId,
          packetId,
          seq,
          type: "PACKET_SENT",
          message: `[CLIENT] Packet ${packetId} sent seq=${seq}`,
          metadata: { attempt }
        });
        await client.sendPacket(packet, serverPort);
        eventBus.emitRdt({
          runId,
          packetId,
          seq,
          type: "TIMER_STARTED",
          message: `[CLIENT] Timer started for packet ${packetId}`,
          metadata: { timeoutMs: config.timeoutMs }
        });

        const ack = await client.waitForAck(packetId, seq, config.timeoutMs, signal);
        if (signal.aborted) throw new Error("Transmissao parada pelo usuario");
        if (ack) {
          eventBus.emitRdt({
            runId,
            packetId,
            seq,
            type: "ACK_RECEIVED",
            message: `[CLIENT] ACK ${seq} received for packet ${packetId}`,
            metadata: { rttMs: Date.now() - sendAt, attempt }
          });
          seq = seq === 0 ? 1 : 0;
          break;
        }

        eventBus.emitRdt({
          runId,
          packetId,
          seq,
          type: "TIMEOUT",
          message: `[CLIENT] Timeout packet ${packetId}`,
          metadata: { attempt, timeoutMs: config.timeoutMs }
        });
        eventBus.emitRdt({
          runId,
          packetId,
          seq,
          type: "RETRANSMISSION",
          message: `[CLIENT] Retransmitting packet ${packetId}`,
          metadata: { nextAttempt: attempt + 1 }
        });
      }
    }

    const receivedHash = await hashFilePath(server.getOutputPath());
    eventBus.emitRdt({
      runId,
      type: "TRANSFER_FINISHED",
      message: `[RUN] Transfer finished`,
      metadata: { outputPath: server.getOutputPath() }
    });
    eventBus.emitRdt({
      runId,
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
