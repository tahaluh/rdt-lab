import { NextResponse } from "next/server";
import { listEvents, saveRunSnapshot } from "@/server/db";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: { runId: string } }) {
  const run = saveRunSnapshot(params.runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run, events: listEvents(params.runId) });
}
