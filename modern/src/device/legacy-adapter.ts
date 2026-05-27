import { processTransferFiles } from "@/dsp/settings";
import type { EngineBridge, EngineState, Pad, Sound } from "@/device/types";

const fallbackPads: Pad[] = Array.from({ length: 12 }, (_, index) => ({
  number: String(index + 1).padStart(2, "0"),
  name: "",
  type: "Unassigned",
}));

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

export function getLegacyBridge() {
  return window.ep133KitBridge as EngineBridge | undefined;
}

export function snapshotLegacyEngine(bridge?: EngineBridge): EngineState {
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

export function midiPortSummary(access: MIDIAccess) {
  const inputs = Array.from(access.inputs.values());
  const outputs = Array.from(access.outputs.values());
  const names = [...inputs, ...outputs].map((port) => port.name).filter(Boolean);
  const epNames = names.filter((name) => /EP|KO|K\.O|teenage|engineering/i.test(name || ""));
  const count = `${inputs.length} input${inputs.length === 1 ? "" : "s"}, ${outputs.length} output${outputs.length === 1 ? "" : "s"}`;
  if (epNames.length) return `Scanning ${count}: ${epNames.slice(0, 2).join(", ")}`;
  if (names.length) return `Scanning ${count}; no EP port matched`;
  return "No MIDI ports visible";
}

export function requestLegacyMidi(bridge: EngineBridge) {
  bridge.device?.requestMidi?.();
  window.setTimeout(() => bridge.device?.requestMidi?.(), 1200);
}

export async function collectProjectUsage(bridge: EngineBridge | undefined, projects: string[]) {
  const service = bridge?.device?.deviceService;
  if (!service?.getProjectPadMeta) return {};
  const next: Record<number, Set<string>> = {};
  for (const project of projects) {
    for await (const meta of service.getProjectPadMeta(project)) {
      const soundId = meta?.sym;
      if (!soundId || soundId <= 0) continue;
      if (!next[soundId]) next[soundId] = new Set();
      next[soundId].add(project);
    }
  }
  return Object.fromEntries(Object.entries(next).map(([id, used]) => [id, [...used].sort()]));
}

export async function uploadFilesToPads(bridge: EngineBridge, files: File[], pads: Pad[]) {
  const rawPads = pads.map((pad) => pad.raw || bridge.getPadByNumber?.(pad.number)).filter(Boolean);
  await bridge.uploadFilesToPads?.(bridge.classifyFiles?.(files) || files, rawPads);
}

export async function uploadSamples(bridge: EngineBridge, files: File[]) {
  const processed = await processTransferFiles(files);
  const startId = bridge.uploader?.findNextFreeSoundSlot?.(1);
  if (!startId || startId === -1) return;
  const error = bridge.uploader?.enqueueFiles?.(startId, processed);
  if (error) throw error;
}

export async function refreshDevice(bridge: EngineBridge) {
  await bridge.device?.refresh?.();
}

export async function setProject(bridge: EngineBridge, project: string) {
  await bridge.device?.setProject?.(project);
}

export async function setGroup(bridge: EngineBridge, group: string) {
  await bridge.device?.setGroup?.(group);
}

export async function playSound(bridge: EngineBridge, sound?: Sound) {
  if (sound?.path) await bridge.device?.deviceService?.playback?.(sound.path, true);
}

export async function deleteSound(bridge: EngineBridge, sound?: Sound) {
  if (!sound?.path) return;
  await bridge.device?.deviceService?.deleteSound?.(sound.path);
  await bridge.device?.refresh?.();
}

export async function downloadSound(bridge: EngineBridge, sound?: Sound) {
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
}

export async function playPad(bridge: EngineBridge, pad?: Pad) {
  if (pad?.raw) await bridge.playPad?.(pad.raw);
}

export async function clearPad(bridge: EngineBridge, pad?: Pad) {
  if (pad?.raw) await bridge.clearPad?.(pad.raw);
}

export async function downloadPad(bridge: EngineBridge, pad?: Pad) {
  if (pad?.raw) await bridge.downloadPad?.(pad.raw);
}

export async function exportKit(bridge: EngineBridge) {
  await bridge.exportKitArchive?.();
}

export async function importKit(bridge: EngineBridge, file: File) {
  await bridge.importKitArchive?.(file);
}
