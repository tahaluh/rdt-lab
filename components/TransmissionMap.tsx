"use client";

import { Radio, Server, Waves } from "lucide-react";
import type { RunRecord } from "@/rdt/events";
import type { PacketView, Stats } from "./rdtViewModel";

export function TransmissionMap({ run, packets, stats }: { run: RunRecord | null; packets: PacketView[]; stats: Stats }) {
  const current = [...packets].reverse().find((packet) => packet.events.length > 0);
  const inflight = run?.protocol === "STOP_AND_WAIT" && run.status === "running" ? Math.min(1, Math.max(0, stats.packetsSent - stats.acksReceived)) : 0;
  return (
    <section className="panel transmission-map">
      <div className="map-node">
        <Radio size={22} />
        <b>Cliente</b>
      </div>
      <div className="map-channel">
        <span className={`packet-orb ${current?.state ?? "pending"}`}>{current?.packetId ?? "-"}</span>
        <Waves size={22} />
      </div>
      <div className="map-node">
        <Server size={22} />
        <b>Servidor</b>
      </div>
      <div className="inflight">
        <span>Em voo</span>
        <i><b style={{ width: `${inflight * 100}%` }} /></i>
        <strong>{inflight}/1</strong>
      </div>
    </section>
  );
}
