import { createHash } from "node:crypto";

export function checksum(parts: Array<string | number | boolean | Buffer>): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    if (Buffer.isBuffer(part)) {
      hash.update(part);
    } else {
      hash.update(String(part));
    }
    hash.update("|");
  }
  return hash.digest("hex");
}

export function fileHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
