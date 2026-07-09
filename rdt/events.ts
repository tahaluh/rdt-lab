export type Protocol = "UDP" | "STOP_AND_WAIT" | "GO_BACK_N" | "SELECTIVE_REPEAT";

export type RdtEventType =
  | "RUN_STARTED"
  | "PACKET_CREATED"
  | "PACKET_SENT"
  | "PACKET_LOST"
  | "PACKET_DELAYED"
  | "PACKET_CORRUPTED"
  | "PACKET_RECEIVED"
  | "DUPLICATE_RECEIVED"
  | "PACKET_WRITTEN"
  | "ACK_SENT"
  | "ACK_LOST"
  | "ACK_RECEIVED"
  | "TIMER_STARTED"
  | "TIMEOUT"
  | "RETRANSMISSION"
  | "TRANSFER_FINISHED"
  | "HASH_VERIFIED"
  | "RUN_FAILED";

export type RdtEvent = {
  id?: number;
  runId: string;
  timestamp: number;
  protocol: Protocol;
  packetId?: number;
  seq?: number;
  type: RdtEventType;
  message: string;
  metadata?: Record<string, unknown>;
};

export type RunStatus = "running" | "finished" | "failed" | "stopped";

export type RunConfig = {
  protocol: Protocol;
  fileName: string;
  payloadSize: number;
  packetLossRate: number;
  ackLossRate: number;
  corruptionRate: number;
  artificialDelayMs: number;
  timeoutMs: number;
  demoMode: boolean;
  windowSize: number;
  externalClient?: boolean;
};

export type RunRecord = {
  id: string;
  protocol: Protocol;
  fileName: string;
  fileSize: number;
  payloadSize: number;
  packetLossRate: number;
  ackLossRate: number;
  corruptionRate: number;
  artificialDelayMs: number;
  timeoutMs: number;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  savedAt?: number;
  originalHash?: string;
  receivedHash?: string;
};

export type PacketState =
  | "pending"
  | "created"
  | "sent"
  | "received"
  | "acknowledged"
  | "lost"
  | "corrupted"
  | "timeout"
  | "retransmitted"
  | "retransmitted_acknowledged"
  | "duplicated";

export type RunSnapshot = {
  run: RunRecord;
  events: RdtEvent[];
};
