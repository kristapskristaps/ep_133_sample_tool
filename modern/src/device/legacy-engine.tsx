import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearPad,
  collectProjectUsage,
  deleteSound,
  downloadPad,
  downloadSound,
  exportKit,
  getLegacyBridge,
  importKit,
  midiPortSummary,
  playPad,
  playSound,
  refreshDevice,
  requestLegacyMidi,
  setGroup,
  setProject,
  snapshotLegacyEngine,
  uploadFilesToPads,
  uploadSamples,
} from "@/device/legacy-adapter";
import { projects } from "@/device/constants";
import { scanNativeMidi } from "@/device/native-midi";
import type { DeviceEngine, EngineBridge, EngineState, Pad, Sound } from "@/device/types";

function engineAsset(path: string) {
  return import.meta.env.DEV ? `/legacy/${path}` : `../../data/${path}`;
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

export function useDeviceEngine(): DeviceEngine {
  const [state, setState] = useState<EngineState>(() => snapshotLegacyEngine());
  const [midiStatus, setMidiStatus] = useState("");
  const [usageMap, setUsageMap] = useState<Record<number, string[]>>({});
  const autoConnectAttempted = useRef(false);

  const getBridge = useCallback(() => getLegacyBridge(), []);

  useEffect(() => {
    const timer = window.setInterval(() => setState(snapshotLegacyEngine(getBridge())), 500);
    return () => window.clearInterval(timer);
  }, [getBridge]);

  const run = useCallback(
    async (operation: (bridge: EngineBridge) => Promise<void> | void) => {
      const bridge = getBridge();
      if (!bridge) {
        setState(snapshotLegacyEngine());
        return;
      }
      try {
        await operation(bridge);
      } catch (error) {
        console.error(error);
      } finally {
        setState(snapshotLegacyEngine(bridge));
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
          const native = await scanNativeMidi();
          setMidiStatus(native.status || midiPortSummary(native.access));
          requestLegacyMidi(bridge);
          window.setTimeout(() => setState(snapshotLegacyEngine(bridge)), 2200);
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
      let next: Record<number, string[]> = {};
      try {
        next = await collectProjectUsage(getBridge(), projects);
      } catch (error) {
        console.error(error);
      }
      if (!cancelled) {
        setUsageMap(next);
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
    refresh: () => run(refreshDevice),
    setProject: (project: string) => run((bridge) => setProject(bridge, project)),
    setGroup: (group: string) => run((bridge) => setGroup(bridge, group)),
    uploadToPads: (files: File[], pads: Pad[]) => run((bridge) => uploadFilesToPads(bridge, files, pads)),
    uploadSamples: (files: File[]) => run((bridge) => uploadSamples(bridge, files)),
    playSound: (sound?: Sound) => run((bridge) => playSound(bridge, sound)),
    deleteSound: (sound?: Sound) => run((bridge) => deleteSound(bridge, sound)),
    downloadSound: (sound?: Sound) => run((bridge) => downloadSound(bridge, sound)),
    playPad: (pad?: Pad) => run((bridge) => playPad(bridge, pad)),
    clearPad: (pad?: Pad) => run((bridge) => clearPad(bridge, pad)),
    downloadPad: (pad?: Pad) => run((bridge) => downloadPad(bridge, pad)),
    exportKit: () => run(exportKit),
    importKit: (file: File) => run((bridge) => importKit(bridge, file)),
  };
}
