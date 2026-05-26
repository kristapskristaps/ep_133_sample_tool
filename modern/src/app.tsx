import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  AudioLines,
  AudioWaveform,
  Cable,
  CheckCircle2,
  CircleDot,
  Download,
  FolderInput,
  Gauge,
  HardDrive,
  LayoutDashboard,
  Mic2,
  Moon,
  Music2,
  Play,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Settings2,
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
};

const initialPads: Pad[] = [
  { number: "01", name: "ARK KICK", type: "Kick", size: "11.6 KB" },
  { number: "02", name: "BAM KICK", type: "Kick", size: "13.2 KB" },
  { number: "03", name: "", type: "Unassigned" },
  { number: "04", name: "CLOSE HAT", type: "Cymbal", size: "7.8 KB" },
  { number: "05", name: "RIM CLICK", type: "Perc", size: "5.2 KB" },
  { number: "06", name: "", type: "Unassigned" },
  { number: "07", name: "VOX CHOP", type: "Slice", size: "19.8 KB" },
  { number: "08", name: "BASS HIT", type: "Bass", size: "22.4 KB" },
  { number: "09", name: "", type: "Unassigned" },
  { number: "10", name: "553_VOX", type: "Slice", size: "31.4 KB" },
  { number: "11", name: "HYPER CHAMPION", type: "Loop", size: "48.2 KB" },
  { number: "12", name: "", type: "Unassigned" },
];

const projects = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
const groups = ["A", "B", "C", "D"];
const nav = [
  [LayoutDashboard, "Workspace", "kit"],
  [AudioWaveform, "Sampler", "sample"],
  [SlidersHorizontal, "DSP", "dsp"],
  [Archive, "Archive", "archive"],
  [HardDrive, "Device Engine", "device"],
] as const;

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

function PadGrid({ pads, selectedPad, onSelectPad }: { pads: Pad[]; selectedPad: string; onSelectPad: (pad: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {pads.map((pad) => {
        const empty = !pad.name;
        const selected = selectedPad === pad.number;
        return (
          <button
            key={pad.number}
            onClick={() => onSelectPad(pad.number)}
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
            <div className="mt-4 text-sm font-medium">{pad.name || "empty"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{pad.type}</div>
            <div className="mt-3 text-xs text-muted-foreground">{pad.size || "drop sample"}</div>
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
            This panel maps to the existing browser-side DSP engine. The next migration step is moving those processors into typed React hooks.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SamplePanel() {
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
            <Button variant="secondary"><Upload className="h-4 w-4" /> Assign to pads</Button>
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
          <Button className="justify-start"><Upload className="h-4 w-4" /> Assign from pad 1</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function KitPanel({ pads, selectedPad, setSelectedPad }: { pads: Pad[]; selectedPad: string; setSelectedPad: (pad: string) => void }) {
  const selected = pads.find((pad) => pad.number === selectedPad);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SectionTitle icon={LayoutDashboard} title="Kit Builder" description="Inspect assignments, drop kits, import, and archive." />
            <div className="flex gap-2">
              <Button variant="outline"><Archive className="h-4 w-4" /> Import</Button>
              <Button><Download className="h-4 w-4" /> Export</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PadGrid pads={pads} selectedPad={selectedPad} onSelectPad={setSelectedPad} />
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
                <Button key={project} variant={project === "03" ? "default" : "outline"}>{project}</Button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Group</div>
            <div className="grid grid-cols-4 gap-2">
              {groups.map((group) => (
                <Button key={group} variant={group === "D" ? "default" : "outline"}>{group}</Button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Selected pad</div>
            <div className="mt-1 text-sm font-medium">Pad {selected?.number}: {selected?.name || "empty"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{selected?.type}</div>
          </div>
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Drop a folder of 12 sounds to auto-map a kit.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ArchivePanel() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <SectionTitle icon={Archive} title="Kit Archives" description="Export and restore kits as portable ZIP files." />
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button><Download className="h-4 w-4" /> Export active kit</Button>
          <Button variant="outline"><Archive className="h-4 w-4" /> Import kit archive</Button>
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

function DevicePanel() {
  const legacyUrl = import.meta.env.DEV ? "/legacy/index.html" : "../../data/index.html";

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionTitle icon={HardDrive} title="Device Engine" description="The existing TE runtime is embedded here while MIDI/Sysex services are migrated." />
          <Button variant="outline" asChild>
            <a href={legacyUrl} target="_blank" rel="noreferrer">
              <Cable className="h-4 w-4" /> Open legacy
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <iframe
          title="Legacy EP device engine"
          src={legacyUrl}
          className="h-[720px] w-full border-0 bg-muted"
        />
      </CardContent>
    </Card>
  );
}

export function App() {
  const { dark, setDark } = useTheme();
  const [tab, setTab] = useState("kit");
  const [selectedPad, setSelectedPad] = useState("01");
  const usedPads = useMemo(() => initialPads.filter((pad) => pad.name).length, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
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
            <Button variant="outline" onClick={() => setTab("device")}><Cable className="h-4 w-4" /> Device engine</Button>
            <Button><Usb className="h-4 w-4" /> Connect</Button>
          </div>
        </header>
        <div className="grid gap-6 p-6">
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Device" value="EP series" icon={Usb} />
            <Stat label="Target" value="P03 / D" icon={LayoutDashboard} />
            <Stat label="Memory" value="89.34 MB" icon={Gauge} />
            <Stat label="Pads used" value={`${usedPads}/12`} icon={AudioLines} />
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex w-full justify-start overflow-x-auto">
              <TabsTrigger value="kit">Kit</TabsTrigger>
              <TabsTrigger value="sample">Sample</TabsTrigger>
              <TabsTrigger value="dsp">DSP</TabsTrigger>
              <TabsTrigger value="archive">Archive</TabsTrigger>
              <TabsTrigger value="device">Device</TabsTrigger>
            </TabsList>
            <TabsContent value="kit"><KitPanel pads={initialPads} selectedPad={selectedPad} setSelectedPad={setSelectedPad} /></TabsContent>
            <TabsContent value="sample"><SamplePanel /></TabsContent>
            <TabsContent value="dsp"><DspPanel /></TabsContent>
            <TabsContent value="archive"><ArchivePanel /></TabsContent>
            <TabsContent value="device"><DevicePanel /></TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
