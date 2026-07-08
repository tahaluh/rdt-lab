"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Pause, Play, RotateCcw, Save, Square, UploadCloud } from "lucide-react";
import type { PacketState, RdtEvent, RunConfig, RunRecord } from "@/rdt/events";

type FileItem = { name: string; size: number };
type SocketMessage = { type: "event"; event: RdtEvent } | { type: "events"; events: RdtEvent[] } | { type: "run-started"; runId: string } | { type: "run-finished"; runId: string };
type SourceMode = "upload" | "text" | "random" | "packets";
type LabProtocol = "UDP" | "STOP_AND_WAIT" | "GO_BACK_N" | "SELECTIVE_REPEAT";
type WindowMode = "preset" | "custom";
type EventOrder = { byId: Map<number, number>; byRef: Map<RdtEvent, number> };

const payloadOptions = [256, 512, 1024, 1400, 4096];
const windowOptions = [1, 4, 8, 16, 32, 64];
const protocolLabels: Record<LabProtocol, string> = {
  UDP: "UDP puro",
  STOP_AND_WAIT: "Stop-and-Wait",
  GO_BACK_N: "Go-Back-N",
  SELECTIVE_REPEAT: "Selective Repeat"
};

const stateLabel: Record<PacketState, string> = {
  pending: "Pendente",
  created: "Criado",
  sent: "Enviado",
  received: "Recebido",
  acknowledged: "Confirmado",
  lost: "Perdido",
  corrupted: "Corrompido",
  timeout: "Timeout",
  retransmitted: "Retransmitido",
  duplicated: "Duplicado"
};

function stateFromEvents(events: RdtEvent[]): PacketState {
  if (events.some((event) => event.type === "DUPLICATE_RECEIVED")) return "duplicated";
  if (events.some((event) => event.type === "ACK_RECEIVED")) return "acknowledged";
  if (events.some((event) => event.type === "PACKET_WRITTEN")) return "received";
  if (events.some((event) => event.type === "PACKET_RECEIVED")) return "received";
  if (events.some((event) => event.type === "PACKET_CORRUPTED")) return "corrupted";
  if (events.some((event) => event.type === "PACKET_LOST" || event.type === "ACK_LOST")) return "lost";
  if (events.some((event) => event.type === "RETRANSMISSION")) return "retransmitted";
  if (events.some((event) => event.type === "TIMEOUT")) return "timeout";
  if (events.some((event) => event.type === "PACKET_SENT")) return "sent";
  if (events.some((event) => event.type === "PACKET_CREATED")) return "created";
  return "pending";
}

function origin(event: RdtEvent): "CLIENT" | "SERVER" | "CHANNEL" | "SYSTEM" {
  if (event.message.includes("[CLIENT]")) return "CLIENT";
  if (event.message.includes("[SERVER]")) return "SERVER";
  if (event.message.includes("[CHANNEL]")) return "CHANNEL";
  return "SYSTEM";
}

function shortHash(hash?: string): string {
  return hash ? `${hash.slice(0, 4)}...${hash.slice(-4)}` : "-";
}

function formatClock(timestamp?: number): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString("pt-BR", { hour12: false, fractionalSecondDigits: 3 });
}

function formatLogDate(timestamp?: number): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false
  });
}

