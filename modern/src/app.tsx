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
import { cn } from "@/lib/utils";

type Pad = {
  number: string;
  name: string;
  type: string;
  size?: string;
  assignedPath?: string;
  raw?: unknown;
};

type Sound = {
  id: number;
  name: string;
  path?: string;
  size?: string;
  usageProjects?: string[];
  meta?: {
    name?: string;
    channels?: number;
    samplerate?: number;
    format?: string;
  };
  raw?: unknown;
};

type EngineBridge = {
  device?: {
    deviceService?: {
      device?: {
        name?: string;
        serial?: string;
        metadata?: {
          os_version?: string;
          used_storage_bytes?: number;
          free_storage_bytes?: number;
        };
      };
      playback?: (path: string, preview?: boolean) => Promise<void>;
      deleteSound?: (path: string) => Promise<void>;
      downloadSoundAsWav?: (path: string) => Promise<Blob>;
      getProjectPadMeta?: (project: string) => AsyncIterable<{ sym?: number } | null | undefined>;
    };
    activeProject?: { node?: { name?: string } };
    activeGroup?: { node?: { name?: string } };
    activePads?: Array<{
      node?: { name?: string };
      path?: string;
      assignedPath?: string;
      meta?: { sym?: number; name?: string };
    }>;
    currentPad?: unknown;
    isScanning?: boolean;
    deviceError?: string;
    deviceCount?: number;
    engineLocked?: boolean;
    requestMidi?: () => void;
    refresh?: () => Promise<void>;
    setProject?: (project: string) => Promise<void>;
    setGroup?: (group: string) => Promise<void>;
  };
  uploader?: {
    isUploading?: boolean;
    fileCollection?: Array<{ status?: string }>;
    sounds?: Array<{
      id?: number;
      path?: string;
      file?: { size?: number };
      meta?: Sound["meta"];
    }>;
    enqueueFiles?: (startId: number, files: File[]) => Error | undefined;
    findNextFreeSoundSlot?: (startId?: number) => number;
  };
  sortedPads?: () => Pad["raw"][];
  classifyFiles?: (files: File[]) => File[];
  uploadFilesToPads?: (files: File[], pads: Pad["raw"][]) => Promise<void>;
  getPadByNumber?: (number: string | number) => Pad["raw"] | null;
  playPad?: (pad: Pad["raw"]) => Promise<void>;
  clearPad?: (pad: Pad["raw"]) => Promise<void>;
  downloadPad?: (pad: Pad["raw"]) => Promise<void>;
  exportKitArchive?: () => Promise<void>;
  importKitArchive?: (file: File) => Promise<void>;
};

type EngineState = {
  ready: boolean;
  connected: boolean;
  deviceName: string;
  target: string;
  memory: string;
  pads: Pad[];
  activeProject: string;
  activeGroup: string;
  uploading: boolean;
  status: string;
  sounds: Sound[];
  memoryUsedPercent: number;
};

type SampleSettings = {
  normalize: boolean;
  trim: boolean;
  mono: boolean;
  reverse: boolean;
  pingPong: boolean;
  lowCut: boolean;
  highCut: boolean;
  lowCutHz: string;
  highCutHz: string;
  targetDb: string;
  sourceBpm: string;
  targetBpm: string;
};

const fallbackPads: Pad[] = Array.from({ length: 12 }, (_, index) => ({
  number: String(index + 1).padStart(2, "0"),
  name: "",
  type: "Unassigned",
}));

const projects = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
const groups = ["A", "B", "C", "D"];

const defaultSettings: SampleSettings = {
  normalize: true,
  trim: true,
  mono: false,
  reverse: false,
  pingPong: false,
  lowCut: false,
  highCut: false,
  lowCutHz: "35",
  highCutHz: "16000",
  targetDb: "-0.3",
  sourceBpm: "",
  targetBpm: "",
};

function syncOfflineDspSettings(settings: SampleSettings) {
  const payload = {
    enabled: true,
    normalize: settings.normalize,
    reverseCopy: settings.reverse,
    pingPongCopy: settings.pingPong,
    normalizeTargetDb: Number(settings.targetDb) || -0.3,
    trimSilence: settings.trim,
    mono: settings.mono,
    lowCutHz: settings.lowCut ? Number(settings.lowCutHz) || 35 : "",
    highCutHz: settings.highCut ? Number(settings.highCutHz) || 16000 : "",
    sourceBpm: settings.sourceBpm,
    targetBpm: settings.targetBpm,
  };
  const current = window.ep133OfflineDsp?.settings || {};
  const next = { ...current, ...payload };
  if (window.ep133OfflineDsp) window.ep133OfflineDsp.settings = next;
  localStorage.setItem("ep133.offlineDsp", JSON.stringify(next));
}

