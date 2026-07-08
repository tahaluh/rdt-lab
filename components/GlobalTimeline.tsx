"use client";

import type { RdtEvent } from "@/rdt/events";

export function GlobalTimeline({ events }: { events: RdtEvent[] }) {
  return (
    <section className="panel global-timeline">
      <div className="panel-heading">
        <div>
          <h2>Timeline Global</h2>
          <p className="panel-subtitle">DevTools dos eventos RDT</p>
        </div>
      </div>
      <div className="global-events">
        {events.slice(-60).map((event, index) => (
          <button className={event.type.toLowerCase()} key={event.id ?? `${event.timestamp}-${index}`} type="button" title={event.message}>
            <span>{new Date(event.timestamp).toLocaleTimeString("pt-BR", { hour12: false })}</span>
            <b>{event.type.replaceAll("_", " ")}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
