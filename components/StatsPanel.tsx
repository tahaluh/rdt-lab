"use client";

import type { RunRecord } from "@/rdt/events";
import type { Stats } from "./rdtViewModel";

function fmtNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "0";
}

export function StatsPanel({ run, stats }: { run: RunRecord | null; stats: Stats }) {
  const items = [
    ["Pacotes totais", stats.totalPackets],
    ["Pacotes enviados", stats.packetsSent],
    ["Pacotes recebidos", stats.packetsReceived],
    ["ACKs recebidos", stats.acksReceived],
    ["Timeouts", stats.timeouts],
    ["Perdas", stats.losses],
    ["Corrupções", stats.corruptions],
    ["Retransmissões", stats.retransmissions],
    ["Duplicatas", stats.duplicates],
    ["Bytes enviados", stats.bytesSent],
    ["Bytes úteis", stats.usefulBytes],
    ["Overhead", stats.overheadBytes],
    ["Taxa de sucesso", `${fmtNumber(stats.successRate)}%`],
    ["Eficiência", `${fmtNumber(stats.efficiency)}%`],
    ["Retransmissão", `${fmtNumber(stats.retransmissionRate)}%`],
    ["Overhead", `${fmtNumber(stats.overheadRate)}%`],
    ["Tempo decorrido", `${fmtNumber(stats.elapsedMs / 1000)}s`],
    ["Throughput", `${fmtNumber(stats.throughput)} B/s`],
    ["Velocidade atual", `${fmtNumber(stats.currentSpeed)} B/s`],
    ["RTT médio", `${fmtNumber(stats.avgRtt)}ms`]
  ];

  return (
    <section className="panel stats-panel region-stats">
      <h2>Estatísticas</h2>
      <div className="stats-grid">
        {items.map(([label, value]) => (
          <div className="stat" key={label}>
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="hashes">
        <div>Hash original: {run?.originalHash ?? "aguardando"}</div>
        <div>Hash recebido: {run?.receivedHash ?? "aguardando"}</div>
        <div>
          Integridade:{" "}
          {stats.ok == null ? <span>aguardando</span> : stats.ok ? <span className="ok">OK</span> : <span className="error">erro</span>}
        </div>
      </div>
    </section>
  );
}
