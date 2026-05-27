import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  AudioLines,
  AudioWaveform,
  CheckCircle2,
  CircleDot,
  Download,
  FolderInput,
  Gauge,
  LayoutDashboard,
  Mic2,
  Moon,
  Music2,
  RotateCcw,
  Scissors,
  Search,
  SlidersHorizontal,
  Sun,
  Upload,
  Usb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { DeviceEngineHost, groups, projects, useDeviceEngine, type DeviceEngine, type Pad, type Sound } from "@/device";
import { defaultSettings, loadInitialSampleSettings, syncOfflineDspSettings, type SampleSettings } from "@/dsp/settings";
import { cn } from "@/lib/utils";

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem("ep-modern-theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("ep-modern-theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, setDark };
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="truncate text-lg font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ icon: Icon, title, description }: { icon: typeof Gauge; title: string; description: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="rounded-md bg-primary p-2 text-primary-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  detail,
  checked,
  onCheckedChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function SampleSettingsPanel({
  settings,
  setSettings,
}: {
  settings: SampleSettings;
  setSettings: (settings: SampleSettings) => void;
}) {
  const update = <Key extends keyof SampleSettings>(key: Key, value: SampleSettings[Key]) => {
    setSettings({ ...settings, [key]: value });
  };

  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={SlidersHorizontal} title="Sample Settings" description="Applied before sending samples to the selected pad or kit." />
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label="DSP on transfer" detail="Process audio before upload" checked={settings.enabled} onCheckedChange={(checked) => update("enabled", checked)} />
        <SettingRow label="Normalize" detail={`Peak target ${settings.targetDb} dBFS`} checked={settings.normalize} onCheckedChange={(checked) => update("normalize", checked)} />
        <SettingRow label="Trim silence" detail="Remove quiet heads and tails" checked={settings.trim} onCheckedChange={(checked) => update("trim", checked)} />
        <SettingRow label="Mono mix" detail="Collapse stereo files for tight kits" checked={settings.mono} onCheckedChange={(checked) => update("mono", checked)} />
        <SettingRow label="Auto-tag names" detail="Prefix obvious kicks, snares, loops, and FX" checked={settings.autoTag} onCheckedChange={(checked) => update("autoTag", checked)} />
        <SettingRow label="Reverse copy" detail="Create a reversed variant next to source" checked={settings.reverse} onCheckedChange={(checked) => update("reverse", checked)} />
        <SettingRow label="Ping-pong copy" detail="Render forward and reverse playback" checked={settings.pingPong} onCheckedChange={(checked) => update("pingPong", checked)} />
        <SettingRow label="Low cut" detail={`${settings.lowCutHz || 35} Hz high-pass`} checked={settings.lowCut} onCheckedChange={(checked) => update("lowCut", checked)} />
        <SettingRow label="High cut" detail={`${settings.highCutHz || 16000} Hz low-pass`} checked={settings.highCut} onCheckedChange={(checked) => update("highCut", checked)} />
        <SettingRow label="Lo-Fi mode" detail={`${settings.lofiSampleRate || 22050} Hz, ${settings.lofiBitDepth || 12}-bit character`} checked={settings.lofi} onCheckedChange={(checked) => update("lofi", checked)} />
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Output Hz
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.targetSampleRate} onChange={(event) => update("targetSampleRate", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Target dBFS
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.targetDb} onChange={(event) => update("targetDb", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Gain dB
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.gainDb} onChange={(event) => update("gainDb", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Trim dBFS
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.trimThresholdDb} onChange={(event) => update("trimThresholdDb", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Fade in ms
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.fadeInMs} onChange={(event) => update("fadeInMs", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Fade out ms
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.fadeOutMs} onChange={(event) => update("fadeOutMs", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Source BPM
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.sourceBpm} onChange={(event) => update("sourceBpm", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Target BPM
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.targetBpm} onChange={(event) => update("targetBpm", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Low cut Hz
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.lowCutHz} onChange={(event) => update("lowCutHz", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            High cut Hz
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.highCutHz} onChange={(event) => update("highCutHz", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Lo-Fi Hz
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.lofiSampleRate} onChange={(event) => update("lofiSampleRate", event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Lo-Fi bits
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.lofiBitDepth} onChange={(event) => update("lofiBitDepth", event.target.value)} />
          </label>
        </div>
        <Button variant="outline" className="justify-start" onClick={() => setSettings(defaultSettings)}>
          <RotateCcw className="h-4 w-4" /> Reset settings
        </Button>
      </CardContent>
    </Card>
  );
}

function PadGrid({
  pads,
  selectedPad,
  onSelectPad,
  onDropPad,
}: {
  pads: Pad[];
  selectedPad: string;
  onSelectPad: (pad: string) => void;
  onDropPad: (pad: Pad, files: File[]) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {pads.map((pad) => {
        const empty = !pad.name;
        const selected = selectedPad === pad.number;
        return (
          <button
            key={pad.number}
            onClick={() => onSelectPad(pad.number)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const files = Array.from(event.dataTransfer.files || []);
              if (files.length) onDropPad(pad, files);
            }}
            className={cn(
              "group min-h-28 rounded-lg border p-3 text-left transition hover:border-primary hover:bg-primary/5",
              selected && "border-primary bg-primary/10",
              empty ? "border-dashed bg-muted/30 text-muted-foreground" : "bg-card",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary">PAD {pad.number}</span>
              <CircleDot className={cn("h-3.5 w-3.5", empty ? "text-muted-foreground" : "text-emerald-500")} />
            </div>
            <div className="mt-4 truncate text-sm font-medium">{pad.name || "empty"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{pad.type}</div>
            <div className="mt-3 truncate text-xs text-muted-foreground">{pad.size || "drop sample"}</div>
          </button>
        );
      })}
    </div>
  );
}

function SampleModal({
  open,
  pad,
  onClose,
  onUpload,
}: {
  open: boolean;
  pad?: Pad;
  onClose: () => void;
  onUpload: (files: File[], startPad: number) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackRef = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [source, setSource] = useState<"system" | "mic">("system");
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [markers, setMarkers] = useState<number[]>([]);
  const [status, setStatus] = useState("Load or record audio");
  const [recording, setRecording] = useState(false);

  const stopPlayback = useCallback(() => {
    if (!playbackRef.current) return;
    try {
      playbackRef.current.source.stop();
    } catch {}
    void playbackRef.current.context.close();
    playbackRef.current = null;
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#071b16";
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!audioBuffer) {
      ctx.fillStyle = "#35d08b";
      ctx.font = "13px sans-serif";
      ctx.fillText("load or record audio", 16, rect.height / 2);
      return;
    }

    const data = audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / rect.width));
    const mid = rect.height / 2;
    ctx.strokeStyle = "#35d08b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < rect.width; x++) {
      let min = 1;
      let max = -1;
      const start = x * step;
      for (let i = 0; i < step && start + i < data.length; i++) {
        const value = data[start + i];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      ctx.moveTo(x, mid + min * mid * 0.88);
      ctx.lineTo(x, mid + max * mid * 0.88);
    }
    ctx.stroke();

    ctx.strokeStyle = "#f15a3b";
    ctx.lineWidth = 2;
    markers.forEach((marker, index) => {
      const x = marker * rect.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
      ctx.fillStyle = "#f15a3b";
      ctx.fillRect(x - 8, 6, 16, 16);
      ctx.fillStyle = "#fff7ef";
      ctx.font = "10px sans-serif";
      ctx.fillText(String(index + 1), x - 3, 18);
    });
  }, [audioBuffer, markers]);

  useEffect(() => {
    if (!open) return;
    drawWaveform();
    window.addEventListener("resize", drawWaveform);
    return () => window.removeEventListener("resize", drawWaveform);
  }, [drawWaveform, open]);

  useEffect(() => () => {
    stopPlayback();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [stopPlayback]);

  async function loadBlob(blob: Blob, name = "audio") {
    stopPlayback();
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      setAudioBuffer(decoded);
      setMarkers([]);
      setStatus(`Loaded ${name} (${decoded.duration.toFixed(2)}s)`);
    } finally {
      await context.close();
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setStatus("Recording is not supported");
      return;
    }
    stopPlayback();
    chunksRef.current = [];
    try {
      const stream = source === "mic"
        ? await navigator.mediaDevices.getUserMedia({ audio: true })
        : await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        setStatus("No audio track selected");
        return;
      }
      streamRef.current = new MediaStream(audioTracks);
      const recorder = new MediaRecorder(streamRef.current);
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        if (!chunksRef.current.length) {
          setStatus("Nothing recorded");
          return;
        }
        await loadBlob(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }), "recording");
      });
      recorder.start();
      setRecording(true);
      setStatus(source === "mic" ? "Recording microphone" : "Recording shared audio");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Recording failed");
      setRecording(false);
    }
  }

  function stopRecording() {
    recorderRef.current?.state === "recording" ? recorderRef.current.stop() : undefined;
  }

  function addMarker(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!audioBuffer || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const marker = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    if (marker <= 0.01 || marker >= 0.99) return;
    const next = [...new Set([...markers, Number(marker.toFixed(4))])].sort((a, b) => a - b).slice(0, 11);
    setMarkers(next);
    setStatus(`${next.length + 1} chop${next.length ? "s" : ""}`);
  }

  function equalChops(count: number) {
    if (!audioBuffer) return;
    setMarkers(Array.from({ length: count - 1 }, (_, index) => (index + 1) / count));
    setStatus(`${count} equal chops`);
  }

  function transientChops() {
    if (!audioBuffer) return;
    const data = audioBuffer.getChannelData(0);
    const windowSize = Math.max(128, Math.floor(audioBuffer.sampleRate * 0.012));
    const energies: number[] = [];
    for (let pos = 0; pos < data.length; pos += windowSize) {
      let sum = 0;
      for (let i = 0; i < windowSize && pos + i < data.length; i++) sum += Math.abs(data[pos + i]);
      energies.push(sum / windowSize);
    }
    const average = energies.reduce((sum, value) => sum + value, 0) / Math.max(1, energies.length);
    const next: number[] = [];
    let cooldown = 0;
    for (let index = 1; index < energies.length - 1; index++) {
      const rising = energies[index] > energies[index - 1] * 1.8 && energies[index] > average * 1.4;
      if (cooldown <= 0 && rising) {
        const marker = (index * windowSize) / data.length;
        if (marker > 0.02 && marker < 0.98) next.push(Number(marker.toFixed(4)));
        cooldown = Math.floor(audioBuffer.sampleRate * 0.12 / windowSize);
      }
      cooldown--;
    }
    setMarkers(next.slice(0, 11));
    setStatus(`${Math.min(next.length, 11) + 1} transient chops`);
  }

  function play() {
    if (!audioBuffer) return;
    stopPlayback();
    const context = new AudioContext();
    const sourceNode = context.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(context.destination);
    sourceNode.addEventListener("ended", () => {
      void context.close();
      playbackRef.current = null;
    });
    sourceNode.start();
    playbackRef.current = { context, source: sourceNode };
  }

  function encodeWav(channels: Float32Array[], sampleRate: number) {
    const channelCount = channels.length;
    const frameCount = channels[0].length;
    const buffer = new ArrayBuffer(44 + frameCount * channelCount * 2);
    const view = new DataView(buffer);
    let offset = 0;
    const text = (value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset++, value.charCodeAt(i));
    };
    text("RIFF");
    view.setUint32(offset, 36 + frameCount * channelCount * 2, true); offset += 4;
    text("WAVEfmt ");
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, channelCount, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * channelCount * 2, true); offset += 4;
    view.setUint16(offset, channelCount * 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    text("data");
    view.setUint32(offset, frameCount * channelCount * 2, true); offset += 4;
    for (let i = 0; i < frameCount; i++) {
      for (let ch = 0; ch < channelCount; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function renderSlice(startFrame: number, endFrame: number, name: string) {
    if (!audioBuffer) return null;
    const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) =>
      audioBuffer.getChannelData(channel).slice(startFrame, endFrame),
    );
    return new File([encodeWav(channels, audioBuffer.sampleRate)], name, { type: "audio/wav" });
  }

  function renderChops() {
    if (!audioBuffer) return [];
    const points = [0, ...markers, 1].sort((a, b) => a - b);
    return points.flatMap((point, index) => {
      if (index >= points.length - 1) return [];
      const start = Math.floor(point * audioBuffer.length);
      const end = Math.floor(points[index + 1] * audioBuffer.length);
      if (end - start < audioBuffer.sampleRate * 0.015) return [];
      const file = renderSlice(start, end, `sample_chop_${String(index + 1).padStart(2, "0")}.wav`);
      return file ? [file] : [];
    }).slice(0, 12);
  }

  function assign() {
    const files = renderChops();
    if (!files.length) {
      setStatus("No audio to assign");
      return;
    }
    onUpload(files, Number(pad?.number || 1));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <SectionTitle icon={AudioWaveform} title={`Sample Pad ${pad?.number || "--"}`} description="Capture, load, chop, and assign without leaving the workspace." />
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_260px]">
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Button variant={source === "system" ? "default" : "outline"} onClick={() => setSource("system")}>System</Button>
              <Button variant={source === "mic" ? "default" : "outline"} onClick={() => setSource("mic")}>Mic</Button>
              <Button onClick={recording ? stopRecording : startRecording}><Mic2 className="h-4 w-4" /> {recording ? "Stop" : "Record"}</Button>
              <Button variant="outline" onClick={() => fileInput.current?.click()}><FolderInput className="h-4 w-4" /> Load file</Button>
              <Button variant="outline" onClick={transientChops}><Scissors className="h-4 w-4" /> Detect chops</Button>
              <Button variant="outline" onClick={play}>Play</Button>
              <Button onClick={assign}><Upload className="h-4 w-4" /> Assign to pad {Number(pad?.number || 1)}</Button>
              <input
                ref={fileInput}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void loadBlob(file, file.name);
                }}
              />
            </div>
            <canvas ref={canvasRef} onClick={addMarker} className="h-72 w-full rounded-lg border bg-zinc-950" />
            <div className="text-sm text-muted-foreground">{status}</div>
          </div>
          <div className="grid content-start gap-3">
            <Button variant="outline" className="justify-start" onClick={() => equalChops(4)}><Scissors className="h-4 w-4" /> 4 equal chops</Button>
            <Button variant="outline" className="justify-start" onClick={() => equalChops(8)}><Scissors className="h-4 w-4" /> 8 equal chops</Button>
            <Button variant="outline" className="justify-start" onClick={() => equalChops(12)}><Scissors className="h-4 w-4" /> 12 equal chops</Button>
            <Button variant="outline" className="justify-start" onClick={() => setMarkers([])}><RotateCcw className="h-4 w-4" /> Clear markers</Button>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              Chops are staged for the selected project/group target. The upload action assigns the rendered files starting at pad {Number(pad?.number || 1)}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SampleManager({
  engine,
}: {
  engine: DeviceEngine;
}) {
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [bank, setBank] = useState<"all" | string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const soundById = new Map(engine.sounds.map((sound) => [sound.id, sound]));
  const slots = Array.from({ length: 999 }, (_, index) => {
    const id = index + 1;
    return {
      id,
      sound: soundById.get(id),
    };
  });
  const allBanks = Array.from({ length: 10 }, (_, index) => {
    const start = index * 100;
    const range = `${start}-${start + 99}`;
    const bankSlots = slots.filter((slot) => Math.floor((slot.id - 1) / 100) * 100 === start);
    const count = bankSlots.filter((slot) => slot.sound).length;
    return { range, count, total: bankSlots.length };
  });
  const searchedSlots = slots.filter((slot) => {
    const sound = slot.sound;
    if (!query.trim()) return true;
    const text = `${slot.id} ${sound?.name || "empty"} ${sound?.path || ""} ${(sound?.usageProjects || []).join(" ")}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const visibleSlots = bank === "all" ? searchedSlots : searchedSlots.filter((slot) => {
    const start = Math.floor((slot.id - 1) / 100) * 100;
    return `${start}-${start + 99}` === bank;
  });
  const selected = (selectedId ? soundById.get(selectedId) : undefined) || visibleSlots.find((slot) => slot.sound)?.sound;
  const groupedSlots = visibleSlots.reduce<Record<string, Array<{ id: number; sound?: Sound }>>>((groupsByHundred, slot) => {
    const start = Math.floor((slot.id - 1) / 100) * 100;
    const range = `${start}-${start + 99}`;
    if (!groupsByHundred[range]) groupsByHundred[range] = [];
    groupsByHundred[range].push(slot);
    return groupsByHundred;
  }, {});
  const slotGroups = Object.entries(groupedSlots).sort(([a], [b]) => Number(a.split("-")[0]) - Number(b.split("-")[0]));

  const uploadToSlot = (slot: { id: number; sound?: Sound }, files: File[]) => {
    if (!files.length) return;
    const occupiedTargets = files
      .map((_, index) => soundById.get(slot.id + index))
      .filter((sound): sound is Sound => Boolean(sound));
    if (occupiedTargets.length) {
      const label = occupiedTargets.length === 1
        ? `sample ${String(occupiedTargets[0].id).padStart(3, "0")} "${occupiedTargets[0].name}"`
        : `${occupiedTargets.length} occupied slots starting at ${String(slot.id).padStart(3, "0")}`;
      const confirmed = window.confirm(`Replace ${label}?`);
      if (!confirmed) return;
    }
    void engine.uploadSamplesToSlots(files, slot.id, Boolean(slot.sound));
  };

  return (
    <Card className="min-h-[calc(100vh-260px)]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle icon={Archive} title="Sample Library" description="Browse EP memory by 100-slot banks, search, preview, export, or clear samples." />
          <div className="flex gap-2">
            <input
              ref={uploadInput}
              type="file"
              accept="audio/*"
              className="hidden"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.currentTarget.value = "";
                if (files.length) void engine.uploadSamples(files);
              }}
            />
            <Button variant="outline" onClick={() => uploadInput.current?.click()} disabled={!engine.connected}>
              <Upload className="h-4 w-4" /> Upload
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-lg border bg-muted/35 p-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="grid gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{engine.memory}</span>
              <span>{engine.memoryUsedPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${Math.min(100, engine.memoryUsedPercent)}%` }} />
            </div>
          </div>
          <label className="relative grid gap-1 text-xs text-muted-foreground">
            Search samples
            <Search className="pointer-events-none absolute bottom-2 left-2.5 h-4 w-4 text-muted-foreground" />
            <input className="h-9 rounded-md border bg-background pl-8 pr-2 text-sm text-foreground" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Button size="sm" variant={bank === "all" ? "default" : "outline"} onClick={() => setBank("all")}>
            All {engine.sounds.length}/999
          </Button>
          {allBanks.map(({ range, count, total }) => (
            <Button key={range} size="sm" variant={bank === range ? "default" : "outline"} onClick={() => setBank(range)} className="shrink-0">
              {range} <span className="text-xs opacity-70">{count}/{total}</span>
            </Button>
          ))}
        </div>
        <div className="grid gap-4 overflow-auto pr-1 xl:max-h-[calc(100vh-430px)]">
          {slotGroups.length ? slotGroups.map(([range, items]) => (
            <section key={range} className="grid gap-2">
              <div className="sticky top-0 z-10 flex items-center justify-between rounded-md border bg-card/95 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                <span>Samples {range}</span>
                <span>{items.filter((slot) => slot.sound).length}/{items.length} used</span>
              </div>
              <div className="grid gap-2">
                {items.map((slot) => {
                  const sound = slot.sound;
                  const usage = sound?.usageProjects || [];
                  return (
                    <button
                      key={slot.id}
                      onClick={() => setSelectedId(slot.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        uploadToSlot(slot, Array.from(event.dataTransfer.files || []));
                      }}
                      className={cn(
                        "grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border p-3 text-left text-sm transition hover:border-primary hover:bg-primary/5",
                        sound ? "bg-background" : "border-dashed bg-muted/20 text-muted-foreground",
                        selectedId === slot.id && "border-primary bg-primary/10",
                      )}
                    >
                      <span className="rounded-md bg-muted px-2 py-1 text-center font-mono text-xs text-muted-foreground">{String(slot.id).padStart(3, "0")}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{sound?.name || "empty slot"}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {!sound ? (
                            <span className="rounded-sm border border-dashed bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">drop sample here</span>
                          ) : usage.length ? usage.map((project) => (
                            <span key={project} className="rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                              Project {Number(project)}
                            </span>
                          )) : (
                            <span className="rounded-sm border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">unused</span>
                          )}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">{sound?.size || "available"}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {engine.connected ? "No slots match the current search." : "Connect a device to load samples."}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/35 p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{selected ? `${String(selected.id).padStart(3, "0")} ${selected.name}` : "No sample selected"}</div>
            <div className="text-xs text-muted-foreground">
              {selected?.usageProjects?.length ? `Used in project ${selected.usageProjects.map((project) => Number(project)).join(", ")}` : "No project usage detected"}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => engine.playSound(selected)} disabled={!selected}>Play</Button>
          <Button size="sm" variant="outline" onClick={() => engine.downloadSound(selected)} disabled={!selected}>WAV</Button>
          <Button size="sm" variant="outline" onClick={() => engine.deleteSound(selected)} disabled={!selected}>Delete</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Workspace({
  engine,
  selectedPad,
  setSelectedPad,
  settings,
  setSettings,
  onOpenSampler,
}: {
  engine: DeviceEngine;
  selectedPad: string;
  setSelectedPad: (pad: string) => void;
  settings: SampleSettings;
  setSettings: (settings: SampleSettings) => void;
  onOpenSampler: () => void;
}) {
  const kitImportInput = useRef<HTMLInputElement | null>(null);
  const sampleInput = useRef<HTMLInputElement | null>(null);
  const [archiveNote, setArchiveNote] = useState("");
  const selected = engine.pads.find((pad) => pad.number === selectedPad);

  const uploadFiles = useCallback(
    async (files: File[], targetPads?: Pad[]) => {
      if (!files.length) return;
      await engine.uploadToPads(files, targetPads || engine.pads);
    },
    [engine],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SectionTitle icon={LayoutDashboard} title="Project Kit" description="Select a target, choose a pad, then sample, upload, edit, import, or export." />
            <div className="flex flex-wrap gap-2">
              <input
                ref={kitImportInput}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) engine.importKit(file);
                }}
              />
              <Button variant="outline" onClick={() => kitImportInput.current?.click()} disabled={!engine.connected}>
                <Archive className="h-4 w-4" /> Import
              </Button>
              <Button
                variant="outline"
                onClick={() => setArchiveNote(`${engine.target}: ${engine.pads.filter((pad) => pad.assignedPath).length} assigned pad${engine.pads.filter((pad) => pad.assignedPath).length === 1 ? "" : "s"}`)}
              >
                <Search className="h-4 w-4" /> Inspect
              </Button>
              <Button onClick={engine.exportKit} disabled={!engine.connected}>
                <Download className="h-4 w-4" /> Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PadGrid
            pads={engine.pads}
            selectedPad={selectedPad}
            onSelectPad={setSelectedPad}
            onDropPad={(pad, files) => uploadFiles(files, [pad])}
          />
          {archiveNote && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              {archiveNote}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Active Target</CardTitle>
            <CardDescription>Uploads and imports land here.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Project</div>
              <div className="grid grid-cols-3 gap-2">
                {projects.map((project) => (
                  <Button key={project} variant={project === engine.activeProject ? "default" : "outline"} disabled={!engine.connected} onClick={() => engine.setProject(project)}>
                    {project}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Group</div>
              <div className="grid grid-cols-4 gap-2">
                {groups.map((group) => (
                  <Button key={group} variant={group === engine.activeGroup ? "default" : "outline"} disabled={!engine.connected} onClick={() => engine.setGroup(group)}>
                    {group}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pad {selected?.number || "--"}</CardTitle>
            <CardDescription>{selected?.name || "empty"} {selected?.assignedPath ? `- ${selected.type}` : ""}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <input
              ref={sampleInput}
              type="file"
              accept="audio/*"
              className="hidden"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.currentTarget.value = "";
                if (selected && files.length) uploadFiles(files, [selected]);
              }}
            />
            <Button onClick={onOpenSampler} className="justify-start"><Mic2 className="h-4 w-4" /> Sample or chop</Button>
            <Button variant="outline" onClick={() => sampleInput.current?.click()} className="justify-start"><Upload className="h-4 w-4" /> Upload sample</Button>
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="outline" onClick={() => engine.playPad(selected)} disabled={!selected?.assignedPath}>Play</Button>
              <Button size="sm" variant="outline" onClick={() => engine.downloadPad(selected)} disabled={!selected?.assignedPath}>WAV</Button>
              <Button size="sm" variant="outline" onClick={() => engine.clearPad(selected)} disabled={!selected?.assignedPath}>Clear</Button>
            </div>
            <div
              className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (selected) uploadFiles(Array.from(event.dataTransfer.files || []), [selected]);
              }}
            >
              Drop audio here for this pad.
            </div>
          </CardContent>
        </Card>

        <SampleSettingsPanel settings={settings} setSettings={setSettings} />
      </div>
    </div>
  );
}

function LibraryView({ engine }: { engine: DeviceEngine }) {
  return <SampleManager engine={engine} />;
}

export function App() {
  const { dark, setDark } = useTheme();
  const engine = useDeviceEngine();
  const [view, setView] = useState<"project" | "library">("project");
  const [selectedPad, setSelectedPad] = useState("01");
  const [settings, setSettings] = useState<SampleSettings>(() => loadInitialSampleSettings());
  const [samplerOpen, setSamplerOpen] = useState(false);
  const selected = engine.pads.find((pad) => pad.number === selectedPad);

  useEffect(() => {
    syncOfflineDspSettings(settings);
  }, [settings]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DeviceEngineHost />
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-sidebar lg:block">
        <div className="flex h-16 items-center gap-2 border-b px-5">
          <div className="rounded-md bg-primary p-2 text-primary-foreground">
            <Music2 className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">EP-133</div>
            <div className="text-xs text-muted-foreground">Sampler workspace</div>
          </div>
        </div>
        <nav className="grid gap-1 p-3">
          <button
            onClick={() => setView("project")}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground", view === "project" && "bg-muted text-foreground")}
          >
            <LayoutDashboard className="h-4 w-4" />
            Project
          </button>
          <button
            onClick={() => setView("library")}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground", view === "library" && "bg-muted text-foreground")}
          >
            <Archive className="h-4 w-4" />
            Library
          </button>
        </nav>
      </aside>
      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-4 border-b bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{view === "project" ? "Project View" : "Library View"}</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              {view === "project"
                ? "Select a project, group, and pad. Then sample, process, upload, import, or export."
                : "Manage device memory, browse sample banks, search, preview, export, and clear sounds."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setDark(!dark)}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {dark ? "Light" : "Dark"}
            </Button>
            <Button variant="outline" onClick={engine.connected ? engine.refresh : engine.connect}>
              <Usb className="h-4 w-4" /> {engine.connected ? "Refresh" : "Connect"}
            </Button>
          </div>
        </header>
        <div className="grid gap-6 p-6">
          <div className="grid grid-cols-2 gap-2 lg:hidden">
            <Button variant={view === "project" ? "default" : "outline"} onClick={() => setView("project")}>
              <LayoutDashboard className="h-4 w-4" /> Project
            </Button>
            <Button variant={view === "library" ? "default" : "outline"} onClick={() => setView("library")}>
              <Archive className="h-4 w-4" /> Library
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Device" value={engine.ready ? engine.deviceName : "Engine loading"} icon={Usb} />
            <Stat label="Target" value={engine.target} icon={LayoutDashboard} />
            <Stat label="Memory" value={engine.memory} icon={Gauge} />
            <Stat label="Samples" value={`${engine.sounds.length}`} icon={AudioLines} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/35 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Status</span>
            <span className="font-medium">{engine.status}</span>
          </div>
          {view === "project" ? (
            <Workspace
              engine={engine}
              selectedPad={selectedPad}
              setSelectedPad={setSelectedPad}
              settings={settings}
              setSettings={setSettings}
              onOpenSampler={() => setSamplerOpen(true)}
            />
          ) : (
            <LibraryView engine={engine} />
          )}
        </div>
      </main>
      <SampleModal
        open={samplerOpen}
        pad={selected}
        onClose={() => setSamplerOpen(false)}
        onUpload={(files, startPad) => {
          void engine.uploadToPads(files, engine.pads.slice(startPad - 1, startPad - 1 + files.length));
          setSamplerOpen(false);
        }}
      />
    </div>
  );
}
