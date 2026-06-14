import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { projects } from "@/device/constants";
import { NativeDeviceService, type NativePad } from "@/device/native-device-service";
import { NativeFileService } from "@/device/native-file-service";
import { scanNativeMidi } from "@/device/native-midi";
import type { NativeMidiDevice } from "@/device/native-midi";
import { TeSysexClient } from "@/device/native-sysex";
import { processTransferFiles } from "@/dsp/settings";
import type { DeviceEngine, EngineState, Pad, PadUploadSlotTarget, Sound } from "@/device/types";

const fallbackPads: Pad[] = Array.from({ length: 12 }, (_, index) => ({
  number: String(index + 1).padStart(2, "0"),
  name: "",
  type: "Unassigned",
}));

const MB = 1024 * 1024;
const DEFAULT_SAMPLE_STORAGE_BYTES = 64 * MB;
const EXTENDED_SAMPLE_STORAGE_BYTES = 128 * MB;
const ENABLE_NATIVE_TARGET_SWITCH = import.meta.env.VITE_DISABLE_NATIVE_TARGET_SWITCH !== "true";

function shortPath(path?: string | null) {
  return path ? path.split("/").pop() || path : "";
}

function soundIdFromName(name: string) {
  const match = name.match(/^(\d{1,3})\b/);
  return match ? Number(match[1]) : 0;
}

function cleanSoundName(name: string) {
  return name.replace(/^\d{1,3}\s*/, "").replace(/\.pcm$/i, "").trim();
}

function normalizeProjectName(name?: string) {
  const value = Number(name);
  return Number.isFinite(value) && value > 0 ? String(value).padStart(2, "0") : name || "";
}

function normalizeGroupName(name?: string) {
  return (name || "").toUpperCase();
}

