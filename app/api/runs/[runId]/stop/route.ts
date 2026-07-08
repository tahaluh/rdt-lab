import { NextResponse } from "next/server";
import { getRun } from "@/server/db";
import { stopRun } from "@/rdt/protocols/stopAndWait";

export async function POST(_: Request, { params }: { params: { runId: string } }) {
  const run = getRun(params.runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "running") return NextResponse.json({ stopped: false, status: run.status });
  return NextResponse.json({ stopped: stopRun(params.runId) });
}
