import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  AudioWaveform,
  CheckCircle2,
  CircleDot,
  Download,
  FolderInput,
  Gauge,
  LayoutDashboard,
  Mic2,
  Moon,
  RotateCcw,
  Scissors,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
  Usb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { DeviceEngineHost, groups, projects, useDeviceEngine, type DeviceEngine, type Pad, type PadUploadSlotTarget, type Sound } from "@/device";
import { defaultSettings, loadInitialSampleSettings, lofiProfiles, syncOfflineDspSettings, type SampleSettings } from "@/dsp/settings";
import { cn } from "@/lib/utils";

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem("ep-modern-theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("ep-modern-theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, setDark };
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

const samplerSliceKeys = [
  { code: "Digit1", label: "1" },
  { code: "Digit2", label: "2" },
  { code: "Digit3", label: "3" },
  { code: "Digit4", label: "4" },
  { code: "Digit5", label: "5" },
  { code: "Digit6", label: "6" },
  { code: "Digit7", label: "7" },
  { code: "Digit8", label: "8" },
  { code: "Digit9", label: "9" },
  { code: "Digit0", label: "0" },
  { code: "Minus", label: "ß" },
  { code: "Equal", label: "´" },
] as const;

const koPadLabelsByInternalPad = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "ENTER"] as const;
const koPadSequenceOrder = ["10", "11", "12", "07", "08", "09", "04", "05", "06", "01", "02", "03"] as const;
const koPadVisualOrder = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

function normalizedPadNumber(padNumber?: string | number | null) {
  const value = Number(padNumber);
  return Number.isFinite(value) ? String(Math.max(1, Math.min(12, value))).padStart(2, "0") : "";
}

function padInternalIndex(padNumber?: string | number | null) {
  const value = Number(padNumber);
  return Number.isFinite(value) ? Math.max(0, Math.min(11, value - 1)) : 0;
}

function padSequenceIndex(padNumber?: string | number | null) {
  const normalized = normalizedPadNumber(padNumber);
  const index = koPadSequenceOrder.indexOf(normalized as (typeof koPadSequenceOrder)[number]);
  return index >= 0 ? index : 0;
}

function padDisplayLabel(padNumber?: string | number | null) {
  if (padNumber == null || padNumber === "") return "--";
  return koPadLabelsByInternalPad[padInternalIndex(padNumber)] || String(padNumber || "--");
}

function padSequenceLabel(index: number) {
  return padDisplayLabel(koPadSequenceOrder[Math.max(0, Math.min(11, index))]);
}

function padRangeLabel(startPadNumber?: string | number | null, count = 1) {
  const start = padSequenceIndex(startPadNumber);
  const end = Math.min(11, start + Math.max(1, count) - 1);
  return start === end
    ? `pad ${padSequenceLabel(start)}`
    : `pads ${padSequenceLabel(start)}-${padSequenceLabel(end)}`;
}

function sortPadsForDisplay(pads: Pad[]) {
  const order = new Map(koPadVisualOrder.map((padNumber, index) => [padNumber, index]));
  return [...pads].sort((a, b) => (order.get(a.number) ?? 99) - (order.get(b.number) ?? 99));
}

function padsFromSequenceStart(pads: Pad[], startPadNumber?: string | number | null) {
  const start = padSequenceIndex(startPadNumber);
  return [...pads]
    .sort((a, b) => padSequenceIndex(a.number) - padSequenceIndex(b.number))
    .filter((pad) => padSequenceIndex(pad.number) >= start);
}

const samplerProcessToggles: { key: keyof Pick<SampleSettings, "normalize" | "trim" | "mono" | "lofi" | "lowCut" | "highCut">; label: string }[] = [
  { key: "normalize", label: "Normalize" },
  { key: "trim", label: "Trim" },
  { key: "mono", label: "Mono" },
  { key: "lofi", label: "Lo-Fi" },
  { key: "lowCut", label: "Low cut" },
  { key: "highCut", label: "High cut" },
];

type PadUploadSlotChoice = {
  mode: "next-free" | "bank" | "slot";
  bankStart: number;
  slot: string;
};

const padUploadBanks = Array.from({ length: 10 }, (_, index) => {
  const startSlot = index * 100 + 1;
  const endSlot = index === 9 ? 999 : startSlot + 99;
  return {
    startSlot,
    endSlot,
    label: `${String(startSlot).padStart(3, "0")}-${String(endSlot).padStart(3, "0")}`,
  };
});

const defaultPadUploadSlotChoice: PadUploadSlotChoice = {
  mode: "next-free",
  bankStart: 1,
  slot: "1",
};

function getPadUploadSlotTarget(choice: PadUploadSlotChoice): PadUploadSlotTarget | null {
  if (choice.mode === "bank") {
    const bank = padUploadBanks.find((candidate) => candidate.startSlot === choice.bankStart) || padUploadBanks[0];
    return { mode: "bank", startSlot: bank.startSlot, endSlot: bank.endSlot };
  }
  if (choice.mode === "slot") {
    const startSlot = Number(choice.slot);
    if (!Number.isInteger(startSlot) || startSlot < 1 || startSlot > 999) return null;
    return { mode: "slot", startSlot };
  }
  return { mode: "next-free" };
}

function preparePadUpload(files: File[], pads: Pad[], engine: DeviceEngine, choice: PadUploadSlotChoice) {
  const uploadCount = Math.min(files.length, pads.length);
  if (!uploadCount) return null;
  const slotTarget = getPadUploadSlotTarget(choice);
  if (!slotTarget) {
    window.alert("Choose a sample slot between 001 and 999.");
    return null;
  }
  if (slotTarget.mode === "bank") {
    const used = new Set(engine.sounds.map((sound) => sound.id));
    const freeSlots = Array.from({ length: slotTarget.endSlot - slotTarget.startSlot + 1 }, (_, index) => slotTarget.startSlot + index)
      .filter((slot) => !used.has(slot));
    if (freeSlots.length < uploadCount) {
      window.alert(`Bank ${String(slotTarget.startSlot).padStart(3, "0")}-${String(slotTarget.endSlot).padStart(3, "0")} only has ${freeSlots.length} free slot${freeSlots.length === 1 ? "" : "s"}.`);
      return null;
    }
  }
  if (slotTarget.mode === "slot") {
    const endSlot = slotTarget.startSlot + uploadCount - 1;
    if (endSlot > 999) {
      window.alert(`Uploading ${uploadCount} sample${uploadCount === 1 ? "" : "s"} from slot ${String(slotTarget.startSlot).padStart(3, "0")} would exceed slot 999.`);
      return null;
    }
    const occupied = engine.sounds.filter((sound) => sound.id >= slotTarget.startSlot && sound.id <= endSlot);
    if (occupied.length) {
      const label = occupied.length === 1
        ? `sample ${String(occupied[0].id).padStart(3, "0")} "${occupied[0].name}"`
        : `${occupied.length} occupied slots from ${String(slotTarget.startSlot).padStart(3, "0")}-${String(endSlot).padStart(3, "0")}`;
      if (!window.confirm(`Replace ${label}?`)) return null;
    }
  }
  return {
    files: files.slice(0, uploadCount),
    pads: pads.slice(0, uploadCount),
    slotTarget,
  };
}