function metadataString(meta: Record<string, unknown> | undefined, key: string) {
  const value = meta?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function metadataNumber(meta: Record<string, unknown> | undefined, key: string) {
  const value = Number(meta?.[key]);
  return Number.isFinite(value) ? value : undefined;
}

function formatBytes(value?: number) {
  if (!Number.isFinite(value)) return "waiting";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function displayDeviceName(device: NativeMidiDevice) {
  return device.model || device.sku || device.outputName || device.inputName || "EP device";
}

function storageBytesForUsage(deviceStorageBytes: number | undefined, usedBytes: number) {
  const base = deviceStorageBytes || DEFAULT_SAMPLE_STORAGE_BYTES;
  if (usedBytes > DEFAULT_SAMPLE_STORAGE_BYTES && base < EXTENDED_SAMPLE_STORAGE_BYTES) return EXTENDED_SAMPLE_STORAGE_BYTES;
  return base;
}

function slotTargetLabel(slotTarget?: PadUploadSlotTarget) {
  if (slotTarget?.mode === "bank") return `bank ${String(slotTarget.startSlot).padStart(3, "0")}-${String(slotTarget.endSlot).padStart(3, "0")}`;
  if (slotTarget?.mode === "slot") return `slot ${String(slotTarget.startSlot).padStart(3, "0")}`;
  return "first free slot";
}

function slotTargetOptions(slotTarget?: PadUploadSlotTarget) {
  if (slotTarget?.mode === "bank") return { startSlot: slotTarget.startSlot, endSlot: slotTarget.endSlot };
  if (slotTarget?.mode === "slot") return { startSlot: slotTarget.startSlot, endSlot: 999, exact: true };
  return {};
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function mapNativePads(nativePads: NativePad[]) {
  return nativePads.length ? nativePads.map((pad) => ({
    number: pad.node.name,
    name: String(pad.meta.name || shortPath(pad.assignedPath) || ""),
    type: pad.assignedPath ? `Sound ${Number(pad.meta.sym)}` : "Unassigned",
    assignedPath: pad.assignedPath || undefined,
    size: pad.assignedPath ? shortPath(pad.assignedPath) : "drop sample",
    raw: pad,
  })) : fallbackPads;
}

function initialState(): EngineState {
  return {
    ready: true,
    connected: false,
    deviceName: "No device",
    target: "Select device",
    memory: "No device",
    pads: fallbackPads,
    activeProject: "",
    activeGroup: "",
    uploading: false,
    status: "Native engine ready",
    sounds: [],
    memoryUsedPercent: 0,
    targetSwitchingEnabled: ENABLE_NATIVE_TARGET_SWITCH,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

export function DeviceEngineHost() {
  return null;
}

export function useDeviceEngine(): DeviceEngine {
  const [state, setState] = useState<EngineState>(() => initialState());
  const [usageMap, setUsageMap] = useState<Record<number, string[]>>({});
  const serviceRef = useRef<NativeDeviceService | null>(null);
  const sysexRef = useRef<TeSysexClient | null>(null);
  const storageBytesRef = useRef(DEFAULT_SAMPLE_STORAGE_BYTES);

  const refreshNative = useCallback(async () => {
    const service = serviceRef.current;
    if (!service) return;
    const [activeProject, activeGroup, nativePads, nativeSounds] = await Promise.all([
      service.getActiveProject(),
      service.getActiveGroup(),
      service.getActivePads(),
      service.listSoundsWithMetadata(),
    ]);
    const pads = mapNativePads(nativePads);
    const sounds = nativeSounds
      .map((sound) => {
        const id = sound.id || soundIdFromName(sound.name);
        const metaName = metadataString(sound.meta, "name");
        return {
          id,
          name: metaName || cleanSoundName(sound.name) || `Sound ${id}`,
          path: sound.path,
          size: formatBytes(sound.size),
          meta: {
            name: metaName || undefined,
            channels: metadataNumber(sound.meta, "channels"),
            samplerate: metadataNumber(sound.meta, "samplerate"),
            format: metadataString(sound.meta, "format") || undefined,
          },
          raw: sound,
        };
      })
      .filter((sound) => sound.id > 0);
    const usedBytes = nativeSounds.reduce((sum, sound) => sum + (Number(sound.size) || 0), 0);
    const storageBytes = storageBytesForUsage(storageBytesRef.current, usedBytes);
    storageBytesRef.current = storageBytes;
    const memoryUsedPercent = Math.round((usedBytes / storageBytes) * 100);
    const activeProjectName = normalizeProjectName(activeProject?.node.name);
    const activeGroupName = normalizeGroupName(activeGroup?.node.name);
    setState((current) => ({
      ...current,
      connected: true,
      target: activeProjectName && activeGroupName ? `P${activeProjectName} / ${activeGroupName}` : "Select target",
      activeProject: activeProjectName,
      activeGroup: activeGroupName,
      pads,
      sounds,
      memory: `${formatBytes(usedBytes)} / ${formatBytes(storageBytes)}`,
      memoryUsedPercent,
      status: "Connected via native engine",
    }));
  }, []);

  const connect = useCallback(async () => {
    try {
      setState((current) => ({ ...current, status: "Scanning native MIDI" }));
      const scan = await scanNativeMidi();
      const device = scan.devices.find((candidate) => candidate.inputId && candidate.outputId);
      if (!device?.inputId || !device.outputId) {
        setState((current) => ({ ...current, connected: false, status: scan.status }));
        return;
      }
      const input = scan.inputs.find((port) => port.id === device.inputId);
      const output = scan.outputs.find((port) => port.id === device.outputId);
      if (!input || !output) throw new Error("Native EP MIDI ports disappeared");
      sysexRef.current?.close();
      const sysex = new TeSysexClient(input, output, device.deviceId ?? 0x7f);
      sysex.open();
      sysexRef.current = sysex;
      storageBytesRef.current = device.storageBytes || DEFAULT_SAMPLE_STORAGE_BYTES;
      const files = new NativeFileService(sysex);
      const service = new NativeDeviceService(files);
      await service.init();
      serviceRef.current = service;
      setState((current) => ({
        ...current,
        connected: true,
        deviceName: displayDeviceName(device),
        status: scan.status,
      }));
      await refreshNative();
    } catch (error) {
      console.error(error);
      setState((current) => ({ ...current, connected: false, status: error instanceof Error ? error.message : "Native connect failed" }));
    }
  }, [refreshNative]);

  useEffect(() => () => sysexRef.current?.close(), []);

  useEffect(() => {
    const service = serviceRef.current;
    if (!state.connected || !state.sounds.length || !service) {
      setUsageMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<number, Set<string>> = {};
      for (const project of projects) {
        for await (const meta of service.getProjectPadMeta(project)) {
          const soundId = Number(meta?.sym);
          if (!soundId) continue;
          if (!next[soundId]) next[soundId] = new Set();
          next[soundId].add(project);
        }
      }
      if (!cancelled) setUsageMap(Object.fromEntries(Object.entries(next).map(([id, used]) => [id, [...used].sort()])));
    })().catch((error) => console.error(error));
    return () => {
      cancelled = true;
    };
  }, [state.connected, state.sounds.length]);

  const runNative = useCallback(async (operation: (service: NativeDeviceService) => Promise<void>) => {
    const service = serviceRef.current;
    if (!service) {
      setState((current) => ({ ...current, status: "Connect a device first" }));
      return;
    }
    try {
      await operation(service);
      await refreshNative();
    } catch (error) {
      console.error(error);
      setState((current) => ({ ...current, uploading: false, status: error instanceof Error ? error.message : "Native operation failed" }));
    }
  }, [refreshNative]);

  return useMemo(() => ({
    ...state,
    sounds: state.sounds.map((sound) => ({ ...sound, usageProjects: usageMap[sound.id] || [] })),
    connect,
    refresh: () => runNative(async () => refreshNative()),
    setProject: (project: string) => runNative(async (service) => {
      if (!ENABLE_NATIVE_TARGET_SWITCH) {
        setState((current) => ({
          ...current,
          status: "Native project switching is disabled because it can reboot the device. Change project on the EP, then refresh.",
        }));
        return;
      }
      setState((current) => ({ ...current, status: `Switching to project ${project}` }));
      const group = state.activeGroup || "A";
      await service.setActiveProject(project, group);
      await wait(500);
      const target = await service.getPadsForProjectGroup(project, group);
      setState((current) => ({
        ...current,
        activeProject: normalizeProjectName(target.project.name),
        activeGroup: normalizeGroupName(target.group.name),
        target: `P${normalizeProjectName(target.project.name)} / ${normalizeGroupName(target.group.name)}`,
        pads: mapNativePads(target.pads),
      }));
    }),
    setGroup: (group: string) => runNative(async (service) => {
      if (!ENABLE_NATIVE_TARGET_SWITCH) {
        setState((current) => ({
          ...current,
          status: "Native group switching is disabled because it can reboot the device. Change group on the EP, then refresh.",
        }));
        return;
      }
      setState((current) => ({ ...current, status: `Switching to group ${group}` }));
      await service.setActiveGroup(group);
      await wait(500);
      const project = state.activeProject || "";
      const target = project ? await service.getPadsForProjectGroup(project, group) : null;
      setState((current) => ({
        ...current,
        activeProject: target ? normalizeProjectName(target.project.name) : current.activeProject,
        activeGroup: target ? normalizeGroupName(target.group.name) : normalizeGroupName(group),
        target: target
          ? `P${normalizeProjectName(target.project.name)} / ${normalizeGroupName(target.group.name)}`
          : `${current.activeProject ? `P${current.activeProject}` : "P--"} / ${normalizeGroupName(group)}`,
        pads: target ? mapNativePads(target.pads) : current.pads,
      }));
    }),
    uploadToPads: (files: File[], pads: Pad[], slotTarget?: PadUploadSlotTarget) => runNative(async (service) => {
      setState((current) => ({ ...current, uploading: true, status: `Preparing ${files.length} sample${files.length === 1 ? "" : "s"} for ${slotTargetLabel(slotTarget)}` }));
      const processed = await processTransferFiles(files);
      const padPaths = pads.flatMap((pad) => {
        const raw = pad.raw as { path?: string } | undefined;
        return raw?.path ? [raw.path] : [];
      });
      await service.uploadSoundsToPads(processed, padPaths, (file, current, total) => {
        setState((existing) => ({ ...existing, uploading: true, status: `Uploading ${file.name}: ${Math.round((current / Math.max(1, total)) * 100)}%` }));
      }, slotTargetOptions(slotTarget));
      setState((current) => ({ ...current, uploading: false, status: "Native pad upload complete" }));
    }),
    uploadSamples: (files: File[]) => runNative(async (service) => {
      setState((current) => ({ ...current, uploading: true, status: `Preparing ${files.length} sample${files.length === 1 ? "" : "s"}` }));
      const processed = await processTransferFiles(files);
      await service.uploadSounds(processed, (file, current, total) => {
        setState((existing) => ({ ...existing, uploading: true, status: `Uploading ${file.name}: ${Math.round((current / Math.max(1, total)) * 100)}%` }));
      });
      setState((current) => ({ ...current, uploading: false, status: "Native library upload complete" }));
    }),
    uploadSamplesToSlots: (files: File[], startSlot: number) => runNative(async (service) => {
      setState((current) => ({ ...current, uploading: true, status: `Preparing slot ${String(startSlot).padStart(3, "0")}` }));
      const processed = await processTransferFiles(files);
      await service.uploadSoundsToSlots(processed, startSlot, (file, current, total) => {
        setState((existing) => ({ ...existing, uploading: true, status: `Uploading ${file.name}: ${Math.round((current / Math.max(1, total)) * 100)}%` }));
      });
      setState((current) => ({ ...current, uploading: false, status: "Native slot upload complete" }));
    }),
    playSound: (sound?: Sound) => runNative(async (service) => {
      if (sound?.path) await service.playback(sound.path, true);
    }),
    deleteSound: (sound?: Sound) => runNative(async (service) => {
      if (sound?.path) await service.deleteSound(sound.path);
    }),
    downloadSound: (sound?: Sound) => runNative(async (service) => {
      if (!sound?.path) return;
      const wav = await service.downloadWav(sound.path);
      downloadBlob(wav, `${String(sound.id).padStart(3, "0")} ${sound.name || "sample"}.wav`);
    }),
    loadSoundWav: async (sound?: Sound) => {
      const service = serviceRef.current;
      if (!service || !sound?.path) return null;
      try {
        return await service.downloadWav(sound.path);
      } catch (error) {
        console.error(error);
        setState((current) => ({ ...current, status: error instanceof Error ? error.message : "Native WAV preview failed" }));
        return null;
      }
    },
    playPad: (pad?: Pad) => runNative(async (service) => {
      if (pad?.assignedPath) await service.playback(pad.assignedPath, true);
    }),
    clearPad: (pad?: Pad) => runNative(async (service) => {
      const raw = pad?.raw as { path?: string } | undefined;
      if (raw?.path) await service.clearPad(raw.path);
    }),
    downloadPad: (pad?: Pad) => runNative(async (service) => {
      if (!pad?.assignedPath) return;
      const wav = await service.downloadWav(pad.assignedPath);
      downloadBlob(wav, `${shortPath(pad.assignedPath) || "pad"}.wav`);
    }),
    exportKit: () => runNative(async (service) => {
      setState((current) => ({ ...current, uploading: true, status: "Preparing kit export" }));
      const archive = await service.exportActiveKitArchive((label, current, total) => {
        const percent = total ? ` ${Math.round((current / total) * 100)}%` : "";
        setState((existing) => ({ ...existing, uploading: true, status: `${label}${percent}` }));
      });
      downloadBlob(archive.blob, archive.filename);
      setState((current) => ({ ...current, uploading: false, status: `Exported ${archive.manifest.pads.length} kit sample${archive.manifest.pads.length === 1 ? "" : "s"}` }));
    }),
    importKit: (file: File) => runNative(async (service) => {
      setState((current) => ({ ...current, uploading: true, status: `Importing ${file.name}` }));
      const result = await service.importActiveKitArchive(file, (label, current, total) => {
        setState((existing) => ({ ...existing, uploading: true, status: `Importing ${label}: ${Math.round((current / Math.max(1, total)) * 100)}%` }));
      });
      setState((current) => ({ ...current, uploading: false, status: `Imported ${result.imported} kit sample${result.imported === 1 ? "" : "s"}` }));
    }),
  }), [connect, refreshNative, runNative, state, usageMap]);
}
