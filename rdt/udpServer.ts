import dgram, { type RemoteInfo } from "node:dgram";
import { appendOutput, resetOutputFile } from "./fileUtils";
import type { RunConfig } from "./events";
import { decodeMessage, encodeMessage, makeAck, packetPayload, type RdtPacket, verifyPacket } from "./packet";
import { artificialDelay, corruptPacket, shouldCorruptPacket, shouldDropAck, shouldDropPacket, sleep } from "./unreliableChannel";
import { eventBus } from "../server/websocket";

export class RdtUdpServer {
  private socket = dgram.createSocket("udp4");
  private receivedPacketIds = new Set<number>();
  private expectedSeq: 0 | 1 = 0;
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

  private async handleMessage(message: Buffer, rinfo: RemoteInfo): Promise<void> {
    if (this.closed) return;
    const decoded = decodeMessage(message);
    if (!decoded || decoded.kind !== "DATA" || decoded.runId !== this.runId) return;
    let packet: RdtPacket = decoded;

    if (shouldDropPacket(this.config)) {
      eventBus.emitRdt({
        runId: this.runId,
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
      packetId: packet.packetId,
      seq: packet.seq,
      type: "PACKET_RECEIVED",
      message: `[SERVER] Packet ${packet.packetId} received seq=${packet.seq}`
    });

    if (this.receivedPacketIds.has(packet.packetId) || packet.seq !== this.expectedSeq) {
      eventBus.emitRdt({
        runId: this.runId,
        packetId: packet.packetId,
        seq: packet.seq,
        type: "DUPLICATE_RECEIVED",
        message: `[SERVER] Packet ${packet.packetId} duplicate/out-of-order; payload not written`,
        metadata: { expectedSeq: this.expectedSeq }
      });
      await this.sendAck(packet, rinfo);
      return;
    }

    await appendOutput(this.outputPath, packetPayload(packet));
    this.receivedPacketIds.add(packet.packetId);
    eventBus.emitRdt({
      runId: this.runId,
      packetId: packet.packetId,
      seq: packet.seq,
      type: "PACKET_WRITTEN",
      message: `[SERVER] Packet ${packet.packetId} written to output file`
    });

    await this.sendAck(packet, rinfo);
    this.expectedSeq = this.expectedSeq === 0 ? 1 : 0;
  }

  private async sendAck(packet: RdtPacket, rinfo: RemoteInfo): Promise<void> {
    if (this.closed) return;
    const ack = makeAck(this.runId, packet.packetId, packet.seq);
    if (shouldDropAck(this.config)) {
      eventBus.emitRdt({
        runId: this.runId,
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
      packetId: packet.packetId,
      seq: packet.seq,
      type: "ACK_SENT",
      message: `[SERVER] ACK ${packet.seq} sent for packet ${packet.packetId}`
    });
  }
}
