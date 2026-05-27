import {
  FileDeleteRequest,
  FileGetDataRequest,
  FileGetDataResponse,
  FileGetInitRequest,
  FileGetInitResponse,
  FileInfoRequest,
  FileInfoResponse,
  FileInitRequest,
  FileInitResponse,
  FileListEntry,
  FileListRequest,
  FileMetadataGetRequest,
  FileMetadataGetResponse,
  FileMetadataSetPagedDataRequest,
  FileMetadataSetPagedInitRequest,
  FileMetadataSetRequest,
  FilePlaybackRequest,
  FilePutDataRequest,
  FilePutInitRequest,
  FilePutInitResponse,
  TE_FILE,
  TE_FILE_COMMAND,
  type NativeFileRequest,
} from "@/device/native-file-protocol";
import type { TeSysexClient } from "@/device/native-sysex";

const TE_SYSEX_HEADER_OVERHEAD = 8;
const TE_SYSEX_FOOTER_OVERHEAD = 1;

function calculateMaxPayloadLength(value: number) {
  const overhead = TE_SYSEX_HEADER_OVERHEAD + 2 + TE_SYSEX_FOOTER_OVERHEAD;
  if (value <= overhead) return 0;
  const available = value - 1 - overhead;
  return available - Math.floor(available / 8);
}

export class NativeFileService {
  private chunkSize = 0;

  constructor(private client: TeSysexClient) {}

  private async request(request: NativeFileRequest, timeoutMs?: number) {
    return this.client.send(TE_FILE_COMMAND, Uint8Array.from(request.asBytes()), timeoutMs);
  }

  async init(maxResponseLength = 4 * 1024 * 1024, subscribe = true) {
    const response = await this.request(new FileInitRequest(maxResponseLength, subscribe ? TE_FILE.INIT_SUBSCRIBE : 0));
    const init = new FileInitResponse(response.data);
    this.chunkSize = init.chunkSize;
    return init;
  }

  async list(nodeId: number, page = 0) {
    const response = await this.request(new FileListRequest(page, nodeId));
    if (response.data.byteLength <= 2) return [];
    const returnedPage = ((response.data[0] << 8) | response.data[1]) & 0xffff;
    if (returnedPage !== page) throw new Error(`unexpected page ${returnedPage}, expected ${page}`);
    return [...FileListEntry.iter(response.data.slice(2))];
  }

  async listAll(nodeId: number) {
    const entries: FileListEntry[] = [];
    for (let page = 0;; page++) {
      const batch = await this.list(nodeId, page);
      if (!batch.length) break;
      entries.push(...batch);
    }
    return entries;
  }

  async info(fileId: number) {
    const response = await this.request(new FileInfoRequest(fileId));
    return new FileInfoResponse(response.data);
  }

  async getMetadata(fileId: number, key: string | null = null, page = 0) {
    const response = await this.request(new FileMetadataGetRequest(fileId, page, key));
    return new FileMetadataGetResponse(response.data);
  }

