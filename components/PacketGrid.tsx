"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PacketView } from "./rdtViewModel";

const labels: Record<string, string> = {
  pending: "pendente",
  created: "criado",
  sent: "enviado",
  received: "recebido",
  acknowledged: "confirmado",
  lost: "perdido",
  corrupted: "corrompido",
  retransmitted: "retransmitido",
  duplicated: "duplicado"
};

function packetTitle(packet: PacketView): string {
  const attempts = packet.events.filter((event) => event.type === "PACKET_SENT").length;
  const ack = packet.events.some((event) => event.type === "ACK_RECEIVED");
  const corrupted = packet.events.some((event) => event.type === "PACKET_CORRUPTED");
  const first = packet.events[0]?.timestamp;
  const last = packet.events.at(-1)?.timestamp;
  const elapsed = first && last ? `${last - first} ms` : "aguardando";
  return [`Pacote ${packet.packetId}`, `Estado: ${labels[packet.state]}`, `Tentativas: ${attempts}`, `Checksum: ${corrupted ? "falhou" : "OK"}`, `ACK recebido: ${ack ? "sim" : "não"}`, `Tempo: ${elapsed}`].join("\n");
}

export function PacketGrid({
  packets,
  selectedPacketId,
  onSelect
}: {
  packets: PacketView[];
  selectedPacketId: number | null;
  onSelect: (packetId: number) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  const [columns, setColumns] = useState(18);

  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const updateColumns = () => {
      const available = element.getBoundingClientRect().width;
      setColumns(Math.max(1, Math.floor((available + 7) / 37)));
    };
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const latestPacketId = useMemo(() => {
    const touched = packets
      .filter((packet) => packet.events.length > 0)
      .map((packet) => ({
        packetId: packet.packetId,
        lastEvent: packet.events.at(-1)?.timestamp ?? 0
      }))
      .sort((a, b) => b.lastEvent - a.lastEvent)[0];
    return touched?.packetId ?? selectedPacketId ?? 0;
  }, [packets, selectedPacketId]);

  const visiblePackets = useMemo(() => {
    if (!compact) return packets;
    const start = Math.floor(latestPacketId / columns) * columns;
    return packets.slice(start, start + columns);
  }, [columns, compact, latestPacketId, packets]);

  const firstVisible = visiblePackets[0]?.packetId ?? 0;
  const lastVisible = visiblePackets.at(-1)?.packetId ?? 0;
  const gridStyle = compact ? ({ "--packet-columns": columns } as CSSProperties) : undefined;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Grid de Pacotes</h2>
          {compact && packets.length > 0 ? (
            <p className="panel-subtitle">
              Linha atual: pacotes {firstVisible}-{lastVisible}
            </p>
          ) : null}
        </div>
        {packets.length > 0 ? (
          <button className="icon-btn" onClick={() => setCompact((value) => !value)} type="button" title={compact ? "Mostrar grid completo" : "Mostrar somente a linha atual"}>
            {compact ? <Maximize2 size={17} /> : <Minimize2 size={17} />}
          </button>
        ) : null}
      </div>
      {packets.length === 0 ? (
        <p className="empty">Inicie uma transmissão para ver os pacotes.</p>
      ) : (
        <>
          <div ref={gridRef} className={`packet-grid ${compact ? "compact" : ""}`} style={gridStyle}>
            {visiblePackets.map((packet) => (
              <button
                key={packet.packetId}
                className={`packet-cell ${packet.state} ${selectedPacketId === packet.packetId ? "selected" : ""}`}
                title={packetTitle(packet)}
                onClick={() => onSelect(packet.packetId)}
                type="button"
              >
                {packet.packetId}
              </button>
            ))}
          </div>
          <div className="legend">
            {Object.entries(labels).map(([state, label]) => (
              <span key={state}>
                <i className={`swatch packet-cell ${state}`} />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
