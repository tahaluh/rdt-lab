import { checksum } from "./checksum";

export type RdtPacket = {
  kind: "DATA";
  runId: string;
  packetId: number;
  seq: 0 | 1;
  checksum: string;
  payload: string;
  isLast: boolean;
  timestamp: number;
};

export type RdtAck = {
  kind: "ACK";
  runId: string;
  packetId: number;
  seq: 0 | 1;
  checksum: string;
};

export function makePacket(runId: string, packetId: number, seq: 0 | 1, payload: Buffer, isLast: boolean): RdtPacket {
  const encoded = payload.toString("base64");
  const timestamp = Date.now();
  return {
    kind: "DATA",
    runId,
    packetId,
    seq,
    payload: encoded,
    isLast,
    timestamp,
    checksum: checksum([runId, packetId, seq, encoded, isLast, timestamp])
  };
}

export function makeAck(runId: string, packetId: number, seq: 0 | 1): RdtAck {
  return {
    kind: "ACK",
    runId,
    packetId,
    seq,
    checksum: checksum([runId, packetId, seq, "ACK"])
  };
}

export function packetPayload(packet: RdtPacket): Buffer {
  return Buffer.from(packet.payload, "base64");
}

export function verifyPacket(packet: RdtPacket): boolean {
  return packet.checksum === checksum([packet.runId, packet.packetId, packet.seq, packet.payload, packet.isLast, packet.timestamp]);
}

export function verifyAck(ack: RdtAck): boolean {
  return ack.checksum === checksum([ack.runId, ack.packetId, ack.seq, "ACK"]);
}

export function encodeMessage(message: RdtPacket | RdtAck): Buffer {
  return Buffer.from(JSON.stringify(message));
}

export function decodeMessage(buffer: Buffer): RdtPacket | RdtAck | null {
  try {
    const parsed = JSON.parse(buffer.toString("utf8")) as RdtPacket | RdtAck;
    return parsed?.kind === "DATA" || parsed?.kind === "ACK" ? parsed : null;
  } catch {
    return null;
  }
}
