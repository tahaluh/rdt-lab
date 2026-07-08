"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelRightOpen } from "lucide-react";
import { ComparisonPanel } from "./ComparisonPanel";
import { DemoControls } from "./DemoControls";
import { EventLog } from "./EventLog";
import { GlobalTimeline } from "./GlobalTimeline";
import { LabTopBar } from "./LabTopBar";
import { PacketGrid } from "./PacketGrid";
import { PacketTimeline } from "./PacketTimeline";
import { StatsPanel } from "./StatsPanel";
import { TransmissionChart } from "./TransmissionChart";
import { TransmissionMap } from "./TransmissionMap";
import { buildPackets, buildStats } from "./rdtViewModel";
import type { RdtEvent, RunConfig, RunRecord } from "@/rdt/events";

type SocketMessage = { type: "event"; event: RdtEvent } | { type: "run-started"; runId: string } | { type: "run-finished"; runId: string };

export function RdtDashboard({ initialRunId }: { initialRunId?: string }) {
  const [files, setFiles] = useState<Array<{ name: string; size: number }>>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<RdtEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedPacketId, setSelectedPacketId] = useState<number | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [livePaused, setLivePaused] = useState(false);
  const [frozenEvents, setFrozenEvents] = useState<RdtEvent[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [replayPaused, setReplayPaused] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const currentRunIdRef = useRef<string | null>(initialRunId ?? null);

  const loadFiles = useCallback(async () => {
    const response = await fetch("/api/files", { cache: "no-store" });
    const data = (await response.json()) as { files: Array<{ name: string; size: number }> };
    setFiles(data.files);
  }, []);

  const loadRuns = useCallback(async () => {
    const response = await fetch("/api/runs", { cache: "no-store" });
    const data = (await response.json()) as { runs: RunRecord[] };
    setRuns(data.runs);
  }, []);

  const loadRun = useCallback(async (runId: string) => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { run: RunRecord; events: RdtEvent[] };
    currentRunIdRef.current = data.run.id;
    setRun(data.run);
    setEvents(data.events);
    setBusy(data.run.status === "running");
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    void loadFiles();
    void loadRuns();
  }, [loadFiles, loadRuns]);

  useEffect(() => {
    if (initialRunId) void loadRun(initialRunId);
  }, [initialRunId, loadRun]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("rdt-theme");
    if (storedTheme === "dark" || storedTheme === "light") setTheme(storedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("rdt-theme", theme);
  }, [theme]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    ws.onmessage = (message) => {
      const data = JSON.parse(message.data) as SocketMessage;
      if (data.type === "event") {
        setEvents((current) => {
          const currentRunId = currentRunIdRef.current;
          if (currentRunId && data.event.runId !== currentRunId) return current;
          if (!currentRunId && initialRunId && data.event.runId !== initialRunId) return current;
          if (data.event.id && current.some((event) => event.id === data.event.id)) return current;
          return [...current, data.event];
        });
      }
      if (data.type === "run-finished") {
        if (currentRunIdRef.current && data.runId !== currentRunIdRef.current) return;
        setBusy(false);
        void loadRun(data.runId);
      }
    };
    return () => ws.close();
  }, [initialRunId, loadRun]);

  useEffect(() => {
    if (!busy || !run) return;
    const timer = window.setInterval(() => void loadRun(run.id), 900);
    return () => window.clearInterval(timer);
  }, [busy, loadRun, run]);

  useEffect(() => {
    if (!replaying || replayPaused) return;
    const timer = window.setInterval(() => {
      setReplayIndex((index) => Math.min(events.length, index + Math.max(1, Math.floor(replaySpeed))));
    }, Math.max(40, 220 / replaySpeed));
    return () => window.clearInterval(timer);
  }, [events.length, replayPaused, replaySpeed, replaying]);

  useEffect(() => {
    if (replaying && replayIndex >= events.length) setReplayPaused(true);
  }, [events.length, replayIndex, replaying]);

  const start = async (config: RunConfig) => {
    setBusy(true);
    setEvents([]);
    setFrozenEvents([]);
    setLivePaused(false);
    setReplaying(false);
    setReplayIndex(0);
    setSelectedPacketId(null);
    setTimelineOpen(true);
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    });
    const data = (await response.json()) as { run?: RunRecord; error?: string };
    if (!response.ok || !data.run) {
      setBusy(false);
      throw new Error(data.error ?? "Falha ao iniciar transmissão");
    }
    currentRunIdRef.current = data.run.id;
    setRun(data.run);
    void loadRun(data.run.id);
    window.history.replaceState(null, "", `/runs/${data.run.id}`);
  };

  const stop = async () => {
    if (!run || run.status !== "running") return;
    await fetch(`/api/runs/${run.id}/stop`, { method: "POST" });
    setBusy(false);
    void loadRun(run.id);
  };

  const displayEvents = replaying ? events.slice(0, replayIndex) : livePaused ? frozenEvents : events;
  const packets = useMemo(() => buildPackets(run, displayEvents), [run, displayEvents]);
  const stats = useMemo(() => buildStats(run, displayEvents), [run, displayEvents]);
  const selectedPacket = packets.find((packet) => packet.packetId === selectedPacketId) ?? packets[0] ?? null;

  const togglePause = () => {
    if (replaying) {
      setReplayPaused((value) => !value);
      return;
    }
    setLivePaused((value) => {
      if (!value) setFrozenEvents(events);
      return !value;
    });
  };

  const startReplay = () => {
    if (!run) return;
    setReplaying(true);
    setReplayPaused(false);
    setReplayIndex(0);
    setLivePaused(false);
  };

  const saveRun = () => {
    if (!run) return;
    const blob = new Blob([JSON.stringify({ run, events }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rdt-run-${run.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openRun = (runId: string) => {
    setReplaying(false);
    setReplayIndex(0);
    void loadRun(runId);
    window.history.replaceState(null, "", `/runs/${runId}`);
  };

  const duplicateConfig = (source: RunRecord) => {
    void start({
      fileName: source.fileName,
      payloadSize: source.payloadSize,
      packetLossRate: source.packetLossRate,
      ackLossRate: source.ackLossRate,
      corruptionRate: source.corruptionRate,
      artificialDelayMs: source.artificialDelayMs,
      timeoutMs: source.timeoutMs,
      demoMode: true
    });
  };

  const toggleCompare = (runId: string) => {
    setCompareSelection((current) => (current.includes(runId) ? current.filter((id) => id !== runId) : [...current.slice(-1), runId]));
  };

  return (
    <div className="app-shell">
      <LabTopBar
        run={run}
        stats={stats}
        theme={theme}
        replaying={replaying}
        paused={replaying ? replayPaused : livePaused}
        onTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
        onStartReplay={startReplay}
        onTogglePause={togglePause}
        onStop={stop}
        onSave={saveRun}
      />

      <main className="lab-layout">
        <DemoControls files={files} busy={busy} onStart={start} onFilesChanged={loadFiles} />

        <section className="region-grid stack">
          <TransmissionMap run={run} packets={packets} stats={stats} />
          <PacketGrid packets={packets} selectedPacketId={selectedPacket?.packetId ?? null} onSelect={setSelectedPacketId} />
          <GlobalTimeline events={displayEvents} />
        </section>

        <StatsPanel run={run} stats={stats} />

        <section className="timeline-shell">
          {timelineOpen ? (
            <PacketTimeline packet={selectedPacket} onClose={() => setTimelineOpen(false)} />
          ) : (
            <button className="reopen-timeline" type="button" onClick={() => setTimelineOpen(true)}>
              <PanelRightOpen size={17} />
              Abrir timeline do pacote
            </button>
          )}
        </section>

        <ComparisonPanel runs={runs} selected={compareSelection} onToggle={toggleCompare} onOpen={openRun} onDuplicate={duplicateConfig} />
        <EventLog events={displayEvents} />
        <TransmissionChart run={run} events={displayEvents} />

        {replaying ? (
          <div className="replay-bar">
            <button type="button" onClick={() => setReplayIndex((value) => Math.max(0, value - 10))}>{"<<"}</button>
            <button type="button" onClick={() => setReplayPaused((value) => !value)}>{replayPaused ? "▶" : "⏸"}</button>
            <button type="button" onClick={() => setReplayIndex((value) => Math.min(events.length, value + 10))}>{">>"}</button>
            {[0.5, 1, 2, 5].map((speed) => (
              <button key={speed} type="button" className={replaySpeed === speed ? "active" : ""} onClick={() => setReplaySpeed(speed)}>
                {speed}x
              </button>
            ))}
            <span>{replayIndex}/{events.length} eventos</span>
          </div>
        ) : null}
      </main>
    </div>
  );
}