  async getMetadataJson(fileId: number, keys: Array<string | null> = [null]) {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      let json = "";
      for (let page = 0;; page++) {
        const response = await this.request(new FileMetadataGetRequest(fileId, page, key));
        if (response.data.byteLength <= 2) break;
        const metadata = new FileMetadataGetResponse(response.data);
        if (metadata.page !== page) throw new Error(`unexpected metadata page ${metadata.page}, expected ${page}`);
        json += metadata.metadata;
        if (response.data.slice(-1)[0] === 0) break;
      }
      Object.assign(result, JSON.parse(json));
    }
    return result;
  }

  async setMetadata(fileId: number, metadata: string | Record<string, unknown>) {
    const json = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
    if (!this.chunkSize) await this.init();
    if (json.length <= this.chunkSize - 8) {
      await this.request(new FileMetadataSetRequest(fileId, json));
      return;
    }
    const bytes = new TextEncoder().encode(json);
    await this.request(new FileMetadataSetPagedInitRequest(fileId, bytes.byteLength));
    const maxPayload = calculateMaxPayloadLength(this.chunkSize - 8);
    if (maxPayload <= 0) throw new Error("native metadata payload size is invalid");
    let offset = 0;
    let page = 0;
    while (offset < bytes.byteLength) {
      const length = Math.min(maxPayload, bytes.byteLength - offset);
      await this.request(new FileMetadataSetPagedDataRequest(page, bytes.slice(offset, offset + length)));
      offset += length;
      page++;
    }
    await this.request(new FileMetadataSetPagedDataRequest(page, new Uint8Array(0)));
  }

  async delete(fileId: number) {
    await this.request(new FileDeleteRequest(fileId));
  }

  async startPlayback(fileId: number, offset = 0, length = 0) {
    await this.request(new FilePlaybackRequest(fileId, TE_FILE.PLAYBACK_START, offset, length));
  }

  async stopPlayback(fileId: number) {
    await this.request(new FilePlaybackRequest(fileId, TE_FILE.PLAYBACK_STOP, 0, 0));
  }

  async *iterGet(fileId: number, offset = 0, extraArgs: Uint8Array | null = null, onProgress?: (current: number, total: number) => void) {
    const initMessage = await this.request(new FileGetInitRequest(fileId, offset, extraArgs));
    const init = new FileGetInitResponse(initMessage.data);
    const total = init.fileSize - offset;
    let received = 0;
    let page = 0;
    while (received < total) {
      const dataMessage = await this.request(new FileGetDataRequest(page));
      const data = new FileGetDataResponse(dataMessage.data);
      if (data.page !== page) throw new Error(`unexpected page ${data.page}, expected ${page}`);
      if (data.data.byteLength === 0) break;
      received += data.data.byteLength;
      onProgress?.(received, total);
      yield { name: init.fileName, size: init.fileSize, data: data.data };
      page = data.nextPage;
    }
  }

  async get(fileId: number, onProgress?: (current: number, total: number) => void, extraArgs: Uint8Array | null = null, offset = 0) {
    const chunks: Uint8Array[] = [];
    let name = "";
    let size = 0;
    for await (const chunk of this.iterGet(fileId, offset, extraArgs, onProgress)) {
      chunks.push(chunk.data);
      name = chunk.name;
      size = chunk.size;
    }
    return { name, size, data: chunks };
  }

  async put(
    parentId: number,
    data: ArrayBuffer | Uint8Array,
    filename: string,
    options: {
      fileId?: number;
      metadata?: string | Record<string, unknown> | null;
      directory?: boolean;
      capabilities?: number[];
      timeoutMs?: number;
      onProgress?: (current: number, total: number, fileId?: number) => void;
    } = {},
  ) {
    if (!this.chunkSize) await this.init();
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const capabilities = options.capabilities || [TE_FILE.CAPABILITY_READ];
    const type = options.directory ? TE_FILE.FILE_TYPE_DIR : TE_FILE.FILE_TYPE_FILE;
    const flags = capabilities.reduce((sum, capability) => sum | capability, 0) | type;
    const metadata = options.metadata == null ? null : typeof options.metadata === "string" ? options.metadata : JSON.stringify(options.metadata);
    const initMessage = await this.request(
      new FilePutInitRequest(options.fileId || 0, parentId, flags, bytes.byteLength, filename, metadata),
      options.timeoutMs,
    );
    const init = new FilePutInitResponse(initMessage.data);
    options.onProgress?.(0, bytes.byteLength, init.fileId);
    const maxPayload = calculateMaxPayloadLength(this.chunkSize - 6);
    if (maxPayload <= 0) throw new Error("native upload payload size is invalid");
    let offset = 0;
    let page = 0;
    while (offset < bytes.byteLength) {
      const length = Math.min(maxPayload, bytes.byteLength - offset);
      await this.request(new FilePutDataRequest(page, bytes.slice(offset, offset + length)), options.timeoutMs);
      offset += length;
      page++;
      options.onProgress?.(offset, bytes.byteLength, init.fileId);
    }
    await this.request(new FilePutDataRequest(page, new Uint8Array(0)), options.timeoutMs);
    return init.fileId;
  }
}
