"use client";

import { CheckCircle2, Clock, Radio, Server, ShieldAlert, TimerReset, Waves, X } from "lucide-react";
import type { RdtEvent } from "@/rdt/events";
import type { PacketView } from "./rdtViewModel";

function iconFor(event: RdtEvent) {
  if (event.message.includes("[CLIENT]")) return <Radio size={15} />;
  if (event.message.includes("[SERVER]")) return <Server size={15} />;
  if (event.message.includes("[CHANNEL]")) return <Waves size={15} />;
  if (event.type === "TIMEOUT" || event.type === "RETRANSMISSION") return <TimerReset size={15} />;
  if (event.type === "PACKET_CORRUPTED" || event.type === "RUN_FAILED") return <ShieldAlert size={15} />;
  return <CheckCircle2 size={15} />;
}

function origin(event: RdtEvent): string {
  if (event.message.includes("[CLIENT]")) return "Cliente";
  if (event.message.includes("[SERVER]")) return "Servidor";
  if (event.message.includes("[CHANNEL]")) return "Canal";
  return "Sistema";
}

export function PacketTimeline({ packet, onClose }: { packet: PacketView | null; onClose: () => void }) {
  return (
    <section className="panel region-timeline">
      <div className="panel-heading">
        <div>
          <h2>{packet ? `Pacote ${packet.packetId}` : "Timeline do Pacote"}</h2>
          <p className="panel-subtitle">Eventos com origem, timestamp e cor</p>
        </div>
        <button className="icon-btn" onClick={onClose} type="button" title="Fechar histórico por pacote">
          <X size={17} />
        </button>
      </div>
      {!packet ? (
        <p className="empty">Clique em um quadrado para inspecionar o caminho do pacote.</p>
      ) : packet.events.length === 0 ? (
        <p className="empty">Ainda sem eventos para este pacote.</p>
      ) : (
        <ol className="timeline rich-timeline">
          {packet.events.map((event, index) => (
            <li key={event.id ?? `${event.type}-${index}`} className={`timeline-event ${event.type.toLowerCase()}`}>
              <span className="timeline-index">{iconFor(event)}</span>
              <span>
                <small>
                  <Clock size={12} /> {new Date(event.timestamp).toLocaleTimeString("pt-BR", { hour12: false, fractionalSecondDigits: 3 })} · {origin(event)}
                </small>
                <b>{event.type.replaceAll("_", " ")}</b>
                <em>{event.message}</em>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
