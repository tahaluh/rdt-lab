import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureDataDirs } from "../rdt/fileUtils";
import type { Protocol, RdtEvent, RunConfig, RunRecord, RunStatus } from "../rdt/events";

let db: Database.Database | null = null;

function rowToRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    protocol: row.protocol as Protocol,
    fileName: String(row.file_name),
    fileSize: Number(row.file_size),
    payloadSize: Number(row.payload_size),
    packetLossRate: Number(row.packet_loss_rate),
    ackLossRate: Number(row.ack_loss_rate),
    corruptionRate: Number(row.corruption_rate),
    artificialDelayMs: Number(row.artificial_delay_ms),
    timeoutMs: Number(row.timeout_ms),
    status: row.status as RunStatus,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at == null ? undefined : Number(row.finished_at),
    savedAt: row.saved_at == null ? undefined : Number(row.saved_at),
    originalHash: row.original_hash == null ? undefined : String(row.original_hash),
    receivedHash: row.received_hash == null ? undefined : String(row.received_hash)
  };
}

function rowToEvent(row: Record<string, unknown>): RdtEvent {
  return {
    id: Number(row.id),
    runId: String(row.run_id),
    timestamp: Number(row.timestamp),
    protocol: row.protocol as Protocol,
    packetId: row.packet_id == null ? undefined : Number(row.packet_id),
    seq: row.seq == null ? undefined : (Number(row.seq) as 0 | 1),
    type: row.type as RdtEvent["type"],
    message: String(row.message),
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : undefined
  };
}

export async function initDb(): Promise<Database.Database> {
  if (db) return db;
  await ensureDataDirs();
  return openDb();
}

function openDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  db = new Database(path.join(process.cwd(), "data", "rdt.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      protocol TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      payload_size INTEGER NOT NULL,
      packet_loss_rate REAL NOT NULL,
      ack_loss_rate REAL NOT NULL,
      corruption_rate REAL NOT NULL,
      artificial_delay_ms INTEGER NOT NULL,
      timeout_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      original_hash TEXT,
      received_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      protocol TEXT NOT NULL,
      packet_id INTEGER,
      seq INTEGER,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY(run_id) REFERENCES runs(id)
    );
  `);
  const runColumns = new Set(
    db.prepare("PRAGMA table_info(runs)")
      .all()
      .map((row) => String((row as { name: unknown }).name))
  );
  if (!runColumns.has("saved_at")) {
    db.exec("ALTER TABLE runs ADD COLUMN saved_at INTEGER");
  }
  return db;
}

export function database(): Database.Database {
  return openDb();
}

export function createRun(run: RunRecord, config: RunConfig): void {
  database()
    .prepare(
      `INSERT INTO runs (
        id, protocol, file_name, file_size, payload_size, packet_loss_rate,
        ack_loss_rate, corruption_rate, artificial_delay_ms, timeout_ms,
        status, started_at, original_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.id,
      run.protocol,
      config.fileName,
      run.fileSize,
      config.payloadSize,
      config.packetLossRate,
      config.ackLossRate,
      config.corruptionRate,
      config.artificialDelayMs,
      config.timeoutMs,
      run.status,
      run.startedAt,
      run.originalHash
    );
}

export function updateRunFinished(runId: string, status: RunStatus, originalHash?: string, receivedHash?: string): void {
  database()
    .prepare("UPDATE runs SET status = ?, finished_at = ?, original_hash = ?, received_hash = ? WHERE id = ?")
    .run(status, Date.now(), originalHash, receivedHash, runId);
}

export function saveEvent(event: RdtEvent): RdtEvent {
  const result = database()
    .prepare(
      `INSERT INTO events (
        run_id, timestamp, protocol, packet_id, seq, type, message, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.runId,
      event.timestamp,
      event.protocol,
      event.packetId ?? null,
      event.seq ?? null,
      event.type,
      event.message,
      event.metadata ? JSON.stringify(event.metadata) : null
    );
  return { ...event, id: Number(result.lastInsertRowid) };
}

export function listRuns(): RunRecord[] {
  return database()
    .prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 50")
    .all()
    .map((row) => rowToRun(row as Record<string, unknown>));
}

export function getRun(runId: string): RunRecord | null {
  const row = database().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : null;
}

export function saveRunSnapshot(runId: string): RunRecord | null {
  const savedAt = Date.now();
  const result = database().prepare("UPDATE runs SET saved_at = ? WHERE id = ?").run(savedAt, runId);
  return result.changes > 0 ? getRun(runId) : null;
}

export function listEvents(runId: string): RdtEvent[] {
  return database()
    .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY id ASC")
    .all(runId)
    .map((row) => rowToEvent(row as Record<string, unknown>));
}