function engineAsset(path: string) {
  return import.meta.env.DEV ? `/legacy/${path}` : `../../data/${path}`;
}

function formatBytes(value?: number) {
  if (!Number.isFinite(value)) return "waiting";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function activeName(item?: { node?: { name?: string } }) {
  return item?.node?.name || "";
}

function padNumber(name?: string) {
  const index = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].indexOf(name || "");
  return index === -1 ? name || "--" : String(index + 1).padStart(2, "0");
}

function shortPath(path?: string) {
  return path ? path.split("/").pop() || path : "";
}

function mapPads(bridge?: EngineBridge): Pad[] {
  const pads = bridge?.device?.activePads || [];
  if (!pads.length) return fallbackPads;
  return [...pads]
    .sort((a, b) => Number(padNumber(a.node?.name)) - Number(padNumber(b.node?.name)))
    .map((pad) => {
      const assigned = pad.assignedPath || "";
      const soundId = pad.meta?.sym ? `Sound ${pad.meta.sym}` : "Unassigned";
      return {
        number: padNumber(pad.node?.name),
        name: pad.meta?.name || shortPath(assigned),
        type: assigned ? soundId : "Unassigned",
        assignedPath: assigned,
        size: assigned ? shortPath(assigned) : "drop sample",
        raw: pad,
      };
    });
}

function mapSounds(bridge?: EngineBridge): Sound[] {
  return (bridge?.uploader?.sounds || [])
    .filter((sound) => sound?.id && sound.path)
    .map((sound) => ({
      id: Number(sound.id),
      name: sound.meta?.name || shortPath(sound.path) || `Sound ${sound.id}`,
      path: sound.path,
      meta: sound.meta,
      size: formatBytes(sound.file?.size),
      raw: sound,
    }));
}

function snapshotEngine(bridge?: EngineBridge): EngineState {
  const device = bridge?.device?.deviceService?.device;
  const activeProject = activeName(bridge?.device?.activeProject);
  const activeGroup = activeName(bridge?.device?.activeGroup);
  const used = device?.metadata?.used_storage_bytes;
  const free = device?.metadata?.free_storage_bytes;
  const capacity = Number(used || 0) + Number(free || 0);
  return {
    ready: Boolean(bridge),
    connected: Boolean(bridge?.device?.deviceService),
    deviceName: device?.name || "No device",
    target: activeProject && activeGroup ? `P${activeProject} / ${activeGroup}` : "Select device",
    memory: Number.isFinite(used) && Number.isFinite(free) ? `${formatBytes(used)} used` : "waiting",
    pads: mapPads(bridge),
    activeProject,
    activeGroup,
    uploading: Boolean(bridge?.uploader?.isUploading),
    sounds: mapSounds(bridge),
    memoryUsedPercent: capacity > 0 ? Math.round((Number(used || 0) / capacity) * 100) : 0,
    status: !bridge
      ? "Engine loading"
      : bridge.device?.deviceService
        ? "Connected"
        : bridge.device?.engineLocked
          ? "Device engine is locked by another tab"
          : bridge.device?.deviceError
            ? bridge.device.deviceError
            : bridge.device?.isScanning
              ? "Scanning for EP device"
              : "No device found",
  };
}

function midiPortSummary(access: MIDIAccess) {
  const inputs = Array.from(access.inputs.values());
  const outputs = Array.from(access.outputs.values());
  const names = [...inputs, ...outputs].map((port) => port.name).filter(Boolean);
  const epNames = names.filter((name) => /EP|KO|K\.O|teenage|engineering/i.test(name || ""));
  const count = `${inputs.length} input${inputs.length === 1 ? "" : "s"}, ${outputs.length} output${outputs.length === 1 ? "" : "s"}`;
  if (epNames.length) return `Scanning ${count}: ${epNames.slice(0, 2).join(", ")}`;
  if (names.length) return `Scanning ${count}; no EP port matched`;
  return "No MIDI ports visible";
}

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem("ep-modern-theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("ep-modern-theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, setDark };
}

