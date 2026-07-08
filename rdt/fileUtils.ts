import fs from "node:fs/promises";
import path from "node:path";
import { fileHash } from "./checksum";

export const dataDir = path.join(process.cwd(), "data");
export const inputDir = path.join(dataDir, "input");
export const outputDir = path.join(dataDir, "output");

export async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
}

export async function listInputFiles(): Promise<Array<{ name: string; size: number }>> {
  await ensureDataDirs();
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const stat = await fs.stat(path.join(inputDir, entry.name));
        return { name: entry.name, size: stat.size };
      })
  );
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readInputFile(fileName: string): Promise<Buffer> {
  const safeName = path.basename(fileName);
  return fs.readFile(path.join(inputDir, safeName));
}

export async function resetOutputFile(runId: string, fileName: string): Promise<string> {
  await ensureDataDirs();
  const outputPath = path.join(outputDir, `${runId}-${path.basename(fileName)}`);
  await fs.writeFile(outputPath, Buffer.alloc(0));
  return outputPath;
}

export async function appendOutput(outputPath: string, payload: Buffer): Promise<void> {
  await fs.appendFile(outputPath, payload);
}

export async function deleteRunOutputFiles(runId: string): Promise<void> {
  await ensureDataDirs();
  const entries = await fs.readdir(outputDir);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(`${runId}-`))
      .map((name) => fs.rm(path.join(outputDir, name), { force: true }))
  );
}

export async function hashFilePath(filePath: string): Promise<string> {
  return fileHash(await fs.readFile(filePath));
}
