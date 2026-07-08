import { NextResponse } from "next/server";
import { listInputFiles } from "@/rdt/fileUtils";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ files: await listInputFiles() });
}
