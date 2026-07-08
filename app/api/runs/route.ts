import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/server/db";
import { startStopAndWait } from "@/rdt/protocols/stopAndWait";
import type { RunConfig } from "@/rdt/events";

const payloadSizes = new Set([256, 512, 1024, 1400, 4096]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseConfig(body: Partial<RunConfig>): RunConfig {
  const payloadSize = Number(body.payloadSize ?? 512);
  return {
    fileName: String(body.fileName ?? ""),
    payloadSize: payloadSizes.has(payloadSize) ? payloadSize : 512,
    packetLossRate: clamp(Number(body.packetLossRate ?? 0), 0, 1),
    ackLossRate: clamp(Number(body.ackLossRate ?? 0), 0, 1),
    corruptionRate: clamp(Number(body.corruptionRate ?? 0), 0, 1),
    artificialDelayMs: clamp(Number(body.artificialDelayMs ?? 0), 0, 2000),
    timeoutMs: clamp(Number(body.timeoutMs ?? 1000), 300, 5000),
    demoMode: Boolean(body.demoMode ?? true)
  };
}

export async function GET() {
  return NextResponse.json({ runs: listRuns() });
}

export async function POST(request: NextRequest) {
  const config = parseConfig(await request.json());
  if (!config.fileName) {
    return NextResponse.json({ error: "fileName is required" }, { status: 400 });
  }
  const run = await startStopAndWait(config);
  return NextResponse.json({ run }, { status: 201 });
}