function logNumber(event: RdtEvent, fallbackIndex: number, eventOrder?: EventOrder): string {
  const runIndex = event.id != null ? eventOrder?.byId.get(event.id) : eventOrder?.byRef.get(event);
  return `#${runIndex ?? fallbackIndex + 1}`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function bytesForSize(size: string, customKb: number): number {
  if (size === "10kb") return 10 * 1024;
  if (size === "100kb") return 100 * 1024;
  if (size === "1mb") return 1024 * 1024;
  if (size === "10mb") return 10 * 1024 * 1024;
  return Math.max(1, customKb * 1024);
}

function maxRuntimePacketIdFromEvents(events: RdtEvent[]): number {
  return events.reduce((maxPacketId, event) => {
    if (event.packetId == null || event.type === "PACKET_CREATED") return maxPacketId;
    return Math.max(maxPacketId, event.packetId);
  }, 0);
}

function useTicker(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function usePacketGridColumns(): number {
  const [columns, setColumns] = useState(28);
  useEffect(() => {
    const update = () => {
      if (window.innerWidth <= 520) setColumns(12);
      else if (window.innerWidth <= 760) setColumns(16);
      else if (window.innerWidth <= 1180) setColumns(20);
      else setColumns(28);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return columns;
}

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text);
  }
}

export function RdtDashboard({ initialRunId }: { initialRunId?: string }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<RdtEvent[]>([]);
  const [maxRuntimePacketId, setMaxRuntimePacketId] = useState(0);
  const [selectedPacketId, setSelectedPacketId] = useState(0);
  const [packetJump, setPacketJump] = useState("0");
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [visibleEvents, setVisibleEvents] = useState<RdtEvent[]>([]);
  const [clearedLogAt, setClearedLogAt] = useState(0);
  const [saveStatus, setSaveStatus] = useState("");
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [sourceMode, setSourceMode] = useState<SourceMode>("random");
  const [selectedFile, setSelectedFile] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [sizePreset, setSizePreset] = useState("100kb");
  const [customKb, setCustomKb] = useState(256);
  const [packetCount, setPacketCount] = useState(128);
  const [labProtocol, setLabProtocol] = useState<LabProtocol>("STOP_AND_WAIT");
  const [payloadSize, setPayloadSize] = useState(512);
  const [packetLoss, setPacketLoss] = useState(10);
  const [ackLoss, setAckLoss] = useState(5);
  const [corruption, setCorruption] = useState(2);
  const [delay, setDelay] = useState(120);
  const [jitter, setJitter] = useState(30);
  const [rtt, setRtt] = useState(60);
  const [timeoutMs, setTimeoutMs] = useState(1000);
  const [slowMode, setSlowMode] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [windowMode, setWindowMode] = useState<WindowMode>("preset");
  const [windowSize, setWindowSize] = useState(4);
  const [customWindowSize, setCustomWindowSize] = useState(12);
  const currentRunIdRef = useRef<string | null>(initialRunId ?? null);
  const eventIdsRef = useRef(new Set<number>());
  const pausedRef = useRef(paused);
  const startingRef = useRef(starting);
  const now = useTicker(run?.status === "running" && !paused);
  const statsNow = paused && pausedAt ? pausedAt : now;
  const isRunning = run?.status === "running";

  const loadFiles = useCallback(async () => {
    const response = await fetch("/api/files", { cache: "no-store" });
    const data = (await response.json()) as { files: FileItem[] };
    setFiles(data.files);
    setSelectedFile((current) => current || data.files[0]?.name || "");
  }, []);

  const loadRun = useCallback(async (runId: string) => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { run: RunRecord; events: RdtEvent[] };
    currentRunIdRef.current = data.run.id;
    eventIdsRef.current = new Set(data.events.map((event) => event.id).filter((id): id is number => id != null));
    setRun(data.run);
    setEvents(data.events);
    setMaxRuntimePacketId(maxRuntimePacketIdFromEvents(data.events));
    if (!pausedRef.current) setVisibleEvents(data.events);
  }, []);

  const appendSocketEvents = useCallback((incomingEvents: RdtEvent[]) => {
    const nextEvents: RdtEvent[] = [];
    let nextMaxPacketId: number | null = null;
    for (const event of incomingEvents) {
      if (event.id != null) {
        if (eventIdsRef.current.has(event.id)) continue;
        eventIdsRef.current.add(event.id);
      }
      nextEvents.push(event);
      if (event.packetId != null && event.type !== "PACKET_CREATED") {
        nextMaxPacketId = Math.max(nextMaxPacketId ?? 0, event.packetId);
      }
    }
    if (!nextEvents.length) return;
    if (nextMaxPacketId != null) setMaxRuntimePacketId((current) => Math.max(current, nextMaxPacketId));
    setEvents((current) => [...current, ...nextEvents]);
    if (!pausedRef.current) setVisibleEvents((current) => [...current, ...nextEvents]);
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (initialRunId) void loadRun(initialRunId);
  }, [initialRunId, loadRun]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    startingRef.current = starting;
  }, [starting]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    ws.onmessage = (message) => {
      const data = JSON.parse(message.data) as SocketMessage;
      if (data.type === "run-started" && startingRef.current && !currentRunIdRef.current) {
        currentRunIdRef.current = data.runId;
      }
      if (data.type === "event") {
        const activeRunId = currentRunIdRef.current;
        if (!activeRunId || data.event.runId !== activeRunId) return;
        appendSocketEvents([data.event]);
      }
      if (data.type === "events") {
        const activeRunId = currentRunIdRef.current;
        if (!activeRunId) return;
        appendSocketEvents(data.events.filter((event) => event.runId === activeRunId));
      }
      if (data.type === "run-finished" && currentRunIdRef.current === data.runId) void loadRun(data.runId);
    };
    return () => ws.close();
  }, [appendSocketEvents, loadRun]);

  useEffect(() => {
    setPacketJump(String(selectedPacketId));
  }, [selectedPacketId]);

  const currentEvents = paused ? visibleEvents : events;
  const eventOrder = useMemo<EventOrder>(() => {
    const byId = new Map<number, number>();
    const byRef = new Map<RdtEvent, number>();
    currentEvents.forEach((event, index) => {
      const runIndex = index + 1;
      if (event.id != null) byId.set(event.id, runIndex);
      byRef.set(event, runIndex);
    });
    return { byId, byRef };
  }, [currentEvents]);
  const logEvents = currentEvents.filter((event) => event.timestamp > clearedLogAt);
  const selectedFileSize = files.find((file) => file.name === selectedFile)?.size;
  const effectivePacketCount = Math.min(50000, Math.max(1, Number.isFinite(packetCount) ? Math.floor(packetCount) : 1));
  const configuredBytes = sourceMode === "upload"
    ? uploadFile?.size ?? selectedFileSize ?? 1
    : sourceMode === "packets"
      ? effectivePacketCount * payloadSize
      : bytesForSize(sizePreset, customKb);
  const estimatedPackets = sourceMode === "packets" ? effectivePacketCount : Math.ceil(configuredBytes / payloadSize) || 1;
  const runTotalPackets = run ? Math.ceil(run.fileSize / run.payloadSize) || 1 : estimatedPackets;
  const activeProtocol = run?.protocol ?? labProtocol;
  const hasReliability = labProtocol !== "UDP";
  const hasSlidingWindow = labProtocol === "GO_BACK_N" || labProtocol === "SELECTIVE_REPEAT";
  const effectiveWindowSize = hasSlidingWindow ? (windowMode === "custom" ? customWindowSize : windowSize) : labProtocol === "STOP_AND_WAIT" ? 1 : 0;

  const packets = useMemo(() => {
    const grouped = new Map<number, RdtEvent[]>();
    for (const event of currentEvents) {
      if (event.packetId == null) continue;
      grouped.set(event.packetId, [...(grouped.get(event.packetId) ?? []), event]);
    }
    return Array.from({ length: runTotalPackets }, (_, packetId) => {
      const packetEvents = grouped.get(packetId) ?? [];
      const state = stateFromEvents(packetEvents);
      return { packetId, state, events: packetEvents };
    });
  }, [currentEvents, runTotalPackets]);

  const stats = useMemo(() => {
    const packetsSent = currentEvents.filter((event) => event.type === "PACKET_SENT").length;
    const packetsWritten = currentEvents.filter((event) => event.type === "PACKET_WRITTEN").length;
    const confirmed = activeProtocol === "UDP" ? packetsWritten : currentEvents.filter((event) => event.type === "ACK_RECEIVED").length;
    const packetLost = currentEvents.filter((event) => event.type === "PACKET_LOST").length;
    const ackLost = currentEvents.filter((event) => event.type === "ACK_LOST").length;
    const corrupted = currentEvents.filter((event) => event.type === "PACKET_CORRUPTED").length;
    const retransmissions = currentEvents.filter((event) => event.type === "RETRANSMISSION").length;
    const duplicates = currentEvents.filter((event) => event.type === "DUPLICATE_RECEIVED").length;
    const rtts = currentEvents
      .map((event) => (typeof event.metadata?.rttMs === "number" ? event.metadata.rttMs : null))
      .filter((value): value is number => value != null);
    const elapsedMs = run ? (run.finishedAt ?? statsNow) - run.startedAt : 0;
    const usefulThroughput = run && elapsedMs > 0 ? Math.min(run.fileSize, confirmed * run.payloadSize) / (elapsedMs / 1000) : 0;
    const grossThroughput = run && elapsedMs > 0 ? packetsSent * run.payloadSize / (elapsedMs / 1000) : 0;
    return {
      packetsSent,
      packetsWritten,
      confirmed,
      packetLost,
      ackLost,
      corrupted,
      retransmissions,
      duplicates,
      elapsedMs,
      usefulThroughput,
      grossThroughput,
      avgRtt: rtts.length ? rtts.reduce((sum, value) => sum + value, 0) / rtts.length : 0,
      efficiency: packetsSent > 0 ? (confirmed / packetsSent) * 100 : 0,
      progress: runTotalPackets > 0 ? Math.min(100, (confirmed / runTotalPackets) * 100) : 0
    };
  }, [activeProtocol, currentEvents, run, runTotalPackets, statsNow]);

  const selectedPacket = packets[selectedPacketId] ?? packets[0];
  const latestSeq = [...currentEvents].reverse().find((event) => event.seq != null)?.seq;
  const seqCurrent = latestSeq ?? (activeProtocol === "STOP_AND_WAIT" ? stats.confirmed % 2 : stats.confirmed);
  const etaMs = stats.progress > 0 && stats.progress < 100 ? stats.elapsedMs * ((100 - stats.progress) / stats.progress) : 0;

  async function resolveFileName(): Promise<string> {
    if (sourceMode === "upload") {
      if (uploadFile) {
        const form = new FormData();
        form.set("file", uploadFile);
        const response = await fetch("/api/files/upload", { method: "POST", body: form });
        const data = await readJson<{ file: FileItem; error?: string }>(response);
        if (!response.ok || !data?.file) throw new Error(data?.error ?? "Falha ao enviar arquivo");
        await loadFiles();
        return data.file.name;
      }
      return selectedFile || files[0]?.name || "";
    }
    const bytes = sourceMode === "packets" ? effectivePacketCount * payloadSize : bytesForSize(sizePreset, customKb);
    const packetsToGenerate = sourceMode === "packets" ? effectivePacketCount : Math.max(1, Math.ceil(bytes / payloadSize));
    const response = await fetch("/api/files/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: sourceMode === "packets" ? "packets" : sourceMode,
        fileName: `${sourceMode}-demo.txt`,
        bytes,
        packets: packetsToGenerate,
        payloadSize,
        text: "RDT Lab generated text payload for reliable data transfer over UDP.\n"
      })
    });
    const data = await readJson<{ file: FileItem; error?: string }>(response);
    if (!response.ok || !data?.file) throw new Error(data?.error ?? "Falha ao gerar arquivo");
    await loadFiles();
    return data.file.name;
  }

  async function startRun() {
    if (starting || stopping || isRunning) return;
    setStarting(true);
    currentRunIdRef.current = null;
    eventIdsRef.current = new Set();
    setRun(null);
    setPaused(false);
    setPausedAt(null);
    setEvents([]);
    setMaxRuntimePacketId(0);
    setVisibleEvents([]);
    setClearedLogAt(0);
    setSaveStatus("");
    setSelectedPacketId(0);
    let fileName = "";
    try {
      fileName = await resolveFileName();
    } catch (error) {
      setSaveStatus(`Erro ao preparar arquivo: ${error instanceof Error ? error.message : String(error)}`);
      setStarting(false);
      return;
    }
    if (!fileName) {
      setSaveStatus("Escolha ou gere um arquivo antes de iniciar");
      setStarting(false);
      return;
    }
    const config: RunConfig = {
      protocol: labProtocol,
      fileName,
      payloadSize,
      packetLossRate: packetLoss / 100,
      ackLossRate: hasReliability ? ackLoss / 100 : 0,
      corruptionRate: corruption / 100,
      artificialDelayMs: delay + Math.floor(rtt / 2) + Math.floor(jitter / 2),
      timeoutMs: hasReliability ? timeoutMs : 0,
      demoMode: slowMode,
      windowSize: effectiveWindowSize
    };
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config)
      });
      const data = await readJson<{ run?: RunRecord; error?: string }>(response);
      if (!response.ok || !data?.run) {
        setSaveStatus(`Erro ao iniciar: ${data?.error ?? (response.statusText || "resposta inválida")}`);
        return;
      }
      currentRunIdRef.current = data.run.id;
      setRun(data.run);
      window.history.replaceState(null, "", `/runs/${data.run.id}`);
    } catch (error) {
      setSaveStatus(`Erro ao iniciar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setStarting(false);
    }
  }

  async function stopRun() {
    if (!run || run.status !== "running" || stopping) return;
    setStopping(true);
    setPaused(false);
    setPausedAt(null);
    try {
      await fetch(`/api/runs/${run.id}/stop`, { method: "POST" });
      await waitForStoppedRun(run.id);
    } catch (error) {
      setSaveStatus(`Erro ao parar: ${error instanceof Error ? error.message : String(error)}`);
      await loadRun(run.id);
    } finally {
      setStopping(false);
    }
  }

  async function waitForStoppedRun(runId: string): Promise<void> {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      await loadRun(runId);
      const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
      if (response.ok) {
        const data = (await response.json()) as { run: RunRecord; events: RdtEvent[] };
        currentRunIdRef.current = data.run.id;
        eventIdsRef.current = new Set(data.events.map((event) => event.id).filter((id): id is number => id != null));
        setRun(data.run);
        setEvents(data.events);
        setMaxRuntimePacketId(maxRuntimePacketIdFromEvents(data.events));
        setVisibleEvents(data.events);
        if (data.run.status !== "running") return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    await loadRun(runId);
  }

  async function saveRun() {
    if (!run) return;
    setSaveStatus("Salvando...");
    const response = await fetch(`/api/runs/${run.id}/save`, { method: "POST" });
    if (!response.ok) {
      setSaveStatus("Erro ao salvar");
      return;
    }
    const data = (await response.json()) as { run: RunRecord; events: RdtEvent[] };
    eventIdsRef.current = new Set(data.events.map((event) => event.id).filter((id): id is number => id != null));
    setRun(data.run);
    setEvents(data.events);
    setMaxRuntimePacketId(maxRuntimePacketIdFromEvents(data.events));
    if (!paused) setVisibleEvents(data.events);
    setSaveStatus(`Salvo no banco às ${formatClock(data.run.savedAt)}`);
  }

  async function clearRound() {
    if (run?.status === "running") {
      setStopping(true);
      try {
        await fetch(`/api/runs/${run.id}/stop`, { method: "POST" });
        await waitForStoppedRun(run.id);
      } finally {
        setStopping(false);
      }
    }
    currentRunIdRef.current = null;
    eventIdsRef.current = new Set();
    setRun(null);
    setPaused(false);
    setPausedAt(null);
    setEvents([]);
    setMaxRuntimePacketId(0);
    setVisibleEvents([]);
    setClearedLogAt(0);
    setSaveStatus("");
    setSelectedPacketId(0);
    window.history.replaceState(null, "", "/");
  }

  function selectPacket(packetId: number) {
    const next = Math.min(Math.max(0, packetId), Math.max(0, runTotalPackets - 1));
    setSelectedPacketId(next);
    setPacketJump(String(next));
  }

  return (
    <main className="rdt-screen">
      <aside className="left-column">
        <div className="brand-block">
          <div className="brand-mark">RDT</div>
          <div>
            <h1>RDT Lab</h1>
            <p>Reliable Data Transfer over UDP</p>
          </div>
        </div>

        <Card title="Configuração da transmissão">
          <Field label="Fonte dos dados">
            <select value={sourceMode} onChange={(event) => setSourceMode(event.target.value as SourceMode)}>
              <option value="upload">Upload de arquivo</option>
              <option value="text">Gerar texto</option>
              <option value="random">Gerar bytes aleatórios</option>
              <option value="packets">Gerar N pacotes</option>
            </select>
          </Field>
          {sourceMode === "upload" ? (
            <>
              <label className="upload-control">
                <UploadCloud size={16} />
                <span>{uploadFile?.name || "Escolher arquivo"}</span>
                <input type="file" onChange={(event) => setUploadFile(event.currentTarget.files?.[0] ?? null)} />
              </label>
              <Field label="Arquivo disponível">
                <select value={selectedFile} onChange={(event) => setSelectedFile(event.target.value)}>
                  {files.map((file) => (
                    <option key={file.name} value={file.name}>{file.name}</option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}
          {sourceMode !== "upload" && sourceMode !== "packets" ? (
            <>
              <Field label="Tamanho">
                <select value={sizePreset} onChange={(event) => setSizePreset(event.target.value)}>
                  <option value="10kb">10 KB</option>
                  <option value="100kb">100 KB</option>
                  <option value="1mb">1 MB</option>
                  <option value="10mb">10 MB</option>
                  <option value="custom">Personalizado</option>
                </select>
              </Field>
              {sizePreset === "custom" ? <NumberField label="Tamanho customizado" value={customKb} setValue={setCustomKb} suffix="KB" min={1} max={102400} /> : null}
            </>
          ) : null}
          {sourceMode === "packets" ? <NumberField label="Quantidade de pacotes" value={packetCount} setValue={setPacketCount} suffix="pacotes" min={1} max={50000} /> : null}
          <Field label="Tamanho do pacote">
            <select value={payloadSize} onChange={(event) => setPayloadSize(Number(event.target.value))}>
              {payloadOptions.map((option) => <option key={option} value={option}>{option} B</option>)}
            </select>
          </Field>
          <div className="estimate-box">
            <span>Pacotes estimados</span>
            <b>{estimatedPackets.toLocaleString("pt-BR")} pacotes</b>
          </div>

          <div className="config-divider" />
          <h3 className="config-subtitle">Protocolo</h3>
          <Field label="Protocolo">
            <select value={labProtocol} onChange={(event) => setLabProtocol(event.target.value as LabProtocol)}>
              <option value="UDP">UDP puro</option>
              <option value="STOP_AND_WAIT">Stop-and-Wait</option>
              <option value="GO_BACK_N">Go-Back-N</option>
              <option value="SELECTIVE_REPEAT">Selective Repeat</option>
            </select>
          </Field>
          {labProtocol === "STOP_AND_WAIT" ? <div className="protocol-note">Janela fixa: <b>1</b></div> : null}
          {labProtocol === "GO_BACK_N" ? <div className="protocol-note">ACK cumulativo: <b>informativo</b></div> : null}
          {hasSlidingWindow ? (
            <div className="window-config">
              <Field label="Janela">
                <select value={windowMode === "custom" ? "custom" : String(windowSize)} onChange={(event) => {
                  if (event.target.value === "custom") {
                    setWindowMode("custom");
                    return;
                  }
                  setWindowMode("preset");
                  setWindowSize(Number(event.target.value));
                }}>
                  {windowOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  <option value="custom">Personalizada</option>
                </select>
              </Field>
              {windowMode === "custom" ? <NumberField label="Janela customizada" value={customWindowSize} setValue={setCustomWindowSize} suffix="pacotes" min={1} max={256} /> : null}
            </div>
          ) : null}

          <div className="config-divider" />
          <h3 className="config-subtitle">Execução</h3>
          {hasReliability ? <NumberField label="Timeout do cliente" value={timeoutMs} setValue={setTimeoutMs} suffix="ms" min={100} max={10000} step={100} /> : null}
          <Toggle label="Modo lento" checked={slowMode} setChecked={setSlowMode} />
          {hasReliability ? <Toggle label="Play automático" checked={autoPlay} setChecked={setAutoPlay} /> : null}
        </Card>

        <Card title="Canal não confiável (simulação)">
          <SliderField label="Perda de pacote" value={packetLoss} setValue={setPacketLoss} min={0} max={100} suffix="%" />
          {hasReliability ? <SliderField label="Perda de ACK" value={ackLoss} setValue={setAckLoss} min={0} max={100} suffix="%" /> : null}
          <SliderField label="Corrupção de pacote" value={corruption} setValue={setCorruption} min={0} max={100} suffix="%" />
          <SliderField label="Delay artificial" value={delay} setValue={setDelay} min={0} max={2000} step={20} suffix="ms" />
          <SliderField label="Jitter" value={jitter} setValue={setJitter} min={0} max={1000} step={10} suffix="ms" />
          <SliderField label="RTT artificial" value={rtt} setValue={setRtt} min={0} max={2000} step={20} suffix="ms" />
        </Card>

        <Card title="Controles da rodada" className="round-controls-card">
          <button className="primary-btn" onClick={() => void startRun()} disabled={starting || stopping || isRunning} type="button">
            <Play size={16} />
            {starting ? "Iniciando..." : isRunning ? "Transmissão em andamento" : "Iniciar transmissão"}
          </button>
          <button className="secondary-btn" onClick={() => void clearRound()} disabled={starting || stopping} type="button">
            <RotateCcw size={16} />
            {stopping ? "Parando..." : "Limpar / nova rodada"}
          </button>
        </Card>
      </aside>

      <section className="center-column">
        <div className="summary-grid">
          <MetricCard title="Rodada atual" lines={[`ID: ${run?.id.slice(0, 8) ?? "-"}`, `Arquivo: ${run?.fileName ?? "-"}`, `Início: ${formatClock(run?.startedAt)}`]} />
          <MetricCard title="Protocolo" lines={[run ? protocolLabels[run.protocol as LabProtocol] ?? run.protocol : protocolLabels[labProtocol], `Status: ${run?.status ?? "idle"}`, hasSlidingWindow ? `Janela: ${effectiveWindowSize}` : `Seq atual: ${seqCurrent}`]} />
          <MetricCard title="Tempo decorrido" hero={formatElapsed(stats.elapsedMs)} lines={[`ETA: ${etaMs > 0 ? formatElapsed(etaMs) : "-"}`]} />
          <MetricCard title="Progresso" hero={`${stats.progress.toFixed(0)}%`} progress={stats.progress} lines={[`${stats.confirmed} / ${runTotalPackets} pacotes`]} />
        </div>

        <Card title="Visão geral dos pacotes" className="packet-overview">
          <div className="legend-row">
            {(["pending", "sent", "received", "acknowledged", "lost", "corrupted", "timeout", "retransmitted", "duplicated"] as PacketState[]).map((state) => (
              <span key={state}><i className={`dot ${state}`} />{stateLabel[state]}</span>
            ))}
          </div>
          <PacketGrid packets={packets} currentPacketId={maxRuntimePacketId} selectedPacketId={selectedPacketId} setSelectedPacketId={selectPacket} />
          <div className="packet-nav">
            <span>Clique em um pacote para ver os detalhes.</span>
            <form onSubmit={(event) => {
              event.preventDefault();
              const value = Number(packetJump);
              if (Number.isFinite(value)) selectPacket(value);
            }}>
              <label>Ir para o pacote</label>
              <input name="packet" type="number" min={0} max={Math.max(0, runTotalPackets - 1)} value={packetJump} onChange={(event) => setPacketJump(event.target.value)} />
              <button type="submit">Ir</button>
            </form>
          </div>
        </Card>

        <Card
          title={`Detalhes do pacote ${selectedPacket?.packetId ?? 0}`}
          className="packet-details"
          action={(
            <div className="detail-counters">
              <span>Duplicado: <b>{selectedPacket?.events.filter((event) => event.type === "DUPLICATE_RECEIVED").length ?? 0}</b> vezes</span>
              <span>Retransmissões: <b>{selectedPacket?.events.filter((event) => event.type === "RETRANSMISSION").length ?? 0}</b> vezes</span>
              <span>Tentativas: <b>{selectedPacket?.events.filter((event) => event.type === "PACKET_SENT").length ?? 0}</b></span>
            </div>
          )}
        >
          <ol className="packet-timeline">
            {(selectedPacket?.events ?? []).map((event, index) => (
              <li className={event.type.toLowerCase()} key={event.id ?? `${event.timestamp}-${index}`}>
                <b>{logNumber(event, index, eventOrder)}</b>
                <time>{formatLogDate(event.timestamp)}</time>
                <em>{origin(event)}</em>
                <strong>{event.type.replaceAll("_", " ")}</strong>
                <span>{event.message.replace(/^\[[^\]]+\]\s*/, "")}</span>
              </li>
            ))}
            {!selectedPacket?.events.length ? <li className="empty-row">Nenhum evento para este pacote ainda.</li> : null}
          </ol>
        </Card>
      </section>

      <aside className="right-column">
        <Card title="Ações rápidas" className="quick-actions-card">
          <div className="quick-actions">
            <button disabled={!run} onClick={() => {
              setPaused((value) => {
                const next = !value;
                if (next) {
                  setVisibleEvents(events);
                  setPausedAt(Date.now());
                } else {
                  setPausedAt(null);
                }
                return next;
              });
            }} type="button">
              <Pause size={15} /> {paused ? "Retomar visão" : "Pausar visão"}
            </button>
            <button onClick={() => void stopRun()} disabled={!isRunning || stopping} type="button">
              <Square size={15} /> {stopping ? "Parando..." : "Parar"}
            </button>
            <button onClick={() => void saveRun()} disabled={!run} type="button">
              <Save size={15} /> Salvar rodada
            </button>
          </div>
          {saveStatus ? <p className="save-status">{saveStatus}</p> : null}
          <button className="full-btn" disabled={!run} type="button">Abrir replay</button>
        </Card>

        <Card title="Estatísticas da rodada" className="stats-card">
          <StatLine label="Pacotes totais" value={runTotalPackets} />
          <StatLine label="Pacotes enviados" value={stats.packetsSent} />
          <StatLine label={activeProtocol === "UDP" ? "Pacotes recebidos" : "Pacotes confirmados"} value={stats.confirmed} />
          <hr />
          <StatLine label="Pacotes perdidos" value={stats.packetLost} />
          <StatLine label="ACKs perdidos" value={stats.ackLost} />
          <StatLine label="Pacotes corrompidos" value={stats.corrupted} />
          <hr />
          <StatLine label="Retransmissões" value={stats.retransmissions} />
          <StatLine label="Duplicatas recebidas" value={stats.duplicates} />
          <hr />
          <StatLine label="Tempo total" value={`${formatElapsed(stats.elapsedMs)}`} />
          <StatLine label="Throughput útil" value={`${stats.usefulThroughput.toFixed(1)} B/s`} />
          <StatLine label="Throughput bruto" value={`${stats.grossThroughput.toFixed(1)} B/s`} />
          <StatLine label="RTT médio estimado" value={`${stats.avgRtt.toFixed(1)} ms`} />
          <StatLine label="Eficiência" value={`${stats.efficiency.toFixed(1)}%`} />
        </Card>

        <Card title="Integridade do arquivo">
          <div className="hash-block">
            <span>Hash original (SHA-256)</span>
            <b>{shortHash(run?.originalHash)}</b>
          </div>
          <div className="hash-block">
            <span>Hash recebido (SHA-256)</span>
            <b>{shortHash(run?.receivedHash)}</b>
          </div>
          <div className={`integrity ${run?.receivedHash && run.originalHash === run.receivedHash ? "ok" : "pending"}`}>
            {run?.receivedHash ? (run.originalHash === run.receivedHash ? "OK — arquivo recebido com sucesso" : "Erro — arquivo corrompido") : "Aguardando finalização"}
          </div>
        </Card>

        <Card title="Log de eventos ao vivo" action={<button className="tiny-btn" onClick={() => setClearedLogAt(Date.now())} type="button">Limpar</button>} className="live-log-card">
          <div className="live-log">
            {logEvents.slice(-120).map((event, index) => (
              <div className={event.type.toLowerCase()} key={event.id ?? `${event.timestamp}-${index}`}>
                <b>{logNumber(event, index, eventOrder)}</b>
                <time>{formatLogDate(event.timestamp)}</time>
                <em>{origin(event)}</em>
                <strong>{event.type.replaceAll("_", " ")}</strong>
                <span>{event.message.replace(/^\[[^\]]+\]\s*/, "")}</span>
              </div>
            ))}
          </div>
        </Card>
      </aside>
    </main>
  );
}

function Card({ title, children, action, className = "" }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SliderField({ label, value, setValue, min, max, suffix, step = 1 }: { label: string; value: number; setValue: (value: number) => void; min: number; max: number; suffix: string; step?: number }) {
  return (
    <div className="slider-field">
      <div>
        <label>{label}</label>
        <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => setValue(Number(event.target.value))} />
        <span>{suffix}</span>
      </div>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => setValue(Number(event.target.value))} />
    </div>
  );
}

function NumberField({ label, value, setValue, suffix, min, max, step = 1 }: { label: string; value: number; setValue: (value: number) => void; suffix: string; min: number; max: number; step?: number }) {
  return (
    <div className="number-field">
      <label>{label}</label>
      <div>
        <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => setValue(Number(event.target.value))} />
        <span>{suffix}</span>
      </div>
    </div>
  );
}

function Toggle({ label, checked, setChecked }: { label: string; checked: boolean; setChecked: (checked: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
    </label>
  );
}

function MetricCard({ title, lines, hero, progress }: { title: string; lines: string[]; hero?: string; progress?: number }) {
  return (
    <section className="metric-card">
      <h2>{title}</h2>
      {hero ? <b>{hero}</b> : null}
      {progress != null ? <i><span style={{ width: `${progress}%` }} /></i> : null}
      {lines.map((line) => <p key={line}>{line}</p>)}
    </section>
  );
}

function PacketGrid({ packets, currentPacketId, selectedPacketId, setSelectedPacketId }: { packets: Array<{ packetId: number; state: PacketState; events: RdtEvent[] }>; currentPacketId: number; selectedPacketId: number; setSelectedPacketId: (id: number) => void }) {
  const columns = usePacketGridColumns();
  const rowsPerPage = 3;
  const pageSize = columns * rowsPerPage;
  const [pageIndex, setPageIndex] = useState(0);
  const latest = Math.min(Math.max(0, currentPacketId), Math.max(0, packets.length - 1));
  const pageCount = Math.max(1, Math.ceil(packets.length / pageSize));
  const firstVisibleRow = pageIndex * rowsPerPage + 1;
  const lastVisibleRow = Math.min(Math.ceil(packets.length / columns), firstVisibleRow + rowsPerPage - 1);
  const fixedRows = packets.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
  const currentStart = Math.floor(latest / columns) * columns;
  const currentRow = packets.slice(currentStart, currentStart + columns);
  const showCurrentRow = packets.length > columns;

  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  return (
    <div className="packet-grid-shell">
      <div className="packet-pagebar">
        <span>Linhas fixas {firstVisibleRow}-{lastVisibleRow}</span>
        <div>
          <button type="button" onClick={() => setPageIndex((current) => Math.max(0, current - 1))} disabled={pageIndex === 0}>Anterior</button>
          <b>{pageIndex + 1}/{pageCount}</b>
          <button type="button" onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))} disabled={pageIndex >= pageCount - 1}>Próxima</button>
        </div>
      </div>
      <div className="packet-grid" style={{ "--packet-columns": columns } as CSSProperties}>
        {fixedRows.map((packet) => <PacketCell key={packet.packetId} packet={packet} selected={packet.packetId === selectedPacketId} onClick={setSelectedPacketId} />)}
      </div>
      {showCurrentRow ? (
        <>
          <div className="packet-current-label">Linha atual: pacotes {currentStart}-{Math.min(packets.length - 1, currentStart + columns - 1)}</div>
          <div className="packet-grid current-row" style={{ "--packet-columns": columns } as CSSProperties}>
            {currentRow.map((packet) => <PacketCell key={`current-${packet.packetId}`} packet={packet} selected={packet.packetId === selectedPacketId} onClick={setSelectedPacketId} />)}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PacketCell({ packet, selected, onClick }: { packet: { packetId: number; state: PacketState; events: RdtEvent[] }; selected: boolean; onClick: (id: number) => void }) {
  const attempts = packet.events.filter((event) => event.type === "PACKET_SENT").length;
  const ack = packet.events.some((event) => event.type === "ACK_RECEIVED");
  const seq = packet.events.find((event) => event.seq != null)?.seq ?? "-";
  const bytes = packet.events.find((event) => typeof event.metadata?.payloadBytes === "number")?.metadata?.payloadBytes ?? "-";
  const title = [`Packet ID: ${packet.packetId}`, `Seq: ${seq}`, `Checksum: ${packet.state === "corrupted" ? "falhou" : "OK"}`, `Tentativas: ${attempts}`, `Tempo: ${packet.events.length ? "registrado" : "-"}`, `ACK: ${ack ? "sim" : "não"}`, `Bytes: ${bytes}`].join("\n");
  return (
    <button className={`packet-cell ${packet.state} ${selected ? "selected" : ""}`} title={title} onClick={() => onClick(packet.packetId)} type="button">
      {packet.packetId}
    </button>
  );
}

function StatLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-line">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
