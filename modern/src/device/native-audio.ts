const DEVICE_SAMPLE_RATE = 46875;
const DEVICE_AUDIO_FORMAT = "s16";
const MAX_SAMPLE_SECONDS = 20;

type NativeAudioOptions = {
  sampleRate: number;
  bitDepth: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function loadNativeAudioOptions(): NativeAudioOptions {
  try {
    const settings = JSON.parse(localStorage.getItem("ep133.offlineDsp") || "{}") as Record<string, unknown>;
    const lofi = Boolean(settings.lofi);
    return {
      sampleRate: lofi ? clamp(Number(settings.lofiSampleRate) || 22050, 3000, DEVICE_SAMPLE_RATE) : DEVICE_SAMPLE_RATE,
      bitDepth: lofi ? clamp(Number(settings.lofiBitDepth) || 12, 4, 16) : 16,
    };
  } catch {
    return { sampleRate: DEVICE_SAMPLE_RATE, bitDepth: 16 };
  }
}

function cleanName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9 _.-]+/gi, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 54) || "sample";
}

function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (let index = 0; index < bytes.length; index++) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

async function decode(file: File) {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close();
  }
}

async function renderAtSampleRate(buffer: AudioBuffer, sampleRate: number) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const length = Math.max(1, Math.round(buffer.duration * sampleRate));
  const offline = new OfflineAudioContext(channels, length, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

function bitCrush(sample: number, bitDepth: number) {
  if (bitDepth >= 16) return sample;
  const steps = 2 ** bitDepth;
  return Math.round(((sample + 1) / 2) * (steps - 1)) / (steps - 1) * 2 - 1;
}

function encodeS16Pcm(buffer: AudioBuffer, bitDepth: number) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const bytes = new Uint8Array(buffer.length * channels * 2);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (let frame = 0; frame < buffer.length; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = bitCrush(Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame])), bitDepth);
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += 2;
    }
  }
  return { bytes, channels };
}

export async function prepareNativeSoundFile(file: File) {
  const decoded = await decode(file);
  if (decoded.duration > MAX_SAMPLE_SECONDS) throw new Error("max sample length is 20 seconds");
  if (decoded.sampleRate < 3000 || decoded.sampleRate > 768000) throw new Error("invalid sample rate");
  const options = loadNativeAudioOptions();
  const rendered = await renderAtSampleRate(decoded, options.sampleRate);
  const { bytes, channels } = encodeS16Pcm(rendered, options.bitDepth);
  const name = cleanName(file.name);
  return {
    name,
    bytes,
    metadata: {
      name,
      channels,
      samplerate: options.sampleRate,
      format: DEVICE_AUDIO_FORMAT,
      crc: crc32(bytes),
    },
  };
}

export function createWavFromNativePcm(
  chunks: Uint8Array[],
  metadata: { channels?: unknown; samplerate?: unknown; name?: unknown },
) {
  const dataSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const channels = Number(metadata.channels) || 1;
  const sampleRate = Number(metadata.samplerate) || DEVICE_SAMPLE_RATE;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const text = (value: string) => {
    for (let index = 0; index < value.length; index++) bytes[offset++] = value.charCodeAt(index);
  };
  text("RIFF");
  view.setUint32(offset, 36 + dataSize, true); offset += 4;
  text("WAVE");
  text("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, channels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  text("data");
  view.setUint32(offset, dataSize, true); offset += 4;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new File([bytes], `${String(metadata.name || "sample")}.wav`, { type: "audio/wav" });
}
