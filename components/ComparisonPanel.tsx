"use client";

import { Copy, GitCompare, PlayCircle } from "lucide-react";
import type { RunRecord } from "@/rdt/events";

function elapsed(run: RunRecord): number {
  return Math.max(0, (run.finishedAt ?? Date.now()) - run.startedAt);
}

function throughput(run: RunRecord): number {
  const ms = elapsed(run);
  return ms > 0 ? run.fileSize / (ms / 1000) : 0;
}

export function ComparisonPanel({
  runs,
  selected,
  onToggle,
  onOpen,
  onDuplicate
}: {
  runs: RunRecord[];
  selected: string[];
  onToggle: (runId: string) => void;
  onOpen: (runId: string) => void;
  onDuplicate: (run: RunRecord) => void;
}) {
  return (
    <section className="panel region-comparison">
      <div className="panel-heading">
        <div>
          <h2>Comparações e Histórico</h2>
          <p className="panel-subtitle">Selecione duas execuções para comparar</p>
        </div>
        <GitCompare size={18} />
      </div>
      <div className="comparison-table">
        <div className="comparison-head">
          <span>Run</span>
          <span>Payload</span>
          <span>Perda</span>
          <span>Tempo</span>
          <span>Throughput</span>
          <span>Ações</span>
        </div>
        {runs.slice(0, 8).map((run) => (
          <div className={selected.includes(run.id) ? "selected" : ""} key={run.id}>
            <label>
              <input type="checkbox" checked={selected.includes(run.id)} onChange={() => onToggle(run.id)} />
              #{run.id.slice(0, 6)}
            </label>
            <span>{run.payloadSize}</span>
            <span>{Math.round(run.packetLossRate * 100)}%</span>
            <span>{(elapsed(run) / 1000).toFixed(1)}s</span>
            <span>{throughput(run).toFixed(0)} B/s</span>
            <span className="row-actions">
              <button className="mini-btn" onClick={() => onOpen(run.id)} type="button" title="Abrir replay">
                <PlayCircle size={14} />
              </button>
              <button className="mini-btn" onClick={() => onDuplicate(run)} type="button" title="Duplicar configuração">
                <Copy size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
