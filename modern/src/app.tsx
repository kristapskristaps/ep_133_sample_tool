import {
  Archive,
  AudioLines,
  Cable,
  CircleDot,
  Download,
  FolderInput,
  Gauge,
  LayoutDashboard,
  Mic2,
  Music2,
  Play,
  RotateCcw,
  Save,
  Scissors,
  SlidersHorizontal,
  Upload,
  Usb,
  Wand2,
  AudioWaveform,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const pads = [
  ["01", "ARK KICK", "Kick"],
  ["02", "BAM KICK", "Kick"],
  ["03", "empty", "Unassigned"],
  ["04", "CLOSE HAT", "Cymbal"],
  ["05", "RIM CLICK", "Perc"],
  ["06", "empty", "Unassigned"],
  ["07", "VOX CHOP", "Slice"],
  ["08", "BASS HIT", "Bass"],
  ["09", "empty", "Unassigned"],
  ["10", "553_VOX", "Slice"],
  ["11", "HYPER CHAMPION", "Loop"],
  ["12", "empty", "Unassigned"],
];

const projects = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
const groups = ["A", "B", "C", "D"];

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
    <div className="flex items-center gap-3">
      <div className="rounded-md bg-primary text-primary-foreground p-2">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function PadGrid() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {pads.map(([number, name, tag]) => {
        const empty = name === "empty";
        return (
          <button
            key={number}
            className={cn(
              "group min-h-28 rounded-lg border p-3 text-left transition hover:border-primary hover:bg-primary/5",
              empty ? "border-dashed bg-muted/30 text-muted-foreground" : "bg-card",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary">PAD {number}</span>
              <CircleDot className={cn("h-3.5 w-3.5", empty ? "text-muted-foreground" : "text-emerald-500")} />
            </div>
            <div className="mt-4 text-sm font-medium">{name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{tag}</div>
          </button>
        );
      })}
    </div>
  );
}

function DspPanel() {
  const rows = [
    ["Normalize", "Peak target -0.3 dBFS"],
    ["Trim silence", "Threshold -55 dBFS"],
    ["Mono mix", "Collapse stereo files"],
    ["Reverse copy", "Create pad-ready variants"],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <Card>
        <CardHeader>
          <SectionTitle icon={SlidersHorizontal} title="Offline DSP" description="Batch process files before they touch the device." />
        </CardHeader>
        <CardContent className="grid gap-3">
          {rows.map(([label, detail]) => (
            <div key={label} className="flex items-center justify-between rounded-md border bg-background p-3">
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{detail}</div>
              </div>
              <Switch defaultChecked={label !== "Reverse copy"} />
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
        </CardContent>
      </Card>
    </div>
  );
}

function SamplePanel() {
  return (
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
        <div className="relative h-52 overflow-hidden rounded-lg border bg-zinc-950">
          <div className="absolute inset-x-6 top-1/2 h-px bg-emerald-400/30" />
          <div className="absolute inset-6 flex items-center gap-1">
            {Array.from({ length: 96 }).map((_, index) => (
              <div
                key={index}
                className="w-1 rounded-full bg-emerald-400"
                style={{ height: `${18 + Math.abs(Math.sin(index * 0.37)) * 90}px`, opacity: index % 9 === 0 ? 1 : 0.65 }}
              />
            ))}
          </div>
          {[18, 39, 62, 81].map((left) => (
            <div key={left} className="absolute top-4 h-44 w-px bg-primary" style={{ left: `${left}%` }} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function KitPanel() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <SectionTitle icon={LayoutDashboard} title="Kit Builder" description="Inspect assignments, drop kits, import, and archive." />
            <div className="flex gap-2">
              <Button variant="outline"><Archive className="h-4 w-4" /> Import</Button>
              <Button><Download className="h-4 w-4" /> Export</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PadGrid />
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
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Drop a folder of 12 sounds to auto-map a kit.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function App() {
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
          {[
            [LayoutDashboard, "Workspace"],
            [SlidersHorizontal, "DSP"],
            [AudioWaveform, "Sampler"],
            [Archive, "Archive"],
          ].map(([Icon, label]) => (
            <button key={String(label)} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <Icon className="h-4 w-4" />
              {String(label)}
            </button>
          ))}
        </nav>
      </aside>
      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-6 backdrop-blur">
          <div>
            <h1 className="text-lg font-semibold">EP-133 Sample Workspace</h1>
            <p className="text-sm text-muted-foreground">Fast kit building, capture, chops, and transfer prep.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline"><Cable className="h-4 w-4" /> Legacy tool</Button>
            <Button><Usb className="h-4 w-4" /> Connect</Button>
          </div>
        </header>
        <div className="grid gap-6 p-6">
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Device" value="EP series" icon={Usb} />
            <Stat label="Project" value="03 / D" icon={LayoutDashboard} />
            <Stat label="Memory" value="89.34 MB" icon={Gauge} />
            <Stat label="Samples" value="623" icon={AudioLines} />
          </div>
          <Tabs defaultValue="kit">
            <TabsList>
              <TabsTrigger value="kit">Kit</TabsTrigger>
              <TabsTrigger value="sample">Sample</TabsTrigger>
              <TabsTrigger value="dsp">DSP</TabsTrigger>
              <TabsTrigger value="device">Device</TabsTrigger>
            </TabsList>
            <TabsContent value="kit"><KitPanel /></TabsContent>
            <TabsContent value="sample"><SamplePanel /></TabsContent>
            <TabsContent value="dsp"><DspPanel /></TabsContent>
            <TabsContent value="device">
              <Card>
                <CardHeader>
                  <SectionTitle icon={Play} title="Legacy Device Surface" description="The original TE device view stays available while functionality is migrated." />
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border bg-muted/40 p-6 text-sm text-muted-foreground">
                    The current production device/MIDI implementation lives in the bundled TE app. This modern shell is the migration target for the workflows we have been adding.
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
