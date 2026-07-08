"use client";

import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { RdtEvent } from "@/rdt/events";

const filters = ["Todos", "Timeout", "ACK", "Erro", "Cliente", "Servidor", "Canal"] as const;

function matchesFilter(event: RdtEvent, filter: (typeof filters)[number]): boolean {
  if (filter === "Todos") return true;
  if (filter === "Timeout") return event.type === "TIMEOUT";
  if (filter === "ACK") return event.type.includes("ACK");
  if (filter === "Erro") return event.type === "RUN_FAILED" || event.type === "PACKET_CORRUPTED";
  if (filter === "Cliente") return event.message.includes("[CLIENT]");
  if (filter === "Servidor") return event.message.includes("[SERVER]");
  return event.message.includes("[CHANNEL]");
}

export function EventLog({ events }: { events: RdtEvent[] }) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("Todos");
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => events.filter((event) => matchesFilter(event, filter)).filter((event) => event.message.toLowerCase().includes(query.toLowerCase())),
    [events, filter, query]
  );

  function exportJson() {
    const blob = new Blob([JSON.stringify(visible, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rdt-events.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel region-logs">
      <div className="panel-heading">
        <div>
          <h2>Logs</h2>
          <p className="panel-subtitle">CLIENT · SERVER · CHANNEL</p>
        </div>
        <button className="icon-btn" type="button" onClick={exportJson} title="Exportar logs filtrados">
          <Download size={17} />
        </button>
      </div>
      <div className="log-tools">
        <div className="search-box">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" />
        </div>
        <div className="filter-row">
          {filters.map((item) => (
            <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="empty">Nenhum evento para o filtro atual.</p>
      ) : (
        <div className="event-log">
          {visible.slice(-220).map((event, index) => (
            <div className="log-line" key={event.id ?? `${event.timestamp}-${index}`}>
              {event.message}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
