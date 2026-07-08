import dgram, { type RemoteInfo } from "node:dgram";
import { appendOutput, resetOutputFile } from "./fileUtils";
import type { RunConfig } from "./events";
import { decodeMessage, encodeMessage, makeAck, packetPayload, type RdtPacket, verifyPacket } from "./packet";
import { artificialDelay, corruptPacket, shouldCorruptPacket, shouldDropAck, shouldDropPacket, sleep } from "./unreliableChannel";
import { eventBus } from "../server/websocket";

export class RdtUdpServer {
  private socket = dgram.createSocket("udp4");
  private receivedPacketIds = new Set<number>();
  private bufferedPackets = new Map<number, RdtPacket>();
  private stateQueue: Promise<void> = Promise.resolve();
  private expectedSeq: 0 | 1 = 0;
  private expectedPacketId = 0;
  private outputPath = "";
  private closed = false;

  constructor(private readonly runId: string, private readonly config: RunConfig) {}

  async start(): Promise<number> {
    this.outputPath = await resetOutputFile(this.runId, this.config.fileName);
    this.socket.on("message", (message, rinfo) => {
      void this.handleMessage(message, rinfo).catch((error) => {
        if (this.closed) return;
        eventBus.emitRdt({
          runId: this.runId,
          protocol: this.config.protocol,
          type: "RUN_FAILED",
          message: `[SERVER] UDP receive failed: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { error: error instanceof Error ? error.message : String(error) }
        });
      });
    });
    await new Promise<void>((resolve) => this.socket.bind(0, "127.0.0.1", resolve));
    const address = this.socket.address();
    if (typeof address === "string") throw new Error("Unexpected UDP address");
    return address.port;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
  }

  getOutputPath(): string {
    return this.outputPath;
  }

  async waitForPacketWrites(totalPackets: number, signal?: AbortSignal): Promise<void> {
    while (this.receivedPacketIds.size < totalPackets) {
      if (signal?.aborted) throw new Error("Transmissao parada pelo usuario");
      await this.stateQueue;
      if (this.receivedPacketIds.size >= totalPackets) return;
      await sleep(10);
    }
  }

  private async handleMessage(message: Buffer, rinfo: RemoteInfo): Promise<void> {
    if (this.closed) return;
    const decoded = decodeMessage(message);
    if (!decoded || decoded.kind !== "DATA" || decoded.runId !== this.runId) return;
    let packet: RdtPacket = decoded;

    if (shouldDropPacket(this.config)) {
      eventBus.emitRdt({
        runId: this.runId,
        protocol: this.config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "PACKET_LOST",
        message: `[CHANNEL] Packet ${packet.packetId} lost`,
        metadata: { direction: "client_to_server" }
      });
      return;
    }

    const delayMs = artificialDelay(this.config);
    if (delayMs > 0) {
      eventBus.emitRdt({
        runId: this.runId,
        protocol: this.config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "PACKET_DELAYED",
        message: `[CHANNEL] Packet ${packet.packetId} delayed ${delayMs}ms`,
        metadata: { delayMs }
      });
      await sleep(delayMs);
      if (this.closed) return;
    }

    if (shouldCorruptPacket(this.config)) {
      packet = corruptPacket(packet);
      eventBus.emitRdt({
        runId: this.runId,
        protocol: this.config.protocol,
        packetId: decoded.packetId,
        seq: decoded.seq,
        type: "PACKET_CORRUPTED",
        message: `[SERVER] Packet ${decoded.packetId} corrupted and discarded`,
        metadata: { direction: "client_to_server" }
      });
      return;
    }

    if (!verifyPacket(packet)) {
      eventBus.emitRdt({
        runId: this.runId,
        protocol: this.config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "PACKET_CORRUPTED",
        message: `[SERVER] Packet ${packet.packetId} failed checksum`,
        metadata: { checksum: packet.checksum }
      });
      return;
    }

    eventBus.emitRdt({
      runId: this.runId,
      protocol: this.config.protocol,
      packetId: packet.packetId,
      seq: packet.seq,
      type: "PACKET_RECEIVED",
      message: `[SERVER] Packet ${packet.packetId} received seq=${packet.seq}`
    });

    if (this.config.protocol === "UDP") {
      await this.enqueueStateUpdate(async () => {
        await this.writePacket(packet);
      });
      return;
    }

    await this.enqueueStateUpdate(async () => {
      if (this.config.protocol === "GO_BACK_N") {
        await this.handleGoBackN(packet, rinfo);
        return;
      }

      if (this.config.protocol === "SELECTIVE_REPEAT") {
        await this.handleSelectiveRepeat(packet, rinfo);
        return;
      }

      await this.handleStopAndWait(packet, rinfo);
    });
  }

  private async enqueueStateUpdate(work: () => Promise<void>): Promise<void> {
    const task = this.stateQueue.then(work, work);
    this.stateQueue = task.catch(() => undefined);
    return task;
  }

  private async handleStopAndWait(packet: RdtPacket, rinfo: RemoteInfo): Promise<void> {
    if (this.receivedPacketIds.has(packet.packetId) || packet.seq !== this.expectedSeq) {
      eventBus.emitRdt({
        runId: this.runId,
        protocol: this.config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "DUPLICATE_RECEIVED",
        message: `[SERVER] Packet ${packet.packetId} duplicate/out-of-order; payload not written`,
        metadata: { expectedSeq: this.expectedSeq }
      });
      await this.sendAck(packet, rinfo);
      return;
    }

    await this.writePacket(packet);
    await this.sendAck(packet, rinfo);
    this.expectedSeq = this.expectedSeq === 0 ? 1 : 0;
  }

  private async handleGoBackN(packet: RdtPacket, rinfo: RemoteInfo): Promise<void> {
    if (packet.packetId === this.expectedPacketId && !this.receivedPacketIds.has(packet.packetId)) {
      await this.writePacket(packet);
      this.expectedPacketId += 1;
      await this.sendAck(packet, rinfo);
      return;
    }

    eventBus.emitRdt({
      runId: this.runId,
      protocol: this.config.protocol,
      packetId: packet.packetId,
      seq: packet.seq,
      type: "DUPLICATE_RECEIVED",
      message: `[SERVER] Packet ${packet.packetId} out-of-order; Go-Back-N expects ${this.expectedPacketId}`,
      metadata: { expectedPacketId: this.expectedPacketId, cumulativeAck: Math.max(0, this.expectedPacketId - 1) }
    });

    if (this.expectedPacketId > 0) {
      const ackPacketId = this.expectedPacketId - 1;
      await this.sendAck({ ...packet, packetId: ackPacketId, seq: ackPacketId }, rinfo);
    }
  }

  private async handleSelectiveRepeat(packet: RdtPacket, rinfo: RemoteInfo): Promise<void> {
    if (packet.packetId < this.expectedPacketId || this.receivedPacketIds.has(packet.packetId)) {
      eventBus.emitRdt({
        runId: this.runId,
        protocol: this.config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "DUPLICATE_RECEIVED",
        message: `[SERVER] Packet ${packet.packetId} duplicate; ACK resent`
      });
      this.sendAckSoon(packet, rinfo);
      return;
    }

    if (this.bufferedPackets.has(packet.packetId)) {
      eventBus.emitRdt({
        runId: this.runId,
        protocol: this.config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "DUPLICATE_RECEIVED",
        message: `[SERVER] Packet ${packet.packetId} already buffered; ACK resent`
      });
      this.sendAckSoon(packet, rinfo);
      return;
    }

    this.bufferedPackets.set(packet.packetId, packet);
    this.sendAckSoon(packet, rinfo);
    await this.flushSelectiveRepeatBuffer();
  }

  private async flushSelectiveRepeatBuffer(): Promise<void> {
    for (;;) {
      const packet = this.bufferedPackets.get(this.expectedPacketId);
      if (!packet) return;
      this.bufferedPackets.delete(this.expectedPacketId);
      await this.writePacket(packet);
      this.expectedPacketId += 1;
    }
  }

  private async writePacket(packet: RdtPacket): Promise<void> {
    await appendOutput(this.outputPath, packetPayload(packet));
    this.receivedPacketIds.add(packet.packetId);
    eventBus.emitRdt({
      runId: this.runId,
      protocol: this.config.protocol,
      packetId: packet.packetId,
      seq: packet.seq,
      type: "PACKET_WRITTEN",
      message: `[SERVER] Packet ${packet.packetId} written to output file`
    });
  }

  private async sendAck(packet: RdtPacket, rinfo: RemoteInfo): Promise<void> {
    if (this.closed) return;
    const ack = makeAck(this.runId, packet.packetId, packet.seq);
    if (shouldDropAck(this.config)) {
      eventBus.emitRdt({
        runId: this.runId,
        protocol: this.config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "ACK_LOST",
        message: `[CHANNEL] ACK ${packet.seq} for packet ${packet.packetId} lost`,
        metadata: { direction: "server_to_client" }
      });
      return;
    }

    const delayMs = Math.floor(artificialDelay(this.config) / 2);
    if (delayMs > 0) await sleep(delayMs);
    if (this.closed) return;
    try {
      await new Promise<void>((resolve, reject) => {
        this.socket.send(encodeMessage(ack), rinfo.port, rinfo.address, (error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      if (this.closed || (error instanceof Error && "code" in error && error.code === "ERR_SOCKET_DGRAM_NOT_RUNNING")) return;
      throw error;
    }
    eventBus.emitRdt({
      runId: this.runId,
      protocol: this.config.protocol,
      packetId: packet.packetId,
      seq: packet.seq,
      type: "ACK_SENT",
      message: `[SERVER] ACK ${packet.seq} sent for packet ${packet.packetId}`
    });
  }

  private sendAckSoon(packet: RdtPacket, rinfo: RemoteInfo): void {
    void this.sendAck(packet, rinfo).catch((error) => {
      if (this.closed) return;
      eventBus.emitRdt({
        runId: this.runId,
        protocol: this.config.protocol,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "RUN_FAILED",
        message: `[SERVER] ACK send failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { error: error instanceof Error ? error.message : String(error) }
      });
    });
  }
}
