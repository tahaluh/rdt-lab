import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ensureDataDirs, inputDir } from "@/rdt/fileUtils";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  await ensureDataDirs();
  const safeName = path.basename(file.name || `upload-${Date.now()}.bin`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(inputDir, safeName), buffer);
  return NextResponse.json({ file: { name: safeName, size: buffer.byteLength } }, { status: 201 });
}
