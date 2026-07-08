import dgram from "node:dgram";
import type { RdtAck, RdtPacket } from "./packet";
import { decodeMessage, encodeMessage, verifyAck } from "./packet";

export class RdtUdpClient {
  private socket = dgram.createSocket("udp4");
  private closed = false;
  private ackWaiters = new Set<(ack: RdtAck) => void>();

  async start(): Promise<void> {
    this.socket.on("message", (message) => {
      const decoded = decodeMessage(message);
      if (!decoded || decoded.kind !== "ACK" || !verifyAck(decoded)) return;
      for (const resolve of this.ackWaiters) resolve(decoded);
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

  waitForAck(packetId: number, seq: 0 | 1, timeoutMs: number, signal?: AbortSignal): Promise<RdtAck | null> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(null);
        return;
      }
      const onAck = (ack: RdtAck) => {
        if (ack.packetId !== packetId || ack.seq !== seq) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.ackWaiters.delete(onAck);
        resolve(ack);
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
}
