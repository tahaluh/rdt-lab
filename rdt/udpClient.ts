import dgram from "node:dgram";
import type { RdtAck, RdtPacket } from "./packet";
import { decodeMessage, encodeMessage, verifyAck } from "./packet";

export class RdtUdpClient {
  private socket = dgram.createSocket("udp4");
  private closed = false;
  private pendingAcks: RdtAck[] = [];
  private ackWaiters = new Set<(ack: RdtAck) => boolean>();

  async start(): Promise<void> {
    this.socket.on("message", (message) => {
      const decoded = decodeMessage(message);
      if (!decoded || decoded.kind !== "ACK" || !verifyAck(decoded)) return;
      for (const resolve of this.ackWaiters) {
        if (resolve(decoded)) return;
      }
      this.pendingAcks.push(decoded);
    });
    await new Promise<void>((resolve) => this.socket.bind(0, "127.0.0.1", resolve));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
  }

  async sendPacket(packet: RdtPacket, serverPort: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.send(encodeMessage(packet), serverPort, "127.0.0.1", (error) => (error ? reject(error) : resolve()));
    });
  }

  waitForAck(packetId: number, seq: number, timeoutMs: number, signal?: AbortSignal): Promise<RdtAck | null> {
    return this.waitForAckMatching((ack) => ack.packetId === packetId && ack.seq === seq, timeoutMs, signal);
  }

  waitForAnyAck(timeoutMs: number, signal?: AbortSignal): Promise<RdtAck | null> {
    return this.waitForAckMatching(() => true, timeoutMs, signal);
  }

  drainPendingAcks(): RdtAck[] {
    const acks = this.pendingAcks;
    this.pendingAcks = [];
    return acks;
  }

  waitForCumulativeAck(minPacketId: number, timeoutMs: number, signal?: AbortSignal): Promise<RdtAck | null> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(null);
        return;
      }

      const pendingAck = this.takeBestPendingCumulativeAck(minPacketId);
      if (pendingAck) {
        resolve(pendingAck);
        return;
      }

      let bestAck: RdtAck | null = null;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (ack: RdtAck | null) => {
        clearTimeout(timeoutTimer);
        if (settleTimer) clearTimeout(settleTimer);
        signal?.removeEventListener("abort", onAbort);
        this.ackWaiters.delete(onAck);
        resolve(ack);
      };

      const onAck = (ack: RdtAck) => {
        if (ack.packetId < minPacketId) return true;
        if (!bestAck || ack.packetId > bestAck.packetId) bestAck = ack;
        settleTimer ??= setTimeout(() => finish(bestAck), 12);
        return true;
      };

      const onAbort = () => finish(null);
      const timeoutTimer = setTimeout(() => finish(bestAck), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.ackWaiters.add(onAck);
    });
  }

  private waitForAckMatching(matches: (ack: RdtAck) => boolean, timeoutMs: number, signal?: AbortSignal): Promise<RdtAck | null> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(null);
        return;
      }
      const pendingIndex = this.pendingAcks.findIndex(matches);
      if (pendingIndex >= 0) {
        const [ack] = this.pendingAcks.splice(pendingIndex, 1);
        resolve(ack);
        return;
      }
      const onAck = (ack: RdtAck) => {
        if (!matches(ack)) return false;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.ackWaiters.delete(onAck);
        resolve(ack);
        return true;
      };
      const onAbort = () => {
        clearTimeout(timer);
        this.ackWaiters.delete(onAck);
        resolve(null);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        this.ackWaiters.delete(onAck);
        resolve(null);
      }, timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.ackWaiters.add(onAck);
    });
  }

  private takeBestPendingCumulativeAck(minPacketId: number): RdtAck | null {
    let bestAck: RdtAck | null = null;
    const retained: RdtAck[] = [];

    for (const ack of this.pendingAcks) {
      if (ack.packetId < minPacketId) continue;
      if (!bestAck || ack.packetId > bestAck.packetId) bestAck = ack;
    }

    for (const ack of this.pendingAcks) {
      if (ack.packetId < minPacketId) continue;
      if (bestAck && ack.packetId <= bestAck.packetId) continue;
      retained.push(ack);
    }

    this.pendingAcks = retained;
    return bestAck;
  }
}
