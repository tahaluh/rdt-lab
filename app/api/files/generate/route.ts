import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ensureDataDirs, inputDir } from "@/rdt/fileUtils";

export const dynamic = "force-dynamic";

type Body = {
  mode?: "random" | "text" | "packets";
  fileName?: string;
  bytes?: number;
  text?: string;
  packets?: number;
  payloadSize?: number;
};

function safeFileName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, "_") || `generated-${Date.now()}.txt`;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Body;
  const mode = body.mode ?? "text";
  const payloadSize = Math.max(1, Math.min(4096, Number(body.payloadSize ?? 512)));
  const packets = Math.floor(Math.max(1, Math.min(50000, Number(body.packets ?? 10))));
  const bytes = Math.max(1, Math.min(100 * 1024 * 1024, Number(body.bytes ?? packets * payloadSize)));
  const fileName = safeFileName(body.fileName ?? `${mode}-${Date.now()}.${mode === "random" ? "bin" : "txt"}`);

  let buffer: Buffer;
  if (mode === "random") {
    buffer = crypto.randomBytes(bytes);
  } else if (mode === "packets") {
    buffer = Buffer.alloc(packets * payloadSize, "RDT-LAB-PACKET-BLOCK\n");
  } else {
    const text = body.text?.trim() || "Texto gerado pelo RDT Lab para demonstrar transferencia confiavel sobre UDP.\n";
    buffer = Buffer.from(text.repeat(Math.max(1, Math.ceil(bytes / Math.max(1, text.length)))).slice(0, bytes));
  }

  await ensureDataDirs();
  await fs.writeFile(path.join(inputDir, fileName), buffer);
  return NextResponse.json({ file: { name: fileName, size: buffer.byteLength } }, { status: 201 });
}
