import { projects, groups } from "@/device/constants";
import { NativeFileService } from "@/device/native-file-service";
import { NativeTreeCache } from "@/device/native-tree";

const pads = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

export type NativePad = {
  node: { id: number; name: string };
  path: string;
  meta: Record<string, unknown>;
  assignedPath: string | null;
};

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

  async setActiveProject(project: string) {
    const active = await this.tree.getNodeIdByPath(`/projects/${project}`);
    await this.files.setMetadata(await this.tree.getNodeIdByPath("/projects"), { active });
  }

  async setActiveGroup(group: string) {
    const activeProject = await this.getActiveProject();
    if (!activeProject) throw new Error("no active project");
    const active = await this.tree.getNodeIdByPath(`${activeProject.path}/groups/${group}`);
    await this.files.setMetadata(await this.tree.getNodeIdByPath(`${activeProject.path}/groups`), { active });
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

  async listSounds() {
    return this.tree.listChildren("/sounds");
  }

  async listProjects() {
    const existing = await this.tree.listChildren("/projects");
    return existing.filter((node) => projects.includes(node.name));
  }
}
