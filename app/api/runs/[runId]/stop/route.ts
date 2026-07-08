import { NextResponse } from "next/server";
import { getRun, updateRunFinished } from "@/server/db";
import { stopRun } from "@/rdt/protocols/stopAndWait";

export async function POST(_: Request, { params }: { params: { runId: string } }) {
  const run = getRun(params.runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "running") return NextResponse.json({ stopped: false, status: run.status });
  const stopped = stopRun(params.runId);
  if (!stopped) updateRunFinished(params.runId, "stopped", run.originalHash, run.receivedHash);
  return NextResponse.json({ stopped, status: stopped ? "stopping" : "stopped" });
}
