import {
  FileDeleteRequest,
  FileInfoRequest,
  FileInfoResponse,
  FileListEntry,
  FileListRequest,
  FileMetadataGetRequest,
  FileMetadataGetResponse,
  FileMetadataSetRequest,
  FilePlaybackRequest,
  TE_FILE,
  TE_FILE_COMMAND,
  type NativeFileRequest,
} from "@/device/native-file-protocol";
import type { TeSysexClient } from "@/device/native-sysex";

export class NativeFileService {
  constructor(private client: TeSysexClient) {}

  private async request(request: NativeFileRequest, timeoutMs?: number) {
    return this.client.send(TE_FILE_COMMAND, Uint8Array.from(request.asBytes()), timeoutMs);
  }

  async list(nodeId: number, page = 0) {
    const response = await this.request(new FileListRequest(page, nodeId));
    return [...FileListEntry.iter(response.data)];
  }

  async info(fileId: number) {
    const response = await this.request(new FileInfoRequest(fileId));
    return new FileInfoResponse(response.data);
  }

  async getMetadata(fileId: number, key: string | null = null, page = 0) {
    const response = await this.request(new FileMetadataGetRequest(fileId, page, key));
    return new FileMetadataGetResponse(response.data);
  }

  async setMetadata(fileId: number, metadata: string) {
    await this.request(new FileMetadataSetRequest(fileId, metadata));
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
}
