"use client";

import { ChevronDown, ChevronUp, FileUp, Play, Shuffle } from "lucide-react";
import { useState } from "react";
import type { RunConfig } from "@/rdt/events";

type Props = {
  files: Array<{ name: string; size: number }>;
  busy: boolean;
  onStart: (config: RunConfig) => Promise<void>;
  onFilesChanged: () => Promise<void>;
};

export function DemoControls({ files, busy, onStart, onFilesChanged }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [source, setSource] = useState<"file" | "random" | "text" | "packets">("file");
  const [generating, setGenerating] = useState(false);

  async function generate(formData: FormData): Promise<string> {
    setGenerating(true);
    try {
      const payloadSize = Number(formData.get("payloadSize"));
      const response = await fetch("/api/files/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: source,
          fileName: String(formData.get("generatedName") || `${source}-${Date.now()}.txt`),
          bytes: Number(formData.get("generatedBytes") || 10240),
          text: String(formData.get("generatedText") || ""),
          packets: Number(formData.get("generatedPackets") || 10),
          payloadSize
        })
      });
      if (!response.ok) throw new Error("Falha ao gerar arquivo");
      const data = (await response.json()) as { file: { name: string; size: number } };
      await onFilesChanged();
      return data.file.name;
    } finally {
      setGenerating(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    const response = await fetch("/api/files/upload", { method: "POST", body: data });
    if (!response.ok) throw new Error("Falha ao enviar arquivo");
    await onFilesChanged();
  }

  async function submit(formData: FormData) {
    const fileName = source !== "file" ? await generate(formData) : String(formData.get("fileName") ?? "");
    await onStart({
      fileName,
      payloadSize: Number(formData.get("payloadSize")),
      packetLossRate: Number(formData.get("packetLossRate")) / 100,
      ackLossRate: Number(formData.get("ackLossRate")) / 100,
      corruptionRate: Number(formData.get("corruptionRate")) / 100,
      artificialDelayMs: Number(formData.get("artificialDelayMs")) + Math.floor(Number(formData.get("rttMs")) / 2),
      timeoutMs: Number(formData.get("timeoutMs")),
      demoMode: formData.get("demoMode") === "on"
    });
  }

  return (
    <section className="panel region-config">
      <div className="panel-heading">
        <div>
          <h2>Configuração</h2>
          <p className="panel-subtitle">Cenário, arquivo e canal não confiável</p>
        </div>
        <button className="icon-btn" type="button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "Expandir configuração" : "Minimizar configuração"}>
          {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
      </div>
      <form action={submit} className={`control-form ${collapsed ? "collapsed" : ""}`}>
        <div className="segmented">
          {(["file", "random", "text", "packets"] as const).map((item) => (
            <button key={item} type="button" className={source === item ? "active" : ""} onClick={() => setSource(item)}>
              {item === "file" ? "Arquivo" : item === "random" ? "Aleatório" : item === "text" ? "Texto" : "N pacotes"}
            </button>
          ))}
        </div>

        {source === "file" ? (
          <>
            <div className="field">
              <label htmlFor="upload">Upload arquivo</label>
              <label className="file-picker" htmlFor="upload">
                <FileUp size={16} />
                Escolher arquivo
              </label>
              <input id="upload" className="visually-hidden" type="file" onChange={(event) => void upload(event.currentTarget.files?.[0])} />
            </div>
            <div className="field">
              <label htmlFor="fileName">Arquivo em data/input</label>
              <select id="fileName" name="fileName" required>
                {files.map((file) => (
                  <option key={file.name} value={file.name}>
                    {file.name} ({file.size} bytes)
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <GeneratedSourceFields source={source} files={files} generating={generating} />
        )}

        <div className="field">
          <label htmlFor="payloadSize">Payload</label>
          <select id="payloadSize" name="payloadSize" defaultValue="512">
            {[256, 512, 1024, 1400, 4096].map((size) => (
              <option key={size} value={size}>
                {size} bytes
              </option>
            ))}
          </select>
        </div>

        <div className="section-label">Canal</div>
        <RangeField name="packetLossRate" label="Perda de pacote" min={0} max={100} defaultValue={10} suffix="%" />
        <RangeField name="ackLossRate" label="Perda de ACK" min={0} max={100} defaultValue={10} suffix="%" />
        <RangeField name="corruptionRate" label="Corrupção" min={0} max={100} defaultValue={5} suffix="%" />
        <RangeField name="artificialDelayMs" label="Delay" min={0} max={2000} defaultValue={120} suffix="ms" step={20} />
        <RangeField name="jitterMs" label="Jitter" min={0} max={1000} defaultValue={0} suffix="ms" step={20} />
        <RangeField name="rttMs" label="RTT" min={0} max={2000} defaultValue={0} suffix="ms" step={20} />

        <div className="section-label">Timeout</div>
        <select name="timeoutMs" defaultValue="1000">
          {[100, 500, 1000, 2000, 5000].map((value) => (
            <option key={value} value={value}>
              {value} ms
            </option>
          ))}
        </select>

        <div className="section-label">Demo</div>
        <label className="switch">
          <span>Modo lento</span>
          <input name="demoMode" type="checkbox" defaultChecked />
        </label>
        <label className="switch">
          <span>Play automático</span>
          <input name="autoPlay" type="checkbox" defaultChecked />
        </label>
        <button className="ghost-btn" type="button" disabled>
          Próximo passo
        </button>

        <div className="section-label">Protocolos futuros</div>
        <div className="field">
          <label>Janela</label>
          <select disabled>
            {[1, 2, 4, 8, 16, 32, 64].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>

        <button className="primary-btn" disabled={busy || (source === "file" && files.length === 0) || generating} type="submit">
          <Play size={18} />
          Iniciar transmissão
        </button>
      </form>
    </section>
  );
}

function GeneratedSourceFields({ source, files, generating }: { source: "random" | "text" | "packets"; files: Array<{ name: string; size: number }>; generating: boolean }) {
  const generatedName = `${source}-demo.txt`;
  return (
    <>
      <div className="field">
        <label>Nome do arquivo</label>
        <input name="generatedName" defaultValue={generatedName} />
      </div>
      {source === "text" ? (
        <div className="field">
          <label>Gerar texto</label>
          <textarea name="generatedText" rows={4} defaultValue="RDT Lab: texto gerado para demonstrar checksum, ACK, timeout e retransmissao." />
        </div>
      ) : source === "packets" ? (
        <RangeField name="generatedPackets" label="Gerar exatamente N pacotes" min={1} max={5000} defaultValue={50} suffix="" />
      ) : (
        <RangeField name="generatedBytes" label="Gerar bytes aleatórios" min={1024} max={10485760} defaultValue={1048576} suffix="B" step={1024} />
      )}
      <div className="hint-line">
        <Shuffle size={14} />
        {generating ? "gerando..." : `${files.length} arquivos disponíveis`}
      </div>
    </>
  );
}

function RangeField(props: { name: string; label: string; min: number; max: number; defaultValue: number; suffix: string; step?: number }) {
  return (
    <div className="field">
      <label htmlFor={props.name}>{props.label}</label>
      <div className="range-row">
        <input id={props.name} name={props.name} type="range" min={props.min} max={props.max} step={props.step ?? 1} defaultValue={props.defaultValue} />
        <input name={props.name} type="number" min={props.min} max={props.max} step={props.step ?? 1} defaultValue={props.defaultValue} aria-label={`${props.label} ${props.suffix}`} />
      </div>
    </div>
  );
}
