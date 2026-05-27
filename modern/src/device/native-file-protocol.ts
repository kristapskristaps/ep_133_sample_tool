export const TE_FILE_COMMAND = 5;

export const TE_FILE = {
  INIT: 1,
  INIT_SUBSCRIBE: 1,
  PUT: 2,
  PUT_INIT: 0,
  PUT_DATA: 1,
  GET: 3,
  GET_INIT: 0,
  GET_DATA: 1,
  LIST: 4,
  PLAYBACK: 5,
  DELETE: 6,
  METADATA: 7,
  METADATA_SET: 1,
  METADATA_GET: 2,
  METADATA_SET_PAGED: 4,
  METADATA_SET_PAGED_INIT: 0,
  METADATA_SET_PAGED_DATA: 1,
  INFO: 11,
  MOVED: 12,
  FILE_TYPE_FILE: 1,
  FILE_TYPE_DIR: 2,
  CAPABILITY_READ: 4,
  CAPABILITY_WRITE: 8,
  CAPABILITY_DELETE: 16,
  CAPABILITY_MOVE: 32,
  CAPABILITY_PLAYBACK: 64,
  PLAYBACK_START: 1,
  PLAYBACK_STOP: 2,
} as const;

export type NativeFileRequest = {
  asBytes(): Uint8Array;
};

function parseNullTerminatedString(data: Uint8Array, offset: number) {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  return new TextDecoder().decode(data.subarray(offset, end));
}

function writeString(view: DataView, offset: number, value: string, nullTerminated = true) {
  const bytes = new TextEncoder().encode(value);
  for (let index = 0; index < bytes.length; index++) view.setUint8(offset + index, bytes[index]);
  if (nullTerminated) view.setUint8(offset + bytes.length, 0);
}

export class FileInitRequest implements NativeFileRequest {
  constructor(private maxResponseLength: number, private flags: number) {}

  asBytes() {
    const bytes = new Uint8Array(6);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, TE_FILE.INIT);
    view.setUint8(1, this.flags);
    view.setUint32(2, this.maxResponseLength);
    return bytes;
  }
}

export class FileInitResponse {
  chunkSize: number;

  constructor(data: Uint8Array) {
    this.chunkSize = (data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4];
  }
}

export class FileListRequest implements NativeFileRequest {
  constructor(private page: number, private nodeId: number) {}

  asBytes() {
    const bytes = new Uint8Array(5);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, TE_FILE.LIST);
    view.setUint16(1, this.page);
    view.setUint16(3, this.nodeId);
    return bytes;
  }
}

export class FileListEntry {
  nodeId: number;
  flags: number;
  fileSize: number;
  fileName: string;
  length: number;

  constructor(data: Uint8Array) {
    this.nodeId = (data[0] << 8) | data[1];
    this.flags = data[2];
    this.fileSize = (data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6];
    this.fileName = parseNullTerminatedString(data, 7);
    this.length = 7 + this.fileName.length;
  }

  static *iter(data: Uint8Array) {
    let offset = 0;
    while (offset < data.byteLength) {
      const entry = new FileListEntry(data.slice(offset));
      yield entry;
      offset += entry.length + 1;
    }
  }
}

export class FileInfoRequest implements NativeFileRequest {
  constructor(private fileId: number) {}

  asBytes() {
    const bytes = new Uint8Array(3);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, TE_FILE.INFO);
    view.setUint16(1, this.fileId);
    return bytes;
  }
}

export class FileInfoResponse {
  nodeId: number;
  parentId: number;
  fileSize: number;
  flags: number;
  fileName: string;

  constructor(data: Uint8Array) {
    this.nodeId = (data[0] << 8) | data[1];
    this.parentId = (data[2] << 8) | data[3];
    this.flags = data[4];
    this.fileSize = (data[5] << 24) | (data[6] << 16) | (data[7] << 8) | data[8];
    this.fileName = parseNullTerminatedString(data, 9);
  }
}

export class FileGetInitRequest implements NativeFileRequest {
  constructor(private fileId: number, private offset: number, private extraArgs: Uint8Array | null = null) {}

  asBytes() {
    const bytes = new Uint8Array(this.extraArgs ? 16 + this.extraArgs.length : 8);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, TE_FILE.GET);
    view.setUint8(1, TE_FILE.GET_INIT);
    view.setUint16(2, this.fileId);
    view.setUint32(4, this.offset);
    if (this.extraArgs) {
      view.setBigUint64(8, 0n);
      bytes.set(this.extraArgs, 16);
    }
    return bytes;
  }
}

export class FileGetInitResponse {
  fileId: number;
  flags: number;
  fileSize: number;
  fileName: string;

  constructor(data: Uint8Array) {
    this.fileId = (data[0] << 8) | data[1];
    this.flags = data[2];
    this.fileSize = (data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6];
    this.fileName = parseNullTerminatedString(data, 7);
  }
}

export class FileGetDataRequest implements NativeFileRequest {
  constructor(private page: number) {}

  asBytes() {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, TE_FILE.GET);
    view.setUint8(1, TE_FILE.GET_DATA);
    view.setUint16(2, this.page);
    return bytes;
  }
}

export class FileGetDataResponse {
  page: number;
  nextPage: number;
  data: Uint8Array;

  constructor(data: Uint8Array) {
    this.page = (data[0] << 8) | data[1];
    this.nextPage = (this.page + 1) & 0xffff;
    this.data = data.subarray(2);
  }
}

export class FileDeleteRequest implements NativeFileRequest {
  constructor(private fileId: number) {}

  asBytes() {
    const bytes = new Uint8Array(3);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, TE_FILE.DELETE);
    view.setUint16(1, this.fileId);
    return bytes;
  }
}

export class FileMetadataGetRequest implements NativeFileRequest {
  constructor(private fileId: number, private page: number, private key: string | null = null) {}

  asBytes() {
    const bytes = new Uint8Array(6 + (this.key ? this.key.length + 1 : 0));
    const view = new DataView(bytes.buffer);
    view.setUint8(0, TE_FILE.METADATA);
    view.setUint8(1, TE_FILE.METADATA_GET);
    view.setUint16(2, this.fileId);
    view.setUint16(4, this.page);
    if (this.key) writeString(view, 6, this.key, true);
    return bytes;
  }
}

export class FileMetadataGetResponse {
  page: number;
  metadata: string;

  constructor(data: Uint8Array) {
    this.page = (data[0] << 8) | data[1];
    this.metadata = parseNullTerminatedString(data, 2);
  }
}

export class FileMetadataSetRequest implements NativeFileRequest {
  constructor(private fileId: number, private metadata: string) {}

  asBytes() {
    const bytes = new Uint8Array(4 + this.metadata.length + 1);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, TE_FILE.METADATA);
    view.setUint8(1, TE_FILE.METADATA_SET);
    view.setUint16(2, this.fileId);
    writeString(view, 4, this.metadata, true);
    return bytes;
  }
}

export class FilePlaybackRequest implements NativeFileRequest {
  constructor(private fileId: number, private action: number, private offset: number, private length: number) {}

  asBytes() {
    const bytes = new Uint8Array(12);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, TE_FILE.PLAYBACK);
    view.setUint8(1, this.action);
    view.setUint16(2, this.fileId);
    view.setUint32(4, this.offset);
    view.setUint32(8, this.length);
    return bytes;
  }
}
