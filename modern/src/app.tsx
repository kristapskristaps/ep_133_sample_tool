import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Save,
  Scissors,
  Search,
  SlidersHorizontal,
  Sun,
  Upload,
  Usb,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const fallbackPads: Pad[] = Array.from({ length: 12 }, (_, index) => ({
  number: String(index + 1).padStart(2, "0"),
  name: "",
  type: "Unassigned",
}));

const projects = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
const groups = ["A", "B", "C", "D"];
const nav = [
  [LayoutDashboard, "Workspace", "kit"],
  [AudioWaveform, "Sampler", "sample"],
  [SlidersHorizontal, "DSP", "dsp"],
  [Archive, "Archive", "archive"],
] as const;

function engineUrl() {
  return import.meta.env.DEV ? "/legacy/engine.html?ep-modern-engine=1" : "../../data/engine.html?ep-modern-engine=1";
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

function useDeviceEngine(frameRef: RefObject<HTMLIFrameElement | null>) {
  const [state, setState] = useState<EngineState>(() => snapshotEngine());
  const [midiStatus, setMidiStatus] = useState("");

  const getBridge = useCallback(() => {
    try {
      return frameRef.current?.contentWindow?.ep133KitBridge as EngineBridge | undefined;
    } catch {
      return undefined;
    }
  }, [frameRef]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setState(snapshotEngine(getBridge()));
    }, 500);
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

  return {
    ...state,
    status: state.connected ? state.status : midiStatus || state.status,
    connect: () =>
      run(async (bridge) => {
        const frameWindow = frameRef.current?.contentWindow;
        if (!frameWindow?.navigator.requestMIDIAccess) {
          setMidiStatus("Web MIDI is not available in this runtime");
          return;
        }
        setMidiStatus("Requesting MIDI/Sysex access");
        try {
          const access = await frameWindow.navigator.requestMIDIAccess({ sysex: true });
          setMidiStatus(midiPortSummary(access));
          await bridge.device?.refresh?.();
        } catch {
          setMidiStatus("MIDI/Sysex permission was denied");
        }
      }),
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

function DeviceEngineHost({ frameRef }: { frameRef: RefObject<HTMLIFrameElement | null> }) {
  return (
    <iframe
      ref={frameRef}
      title="EP-133 internal device engine"
      src={engineUrl()}
      allow="midi *; midi-sysex *"
      aria-hidden="true"
      tabIndex={-1}
      className="pointer-events-none fixed -bottom-[900px] -right-[1300px] h-[800px] w-[1200px] opacity-0"
    />
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold">{value}</div>
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

function DspPanel() {
  const rows = [
    ["Normalize", "Peak target -0.3 dBFS", true],
    ["Trim silence", "Threshold -55 dBFS", true],
    ["Mono mix", "Collapse stereo files", false],
    ["Low cut", "Remove sub rumble at 35 Hz", false],
    ["High cut", "Soften above 16 kHz", false],
    ["Reverse copy", "Create pad-ready variants", false],
    ["Ping-pong copy", "Forward and reverse render", false],
  ] as const;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <SectionTitle icon={SlidersHorizontal} title="Offline DSP" description="Batch process files before they touch the device." />
        </CardHeader>
        <CardContent className="grid gap-3">
          {rows.map(([label, detail, checked]) => (
            <div key={label} className="flex items-center justify-between rounded-md border bg-background p-3">
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{detail}</div>
              </div>
              <Switch defaultChecked={checked} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Transfer Preset</CardTitle>
          <CardDescription>Designed for EP dynamic range and fast kit work.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button className="justify-start"><Wand2 className="h-4 w-4" /> Apply to next drop</Button>
          <Button variant="outline" className="justify-start"><Save className="h-4 w-4" /> Save preset</Button>
          <Button variant="outline" className="justify-start"><RotateCcw className="h-4 w-4" /> Reset</Button>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            Transfer-time DSP is preserved through the internal device engine while its processors are moved into React modules.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SamplePanel({ selectedPad, assignFiles }: { selectedPad: string; assignFiles: (files: File[]) => void }) {
  const markers = [18, 39, 62, 81];
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <SectionTitle icon={AudioWaveform} title="Sampler" description="Capture audio, mark chops, and assign slices to pads." />
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button><Mic2 className="h-4 w-4" /> Record</Button>
            <Button variant="outline"><FolderInput className="h-4 w-4" /> Load file</Button>
            <Button variant="outline"><Scissors className="h-4 w-4" /> Detect chops</Button>
            <Button variant="secondary" onClick={() => assignFiles([])}><Upload className="h-4 w-4" /> Assign to pads</Button>
          </div>
          <div className="relative h-64 overflow-hidden rounded-lg border bg-zinc-950">
            <div className="absolute inset-x-6 top-1/2 h-px bg-emerald-400/30" />
            <div className="absolute inset-6 flex items-center gap-1">
              {Array.from({ length: 108 }).map((_, index) => (
                <div
                  key={index}
                  className="w-1 rounded-full bg-emerald-400"
                  style={{ height: `${18 + Math.abs(Math.sin(index * 0.37)) * 110}px`, opacity: index % 9 === 0 ? 1 : 0.65 }}
                />
              ))}
            </div>
            {markers.map((left, index) => (
              <div key={left} className="absolute top-4 h-56 w-px bg-primary" style={{ left: `${left}%` }}>
                <span className="absolute -left-2 -top-3 rounded bg-primary px-1 text-[10px] text-primary-foreground">{index + 1}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Chop Actions</CardTitle>
          <CardDescription>Prepare slices before upload.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button variant="outline" className="justify-start"><Scissors className="h-4 w-4" /> 4 equal chops</Button>
          <Button variant="outline" className="justify-start"><Scissors className="h-4 w-4" /> 8 equal chops</Button>
          <Button variant="outline" className="justify-start"><Scissors className="h-4 w-4" /> 12 equal chops</Button>
          <Button className="justify-start"><Upload className="h-4 w-4" /> Assign from pad {Number(selectedPad)}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function KitPanel({
  engine,
  selectedPad,
  setSelectedPad,
}: {
  engine: ReturnType<typeof useDeviceEngine>;
  selectedPad: string;
  setSelectedPad: (pad: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const selected = engine.pads.find((pad) => pad.number === selectedPad);

  const uploadFiles = useCallback(
    async (files: File[], targetPads?: Pad[]) => {
      if (!files.length) return;
      await engine.uploadToPads(files, targetPads || engine.pads);
    },
    [engine],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SectionTitle icon={LayoutDashboard} title="Kit Builder" description="Inspect assignments, drop kits, import, and archive." />
            <div className="flex gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) engine.importKit(file);
                }}
              />
              <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={!engine.connected}>
                <Archive className="h-4 w-4" /> Import
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
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Active Target</CardTitle>
          <CardDescription>Choose where uploads and imports land.</CardDescription>
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
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Selected pad</div>
            <div className="mt-1 text-sm font-medium">Pad {selected?.number}: {selected?.name || "empty"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{selected?.type}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => engine.playPad(selected)} disabled={!selected?.assignedPath}>Play</Button>
              <Button size="sm" variant="outline" onClick={() => engine.downloadPad(selected)} disabled={!selected?.assignedPath}>WAV</Button>
              <Button size="sm" variant="outline" onClick={() => engine.clearPad(selected)} disabled={!selected?.assignedPath}>Clear</Button>
            </div>
          </div>
          <div
            className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              uploadFiles(Array.from(event.dataTransfer.files || []));
            }}
          >
            Drop a folder of 12 sounds to auto-map a kit.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ArchivePanel({ engine }: { engine: ReturnType<typeof useDeviceEngine> }) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <SectionTitle icon={Archive} title="Kit Archives" description="Export and restore kits as portable ZIP files." />
        </CardHeader>
        <CardContent className="grid gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) engine.importKit(file);
            }}
          />
          <Button onClick={engine.exportKit} disabled={!engine.connected}><Download className="h-4 w-4" /> Export active kit</Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={!engine.connected}><Archive className="h-4 w-4" /> Import kit archive</Button>
          <Button variant="outline"><Search className="h-4 w-4" /> Inspect manifest</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent Archives</CardTitle>
          <CardDescription>Local history view for the next iteration.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {["EP_kit_P03_D.zip", "EP_kit_P01_A.zip", "EP_kit_P08_C.zip"].map((name) => (
            <div key={name} className="flex items-center justify-between rounded-md border bg-background p-3">
              <span className="text-sm">{name}</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function App() {
  const { dark, setDark } = useTheme();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const engine = useDeviceEngine(frameRef);
  const [tab, setTab] = useState("kit");
  const [selectedPad, setSelectedPad] = useState("01");
  const usedPads = useMemo(() => engine.pads.filter((pad) => pad.name).length, [engine.pads]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DeviceEngineHost frameRef={frameRef} />
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-sidebar lg:block">
        <div className="flex h-16 items-center gap-2 border-b px-5">
          <div className="rounded-md bg-primary p-2 text-primary-foreground">
            <Music2 className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">EP Tools</div>
            <div className="text-xs text-muted-foreground">Modern sample workspace</div>
          </div>
        </div>
        <nav className="grid gap-1 p-3">
          {nav.map(([Icon, label, value]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                tab === value && "bg-muted text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-6 backdrop-blur">
          <div>
            <h1 className="text-lg font-semibold">EP-133 Sample Workspace</h1>
            <p className="text-sm text-muted-foreground">Fast kit building, capture, chops, archives, and transfer prep.</p>
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
            <Stat label="Status" value={engine.status} icon={AudioLines} />
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex w-full justify-start overflow-x-auto">
              <TabsTrigger value="kit">Kit</TabsTrigger>
              <TabsTrigger value="sample">Sample</TabsTrigger>
              <TabsTrigger value="dsp">DSP</TabsTrigger>
              <TabsTrigger value="archive">Archive</TabsTrigger>
            </TabsList>
            <TabsContent value="kit"><KitPanel engine={engine} selectedPad={selectedPad} setSelectedPad={setSelectedPad} /></TabsContent>
            <TabsContent value="sample"><SamplePanel selectedPad={selectedPad} assignFiles={(files) => engine.uploadToPads(files, engine.pads.slice(Number(selectedPad) - 1))} /></TabsContent>
            <TabsContent value="dsp"><DspPanel /></TabsContent>
            <TabsContent value="archive"><ArchivePanel engine={engine} /></TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
