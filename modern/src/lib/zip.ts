const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type ZipInput = {
  name: string;
  data: Blob | ArrayBuffer | Uint8Array | string;
};

export type ZipEntry = {
  name: string;
  data: Uint8Array;
};

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index++) {
    crc = crcTable[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function toBytes(data: ZipInput["data"]) {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

export async function createStoredZip(files: ZipInput[]) {
  const entries = await Promise.all(files.map(async (file) => ({
    name: file.name.replace(/^\/+/, ""),
    nameBytes: encoder.encode(file.name.replace(/^\/+/, "")),
    data: await toBytes(file.data),
  })));
  let localSize = 0;
  let centralSize = 0;
  entries.forEach((entry) => {
    localSize += 30 + entry.nameBytes.length + entry.data.length;
    centralSize += 46 + entry.nameBytes.length;
  });
  const output = new ArrayBuffer(localSize + centralSize + 22);
  const view = new DataView(output);
  let offset = 0;
  const centralRecords: Array<{ entry: (typeof entries)[number]; localOffset: number; crc: number }> = [];

  for (const entry of entries) {
    const localOffset = offset;
    const crc = crc32(entry.data);
    view.setUint32(offset, 0x04034b50, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;
    view.setUint16(offset, 0x0800, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint32(offset, crc, true); offset += 4;
    view.setUint32(offset, entry.data.length, true); offset += 4;
    view.setUint32(offset, entry.data.length, true); offset += 4;
    view.setUint16(offset, entry.nameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    new Uint8Array(output, offset, entry.nameBytes.length).set(entry.nameBytes); offset += entry.nameBytes.length;
    new Uint8Array(output, offset, entry.data.length).set(entry.data); offset += entry.data.length;
    centralRecords.push({ entry, localOffset, crc });
  }

  const centralOffset = offset;
  for (const record of centralRecords) {
    view.setUint32(offset, 0x02014b50, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;
    view.setUint16(offset, 20, true); offset += 2;
    view.setUint16(offset, 0x0800, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint32(offset, record.crc, true); offset += 4;
    view.setUint32(offset, record.entry.data.length, true); offset += 4;
    view.setUint32(offset, record.entry.data.length, true); offset += 4;
    view.setUint16(offset, record.entry.nameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint32(offset, 0, true); offset += 4;
    view.setUint32(offset, record.localOffset, true); offset += 4;
    new Uint8Array(output, offset, record.entry.nameBytes.length).set(record.entry.nameBytes); offset += record.entry.nameBytes.length;
  }

  const endOffset = offset;
  view.setUint32(offset, 0x06054b50, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;
  view.setUint16(offset, 0, true); offset += 2;
  view.setUint16(offset, entries.length, true); offset += 2;
  view.setUint16(offset, entries.length, true); offset += 2;
  view.setUint32(offset, endOffset - centralOffset, true); offset += 4;
  view.setUint32(offset, centralOffset, true); offset += 4;
  view.setUint16(offset, 0, true);
  return new Blob([output], { type: "application/zip" });
}

export async function readStoredZip(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (flags & 0x0008) throw new Error("zip data descriptors are not supported");
    if (method !== 0) throw new Error("only stored ZIP entries are supported");
    if (dataEnd > bytes.length) throw new Error("invalid ZIP entry length");
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    const data = bytes.slice(dataStart, dataEnd);
    if (data.length !== uncompressedSize) throw new Error(`invalid ZIP size for ${name}`);
    entries.push({ name, data });
    offset = dataEnd;
  }
  return entries;
}

export function readJsonEntry<T>(entries: ZipEntry[], name: string) {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`missing ${name}`);
  return JSON.parse(decoder.decode(entry.data)) as T;
}
