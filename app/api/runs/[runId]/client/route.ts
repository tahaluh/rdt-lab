import { NextResponse } from "next/server";
import { getRun, listEvents } from "@/server/db";
import { readInputFile } from "@/rdt/fileUtils";
import { getExternalUdpSession } from "@/rdt/protocols/protocols";
import type { RunConfig } from "@/rdt/events";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { runId: string } }) {
  const run = getRun(params.runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const session = getExternalUdpSession(run.id);
  if (!session) return NextResponse.json({ error: "External UDP session is not active" }, { status: 409 });

  const file = await readInputFile(run.fileName);
  const startedConfig = listEvents(run.id).find((event) => event.type === "RUN_STARTED")?.metadata?.config as Partial<RunConfig> | undefined;
  const config: RunConfig = {
    protocol: run.protocol,
    fileName: run.fileName,
    payloadSize: run.payloadSize,
    packetLossRate: run.packetLossRate,
    ackLossRate: run.ackLossRate,
    corruptionRate: run.corruptionRate,
    artificialDelayMs: run.artificialDelayMs,
    timeoutMs: run.timeoutMs,
    demoMode: Boolean(startedConfig?.demoMode ?? false),
    windowSize: Number(startedConfig?.windowSize ?? (run.protocol === "UDP" ? 0 : run.protocol === "STOP_AND_WAIT" ? 1 : 4)),
    externalClient: true
  };

  return NextResponse.json({
    run,
    serverHost: session.serverHost,
    serverPort: session.serverPort,
    fileBase64: file.toString("base64"),
    externalUdp: session,
    config
  });
}
