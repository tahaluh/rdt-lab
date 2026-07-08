import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/server/db";
import { startTransportRun } from "@/rdt/protocols/protocols";
import type { Protocol, RunConfig } from "@/rdt/events";

const payloadSizes = new Set([256, 512, 1024, 1400, 4096]);
const protocols = new Set<Protocol>(["UDP", "STOP_AND_WAIT", "GO_BACK_N", "SELECTIVE_REPEAT"]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseConfig(body: Partial<RunConfig>): RunConfig {
  const payloadSize = Number(body.payloadSize ?? 512);
  const protocol = protocols.has(body.protocol as Protocol) ? body.protocol as Protocol : "STOP_AND_WAIT";
  const windowSize = Number(body.windowSize ?? (protocol === "STOP_AND_WAIT" ? 1 : 4));
  return {
    protocol,
    fileName: String(body.fileName ?? ""),
    payloadSize: payloadSizes.has(payloadSize) ? payloadSize : 512,
    packetLossRate: clamp(Number(body.packetLossRate ?? 0), 0, 1),
    ackLossRate: protocol === "UDP" ? 0 : clamp(Number(body.ackLossRate ?? 0), 0, 1),
    corruptionRate: clamp(Number(body.corruptionRate ?? 0), 0, 1),
    artificialDelayMs: clamp(Number(body.artificialDelayMs ?? 0), 0, 2000),
    timeoutMs: protocol === "UDP" ? 0 : clamp(Number(body.timeoutMs ?? 1000), 300, 5000),
    demoMode: Boolean(body.demoMode ?? false),
    windowSize: protocol === "UDP" ? 0 : protocol === "STOP_AND_WAIT" ? 1 : Math.floor(clamp(Number.isFinite(windowSize) ? windowSize : 4, 1, 256))
  };
}

export async function GET() {
  return NextResponse.json({ runs: listRuns() });
}

export async function POST(request: NextRequest) {
  try {
    const config = parseConfig(await request.json());
    if (!config.fileName) {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    }
    const run = await startTransportRun(config);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Failed to start run" }, { status: 500 });
  }
}
