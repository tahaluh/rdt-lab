"use client";

import { Download, Moon, Pause, Play, RotateCcw, Save, Square, Sun } from "lucide-react";
import type { RunRecord } from "@/rdt/events";
import type { Stats } from "./rdtViewModel";

export function LabTopBar({
  run,
  stats,
  theme,
  replaying,
  paused,
  onTheme,
  onStartReplay,
  onTogglePause,
  onStop,
  onSave
}: {
  run: RunRecord | null;
  stats: Stats;
  theme: "light" | "dark";
  replaying: boolean;
  paused: boolean;
  onTheme: () => void;
  onStartReplay: () => void;
  onTogglePause: () => void;
  onStop: () => void;
  onSave: () => void;
}) {
  const progress = Math.min(100, stats.successRate);
  const elapsed = `${Math.floor(stats.elapsedMs / 60000).toString().padStart(2, "0")}:${Math.floor((stats.elapsedMs % 60000) / 1000)
    .toString()
    .padStart(2, "0")}`;

  return (
    <header className="topbar lab-topbar">
      <div className="brand">
        <div className="brand-mark">RDT</div>
        <div>
          <h1>RDT Lab</h1>
          <p>Laboratório visual de protocolos de transporte</p>
        </div>
      </div>

      <div className="run-strip">
        <Metric label="Rodada" value={run ? `#${run.id.slice(0, 8)}` : "sem run"} />
        <Metric label="Protocolo" value={run?.protocol ?? "Stop-and-Wait"} />
        <Metric label="Tempo" value={elapsed} />
        <div className="progress-box">
          <span>{progress.toFixed(0)}%</span>
          <i><b style={{ width: `${progress}%` }} /></i>
        </div>
      </div>

      <div className="top-actions">
        <button className="icon-btn" type="button" onClick={onTheme} title={theme === "dark" ? "Usar modo claro" : "Usar modo escuro"}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button className="toolbar-btn" type="button" onClick={onTogglePause} disabled={!run}>
          {paused ? <Play size={15} /> : <Pause size={15} />}
          {paused ? "Retomar" : "Pausar"}
        </button>
        <button className="stop-btn" type="button" onClick={onStop} disabled={run?.status !== "running"}>
          <Square size={15} />
          Parar
        </button>
        <button className="toolbar-btn" type="button" onClick={onSave} disabled={!run}>
          <Save size={15} />
          Salvar
        </button>
        <button className="toolbar-btn" type="button" onClick={onStartReplay} disabled={!run}>
          {replaying ? <RotateCcw size={15} /> : <Download size={15} />}
          Replay
        </button>
      </div>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="run-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