function useDeviceEngine() {
  const [state, setState] = useState<EngineState>(() => snapshotEngine());
  const [midiStatus, setMidiStatus] = useState("");
  const [usageMap, setUsageMap] = useState<Record<number, string[]>>({});
  const autoConnectAttempted = useRef(false);

  const getBridge = useCallback(() => window.ep133KitBridge as EngineBridge | undefined, []);

  useEffect(() => {
    const timer = window.setInterval(() => setState(snapshotEngine(getBridge())), 500);
    return () => window.clearInterval(timer);
  }, [getBridge]);

  const run = useCallback(
    async (operation: (bridge: EngineBridge) => Promise<void> | void) => {
      const bridge = getBridge();
      if (!bridge) {
        setState(snapshotEngine());
        return;
      }
      try {
        await operation(bridge);
      } catch (error) {
        console.error(error);
      } finally {
        setState(snapshotEngine(bridge));
      }
    },
    [getBridge],
  );

  const requestMidi = useCallback(
    () =>
      run(async (bridge) => {
        if (!navigator.requestMIDIAccess) {
          setMidiStatus("Web MIDI is not available in this runtime");
          return;
        }
        try {
          const access = await navigator.requestMIDIAccess({ sysex: true });
          setMidiStatus(midiPortSummary(access));
          bridge.device?.requestMidi?.();
          window.setTimeout(() => bridge.device?.requestMidi?.(), 1200);
          window.setTimeout(() => setState(snapshotEngine(bridge)), 2200);
        } catch {
          setMidiStatus("Click Connect to allow MIDI/Sysex");
        }
      }),
    [run],
  );

  useEffect(() => {
    if (autoConnectAttempted.current || !state.ready || state.connected) return;
    autoConnectAttempted.current = true;
    void requestMidi();
  }, [requestMidi, state.connected, state.ready]);

  useEffect(() => {
    if (!state.connected || !state.sounds.length) {
      setUsageMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const service = getBridge()?.device?.deviceService;
      if (!service?.getProjectPadMeta) return;
      const next: Record<number, Set<string>> = {};
      for (const project of projects) {
        try {
          for await (const meta of service.getProjectPadMeta(project)) {
            const soundId = meta?.sym;
            if (!soundId || soundId <= 0) continue;
            if (!next[soundId]) next[soundId] = new Set();
            next[soundId].add(project);
          }
        } catch (error) {
          console.error(error);
        }
      }
      if (!cancelled) {
        setUsageMap(Object.fromEntries(Object.entries(next).map(([id, used]) => [id, [...used].sort()])));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getBridge, state.connected, state.sounds.length]);

  return {
    ...state,
    sounds: state.sounds.map((sound) => ({ ...sound, usageProjects: usageMap[sound.id] || [] })),
    status: state.connected ? state.status : midiStatus || state.status,
    connect: requestMidi,
    refresh: () => run((bridge) => bridge.device?.refresh?.()),
    setProject: (project: string) => run((bridge) => bridge.device?.setProject?.(project)),
    setGroup: (group: string) => run((bridge) => bridge.device?.setGroup?.(group)),
    uploadToPads: (files: File[], pads: Pad[]) =>
      run((bridge) => {
        const rawPads = pads.map((pad) => pad.raw || bridge.getPadByNumber?.(pad.number)).filter(Boolean);
        return bridge.uploadFilesToPads?.(bridge.classifyFiles?.(files) || files, rawPads);
      }),
    uploadSamples: (files: File[]) =>
      run((bridge) => {
        const startId = bridge.uploader?.findNextFreeSoundSlot?.(1);
        if (!startId || startId === -1) return;
        const error = bridge.uploader?.enqueueFiles?.(startId, bridge.classifyFiles?.(files) || files);
        if (error) throw error;
      }),
    playSound: (sound?: Sound) => run((bridge) => {
      if (sound?.path) return bridge.device?.deviceService?.playback?.(sound.path, true);
    }),
    deleteSound: (sound?: Sound) => run(async (bridge) => {
      if (!sound?.path) return;
      await bridge.device?.deviceService?.deleteSound?.(sound.path);
      await bridge.device?.refresh?.();
    }),
    downloadSound: (sound?: Sound) => run(async (bridge) => {
      if (!sound?.path) return;
      const blob = await bridge.device?.deviceService?.downloadSoundAsWav?.(sound.path);
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${String(sound.id).padStart(3, "0")} ${sound.name || "sample"}.wav`;
      document.body.append(link);
      link.click();
      URL.revokeObjectURL(link.href);
      link.remove();
    }),
    playPad: (pad?: Pad) => run((bridge) => {
      if (pad?.raw) return bridge.playPad?.(pad.raw);
    }),
    clearPad: (pad?: Pad) => run((bridge) => {
      if (pad?.raw) return bridge.clearPad?.(pad.raw);
    }),
    downloadPad: (pad?: Pad) => run((bridge) => {
      if (pad?.raw) return bridge.downloadPad?.(pad.raw);
    }),
    exportKit: () => run((bridge) => bridge.exportKitArchive?.()),
    importKit: (file: File) => run((bridge) => bridge.importKitArchive?.(file)),
  };
}

function DeviceEngineHost() {
  useEffect(() => {
    if (window.__EP133_ENGINE_LOADED) return;
    window.__EP133_ENGINE_LOADED = true;
    window.__EP133_ENGINE_ONLY = true;
    window.__EP133_ENGINE_ROOT_ID = "ep133-engine-root";

    const root = document.createElement("div");
    root.id = "ep133-engine-root";
    root.setAttribute("aria-hidden", "true");
    root.className = "pointer-events-none fixed -bottom-[900px] -right-[1300px] h-[800px] w-[1200px] overflow-hidden opacity-0";
    document.body.append(root);

    const loadScript = (src: string, type?: "module") =>
      new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = engineAsset(src);
        if (type) script.type = type;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`failed to load ${src}`));
        document.body.append(script);
      });

    void (async () => {
      await loadScript("custom.js");
      await loadScript("feature-sidebar.js");
      await loadScript("dsp.js");
      await loadScript("kit-inspector.js");
      await loadScript("sampler.js");
      await loadScript("index.js", "module");
    })().catch((error) => console.error(error));
  }, []);

  return null;
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
        <SettingRow label="Normalize" detail={`Peak target ${settings.targetDb} dBFS`} checked={settings.normalize} onCheckedChange={(checked) => update("normalize", checked)} />
        <SettingRow label="Trim silence" detail="Remove quiet heads and tails" checked={settings.trim} onCheckedChange={(checked) => update("trim", checked)} />
        <SettingRow label="Mono mix" detail="Collapse stereo files for tight kits" checked={settings.mono} onCheckedChange={(checked) => update("mono", checked)} />
        <SettingRow label="Reverse copy" detail="Create a reversed variant next to source" checked={settings.reverse} onCheckedChange={(checked) => update("reverse", checked)} />
        <SettingRow label="Ping-pong copy" detail="Render forward and reverse playback" checked={settings.pingPong} onCheckedChange={(checked) => update("pingPong", checked)} />
        <SettingRow label="Low cut" detail={`${settings.lowCutHz || 35} Hz high-pass`} checked={settings.lowCut} onCheckedChange={(checked) => update("lowCut", checked)} />
        <SettingRow label="High cut" detail={`${settings.highCutHz || 16000} Hz low-pass`} checked={settings.highCut} onCheckedChange={(checked) => update("highCut", checked)} />
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Target dBFS
            <input className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.targetDb} onChange={(event) => update("targetDb", event.target.value)} />
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
  engine: ReturnType<typeof useDeviceEngine>;
}) {
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const sounds = engine.sounds.filter((sound) => {
    const text = `${sound.id} ${sound.name} ${sound.path || ""} ${(sound.usageProjects || []).join(" ")}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const selected = sounds.find((sound) => sound.id === selectedId) || sounds[0];
  const groupedSounds = sounds.reduce<Record<string, Sound[]>>((groupsByHundred, sound) => {
    const start = Math.floor((Math.max(1, sound.id) - 1) / 100) * 100;
    const range = `${start}-${start + 99}`;
    if (!groupsByHundred[range]) groupsByHundred[range] = [];
    groupsByHundred[range].push(sound);
    return groupsByHundred;
  }, {});
  const soundGroups = Object.entries(groupedSounds).sort(([a], [b]) => Number(a.split("-")[0]) - Number(b.split("-")[0]));

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
        <div className="grid gap-4 overflow-auto pr-1 xl:max-h-[calc(100vh-430px)]">
          {soundGroups.length ? soundGroups.map(([range, items]) => (
            <section key={range} className="grid gap-2">
              <div className="sticky top-0 z-10 flex items-center justify-between rounded-md border bg-card/95 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                <span>Samples {range}</span>
                <span>{items.length} shown</span>
              </div>
              <div className="grid gap-2">
                {items.map((sound) => {
                  const usage = sound.usageProjects || [];
                  return (
                    <button
                      key={sound.id}
                      onClick={() => setSelectedId(sound.id)}
                      className={cn(
                        "grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border bg-background p-3 text-left text-sm transition hover:border-primary hover:bg-primary/5",
                        selected?.id === sound.id && "border-primary bg-primary/10",
                      )}
                    >
                      <span className="rounded-md bg-muted px-2 py-1 text-center font-mono text-xs text-muted-foreground">{String(sound.id).padStart(3, "0")}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{sound.name}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {usage.length ? usage.map((project) => (
                            <span key={project} className="rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                              Project {Number(project)}
                            </span>
                          )) : (
                            <span className="rounded-sm border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">unused</span>
                          )}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">{sound.size}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {engine.connected ? "No samples match the current search." : "Connect a device to load samples."}
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
  engine: ReturnType<typeof useDeviceEngine>;
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

function LibraryView({ engine }: { engine: ReturnType<typeof useDeviceEngine> }) {
  return <SampleManager engine={engine} />;
}

export function App() {
  const { dark, setDark } = useTheme();
  const engine = useDeviceEngine();
  const [view, setView] = useState<"project" | "library">("project");
  const [selectedPad, setSelectedPad] = useState("01");
  const [settings, setSettings] = useState<SampleSettings>(defaultSettings);
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
