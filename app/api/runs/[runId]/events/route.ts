import { NextResponse } from "next/server";
import { listEvents } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { runId: string } }) {
  return NextResponse.json({ events: listEvents(params.runId) });
}
