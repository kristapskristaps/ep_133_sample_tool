import { useCallback, useEffect, useRef, useState } from "react";
import { processTransferFiles } from "@/dsp/settings";
import type { EngineBridge, EngineState, Pad, Sound } from "@/device/types";

export const projects = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
export const groups = ["A", "B", "C", "D"];

const fallbackPads: Pad[] = Array.from({ length: 12 }, (_, index) => ({
  number: String(index + 1).padStart(2, "0"),
  name: "",
  type: "Unassigned",
}));

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

export function DeviceEngineHost() {
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

export function useDeviceEngine() {
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
      run(async (bridge) => {
        const processed = await processTransferFiles(files);
        const startId = bridge.uploader?.findNextFreeSoundSlot?.(1);
        if (!startId || startId === -1) return;
        const error = bridge.uploader?.enqueueFiles?.(startId, processed);
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
