import type { FileInfoResponse, FileListEntry } from "@/device/native-file-protocol";
import type { NativeFileService } from "@/device/native-file-service";

export type NativeNode = {
  id: number;
  parentId: number;
  name: string;
  flags: number;
  size: number;
  path: string;
};

function normalizePath(path: string) {
  if (!path || path === "/") return "/";
  return `/${path.split("/").filter(Boolean).join("/")}`;
}

function joinPath(parent: string, child: string) {
  return parent === "/" ? `/${child}` : `${parent}/${child}`;
}

function entryToNode(entry: FileListEntry, parentPath: string) {
  return {
    id: entry.nodeId,
    parentId: 0,
    name: entry.fileName,
    flags: entry.flags,
    size: entry.fileSize,
    path: joinPath(parentPath, entry.fileName),
  };
}

function infoToNode(info: FileInfoResponse, path: string) {
  return {
    id: info.nodeId,
    parentId: info.parentId,
    name: info.fileName,
    flags: info.flags,
    size: info.fileSize,
    path,
  };
}

export class NativeTreeCache {
  private pathToId = new Map<string, number>([["/", 0]]);
  private idToPath = new Map<number, string>([[0, "/"]]);

  constructor(private files: NativeFileService) {}

  clear() {
    this.pathToId = new Map([["/", 0]]);
    this.idToPath = new Map([[0, "/"]]);
  }

  remember(path: string, id: number) {
    const normalized = normalizePath(path);
    this.pathToId.set(normalized, id);
    this.idToPath.set(id, normalized);
  }

  async listChildren(pathOrId: string | number) {
    const parentId = typeof pathOrId === "number" ? pathOrId : await this.getNodeIdByPath(pathOrId);
    const parentPath = typeof pathOrId === "number" ? this.idToPath.get(pathOrId) || "/" : normalizePath(pathOrId);
    const entries = await this.files.listAll(parentId);
    const nodes = entries.map((entry) => entryToNode(entry, parentPath));
    nodes.forEach((node) => {
      this.pathToId.set(node.path, node.id);
      this.idToPath.set(node.id, node.path);
    });
    return nodes;
  }

  async getNodeIdByPath(path: string) {
    const normalized = normalizePath(path);
    const cached = this.pathToId.get(normalized);
    if (cached != null) return cached;

    let currentPath = "/";
    let currentId = 0;
    for (const segment of normalized.split("/").filter(Boolean)) {
      const children = await this.listChildren(currentId);
      const next = children.find((node) => node.name === segment);
      if (!next) throw new Error(`no such path ${normalized}`);
      currentPath = joinPath(currentPath, segment);
      currentId = next.id;
      this.remember(currentPath, currentId);
    }
    return currentId;
  }

  async getPathByNodeId(nodeId: number) {
    const cached = this.idToPath.get(nodeId);
    if (cached) return cached;

    const info = await this.files.info(nodeId);
    const parents: string[] = [info.fileName];
    let parentId = info.parentId;
    let guard = 0;

    while (parentId !== 0) {
      const parentPath = this.idToPath.get(parentId);
      if (parentPath) {
        const path = normalizePath(`${parentPath}/${parents.join("/")}`);
        this.remember(path, nodeId);
        return path;
      }
      const parent = await this.files.info(parentId);
      parents.unshift(parent.fileName);
      this.remember(`/${parents.join("/")}`, parent.nodeId);
      parentId = parent.parentId;
      guard++;
      if (guard > 100) throw new Error(`could not resolve path for node ${nodeId}`);
    }

    const path = normalizePath(parents.join("/"));
    this.remember(path, nodeId);
    return path;
  }

  async getNode(path: string) {
    const normalized = normalizePath(path);
    const id = await this.getNodeIdByPath(normalized);
    return infoToNode(await this.files.info(id), normalized);
  }
}
