import { NextResponse } from "next/server";
import { getRun, listEvents } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { runId: string } }) {
  const run = getRun(params.runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run, events: listEvents(params.runId) });
}
