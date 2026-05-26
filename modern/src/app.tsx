import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

type SampleSettings = {
  normalize: boolean;
  trim: boolean;
  mono: boolean;
  reverse: boolean;
  pingPong: boolean;
  lowCut: boolean;
  highCut: boolean;
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
    lowCutHz: settings.lowCut ? 35 : "",
    highCutHz: settings.highCut ? 16000 : "",
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

function snapshotEngine(bridge?: EngineBridge): EngineState {
  const device = bridge?.device?.deviceService?.device;
  const activeProject = activeName(bridge?.device?.activeProject);
  const activeGroup = activeName(bridge?.device?.activeGroup);
  const used = device?.metadata?.used_storage_bytes;
  const free = device?.metadata?.free_storage_bytes;
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

  return {
    ...state,
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
          <div className="grid grid-cols-2 gap-2">
            <Button variant={settings.lowCut ? "default" : "outline"} onClick={() => update("lowCut", !settings.lowCut)}>Low cut</Button>
            <Button variant={settings.highCut ? "default" : "outline"} onClick={() => update("highCut", !settings.highCut)}>High cut</Button>
          </div>
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
  onUpload: (files: File[]) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
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
              <Button><Mic2 className="h-4 w-4" /> Record</Button>
              <Button variant="outline" onClick={() => fileInput.current?.click()}><FolderInput className="h-4 w-4" /> Load file</Button>
              <Button variant="outline"><Scissors className="h-4 w-4" /> Detect chops</Button>
              <Button><Upload className="h-4 w-4" /> Assign to pad {Number(pad?.number || 1)}</Button>
              <input
                ref={fileInput}
                type="file"
                accept="audio/*"
                className="hidden"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  event.currentTarget.value = "";
                  if (files.length) onUpload(files);
                }}
              />
            </div>
            <div className="relative h-72 overflow-hidden rounded-lg border bg-zinc-950">
              <div className="absolute inset-x-6 top-1/2 h-px bg-emerald-400/30" />
              <div className="absolute inset-6 flex items-center gap-1">
                {Array.from({ length: 120 }).map((_, index) => (
                  <div
                    key={index}
                    className="w-1 rounded-full bg-emerald-400"
                    style={{ height: `${18 + Math.abs(Math.sin(index * 0.37)) * 120}px`, opacity: index % 9 === 0 ? 1 : 0.65 }}
                  />
                ))}
              </div>
              {[18, 39, 62, 81].map((left, index) => (
                <div key={left} className="absolute top-4 h-64 w-px bg-primary" style={{ left: `${left}%` }}>
                  <span className="absolute -left-2 -top-3 rounded bg-primary px-1 text-[10px] text-primary-foreground">{index + 1}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid content-start gap-3">
            <Button variant="outline" className="justify-start"><Scissors className="h-4 w-4" /> 4 equal chops</Button>
            <Button variant="outline" className="justify-start"><Scissors className="h-4 w-4" /> 8 equal chops</Button>
            <Button variant="outline" className="justify-start"><Scissors className="h-4 w-4" /> 12 equal chops</Button>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              Chops are staged for the selected project/group target. The upload action assigns the rendered files starting at pad {Number(pad?.number || 1)}.
            </div>
          </div>
        </div>
      </div>
    </div>
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

export function App() {
  const { dark, setDark } = useTheme();
  const engine = useDeviceEngine();
  const [selectedPad, setSelectedPad] = useState("01");
  const [settings, setSettings] = useState<SampleSettings>(defaultSettings);
  const [samplerOpen, setSamplerOpen] = useState(false);
  const usedPads = useMemo(() => engine.pads.filter((pad) => pad.name).length, [engine.pads]);
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
            <div className="font-semibold">EP Tools</div>
            <div className="text-xs text-muted-foreground">Project kit workspace</div>
          </div>
        </div>
        <nav className="grid gap-1 p-3">
          <button className="flex items-center gap-3 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
            <LayoutDashboard className="h-4 w-4" />
            Workspace
          </button>
        </nav>
      </aside>
      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-6 backdrop-blur">
          <div>
            <h1 className="text-lg font-semibold">EP-133 Sample Workspace</h1>
            <p className="text-sm text-muted-foreground">Select a project, group, and pad. Then sample, process, upload, import, or export.</p>
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
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Device" value={engine.ready ? engine.deviceName : "Engine loading"} icon={Usb} />
            <Stat label="Target" value={engine.target} icon={LayoutDashboard} />
            <Stat label="Memory" value={engine.memory} icon={Gauge} />
            <Stat label="Pads used" value={`${usedPads}/12`} icon={AudioLines} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/35 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Status</span>
            <span className="font-medium">{engine.status}</span>
          </div>
          <Workspace
            engine={engine}
            selectedPad={selectedPad}
            setSelectedPad={setSelectedPad}
            settings={settings}
            setSettings={setSettings}
            onOpenSampler={() => setSamplerOpen(true)}
          />
        </div>
      </main>
      <SampleModal
        open={samplerOpen}
        pad={selected}
        onClose={() => setSamplerOpen(false)}
        onUpload={(files) => {
          if (selected) void engine.uploadToPads(files, [selected]);
          setSamplerOpen(false);
        }}
      />
    </div>
  );
}