function PadUploadSlotPanel({
  choice,
  setChoice,
}: {
  choice: PadUploadSlotChoice;
  setChoice: (choice: PadUploadSlotChoice) => void;
}) {
  const update = (next: Partial<PadUploadSlotChoice>) => setChoice({ ...choice, ...next });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pad Upload Slot</CardTitle>
        <CardDescription>Choose where new pad samples are stored before the pad is assigned.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { mode: "next-free", label: "Next free" },
            { mode: "bank", label: "Bank" },
            { mode: "slot", label: "Slot" },
          ].map((option) => (
            <Button
              key={option.mode}
              type="button"
              variant={choice.mode === option.mode ? "default" : "outline"}
              onClick={() => update({ mode: option.mode as PadUploadSlotChoice["mode"] })}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {choice.mode === "bank" && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            First free in bank
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
              value={choice.bankStart}
              onChange={(event) => update({ bankStart: Number(event.target.value) })}
            >
              {padUploadBanks.map((bank) => (
                <option key={bank.startSlot} value={bank.startSlot}>{bank.label}</option>
              ))}
            </select>
          </label>
        )}
        {choice.mode === "slot" && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Starting slot
            <input
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
              inputMode="numeric"
              min={1}
              max={999}
              value={choice.slot}
              onChange={(event) => update({ slot: event.target.value.replace(/\D/g, "").slice(0, 3) })}
            />
          </label>
        )}
      </CardContent>
    </Card>
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
  const updateLofiMode = (mode: SampleSettings["lofiMode"]) => {
    const profile = lofiProfiles[mode];
    setSettings({
      ...settings,
      enabled: true,
      lofi: true,
      lofiMode: mode,
      lofiSampleRate: String(profile.sampleRate),
      lofiBitDepth: String(profile.bitDepth),
    });
  };
  const toggleProcessSetting = (key: keyof Pick<SampleSettings, "normalize" | "trim" | "mono" | "lofi" | "lowCut" | "highCut">) => {
    const enabled = !settings[key];
    setSettings({ ...settings, enabled: enabled ? true : settings.enabled, [key]: enabled });
  };

  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={SlidersHorizontal} title="Sample Settings" description="Applied before sending samples to the selected pad or kit." />
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label="DSP on transfer" detail="Process audio before upload" checked={settings.enabled} onCheckedChange={(checked) => update("enabled", checked)} />
        <SettingRow label="Normalize" detail={`Peak target ${settings.targetDb} dBFS`} checked={settings.normalize} onCheckedChange={() => toggleProcessSetting("normalize")} />
        <SettingRow label="Trim silence" detail="Remove quiet heads and tails" checked={settings.trim} onCheckedChange={() => toggleProcessSetting("trim")} />
        <SettingRow label="Mono mix" detail="Collapse stereo files for tight kits" checked={settings.mono} onCheckedChange={() => toggleProcessSetting("mono")} />
        <SettingRow label="Auto-tag names" detail="Prefix obvious kicks, snares, loops, and FX" checked={settings.autoTag} onCheckedChange={(checked) => update("autoTag", checked)} />
        <SettingRow label="Reverse copy" detail="Create a reversed variant next to source" checked={settings.reverse} onCheckedChange={(checked) => update("reverse", checked)} />
        <SettingRow label="Ping-pong copy" detail="Render forward and reverse playback" checked={settings.pingPong} onCheckedChange={(checked) => update("pingPong", checked)} />
        <SettingRow label="Low cut" detail={`${settings.lowCutHz || 35} Hz high-pass`} checked={settings.lowCut} onCheckedChange={() => toggleProcessSetting("lowCut")} />
        <SettingRow label="High cut" detail={`${settings.highCutHz || 16000} Hz low-pass`} checked={settings.highCut} onCheckedChange={() => toggleProcessSetting("highCut")} />
        <SettingRow label="Lo-Fi mode" detail={`${settings.lofiSampleRate || 22050} Hz, ${settings.lofiBitDepth || 12}-bit character`} checked={settings.lofi} onCheckedChange={() => toggleProcessSetting("lofi")} />
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(lofiProfiles) as Array<[SampleSettings["lofiMode"], (typeof lofiProfiles)[SampleSettings["lofiMode"]]]>).map(([mode, profile]) => (
            <Button key={mode} type="button" variant={settings.lofiMode === mode ? "default" : "outline"} onClick={() => updateLofiMode(mode)}>
              {profile.label}
            </Button>
          ))}
        </div>
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
  const displayPads = sortPadsForDisplay(pads);
  return (
    <div className="grid grid-cols-3 gap-3">
      {displayPads.map((pad) => {
        const empty = !pad.name;
        const selected = selectedPad === pad.number;
        const label = padDisplayLabel(pad.number);
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
              <span className="text-xs font-semibold text-primary">PAD {label}</span>
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
  settings,
  setSettings,
}: {
  open: boolean;
  pad?: Pad;
  onClose: () => void;
  onUpload: (files: File[], startPad: number) => void;
  settings: SampleSettings;
  setSettings: (settings: SampleSettings) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackRef = useRef<{ context: AudioContext; source: AudioBufferSourceNode; startedAt: number; offset: number; duration?: number; reverse?: boolean } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const streamSourceRef = useRef<"system" | "mic" | null>(null);
  const recordingContextRef = useRef<AudioContext | null>(null);
  const recordingFrameRef = useRef<number | null>(null);
  const recordingNodesRef = useRef<{ processor: ScriptProcessorNode; silentGain: GainNode } | null>(null);
  const recordingChunksRef = useRef<Float32Array[][]>([]);
  const recordingStartedRef = useRef(false);
  const [source, setSource] = useState<"system" | "mic">("system");
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [markers, setMarkers] = useState<number[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<number | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<number | null>(null);
  const [draggingMarker, setDraggingMarker] = useState<number | null>(null);
  const [activeSlice, setActiveSlice] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [startChopSet, setStartChopSet] = useState(false);
  const [autoChopSensitivity, setAutoChopSensitivity] = useState(55);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [draggingTrim, setDraggingTrim] = useState<"start" | "end" | null>(null);
  const [sliceNames, setSliceNames] = useState<Record<number, string>>({});
  const [reversedSlices, setReversedSlices] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState("Load or record audio");
  const [recordingState, setRecordingState] = useState<"idle" | "armed" | "recording">("idle");
  const [recordingPeaks, setRecordingPeaks] = useState<number[]>([]);
  const [systemShareActive, setSystemShareActive] = useState(false);

  const stopPlayback = useCallback(() => {
    if (!playbackRef.current) return;
    try {
      playbackRef.current.source.stop();
    } catch {}
    if (playbackRef.current.context.state !== "closed") void playbackRef.current.context.close();
    playbackRef.current = null;
    setPlayhead(null);
    setActiveSlice(null);
    setIsPlaying(false);
  }, []);

  const stopRecordingMonitor = useCallback(() => {
    if (recordingFrameRef.current != null) {
      window.cancelAnimationFrame(recordingFrameRef.current);
      recordingFrameRef.current = null;
    }
    recordingNodesRef.current?.processor.disconnect();
    recordingNodesRef.current?.silentGain.disconnect();
    recordingNodesRef.current = null;
    void recordingContextRef.current?.close();
    recordingContextRef.current = null;
  }, []);

  const releaseMediaStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    streamSourceRef.current = null;
    setSystemShareActive(false);
  }, []);

  const clearRecorder = useCallback(() => {
    stopRecordingMonitor();
    recordingChunksRef.current = [];
    recordingStartedRef.current = false;
    setRecordingState("idle");
  }, [stopRecordingMonitor]);

  const targetPadSequenceIndex = padSequenceIndex(pad?.number);
  const targetPadLabel = padDisplayLabel(pad?.number);
  const maxChops = Math.max(1, 12 - targetPadSequenceIndex);
  const maxMarkers = Math.max(0, maxChops - 1);
  const targetPadRange = padRangeLabel(pad?.number, maxChops);
  const visibleDuration = 1 / zoom;
  const viewStart = pan * Math.max(0, 1 - visibleDuration);
  const viewEnd = Math.min(1, viewStart + visibleDuration);
  const activeMarkers = markers.filter((marker) => marker > trimStart + 0.001 && marker < trimEnd - 0.001);
  const slicePoints = [trimStart, ...activeMarkers, trimEnd].sort((a, b) => a - b);
  const slices = slicePoints.slice(0, -1).map((start, index) => ({
    index,
    start,
    end: slicePoints[index + 1],
    duration: audioBuffer ? (slicePoints[index + 1] - start) * audioBuffer.duration : 0,
    name: sliceNames[index] || `sample_chop_${String(index + 1).padStart(2, "0")}`,
    reversed: Boolean(reversedSlices[index]),
  }));
  const focusedSliceIndex = activeSlice ?? (selectedMarker != null ? selectedMarker + 1 : null);

  const updateSetting = <Key extends keyof SampleSettings>(key: Key, value: SampleSettings[Key]) => {
    setSettings({ ...settings, [key]: value });
  };
  const updateLofiMode = (mode: SampleSettings["lofiMode"]) => {
    const profile = lofiProfiles[mode];
    setSettings({
      ...settings,
      enabled: true,
      lofi: true,
      lofiMode: mode,
      lofiSampleRate: String(profile.sampleRate),
      lofiBitDepth: String(profile.bitDepth),
    });
  };
  const toggleProcessSetting = (key: keyof Pick<SampleSettings, "normalize" | "trim" | "mono" | "lofi" | "lowCut" | "highCut">) => {
    const enabled = !settings[key];
    setSettings({ ...settings, enabled: enabled ? true : settings.enabled, [key]: enabled });
  };

  const detectTransientMarkers = useCallback((sensitivity: number) => {
    if (!audioBuffer) return [];
    const data = audioBuffer.getChannelData(0);
    const windowSize = Math.max(128, Math.floor(audioBuffer.sampleRate * 0.012));
    const energies: number[] = [];
    for (let pos = 0; pos < data.length; pos += windowSize) {
      let sum = 0;
      for (let i = 0; i < windowSize && pos + i < data.length; i++) sum += Math.abs(data[pos + i]);
      energies.push(sum / windowSize);
    }
    const average = energies.reduce((sum, value) => sum + value, 0) / Math.max(1, energies.length);
    const transientRatio = 2.35 - sensitivity * 0.016;
    const averageRatio = 1.85 - sensitivity * 0.012;
    const candidates: { marker: number; score: number }[] = [];
    let cooldown = 0;
    for (let index = 1; index < energies.length - 1; index++) {
      const localPeak = energies[index] >= energies[index + 1] && energies[index] > energies[index - 1] * transientRatio;
      const strongEnough = energies[index] > average * averageRatio;
      if (cooldown <= 0 && localPeak && strongEnough) {
        const marker = (index * windowSize) / data.length;
        if (marker > trimStart + 0.005 && marker < trimEnd - 0.005) {
          const rise = energies[index] / Math.max(0.00001, energies[index - 1]);
          const strength = energies[index] / Math.max(0.00001, average);
          candidates.push({ marker: Number(marker.toFixed(4)), score: rise * strength });
        }
        cooldown = Math.floor(audioBuffer.sampleRate * 0.1 / windowSize);
      }
      cooldown--;
    }
    const minSpacing = Math.max(0.025, (trimEnd - trimStart) / Math.max(8, maxChops * 2));
    const selected: number[] = [];
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      if (selected.length >= maxMarkers) break;
      if (selected.every((marker) => Math.abs(marker - candidate.marker) >= minSpacing)) selected.push(candidate.marker);
    }
    return selected.sort((a, b) => a - b);
  }, [audioBuffer, maxChops, maxMarkers, trimEnd, trimStart]);

  const autoChopMarkers = useMemo(() => detectTransientMarkers(autoChopSensitivity), [autoChopSensitivity, detectTransientMarkers]);
  const autoChopCount = audioBuffer ? Math.min(maxChops, autoChopMarkers.length + 1) : 0;

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
    const background = ctx.createLinearGradient(0, 0, rect.width, rect.height);
    background.addColorStop(0, "#04110f");
    background.addColorStop(0.52, "#08231d");
    background.addColorStop(1, "#160b09");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "rgba(255, 247, 239, 0.045)";
    for (let x = 0; x < rect.width; x += 64) ctx.fillRect(x, 0, 1, rect.height);
    ctx.fillStyle = "rgba(255, 247, 239, 0.03)";
    for (let y = 0; y < rect.height; y += 36) ctx.fillRect(0, y, rect.width, 1);
    ctx.strokeStyle = "rgba(255, 247, 239, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rect.height / 2);
    ctx.lineTo(rect.width, rect.height / 2);
    ctx.stroke();

    if (!audioBuffer) {
      if (recordingPeaks.length) {
        const mid = rect.height / 2;
        const barWidth = rect.width / Math.max(48, recordingPeaks.length);
        recordingPeaks.slice(-160).forEach((peak, index, peaks) => {
          const x = index * (rect.width / Math.max(1, peaks.length - 1));
          const height = Math.max(2, peak * rect.height * 1.8);
          ctx.fillStyle = peak > 0.018 ? "rgba(53, 208, 139, 0.88)" : "rgba(255, 247, 239, 0.24)";
          ctx.fillRect(x, mid - height / 2, Math.max(2, barWidth), height);
        });
        ctx.fillStyle = "#fff7ef";
        ctx.font = "13px sans-serif";
        ctx.fillText(recordingState === "armed" ? "waiting for audio" : "recording", 16, 26);
        return;
      }
      ctx.fillStyle = "#35d08b";
      ctx.font = "13px sans-serif";
      ctx.fillText("load or record audio", 16, rect.height / 2);
      return;
    }

    const timeToX = (position: number) => ((position - viewStart) / Math.max(0.001, viewEnd - viewStart)) * rect.width;

    slicePoints.slice(0, -1).forEach((start, index) => {
      const end = slicePoints[index + 1];
      const visibleStart = Math.max(start, viewStart);
      const visibleEnd = Math.min(end, viewEnd);
      if (visibleEnd <= visibleStart) return;
      const x = timeToX(visibleStart);
      const width = Math.max(1, timeToX(visibleEnd) - x);
      ctx.fillStyle = index === activeSlice
        ? "rgba(241, 90, 59, 0.22)"
        : index % 2
          ? "rgba(53, 208, 139, 0.055)"
          : "rgba(255, 247, 239, 0.035)";
      ctx.fillRect(x, 0, width, rect.height);
    });

    const data = audioBuffer.getChannelData(0);
    const mid = rect.height / 2;
    const waveGradient = ctx.createLinearGradient(0, 0, 0, rect.height);
    waveGradient.addColorStop(0, "rgba(74, 255, 177, 0.92)");
    waveGradient.addColorStop(0.5, "rgba(53, 208, 139, 0.58)");
    waveGradient.addColorStop(1, "rgba(22, 112, 91, 0.88)");
    ctx.strokeStyle = waveGradient;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = "rgba(53, 208, 139, 0.42)";
    ctx.shadowBlur = 8;
    slicePoints.slice(0, -1).forEach((sliceStart, index) => {
      const sliceEnd = slicePoints[index + 1];
      const visibleStart = Math.max(sliceStart, viewStart);
      const visibleEnd = Math.min(sliceEnd, viewEnd);
      if (visibleEnd <= visibleStart) return;
      const startX = Math.max(0, Math.floor(timeToX(visibleStart)));
      const endX = Math.min(rect.width, Math.ceil(timeToX(visibleEnd)));
      const reversed = Boolean(reversedSlices[index]);
      ctx.beginPath();
      for (let x = startX; x <= endX; x++) {
        const displayStart = viewStart + (x / Math.max(1, rect.width)) * (viewEnd - viewStart);
        const displayEnd = viewStart + ((x + 1) / Math.max(1, rect.width)) * (viewEnd - viewStart);
        const sampleStart = reversed ? sliceStart + sliceEnd - Math.min(sliceEnd, displayEnd) : Math.max(sliceStart, displayStart);
        const sampleEnd = reversed ? sliceStart + sliceEnd - Math.max(sliceStart, displayStart) : Math.min(sliceEnd, displayEnd);
        const frameStart = Math.max(0, Math.floor(Math.min(sampleStart, sampleEnd) * data.length));
        const frameEnd = Math.min(data.length - 1, Math.ceil(Math.max(sampleStart, sampleEnd) * data.length));
        let min = 1;
        let max = -1;
        for (let frame = frameStart; frame <= frameEnd; frame++) {
          const value = data[frame] || 0;
          if (value < min) min = value;
          if (value > max) max = value;
        }
        if (min > max) {
          min = 0;
          max = 0;
        }
        ctx.moveTo(x, mid + min * mid * 0.88);
        ctx.lineTo(x, mid + max * mid * 0.88);
      }
      ctx.stroke();
    });
    ctx.shadowBlur = 0;

    slicePoints.slice(0, -1).forEach((start, index) => {
      const end = slicePoints[index + 1];
      const visibleStart = Math.max(start, viewStart);
      const visibleEnd = Math.min(end, viewEnd);
      if (visibleEnd <= visibleStart) return;
      const x = timeToX(visibleStart);
      ctx.fillStyle = "rgba(255, 247, 239, 0.76)";
      ctx.font = "11px sans-serif";
      ctx.fillText(String(index + 1).padStart(2, "0"), x + 8, rect.height - 12);
      if (reversedSlices[index]) {
        ctx.fillStyle = "#f5c84b";
        ctx.fillRect(x + 30, rect.height - 27, 18, 16);
        ctx.fillStyle = "#071b16";
        ctx.font = "10px sans-serif";
        ctx.fillText("R", x + 36, rect.height - 15);
      }
    });

    markers.forEach((marker, index) => {
      if (marker < viewStart || marker > viewEnd) return;
      const x = timeToX(marker);
      const selected = selectedMarker === index;
      const hovered = hoveredMarker === index;
      ctx.strokeStyle = selected ? "#fff7ef" : "#f15a3b";
      ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
      ctx.fillStyle = selected ? "#fff7ef" : hovered ? "#f58b72" : "#f15a3b";
      ctx.fillRect(x - 10, 7, 20, 18);
      ctx.fillStyle = selected ? "#071b16" : "#fff7ef";
      ctx.font = "10px sans-serif";
      ctx.fillText(String(index + 2), x - 3, 20);
      if (hovered) {
        ctx.fillStyle = "rgba(7, 27, 22, 0.92)";
        ctx.fillRect(x + 12, 7, 18, 18);
        ctx.strokeStyle = "#f15a3b";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 12, 7, 18, 18);
        ctx.fillStyle = "#fff7ef";
        ctx.font = "12px sans-serif";
        ctx.fillText("x", x + 18, 20);
      }
    });

    if (startChopSet) {
      if (trimStart >= viewStart && trimStart <= viewEnd) {
        const x = timeToX(trimStart);
        ctx.strokeStyle = "#35d08b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, rect.height);
        ctx.stroke();
        ctx.fillStyle = "#35d08b";
        ctx.fillRect(x, 7, 20, 18);
        ctx.fillStyle = "#071b16";
        ctx.font = "10px sans-serif";
        ctx.fillText("1", x + 7, 20);
      }
    }

    [
      { position: trimStart, label: "IN", color: "#5db8ff" },
      { position: trimEnd, label: "OUT", color: "#f5c84b" },
    ].forEach((handle) => {
      if (handle.position < viewStart || handle.position > viewEnd) return;
      const x = timeToX(handle.position);
      ctx.strokeStyle = handle.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
      ctx.fillStyle = handle.color;
      ctx.fillRect(x - 14, rect.height - 28, 28, 18);
      ctx.fillStyle = "#071b16";
      ctx.font = "9px sans-serif";
      ctx.fillText(handle.label, x - 9, rect.height - 15);
    });

    if (playhead != null) {
      if (playhead >= viewStart && playhead <= viewEnd) {
        const x = timeToX(playhead);
        ctx.fillStyle = "rgba(245, 200, 75, 0.08)";
        ctx.fillRect(0, 0, x, rect.height);
        ctx.strokeStyle = "#f5c84b";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, rect.height);
        ctx.stroke();
        ctx.fillStyle = "#f5c84b";
        ctx.beginPath();
        ctx.arc(x, 14, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [activeSlice, audioBuffer, hoveredMarker, markers, playhead, recordingPeaks, recordingState, reversedSlices, selectedMarker, slicePoints, startChopSet, trimEnd, trimStart, viewEnd, viewStart]);

  useEffect(() => {
    if (!open) return;
    drawWaveform();
    window.addEventListener("resize", drawWaveform);
    return () => window.removeEventListener("resize", drawWaveform);
  }, [drawWaveform, open]);

  useEffect(() => {
    setMarkers((current) => current.slice(0, maxMarkers));
    setSelectedMarker((current) => current != null && current >= maxMarkers ? null : current);
    setHoveredMarker((current) => current != null && current >= maxMarkers ? null : current);
    setReversedSlices((current) => Object.fromEntries(Object.entries(current).filter(([sliceIndex]) => Number(sliceIndex) < maxChops)));
  }, [maxChops, maxMarkers]);

  useEffect(() => () => {
    stopPlayback();
    clearRecorder();
    releaseMediaStream();
  }, [clearRecorder, releaseMediaStream, stopPlayback]);

  useEffect(() => {
    if (open) return;
    stopPlayback();
    clearRecorder();
    releaseMediaStream();
  }, [clearRecorder, open, releaseMediaStream, stopPlayback]);

  useEffect(() => {
    if (!open || !audioBuffer || !isPlaying) return;
    let frame = 0;
    const tick = () => {
      const playback = playbackRef.current;
      if (playback) {
        const elapsed = playback.context.currentTime - playback.startedAt;
        const position = playback.reverse && playback.duration
          ? playback.offset + Math.max(0, playback.duration - elapsed)
          : playback.offset + elapsed;
        const maxPosition = playback.duration ? playback.offset + playback.duration : audioBuffer.duration;
        setPlayhead(Math.max(0, Math.min(maxPosition, position)) / audioBuffer.duration);
        frame = window.requestAnimationFrame(tick);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [audioBuffer, isPlaying, open]);

  async function loadBlob(blob: Blob, name = "audio") {
    stopPlayback();
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      loadAudioBuffer(decoded, name);
    } finally {
      await context.close();
    }
  }

  function loadAudioBuffer(buffer: AudioBuffer, name = "audio") {
    setAudioBuffer(buffer);
    setMarkers([]);
    setSelectedMarker(null);
    setStartChopSet(false);
    setTrimStart(0);
    setTrimEnd(1);
    setZoom(1);
    setPan(0);
    setSliceNames({});
    setReversedSlices({});
    setStatus(`Loaded ${name} (${buffer.duration.toFixed(2)}s)`);
  }

  function createRecordedBuffer(context: AudioContext) {
    const chunks = recordingChunksRef.current;
    if (!chunks.length) return null;
    const channelCount = chunks[0].length;
    const frameCount = chunks.reduce((sum, chunk) => sum + (chunk[0]?.length || 0), 0);
    if (!channelCount || !frameCount) return null;
    const buffer = context.createBuffer(channelCount, frameCount, context.sampleRate);
    for (let channel = 0; channel < channelCount; channel++) {
      const output = buffer.getChannelData(channel);
      let offset = 0;
      for (const chunk of chunks) {
        const input = chunk[channel] || chunk[0];
        output.set(input, offset);
        offset += input.length;
      }
    }
    return buffer;
  }

  function clearSample() {
    stopPlayback();
    if (recordingState !== "idle") stopRecording();
    setAudioBuffer(null);
    setMarkers([]);
    setSelectedMarker(null);
    setActiveSlice(null);
    setPlayhead(null);
    setStartChopSet(false);
    setTrimStart(0);
    setTrimEnd(1);
    setZoom(1);
    setPan(0);
    setSliceNames({});
    setReversedSlices({});
    setRecordingPeaks([]);
    recordingChunksRef.current = [];
    recordingStartedRef.current = false;
    setStatus("Sample cleared");
  }

  async function startRecording() {
    if (!navigator.mediaDevices) {
      setStatus("Recording is not supported");
      return;
    }
    stopPlayback();
    clearRecorder();
    recordingChunksRef.current = [];
    recordingStartedRef.current = false;
    setRecordingPeaks([]);
    try {
      const existingStream = streamRef.current;
      const canReuseStream = source === "system"
        && streamSourceRef.current === "system"
        && existingStream?.getAudioTracks().some((track) => track.readyState === "live");
      if (!canReuseStream) releaseMediaStream();
      const stream = canReuseStream && existingStream
        ? existingStream
        : source === "mic"
          ? await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
          },
        })
          : await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        setStatus("No audio track selected");
        return;
      }
      streamRef.current = stream;
      streamSourceRef.current = source;
      setSystemShareActive(source === "system");
      if (!canReuseStream) {
        stream.getTracks().forEach((track) => {
          track.addEventListener("ended", () => {
            if (streamRef.current !== stream) return;
            stopRecordingMonitor();
            streamRef.current = null;
            streamSourceRef.current = null;
            setSystemShareActive(false);
            setRecordingState("idle");
            setStatus(source === "system" ? "System audio share ended" : "Microphone capture ended");
          }, { once: true });
        });
      }
      const audioOnlyStream = new MediaStream(audioTracks);
      const context = new AudioContext();
      const sourceNode = context.createMediaStreamSource(audioOnlyStream);
      const analyser = context.createAnalyser();
      const channelCount = Math.max(1, Math.min(2, audioTracks[0].getSettings().channelCount || 2));
      const processor = context.createScriptProcessor(4096, channelCount, channelCount);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      sourceNode.connect(analyser);
      sourceNode.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      recordingContextRef.current = context;
      recordingNodesRef.current = { processor, silentGain };
      processor.onaudioprocess = (event) => {
        if (!recordingStartedRef.current) return;
        const channels = Array.from({ length: event.inputBuffer.numberOfChannels }, (_, channel) =>
          new Float32Array(event.inputBuffer.getChannelData(channel)),
        );
        recordingChunksRef.current.push(channels);
      };
      const data = new Float32Array(analyser.fftSize);
      let hotFrames = 0;
      setRecordingState("armed");
      setStatus(source === "mic"
        ? "Armed: waiting for microphone audio"
        : canReuseStream ? "Armed: reusing shared PCM audio" : "Armed: waiting for shared PCM audio");

      const monitor = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index++) {
          const centered = data[index];
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length);
        setRecordingPeaks((current) => [...current.slice(-159), rms]);
        hotFrames = rms > 0.014 ? hotFrames + 1 : 0;
        if (hotFrames >= 3 && !recordingStartedRef.current) {
          recordingStartedRef.current = true;
          setRecordingState("recording");
          setStatus(source === "mic" ? "Recording microphone PCM" : "Recording shared PCM audio");
        }
        recordingFrameRef.current = window.requestAnimationFrame(monitor);
      };
      recordingFrameRef.current = window.requestAnimationFrame(monitor);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Recording failed");
      clearRecorder();
    }
  }

  function stopRecording() {
    const context = recordingContextRef.current;
    const buffer = context && recordingStartedRef.current ? createRecordedBuffer(context) : null;
    stopRecordingMonitor();
    if (streamSourceRef.current !== "system") releaseMediaStream();
    setRecordingState("idle");
    if (buffer) {
      recordingChunksRef.current = [];
      recordingStartedRef.current = false;
      setRecordingPeaks([]);
      loadAudioBuffer(buffer, "recording");
      return;
    }
    recordingChunksRef.current = [];
    recordingStartedRef.current = false;
    setRecordingPeaks([]);
    setStatus("Recording cancelled");
  }

  function markerFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canvasRef.current) return 0;
    const rect = canvasRef.current.getBoundingClientRect();
    const visiblePosition = (event.clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(1, viewStart + visiblePosition * (viewEnd - viewStart)));
  }

  function canvasPointFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: rect ? event.clientX - rect.left : 0,
      y: rect ? event.clientY - rect.top : 0,
      width: rect?.width || 1,
    };
  }

  function markerX(marker: number, width: number) {
    return ((marker - viewStart) / Math.max(0.001, viewEnd - viewStart)) * width;
  }

  function nearestMarkerIndex(position: number) {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const width = Math.max(1, canvas.getBoundingClientRect().width);
    return markers.findIndex((marker) => Math.abs(marker - position) / Math.max(0.001, viewEnd - viewStart) * width <= 12);
  }

  function markerDeleteIndexFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = canvasPointFromEvent(event);
    return markers.findIndex((marker) => {
      if (marker < viewStart || marker > viewEnd) return false;
      const x = markerX(marker, point.width);
      return point.x >= x + 12 && point.x <= x + 30 && point.y >= 7 && point.y <= 25;
    });
  }

  function nearestTrimHandle(position: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const width = Math.max(1, canvas.getBoundingClientRect().width);
    const startDistance = Math.abs(trimStart - position) / Math.max(0.001, viewEnd - viewStart) * width;
    const endDistance = Math.abs(trimEnd - position) / Math.max(0.001, viewEnd - viewStart) * width;
    if (startDistance <= 14 && startDistance <= endDistance) return "start";
    if (endDistance <= 14) return "end";
    return null;
  }

  function addMarker(position: number, label = "chops") {
    if (!audioBuffer || position <= trimStart + 0.005 || position >= trimEnd - 0.005 || markers.length >= maxMarkers) return;
    if (markers.some((marker) => Math.abs(marker - position) < 0.006)) return;
    const rounded = Number(position.toFixed(4));
    const next = [...markers, rounded].sort((a, b) => a - b);
    setMarkers(next);
    setSelectedMarker(next.findIndex((candidate) => candidate === rounded));
    setStartChopSet(true);
    setStatus(`${next.length + 1} ${label}`);
  }

  function removeMarker(index: number | null) {
    if (index == null || index < 0) return;
    const next = markers.filter((_, markerIndex) => markerIndex !== index);
    setMarkers(next);
    setReversedSlices((current) => {
      const updated: Record<number, boolean> = {};
      Object.entries(current).forEach(([sliceKey, reversed]) => {
        const sliceIndex = Number(sliceKey);
        if (!reversed || sliceIndex === index + 1) return;
        updated[sliceIndex > index + 1 ? sliceIndex - 1 : sliceIndex] = true;
      });
      return updated;
    });
    setSelectedMarker(null);
    setStatus(`${next.length + 1} chops`);
  }

  function setMarkerSlot(slotIndex: number, position: number, keyLabel: string) {
    if (!audioBuffer) return;
    if (slotIndex >= maxMarkers) {
      setStatus(`${maxChops} chop${maxChops === 1 ? "" : "s"} available from ${targetPadRange}`);
      return;
    }
    const rounded = Number(Math.max(trimStart + 0.005, Math.min(trimEnd - 0.005, position)).toFixed(4));
    const next = [...markers];
    next[slotIndex] = rounded;
    const sorted = next
      .filter((marker, index) => index === slotIndex || typeof marker === "number")
      .slice(0, maxMarkers)
      .sort((a, b) => a - b);
    setMarkers(sorted);
    setSelectedMarker(sorted.findIndex((marker) => marker === rounded));
    setStartChopSet(true);
    setStatus(`Chop ${keyLabel} set at ${(rounded * audioBuffer.duration).toFixed(2)}s`);
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!audioBuffer || !canvasRef.current) return;
    const marker = markerFromEvent(event);
    const deleteIndex = markerDeleteIndexFromEvent(event);
    if (deleteIndex >= 0) {
      removeMarker(deleteIndex);
      return;
    }
    const nearest = nearestMarkerIndex(marker);
    canvasRef.current.setPointerCapture(event.pointerId);
    const trimHandle = nearestTrimHandle(marker);
    if (trimHandle) {
      setDraggingTrim(trimHandle);
      setStatus(trimHandle === "start" ? "Adjusting trim start" : "Adjusting trim end");
      return;
    }
    if (nearest >= 0) {
      setSelectedMarker(nearest);
      setHoveredMarker(nearest);
      setDraggingMarker(nearest);
      setStatus(`Selected chop ${nearest + 2}`);
      return;
    }
    addMarker(marker);
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!audioBuffer) return;
    const position = markerFromEvent(event);
    if (draggingMarker != null) {
      const previous = markers[draggingMarker - 1] ?? trimStart;
      const next = markers[draggingMarker + 1] ?? trimEnd;
      const moved = Number(Math.max(previous + 0.005, Math.min(next - 0.005, position)).toFixed(4));
      setMarkers((current) => current.map((marker, index) => index === draggingMarker ? moved : marker));
      setStatus(`Moved chop ${draggingMarker + 2} to ${(moved * audioBuffer.duration).toFixed(2)}s`);
      return;
    }
    if (draggingTrim === "start") {
      const next = Math.max(0, Math.min(trimEnd - 0.01, position));
      setTrimStart(Number(next.toFixed(4)));
      setMarkers((current) => current.filter((marker) => marker > next && marker < trimEnd));
      setStatus(`Trim start ${(next * (audioBuffer?.duration || 0)).toFixed(2)}s`);
      return;
    }
    if (draggingTrim === "end") {
      const next = Math.min(1, Math.max(trimStart + 0.01, position));
      setTrimEnd(Number(next.toFixed(4)));
      setMarkers((current) => current.filter((marker) => marker > trimStart && marker < next));
      setStatus(`Trim end ${(next * (audioBuffer?.duration || 0)).toFixed(2)}s`);
      return;
    }
    const nearest = nearestMarkerIndex(position);
    setHoveredMarker(nearest >= 0 ? nearest : null);
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    canvasRef.current?.releasePointerCapture(event.pointerId);
    setDraggingTrim(null);
    setDraggingMarker(null);
  }

  function equalChops(count: number) {
    if (!audioBuffer) return;
    const safeCount = Math.min(count, maxChops);
    const length = trimEnd - trimStart;
    setMarkers(Array.from({ length: safeCount - 1 }, (_, index) => trimStart + ((index + 1) / safeCount) * length));
    setSelectedMarker(null);
    setStartChopSet(true);
    setReversedSlices({});
    setStatus(`${safeCount} equal chops`);
  }

  function transientChops() {
    if (!audioBuffer) return;
    setMarkers(autoChopMarkers);
    setSelectedMarker(null);
    setStartChopSet(true);
    setReversedSlices({});
    setStatus(`${autoChopMarkers.length + 1} autochops at threshold ${autoChopSensitivity}`);
  }

  function bitCrushValue(sample: number, bitDepth: number) {
    if (bitDepth >= 16) return sample;
    const steps = 2 ** Math.max(1, bitDepth);
    return Math.round(((sample + 1) / 2) * (steps - 1)) / (steps - 1) * 2 - 1;
  }

  function copySegmentBuffer(startSeconds: number, durationSeconds: number, sampleRate: number, reverse = false) {
    if (!audioBuffer) return null;
    const channelCount = settings.mono ? 1 : Math.min(2, audioBuffer.numberOfChannels);
    const length = Math.max(1, Math.floor(durationSeconds * sampleRate));
    const buffer = new AudioBuffer({ length, numberOfChannels: channelCount, sampleRate });
    const sourceStart = Math.max(0, Math.floor(startSeconds * audioBuffer.sampleRate));
    const sourceFrameCount = Math.max(1, Math.floor(durationSeconds * audioBuffer.sampleRate));
    for (let channel = 0; channel < channelCount; channel++) {
      const output = buffer.getChannelData(channel);
      const sourceChannel = audioBuffer.getChannelData(Math.min(channel, audioBuffer.numberOfChannels - 1));
      if (settings.mono && audioBuffer.numberOfChannels > 1) {
        const otherChannel = audioBuffer.getChannelData(1);
        for (let frame = 0; frame < length; frame++) {
          const relativeFrame = Math.min(sourceFrameCount - 1, Math.floor((frame / sampleRate) * audioBuffer.sampleRate));
          const sourceFrame = sourceStart + (reverse ? sourceFrameCount - 1 - relativeFrame : relativeFrame);
          output[frame] = ((sourceChannel[sourceFrame] || 0) + (otherChannel[sourceFrame] || 0)) / 2;
        }
      } else {
        for (let frame = 0; frame < length; frame++) {
          const relativeFrame = Math.min(sourceFrameCount - 1, Math.floor((frame / sampleRate) * audioBuffer.sampleRate));
          const sourceFrame = sourceStart + (reverse ? sourceFrameCount - 1 - relativeFrame : relativeFrame);
          output[frame] = sourceChannel[sourceFrame] || 0;
        }
      }
    }
    return buffer;
  }

  async function renderPreviewBuffer(startSeconds: number, durationSeconds: number, reverse = false) {
    if (!audioBuffer || (!settings.enabled && !reverse)) return null;
    const lofiProfile = lofiProfiles[settings.lofiMode] || lofiProfiles.soft;
    const lofiSampleRate = Math.max(3000, Math.min(audioBuffer.sampleRate, Number(settings.lofiSampleRate) || lofiProfile.sampleRate));
    const renderRate = settings.enabled && settings.lofi ? lofiSampleRate : audioBuffer.sampleRate;
    const sourceBuffer = copySegmentBuffer(startSeconds, durationSeconds, renderRate, reverse);
    if (!sourceBuffer) return null;
    if (!settings.enabled) return sourceBuffer;
    const context = new OfflineAudioContext(sourceBuffer.numberOfChannels, sourceBuffer.length, renderRate);
    const sourceNode = context.createBufferSource();
    sourceNode.buffer = sourceBuffer;
    let node: AudioNode = sourceNode;
    if (settings.lowCut) {
      const filter = context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(Math.max(10, Math.min(renderRate / 2 - 100, Number(settings.lowCutHz) || 35)), context.currentTime);
      filter.Q.setValueAtTime(0.707, context.currentTime);
      node.connect(filter);
      node = filter;
    }
    if (settings.highCut) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(Math.max(100, Math.min(renderRate / 2 - 100, Number(settings.highCutHz) || 16000)), context.currentTime);
      filter.Q.setValueAtTime(0.707, context.currentTime);
      node.connect(filter);
      node = filter;
    }
    const gain = context.createGain();
    gain.gain.value = 10 ** ((Number(settings.gainDb) || 0) / 20);
    node.connect(gain);
    gain.connect(context.destination);
    sourceNode.start();
    const rendered = await context.startRendering();
    if (settings.lofi) {
      const bitDepth = Math.max(2, Math.min(16, Number(settings.lofiBitDepth) || lofiProfile.bitDepth));
      for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
        const data = rendered.getChannelData(channel);
        for (let frame = 0; frame < data.length; frame++) data[frame] = bitCrushValue(data[frame], bitDepth);
      }
    }
    return rendered;
  }

  async function play(start?: number, duration?: number, sliceIndex?: number) {
    if (!audioBuffer) return;
    stopPlayback();
    const startSeconds = start ?? trimStart * audioBuffer.duration;
    const durationSeconds = duration ?? (trimEnd - trimStart) * audioBuffer.duration;
    const reverse = sliceIndex != null && Boolean(reversedSlices[sliceIndex]);
    const context = new AudioContext();
    const sourceNode = context.createBufferSource();
    const previewBuffer = await renderPreviewBuffer(startSeconds, durationSeconds, reverse);
    sourceNode.buffer = previewBuffer || audioBuffer;
    sourceNode.connect(context.destination);
    sourceNode.addEventListener("ended", () => {
      if (context.state !== "closed") void context.close();
      playbackRef.current = null;
      setPlayhead(null);
      setActiveSlice(null);
      setIsPlaying(false);
    });
    sourceNode.start(0, previewBuffer ? 0 : startSeconds, previewBuffer ? undefined : durationSeconds);
    playbackRef.current = { context, source: sourceNode, startedAt: context.currentTime, offset: startSeconds, duration: durationSeconds, reverse };
    setActiveSlice(sliceIndex ?? null);
    setIsPlaying(true);
  }

  function playSlice(index: number) {
    const slice = slices[index];
    if (!audioBuffer || !slice) return;
    setSelectedMarker(index > 0 ? index - 1 : null);
    play(slice.start * audioBuffer.duration, slice.duration, index);
    setStatus(`Playing slice ${String(index + 1).padStart(2, "0")}${slice.reversed ? " reversed" : ""}`);
  }

  function toggleReverseSlice(index = focusedSliceIndex) {
    if (!audioBuffer || index == null || index < 0 || index >= slices.length) {
      setStatus("Select or play a chop before reversing");
      return;
    }
    setReversedSlices((current) => {
      const next = { ...current, [index]: !current[index] };
      if (!next[index]) delete next[index];
      setStatus(`Slice ${String(index + 1).padStart(2, "0")} ${next[index] ? "reversed" : "normal"}`);
      return next;
    });
  }

  function playbackPosition() {
    const playback = playbackRef.current;
    if (!playback) return null;
    return playback.offset + playback.context.currentTime - playback.startedAt;
  }

  function stampChopMarker(markerIndex: number, keyLabel: string) {
    if (!audioBuffer) return;
    const position = playbackPosition();
    if (position == null) {
      setStatus("Start playback before setting chops");
      return;
    }
    setMarkerSlot(markerIndex, position / audioBuffer.duration, keyLabel);
  }

  function moveSelectedMarker(direction: -1 | 1, coarse = false) {
    if (!audioBuffer || selectedMarker == null) return;
    const step = (viewEnd - viewStart) / (coarse ? 60 : 600);
    setMarkers((current) => {
      const previous = current[selectedMarker - 1] ?? trimStart;
      const next = current[selectedMarker + 1] ?? trimEnd;
      const moved = Number(Math.max(previous + 0.001, Math.min(next - 0.001, current[selectedMarker] + direction * step)).toFixed(4));
      const updated = current.map((marker, index) => index === selectedMarker ? moved : marker);
      setStatus(`Moved chop ${selectedMarker + 2} to ${(moved * audioBuffer.duration).toFixed(2)}s`);
      return updated;
    });
  }

  function handleChopKey(keyIndex: number, keyLabel: string) {
    if (!audioBuffer) return;
    if (keyIndex >= maxChops) {
      setStatus(`${targetPadRange} can take ${maxChops} chop${maxChops === 1 ? "" : "s"} from selected pad ${targetPadLabel}`);
      return;
    }
    if (keyIndex === 0) {
      if (!startChopSet) {
        setStartChopSet(true);
        play();
        setStatus(`Chop 1 set at ${(trimStart * audioBuffer.duration).toFixed(2)}s`);
        return;
      }
      playSlice(0);
      return;
    }
    const existingChopCount = startChopSet ? slices.length : 0;
    if (playbackRef.current && (!startChopSet || keyIndex >= existingChopCount)) {
      stampChopMarker(keyIndex - 1, keyLabel);
      return;
    }
    if (startChopSet && keyIndex < existingChopCount && slices[keyIndex]) {
      playSlice(keyIndex);
      return;
    }
    setStatus(`Press 1 to start playback, then press ${keyLabel} to set chop ${keyLabel}`);
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const keyIndex = samplerSliceKeys.findIndex((key) => key.code === event.code);
      if (keyIndex >= 0) {
        event.preventDefault();
        handleChopKey(keyIndex, samplerSliceKeys[keyIndex].label);
        return;
      }
      if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && selectedMarker != null) {
        event.preventDefault();
        moveSelectedMarker(event.code === "ArrowLeft" ? -1 : 1, event.shiftKey);
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selectedMarker != null) {
        event.preventDefault();
        removeMarker(selectedMarker);
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        toggleReverseSlice();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (playbackRef.current) stopPlayback();
        else play();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audioBuffer, focusedSliceIndex, markers, open, selectedMarker, slices, startChopSet, stopPlayback, trimEnd, trimStart, viewEnd, viewStart]);

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

  function renderSlice(startFrame: number, endFrame: number, name: string, reverse = false) {
    if (!audioBuffer) return null;
    const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) => {
      const data = audioBuffer.getChannelData(channel).slice(startFrame, endFrame);
      if (reverse) data.reverse();
      return data;
    });
    return new File([encodeWav(channels, audioBuffer.sampleRate)], name, { type: "audio/wav" });
  }

  function cleanSliceName(name: string, fallback: string) {
    return (name || fallback)
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9 _.-]+/gi, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 54) || fallback;
  }

  function renderChops() {
    if (!audioBuffer) return [];
    return slices.flatMap((slice, index) => {
      const start = Math.floor(slice.start * audioBuffer.length);
      const end = Math.floor(slice.end * audioBuffer.length);
      if (end - start < audioBuffer.sampleRate * 0.015) return [];
      const fallback = `sample_chop_${String(index + 1).padStart(2, "0")}`;
      const file = renderSlice(start, end, `${cleanSliceName(slice.name, fallback)}.wav`, slice.reversed);
      return file ? [file] : [];
    }).slice(0, maxChops);
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
      <div className="max-h-[94vh] w-full max-w-6xl overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <SectionTitle icon={AudioWaveform} title={`Sampler Pad ${targetPadLabel}`} description={`${slices.length} slice${slices.length === 1 ? "" : "s"} ready for keyboard playback and pad assignment.`} />
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
        <div className="grid max-h-[calc(94vh-73px)] gap-4 overflow-auto p-4 xl:grid-cols-[1fr_310px]">
          <div className="grid content-start gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="rounded-md border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                Target {targetPadRange}: {maxChops} chop{maxChops === 1 ? "" : "s"} available
              </div>
              <div className="text-xs text-muted-foreground">
                {audioBuffer ? `${audioBuffer.duration.toFixed(2)}s / ${audioBuffer.sampleRate} Hz` : status}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant={source === "system" ? "default" : "outline"} onClick={() => setSource("system")}>System</Button>
              <Button variant={source === "mic" ? "default" : "outline"} onClick={() => setSource("mic")}>Mic</Button>
              <Button onClick={recordingState === "idle" ? startRecording : stopRecording}><Mic2 className="h-4 w-4" /> {recordingState === "recording" ? "Stop" : recordingState === "armed" ? "Cancel" : "Record"}</Button>
              {systemShareActive && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (recordingState !== "idle") stopRecording();
                    releaseMediaStream();
                    setStatus("System audio share released");
                  }}
                >
                  Release share
                </Button>
              )}
              <Button variant="outline" onClick={() => fileInput.current?.click()}><FolderInput className="h-4 w-4" /> Load file</Button>
              <Button variant="outline" onClick={transientChops}><Scissors className="h-4 w-4" /> Autochop</Button>
              <Button variant="outline" onClick={() => isPlaying ? stopPlayback() : play()}>{isPlaying ? "Stop" : "Play"}</Button>
              <Button variant="outline" onClick={clearSample}><Trash2 className="h-4 w-4" /> Clear sample</Button>
              <Button onClick={assign}><Upload className="h-4 w-4" /> Assign to pad {targetPadLabel}</Button>
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
            <canvas
              ref={canvasRef}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onPointerLeave={() => setHoveredMarker(null)}
              className="h-[360px] w-full touch-none rounded-lg border bg-zinc-950 shadow-inner"
            />
            <div className="grid gap-3 rounded-lg border bg-muted/25 p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Zoom
                  <input
                    type="range"
                    min={1}
                    max={8}
                    step={0.25}
                    value={zoom}
                    onChange={(event) => {
                      setZoom(Number(event.target.value));
                      setPan((current) => Math.min(1, current));
                    }}
                  />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Pan
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={pan}
                    disabled={zoom <= 1}
                    onChange={(event) => setPan(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Trim in {audioBuffer ? (trimStart * audioBuffer.duration).toFixed(2) : "0.00"}s
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, trimEnd - 0.01)}
                    step={0.001}
                    value={trimStart}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setTrimStart(next);
                      setMarkers((current) => current.filter((marker) => marker > next && marker < trimEnd));
                    }}
                  />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Trim out {audioBuffer ? (trimEnd * audioBuffer.duration).toFixed(2) : "0.00"}s
                  <input
                    type="range"
                    min={Math.min(1, trimStart + 0.01)}
                    max={1}
                    step={0.001}
                    value={trimEnd}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setTrimEnd(next);
                      setMarkers((current) => current.filter((marker) => marker > trimStart && marker < next));
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
              {samplerSliceKeys.map((key, index) => {
                const slice = slices[index];
                return (
                  <button
                    key={key.code}
                    className={cn(
                      "grid h-16 content-center rounded-md border bg-background px-2 text-left text-xs hover:border-primary disabled:opacity-45",
                      activeSlice === index && "border-primary bg-primary/10",
                    )}
                    onClick={() => handleChopKey(index, key.label)}
                    disabled={!audioBuffer || index >= maxChops || (index > 0 && !isPlaying && !(startChopSet && slice))}
                  >
                    <span className="text-sm font-semibold">{key.label}</span>
                    <span className="truncate text-muted-foreground">{index >= maxChops ? "No pad" : index === 0 && !startChopSet ? "Set chop 1" : slice ? `Chop ${String(index + 1).padStart(2, "0")}${slice.reversed ? " · R" : ""}` : "Empty"}</span>
                    <span className="text-muted-foreground">{slice && startChopSet ? `${slice.duration.toFixed(2)}s` : index < maxChops ? `Pad ${padSequenceLabel(targetPadSequenceIndex + index)}` : "Limit"}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>{status}</span>
              <span>Space starts/stops without setting chop 1. Press 1 to set the start; available keys map to {targetPadRange}.</span>
            </div>
          </div>
          <div className="grid content-start gap-3">
            <div className="grid gap-2 rounded-lg border bg-muted/25 p-3">
              <div className="text-sm font-semibold">Chop</div>
              <div className="grid grid-cols-4 gap-2">
                <Button variant="outline" onClick={() => equalChops(4)} disabled={maxChops < 4}>4</Button>
                <Button variant="outline" onClick={() => equalChops(8)} disabled={maxChops < 8}>8</Button>
                <Button variant="outline" onClick={() => equalChops(12)} disabled={maxChops < 12}>12</Button>
                <Button variant="outline" onClick={() => equalChops(maxChops)}>{maxChops}</Button>
              </div>
              <div className="grid gap-2 rounded-md border bg-background p-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">Autochop threshold</span>
                  <span className="text-muted-foreground">{audioBuffer ? `${autoChopCount}/${maxChops} chop${autoChopCount === 1 ? "" : "s"}` : "load audio"}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={autoChopSensitivity}
                  onChange={(event) => setAutoChopSensitivity(Number(event.target.value))}
                />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>fewer</span>
                  <span>{autoChopSensitivity}</span>
                  <span>more</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Scores onsets across the trimmed sample, keeps the strongest spaced peaks, then sorts them in time.
                </div>
              </div>
              <Button variant="outline" className="justify-start" onClick={transientChops}><Scissors className="h-4 w-4" /> Autochop</Button>
              <Button variant="outline" className="justify-start" onClick={() => { setMarkers([]); setSelectedMarker(null); setStartChopSet(false); setReversedSlices({}); }}><RotateCcw className="h-4 w-4" /> Clear markers</Button>
            </div>

            <div className="grid gap-2 rounded-lg border bg-muted/25 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Process</div>
                <Switch checked={settings.enabled} onCheckedChange={(checked) => updateSetting("enabled", checked)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {samplerProcessToggles.map(({ key, label }) => (
                  <button
                    key={key}
                    className={cn(
                      "rounded-md border bg-background px-2 py-2 text-left text-xs",
                      settings[key] && "border-primary bg-primary/10",
                    )}
                    onClick={() => toggleProcessSetting(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(lofiProfiles) as Array<[SampleSettings["lofiMode"], (typeof lofiProfiles)[SampleSettings["lofiMode"]]]>).map(([mode, profile]) => (
                  <Button key={mode} type="button" variant={settings.lofiMode === mode ? "default" : "outline"} onClick={() => updateLofiMode(mode)}>
                    {profile.label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2 rounded-md border bg-background p-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">Selected chop</span>
                  <span className="text-muted-foreground">{focusedSliceIndex == null ? "none" : `Slice ${String(focusedSliceIndex + 1).padStart(2, "0")}`}</span>
                </div>
                <Button
                  type="button"
                  variant={focusedSliceIndex != null && reversedSlices[focusedSliceIndex] ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => toggleReverseSlice()}
                  disabled={focusedSliceIndex == null}
                >
                  Reverse selected
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">R</span>
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Lo-Fi Hz
                  <input className="h-8 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.lofiSampleRate} onChange={(event) => updateSetting("lofiSampleRate", event.target.value)} />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Bit depth
                  <input className="h-8 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.lofiBitDepth} onChange={(event) => updateSetting("lofiBitDepth", event.target.value)} />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Low cut
                  <input className="h-8 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.lowCutHz} onChange={(event) => updateSetting("lowCutHz", event.target.value)} />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  High cut
                  <input className="h-8 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.highCutHz} onChange={(event) => updateSetting("highCutHz", event.target.value)} />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Gain
                  <input className="h-8 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.gainDb} onChange={(event) => updateSetting("gainDb", event.target.value)} />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Target dB
                  <input className="h-8 rounded-md border bg-background px-2 text-sm text-foreground" value={settings.targetDb} onChange={(event) => updateSetting("targetDb", event.target.value)} />
                </label>
              </div>
              <div className="text-xs text-muted-foreground">
                These settings apply to sampler playback and pad assignment.
              </div>
            </div>

            <div className="grid max-h-48 gap-2 overflow-auto rounded-lg border bg-muted/25 p-2">
              {slices.map((slice) => (
                <div
                  key={`${slice.start}-${slice.end}`}
                  className={cn(
                    "grid gap-1 rounded-md border bg-background px-2 py-1.5 text-xs hover:border-primary",
                    activeSlice === slice.index && "border-primary bg-primary/10",
                  )}
                >
                  <button
                    className="flex items-center justify-between gap-2 text-left"
                    onClick={() => playSlice(slice.index)}
                    disabled={!audioBuffer}
                  >
                    <span>{samplerSliceKeys[slice.index]?.label || slice.index + 1} · Slice {String(slice.index + 1).padStart(2, "0")}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {slice.reversed && <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-950">R</span>}
                      {slice.duration.toFixed(2)}s
                    </span>
                  </button>
                  <input
                    className="h-7 rounded border bg-muted/20 px-2 text-xs text-foreground"
                    value={slice.name}
                    onChange={(event) => setSliceNames((current) => ({ ...current, [slice.index]: event.target.value }))}
                  />
                </div>
              ))}
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
  const [waveforms, setWaveforms] = useState<Record<number, { peaks: number[]; status: string }>>({});
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
  const selected = selectedId ? soundById.get(selectedId) : undefined;
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
  const selectSlot = (slotId: number) => {
    setSelectedId(slotId);
  };

  useEffect(() => {
    if (!selected || waveforms[selected.id]) return;
    let cancelled = false;
    setWaveforms((current) => ({ ...current, [selected.id]: { peaks: [], status: "Loading waveform" } }));
    void (async () => {
      const blob = await engine.loadSoundWav(selected);
      if (!blob || cancelled) {
        if (!cancelled) setWaveforms((current) => ({ ...current, [selected.id]: { peaks: [], status: "Waveform unavailable" } }));
        return;
      }
      const context = new AudioContext();
      try {
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        const data = buffer.getChannelData(0);
        const buckets = 96;
        const step = Math.max(1, Math.floor(data.length / buckets));
        const peaks = Array.from({ length: buckets }, (_, bucket) => {
          let peak = 0;
          const start = bucket * step;
          for (let index = 0; index < step && start + index < data.length; index++) {
            peak = Math.max(peak, Math.abs(data[start + index]));
          }
          return Number(peak.toFixed(3));
        });
        if (!cancelled) setWaveforms((current) => ({ ...current, [selected.id]: { peaks, status: `${buffer.duration.toFixed(2)}s preview` } }));
      } catch (error) {
        console.error(error);
        if (!cancelled) setWaveforms((current) => ({ ...current, [selected.id]: { peaks: [], status: "Waveform decode failed" } }));
      } finally {
        await context.close();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, selected, waveforms]);

  const waveform = selected ? waveforms[selected.id] : undefined;

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
        <div className="rounded-lg border bg-muted/35 p-3">
          <label className="relative grid gap-1 text-xs text-muted-foreground md:max-w-sm">
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
                    <div
                      key={slot.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectSlot(slot.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectSlot(slot.id);
                        }
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        uploadToSlot(slot, Array.from(event.dataTransfer.files || []));
                      }}
                      className={cn(
                        "group grid cursor-pointer grid-cols-[64px_minmax(0,1fr)_132px] items-center gap-3 rounded-md border p-3 text-left text-sm outline-none transition hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring",
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
                      <span className="flex justify-end">
                        {sound ? (
                          <>
                            <span className="self-center text-xs text-muted-foreground group-hover:hidden group-focus-within:hidden">{sound.size}</span>
                            <span className="hidden items-center gap-1 group-hover:flex group-focus-within:flex">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  engine.playSound(sound);
                                }}
                              >
                                Play
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                title="Download WAV"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  engine.downloadSound(sound);
                                }}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Delete sample"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  engine.deleteSound(sound);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">available</span>
                        )}
                      </span>
                    </div>
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
        <div className="grid gap-3 rounded-lg border bg-muted/35 p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid min-w-0 gap-3">
            <div>
              <div className="truncate text-sm font-medium">{selected ? `${String(selected.id).padStart(3, "0")} ${selected.name}` : "Select a sample for preview"}</div>
              <div className="text-xs text-muted-foreground">
                {selected?.usageProjects?.length ? `Used in project ${selected.usageProjects.map((project) => Number(project)).join(", ")}` : selected ? "No project usage detected" : "Waveforms load on demand and are cached for this session."}
              </div>
            </div>
            <div className="flex h-20 items-center gap-px overflow-hidden rounded-md border bg-background px-2">
              {selected && waveform?.peaks.length ? waveform.peaks.map((peak, index) => (
                <span
                  key={`${selected.id}-${index}`}
                  className="w-full rounded-full bg-primary/75"
                  style={{ height: `${Math.max(8, peak * 100)}%` }}
                />
              )) : (
                <div className="w-full text-center text-xs text-muted-foreground">{selected ? waveform?.status || "Preparing preview" : "No sample selected"}</div>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{selected ? waveform?.status || "Preparing preview" : "Click a filled slot to preview its waveform."}</div>
          </div>
          <div className="flex flex-wrap content-start gap-2">
            <Button size="sm" variant="outline" onClick={() => engine.playSound(selected)} disabled={!selected}>Play</Button>
            <Button size="sm" variant="outline" onClick={() => engine.downloadSound(selected)} disabled={!selected}>
              <Download className="h-4 w-4" /> Download WAV
            </Button>
            <Button size="sm" variant="outline" onClick={() => engine.deleteSound(selected)} disabled={!selected}>Delete</Button>
          </div>
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
  padUploadSlotChoice,
  setPadUploadSlotChoice,
  onOpenSampler,
}: {
  engine: DeviceEngine;
  selectedPad: string;
  setSelectedPad: (pad: string) => void;
  settings: SampleSettings;
  setSettings: (settings: SampleSettings) => void;
  padUploadSlotChoice: PadUploadSlotChoice;
  setPadUploadSlotChoice: (choice: PadUploadSlotChoice) => void;
  onOpenSampler: () => void;
}) {
  const kitImportInput = useRef<HTMLInputElement | null>(null);
  const sampleInput = useRef<HTMLInputElement | null>(null);
  const [archiveNote, setArchiveNote] = useState("");
  const selected = engine.pads.find((pad) => pad.number === selectedPad);

  const uploadFiles = useCallback(
    async (files: File[], targetPads?: Pad[]) => {
      const pads = targetPads || padsFromSequenceStart(engine.pads);
      const upload = preparePadUpload(files, pads, engine, padUploadSlotChoice);
      if (!upload) return;
      await engine.uploadToPads(upload.files, upload.pads, upload.slotTarget);
    },
    [engine, padUploadSlotChoice],
  );

  const saveSnapshot = () => {
    const key = "ep-modern-snapshots";
    type Snapshot = {
      id: string;
      createdAt: string;
      target: string;
      pads: Array<{ number: string; name: string; type: string; assignedPath?: string }>;
      sounds: Array<{ id: number; name: string; path?: string }>;
    };
    const existing = JSON.parse(localStorage.getItem(key) || "[]") as Snapshot[];
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      target: engine.target,
      pads: engine.pads.map((pad) => ({ number: pad.number, name: pad.name, type: pad.type, assignedPath: pad.assignedPath })),
      sounds: engine.sounds.map((sound) => ({ id: sound.id, name: sound.name, path: sound.path })),
    };
    const previous = existing.find((candidate) => candidate.target === snapshot.target);
    const changedPads = previous
      ? snapshot.pads.filter((pad) => {
        const before = previous.pads.find((candidate) => candidate.number === pad.number);
        return before?.assignedPath !== pad.assignedPath || before?.name !== pad.name;
      }).length
      : snapshot.pads.filter((pad) => pad.assignedPath).length;
    const previousSounds = new Set((previous?.sounds || []).map((sound) => sound.id));
    const currentSounds = new Set(snapshot.sounds.map((sound) => sound.id));
    const addedSounds = snapshot.sounds.filter((sound) => !previousSounds.has(sound.id)).length;
    const removedSounds = previous ? previous.sounds.filter((sound) => !currentSounds.has(sound.id)).length : 0;
    localStorage.setItem(key, JSON.stringify([snapshot, ...existing].slice(0, 50)));
    setArchiveNote(`Snapshot saved: ${changedPads} pad change${changedPads === 1 ? "" : "s"}, ${addedSounds} added sample${addedSounds === 1 ? "" : "s"}, ${removedSounds} removed sample${removedSounds === 1 ? "" : "s"}.`);
  };

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
              <Button variant="outline" onClick={saveSnapshot} disabled={!engine.connected}>
                <CheckCircle2 className="h-4 w-4" /> Snapshot
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
            <CardDescription>
              {engine.targetSwitchingEnabled ? "Uploads and imports land here." : "Read from the device. Change target on the EP, then refresh."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Project</div>
              <div className="grid grid-cols-3 gap-2">
                {projects.map((project) => (
                  <Button
                    key={project}
                    variant={project === engine.activeProject ? "default" : "outline"}
                    disabled={!engine.connected || !engine.targetSwitchingEnabled}
                    onClick={() => engine.setProject(project)}
                  >
                    {project}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Group</div>
              <div className="grid grid-cols-4 gap-2">
                {groups.map((group) => (
                  <Button
                    key={group}
                    variant={group === engine.activeGroup ? "default" : "outline"}
                    disabled={!engine.connected || !engine.targetSwitchingEnabled}
                    onClick={() => engine.setGroup(group)}
                  >
                    {group}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pad {padDisplayLabel(selected?.number)}</CardTitle>
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
              <Button size="sm" variant="outline" onClick={() => engine.downloadPad(selected)} disabled={!selected?.assignedPath}>Download</Button>
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

        <PadUploadSlotPanel choice={padUploadSlotChoice} setChoice={setPadUploadSlotChoice} />
        <SampleSettingsPanel settings={settings} setSettings={setSettings} />
      </div>
    </div>
  );
}

function LibraryView({ engine }: { engine: DeviceEngine }) {
  return <SampleManager engine={engine} />;
}

function ConnectionDot({ engine }: { engine: DeviceEngine }) {
  const busy = engine.uploading || /scanning|preparing|uploading/i.test(engine.status);
  const color = engine.connected ? busy ? "bg-amber-400" : "bg-emerald-500" : busy ? "bg-amber-400" : "bg-red-500";
  return <span className={cn("h-2.5 w-2.5 rounded-full", color)} />;
}

function ConnectOverlay({ engine }: { engine: DeviceEngine }) {
  const connecting = /scanning/i.test(engine.status) && !engine.connected;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-3 text-primary">
            <Usb className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Connect your EP device</h1>
            <p className="text-sm text-muted-foreground">Plug in the EP-133 or EP-40 over USB, then allow MIDI/SysEx access.</p>
          </div>
        </div>
        <div className="mb-5 grid gap-2 rounded-lg border bg-muted/35 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Connection</span>
            <span className="flex items-center gap-2 font-medium">
              <ConnectionDot engine={engine} />
              {connecting ? "Scanning" : "Not connected"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">{engine.status}</div>
        </div>
        <Button className="w-full" onClick={engine.connect}>
          <Usb className="h-4 w-4" />
          {connecting ? "Scanning for device" : "Connect device"}
        </Button>
      </div>
    </div>
  );
}

function OperationOverlay({ engine }: { engine: DeviceEngine }) {
  if (!engine.uploading) return null;
  const status = engine.status || "Working";
  const title = /export|download|packag|prepared/i.test(status)
    ? "Exporting kit"
    : /import/i.test(status)
      ? "Importing kit"
      : /upload|preparing|slot/i.test(status)
        ? "Transferring samples"
        : "Working";

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-background/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border bg-card p-5 text-card-foreground shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold">{title}</div>
            <div className="truncate text-sm text-muted-foreground">{status}</div>
          </div>
        </div>
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
        <p className="text-xs text-muted-foreground">
          Keep the EP connected. Large kits can take a while because each assigned pad sample is downloaded as WAV before the archive is packaged.
        </p>
      </div>
    </div>
  );
}

export function App() {
  const { dark, setDark } = useTheme();
  const engine = useDeviceEngine();
  const autoConnectStarted = useRef(false);
  const [view, setView] = useState<"project" | "library">("project");
  const [selectedPad, setSelectedPad] = useState("10");
  const [settings, setSettings] = useState<SampleSettings>(() => loadInitialSampleSettings());
  const [padUploadSlotChoice, setPadUploadSlotChoice] = useState<PadUploadSlotChoice>(() => defaultPadUploadSlotChoice);
  const [samplerOpen, setSamplerOpen] = useState(false);
  const selected = engine.pads.find((pad) => pad.number === selectedPad);

  useEffect(() => {
    syncOfflineDspSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (autoConnectStarted.current || engine.connected) return;
    autoConnectStarted.current = true;
    void engine.connect();
  }, [engine]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DeviceEngineHost />
      <main className={cn(!engine.connected && "pointer-events-none select-none blur-sm")}>
        <header className="sticky top-0 z-20 grid min-h-16 gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="min-w-0">
            <div className="text-lg font-semibold">EP-133</div>
            <div className="truncate text-sm text-muted-foreground">{engine.connected ? engine.target : "Connect your device"}</div>
          </div>
          <div className="mx-auto inline-flex rounded-full border bg-muted/45 p-1">
            <button
              onClick={() => setView("project")}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground",
                view === "project" && "bg-background text-foreground shadow-sm",
              )}
            >
              <LayoutDashboard className="h-4 w-4" />
              Project
            </button>
            <button
              onClick={() => setView("library")}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground",
                view === "library" && "bg-background text-foreground shadow-sm",
              )}
            >
              <Archive className="h-4 w-4" />
              Library
            </button>
          </div>
          <div className="flex items-center justify-start gap-2 lg:justify-end">
            <div className="flex min-w-0 items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              <span className="hidden text-muted-foreground sm:inline">Memory</span>
              <span className="font-medium">{engine.memory}</span>
            </div>
            <Button variant="outline" onClick={() => setDark(!dark)}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {dark ? "Light" : "Dark"}
            </Button>
            <Button variant="outline" onClick={engine.connected ? engine.refresh : engine.connect}>
              <ConnectionDot engine={engine} />
              <Usb className="h-4 w-4" />
              {engine.connected ? "Connected" : /scanning/i.test(engine.status) ? "Connecting" : "Connect"}
            </Button>
          </div>
        </header>
        <div className="grid gap-6 p-6">
          {view === "project" ? (
            <Workspace
              engine={engine}
              selectedPad={selectedPad}
              setSelectedPad={setSelectedPad}
              settings={settings}
              setSettings={setSettings}
              padUploadSlotChoice={padUploadSlotChoice}
              setPadUploadSlotChoice={setPadUploadSlotChoice}
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
        settings={settings}
        setSettings={setSettings}
        onClose={() => setSamplerOpen(false)}
        onUpload={(files, startPad) => {
          const upload = preparePadUpload(files, padsFromSequenceStart(engine.pads, startPad), engine, padUploadSlotChoice);
          if (!upload) return;
          void engine.uploadToPads(upload.files, upload.pads, upload.slotTarget);
          setSamplerOpen(false);
        }}
      />
      <OperationOverlay engine={engine} />
      {!engine.connected && <ConnectOverlay engine={engine} />}
    </div>
  );
}
