import type { RdtAck, RdtPacket } from "./packet";
import type { RunConfig } from "./events";

export function shouldDropPacket(config: RunConfig): boolean {
  return Math.random() < config.packetLossRate;
}

export function shouldDropAck(config: RunConfig): boolean {
  return Math.random() < config.ackLossRate;
}

export function shouldCorruptPacket(config: RunConfig): boolean {
  return Math.random() < config.corruptionRate;
}

export function corruptPacket(packet: RdtPacket): RdtPacket {
  const copy = { ...packet };
  if (copy.payload.length > 0) {
    const replacement = copy.payload[0] === "A" ? "B" : "A";
    copy.payload = replacement + copy.payload.slice(1);
  } else {
    copy.checksum = `bad-${copy.checksum}`;
  }
  return copy;
}

export function artificialDelay(config: RunConfig): number {
  const base = config.artificialDelayMs;
  const demo = config.demoMode ? 250 : 0;
  return base + demo;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function describeAck(ack: RdtAck): string {
  return `ACK packet=${ack.packetId} seq=${ack.seq}`;
}
