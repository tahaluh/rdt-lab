"use client";

import type { RdtEvent, RunRecord } from "@/rdt/events";

export function TransmissionChart({ run, events }: { run: RunRecord | null; events: RdtEvent[] }) {
  const totalPackets = run ? Math.ceil(run.fileSize / run.payloadSize) || 1 : 0;
  const ackEvents = events.filter((event) => event.type === "ACK_RECEIVED");
  const retransmissions = events.filter((event) => event.type === "RETRANSMISSION");
  const rtts = ackEvents.map((event) => (typeof event.metadata?.rttMs === "number" ? event.metadata.rttMs : 0));
  const eventSlices = [
    ["ACK", ackEvents.length],
    ["Timeout", events.filter((event) => event.type === "TIMEOUT").length],
    ["Perda", events.filter((event) => event.type === "PACKET_LOST" || event.type === "ACK_LOST").length],
    ["Duplicata", events.filter((event) => event.type === "DUPLICATE_RECEIVED").length],
    ["Checksum", events.filter((event) => event.type === "PACKET_CORRUPTED").length]
  ] as const;

  return (
    <section className="panel chart-panel region-charts">
      <div className="panel-heading">
        <div>
          <h2>Gráficos em Tempo Real</h2>
          <p className="panel-subtitle">Throughput, RTT, retransmissões, eventos e pacotes em voo</p>
        </div>
      </div>
      <div className="chart-grid">
        <MiniLine title="Throughput" values={ackEvents.map((_, index) => index + 1)} max={Math.max(1, totalPackets)} unit="pacotes" />
        <MiniLine title="RTT" values={rtts} max={Math.max(1, ...rtts)} unit="ms" />
        <MiniBars title="Retransmissões" values={retransmissions.map((_, index) => index + 1)} />
        <Donut title="Eventos" slices={eventSlices} />
        <MiniLine title="Pacotes em voo" values={events.map((_, index) => (index % 2 === 0 ? 1 : 0))} max={1} unit="in-flight" />
      </div>
    </section>
  );
}

function MiniLine({ title, values, max, unit }: { title: string; values: number[]; max: number; unit: string }) {
  const width = 260;
  const height = 110;
  const padding = 14;
  const points = values
    .map((value, index) => {
      const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
      const y = height - padding - (value / Math.max(1, max)) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="mini-chart">
      <span>{title}</span>
      <svg viewBox={`0 0 ${width} ${height}`}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="chart-axis" />
        {points ? <polyline points={points} className="chart-line" /> : null}
      </svg>
      <b>{values.at(-1)?.toFixed(0) ?? 0} {unit}</b>
    </div>
  );
}

function MiniBars({ title, values }: { title: string; values: number[] }) {
  return (
    <div className="mini-chart">
      <span>{title}</span>
      <div className="bar-chart">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} style={{ height: `${Math.min(100, ((values[index] ?? 0) + 1) * 8)}%` }} />
        ))}
      </div>
      <b>{values.length} eventos</b>
    </div>
  );
}

function Donut({ title, slices }: { title: string; slices: readonly (readonly [string, number])[] }) {
  const total = slices.reduce((sum, [, value]) => sum + value, 0);
  const gradient = total
    ? slices
        .reduce<{ parts: string[]; cursor: number }>(
          (state, [label, value], index) => {
            const start = state.cursor;
            const end = start + (value / total) * 100;
            const color = ["var(--good)", "var(--warn)", "var(--bad)", "var(--violet)", "var(--yellow)"][index];
            state.parts.push(`${color} ${start}% ${end}%`);
            state.cursor = end;
            return state;
          },
          { parts: [], cursor: 0 }
        )
        .parts.join(", ")
    : "var(--line) 0 100%";
  return (
    <div className="mini-chart">
      <span>{title}</span>
      <i className="donut" style={{ background: `conic-gradient(${gradient})` }} />
      <b>{total} eventos</b>
    </div>
  );
}
