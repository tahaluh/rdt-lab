import { NextResponse } from "next/server";
import { listInputFiles } from "@/rdt/fileUtils";

export async function GET() {
  return NextResponse.json({ files: await listInputFiles() });
}
