import { NextResponse } from "next/server";
import { deleteRunSnapshot, getRun, listEvents } from "@/server/db";
import { deleteRunOutputFiles } from "@/rdt/fileUtils";
import { getExternalUdpSession } from "@/rdt/protocols/protocols";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { runId: string } }) {
  const run = getRun(params.runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run, events: listEvents(params.runId), externalUdp: getExternalUdpSession(params.runId) });
}

export async function DELETE(_: Request, { params }: { params: { runId: string } }) {
  const run = getRun(params.runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status === "running") return NextResponse.json({ error: "Stop the run before deleting it" }, { status: 409 });
  if (!run.savedAt) return NextResponse.json({ error: "Run is not saved as a replay" }, { status: 400 });

  const deleted = deleteRunSnapshot(params.runId);
  if (deleted) await deleteRunOutputFiles(params.runId);
  return NextResponse.json({ deleted });
}
