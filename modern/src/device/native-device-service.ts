import { projects, groups } from "@/device/constants";
import { createWavFromNativePcm, prepareNativeSoundFile } from "@/device/native-audio";
import { TE_FILE } from "@/device/native-file-protocol";
import { NativeFileService } from "@/device/native-file-service";
import { NativeTreeCache, type NativeNode } from "@/device/native-tree";
import { createStoredZip, readJsonEntry, readStoredZip, type ZipInput } from "@/lib/zip";

const pads = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

export type NativePad = {
  node: { id: number; name: string };
  path: string;
  meta: Record<string, unknown>;
  assignedPath: string | null;
};

export type NativeSound = NativeNode & {
  meta: Record<string, unknown>;
};

type KitManifest = {
  version: 1;
  createdAt: string;
  project: string;
  group: string;
  pads: Array<{
    pad: string;
    name: string;
    soundId: number;
    assignedPath: string;
    file: string;
    meta: Record<string, unknown>;
  }>;
};

function safeFilename(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "sample";
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export class NativeDeviceService {
  readonly tree: NativeTreeCache;

  constructor(readonly files: NativeFileService) {
    this.tree = new NativeTreeCache(files);
  }

  async init() {
    await this.files.init();
    this.tree.clear();
  }

  async getMetadata(path: string) {
    return this.files.getMetadataJson(await this.tree.getNodeIdByPath(path));
  }

  async setMetadata(path: string, metadata: Record<string, unknown>) {
    await this.files.setMetadata(await this.tree.getNodeIdByPath(path), metadata);
  }

  async mergeMetadata(path: string, metadata: Record<string, unknown>) {
    let current: Record<string, unknown> = {};
    try {
      current = await this.getMetadata(path);
    } catch {
      current = {};
    }
    await this.setMetadata(path, { ...current, ...metadata });
  }

  async getProjectNode(project: string) {
    const children = await this.tree.listChildren("/projects");
    const requested = Number(project);
    const node = children.find((candidate) => (
      candidate.name === project ||
      (Number.isFinite(requested) && Number(candidate.name) === requested)
    ));
    if (!node) throw new Error(`project ${project} not found on device`);
    return node;
  }

  async getGroupNode(projectPath: string, group: string) {
    const children = await this.tree.listChildren(`${projectPath}/groups`);
    const node = children.find((candidate) => candidate.name.toUpperCase() === group.toUpperCase());
    if (!node) throw new Error(`group ${group} not found on device`);
    return node;
  }

  async getActiveProject() {
    const projectsId = await this.tree.getNodeIdByPath("/projects");
    const meta = await this.files.getMetadataJson(projectsId);
    const active = Number(meta.active);
    if (!active) return null;
    const path = await this.tree.getPathByNodeId(active);
    const node = await this.tree.getNode(path);
    return { node: { id: node.id, name: node.name }, path, meta };
  }

  async getActiveGroup() {
    const project = await this.getActiveProject();
    if (!project) return null;
    const groupsPath = `${project.path}/groups`;
    const groupsId = await this.tree.getNodeIdByPath(groupsPath);
    const meta = await this.files.getMetadataJson(groupsId);
    const active = Number(meta.active);
    if (!active) return null;
    const path = await this.tree.getPathByNodeId(active);
    const node = await this.tree.getNode(path);
    return { node: { id: node.id, name: node.name }, path, meta };
  }

  async getActivePads() {
    const group = await this.getActiveGroup();
    if (!group) return [];
    const children = await this.tree.listChildren(group.path);
    const ordered = children
      .filter((node) => pads.includes(node.name))
      .sort((a, b) => pads.indexOf(a.name) - pads.indexOf(b.name));
    const result: NativePad[] = [];
    for (const node of ordered) {
      const meta = await this.files.getMetadataJson(node.id);
      const sym = Number(meta.sym);
      result.push({
        node: { id: node.id, name: node.name },
        path: node.path,
        meta,
        assignedPath: sym > 0 ? await this.tree.getPathByNodeId(sym) : null,
      });
    }
    return result;
  }

  async *getProjectPadMeta(project: string) {
    for (const group of groups) {
      for (const pad of pads) {
        try {
          yield await this.getMetadata(`/projects/${project}/groups/${group}/${pad}`);
        } catch {
          yield null;
        }
      }
    }
  }

  async setActiveProject(project: string, preferredGroup?: string) {
    const projectNode = await this.getProjectNode(project);
    await this.files.setMetadata(await this.tree.getNodeIdByPath("/projects"), { active: projectNode.id });
    const projectPath = projectNode.path;
    const groupsPath = `${projectPath}/groups`;
    let group = preferredGroup;
    if (!group) {
      try {
        const current = await this.files.getMetadataJson(await this.tree.getNodeIdByPath(groupsPath));
        const activeGroup = Number(current.active);
        if (activeGroup) group = (await this.tree.getNode(await this.tree.getPathByNodeId(activeGroup))).name;
      } catch {
        group = undefined;
      }
    }
    let groupNode: NativeNode;
    try {
      groupNode = await this.getGroupNode(projectPath, group || "A");
    } catch {
      groupNode = await this.getGroupNode(projectPath, "A");
    }
    await this.files.setMetadata(await this.tree.getNodeIdByPath(groupsPath), { active: groupNode.id });
  }

  async setActiveGroup(group: string) {
    const activeProject = await this.getActiveProject();
    if (!activeProject) throw new Error("no active project");
    const groupNode = await this.getGroupNode(activeProject.path, group);
    await this.files.setMetadata(await this.tree.getNodeIdByPath(`${activeProject.path}/groups`), { active: groupNode.id });
  }

  async assignSound(soundPath: string, padPath: string) {
    const sym = await this.tree.getNodeIdByPath(soundPath);
    await this.setMetadata(padPath, { sym });
  }

  async clearPad(padPath: string) {
    await this.setMetadata(padPath, { sym: 0 });
  }

  async playback(path: string, preview = false) {
    await this.files.startPlayback(await this.tree.getNodeIdByPath(path), 0, preview ? 1000 : 0);
  }

  async deleteSound(path: string) {
    await this.files.delete(await this.tree.getNodeIdByPath(path));
    this.tree.clear();
  }

  async downloadRaw(path: string, onProgress?: (current: number, total: number) => void) {
    return this.files.get(await this.tree.getNodeIdByPath(path), onProgress);
  }

  async downloadWav(path: string, onProgress?: (current: number, total: number) => void) {
    const fileId = await this.tree.getNodeIdByPath(path);
    const [metadata, raw] = await Promise.all([
      this.files.getMetadataJson(fileId),
      this.files.get(fileId, onProgress),
    ]);
    return createWavFromNativePcm(raw.data, metadata);
  }

  async listSounds() {
    return this.tree.listChildren("/sounds");
  }

  async listSoundsWithMetadata(): Promise<NativeSound[]> {
    const sounds = await this.listSounds();
    const result: NativeSound[] = [];
    for (const sound of sounds) {
      let meta: Record<string, unknown> = {};
      try {
        meta = await this.files.getMetadataJson(sound.id);
      } catch {
        meta = {};
      }
      result.push({ ...sound, meta });
    }
    return result;
  }

  async findNextFreeSoundSlot(startId = 1) {
    const sounds = await this.listSounds();
    const used = new Set(sounds.map((sound) => sound.id));
    for (let id = Math.max(1, startId); id <= 999; id++) {
      if (!used.has(id)) return id;
    }
    return -1;
  }

  async uploadSound(file: File, slotId?: number, onProgress?: (current: number, total: number) => void) {
    const soundsId = await this.tree.getNodeIdByPath("/sounds");
    const id = slotId || await this.findNextFreeSoundSlot();
    if (!id || id === -1) throw new Error("no free sound slots");
    const prepared = await prepareNativeSoundFile(file);
    await this.files.put(soundsId, prepared.bytes, prepared.name, {
      fileId: id,
      metadata: prepared.metadata,
      capabilities: [TE_FILE.CAPABILITY_READ],
      onProgress: (current, total) => onProgress?.(current, total),
    });
    await this.files.setMetadata(id, prepared.metadata);
    this.tree.clear();
    return {
      id,
      path: await this.tree.getPathByNodeId(id),
      name: prepared.name,
    };
  }

  async uploadSounds(files: File[], onProgress?: (file: File, current: number, total: number) => void) {
    const uploaded: Array<{ id: number; path: string; name: string }> = [];
    let cursor = 1;
    for (const file of files) {
      const slot = await this.findNextFreeSoundSlot(cursor);
      if (slot === -1) throw new Error("no free sound slots");
      uploaded.push(await this.uploadSound(file, slot, (current, total) => onProgress?.(file, current, total)));
      cursor = slot + 1;
    }
    return uploaded;
  }

  async uploadSoundsToSlots(files: File[], startSlot: number, onProgress?: (file: File, current: number, total: number) => void) {
    const uploaded: Array<{ id: number; path: string; name: string }> = [];
    for (let index = 0; index < files.length; index++) {
      const slot = startSlot + index;
      if (slot < 1 || slot > 999) throw new Error(`invalid sound slot ${slot}`);
      uploaded.push(await this.uploadSound(files[index], slot, (current, total) => onProgress?.(files[index], current, total)));
    }
    return uploaded;
  }

  async uploadSoundsToPads(files: File[], padPaths: string[], onProgress?: (file: File, current: number, total: number) => void) {
    const uploaded = await this.uploadSounds(files.slice(0, padPaths.length), onProgress);
    for (let index = 0; index < uploaded.length; index++) {
      await this.assignSound(uploaded[index].path, padPaths[index]);
    }
    return uploaded;
  }

  async exportActiveKitArchive(onProgress?: (label: string, current: number, total: number) => void) {
    const [project, group, activePads] = await Promise.all([
      this.getActiveProject(),
      this.getActiveGroup(),
      this.getActivePads(),
    ]);
    if (!project || !group) throw new Error("select an active project and group before exporting");
    const assignedPads = activePads.filter((pad) => pad.assignedPath);
    const manifest: KitManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      project: project.node.name,
      group: group.node.name,
      pads: [],
    };
    const files: ZipInput[] = [];
    for (let index = 0; index < assignedPads.length; index++) {
      const pad = assignedPads[index];
      if (!pad.assignedPath) continue;
      const soundId = Number(pad.meta.sym);
      const name = safeFilename(String(pad.meta.name || pad.assignedPath.split("/").pop() || `pad_${pad.node.name}`));
      const filename = `samples/pad_${pad.node.name}_${name}.wav`;
      onProgress?.(`Pad ${pad.node.name}`, index, assignedPads.length);
      files.push({ name: filename, data: await this.downloadWav(pad.assignedPath) });
      manifest.pads.push({
        pad: pad.node.name,
        name,
        soundId,
        assignedPath: pad.assignedPath,
        file: filename,
        meta: pad.meta,
      });
    }
    files.unshift({ name: "kit.json", data: JSON.stringify(manifest, null, 2) });
    onProgress?.("Packaging kit", assignedPads.length, assignedPads.length);
    return {
      filename: `ep-kit-p${project.node.name}-${group.node.name}-${new Date().toISOString().slice(0, 10)}.zip`,
      blob: await createStoredZip(files),
      manifest,
    };
  }

  async importActiveKitArchive(file: File, onProgress?: (label: string, current: number, total: number) => void) {
    const entries = await readStoredZip(file);
    const manifest = readJsonEntry<KitManifest>(entries, "kit.json");
    if (manifest.version !== 1 || !Array.isArray(manifest.pads)) throw new Error("unsupported kit archive");
    const activePads = await this.getActivePads();
    const padByNumber = new Map(activePads.map((pad) => [pad.node.name, pad]));
    const files: File[] = [];
    const padPaths: string[] = [];
    for (const pad of manifest.pads) {
      const target = padByNumber.get(pad.pad);
      const entry = entries.find((candidate) => candidate.name === pad.file);
      if (!target || !entry) continue;
      files.push(new File([bytesToArrayBuffer(entry.data)], pad.file.split("/").pop() || `pad_${pad.pad}.wav`, { type: "audio/wav" }));
      padPaths.push(target.path);
    }
    if (!files.length) throw new Error("kit archive has no samples matching the active pad layout");
    await this.uploadSoundsToPads(files, padPaths, (uploadFile, current, total) => {
      const index = Math.max(0, files.indexOf(uploadFile));
      onProgress?.(uploadFile.name, index + current / Math.max(1, total), files.length);
    });
    return { manifest, imported: files.length };
  }

  async listProjects() {
    const existing = await this.tree.listChildren("/projects");
    return existing.filter((node) => projects.includes(node.name));
  }
}
