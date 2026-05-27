export type SampleSettings = {
  enabled: boolean;
  normalize: boolean;
  trim: boolean;
  mono: boolean;
  autoTag: boolean;
  reverse: boolean;
  pingPong: boolean;
  lowCut: boolean;
  highCut: boolean;
  lofi: boolean;
  lowCutHz: string;
  highCutHz: string;
  lofiSampleRate: string;
  lofiBitDepth: string;
  gainDb: string;
  trimThresholdDb: string;
  fadeInMs: string;
  fadeOutMs: string;
  targetSampleRate: string;
  targetDb: string;
  sourceBpm: string;
  targetBpm: string;
};

export const defaultSettings: SampleSettings = {
  enabled: true,
  normalize: true,
  trim: true,
  mono: false,
  autoTag: true,
  reverse: false,
  pingPong: false,
  lowCut: false,
  highCut: false,
  lofi: false,
  lowCutHz: "35",
  highCutHz: "16000",
  lofiSampleRate: "22050",
  lofiBitDepth: "12",
  gainDb: "0",
  trimThresholdDb: "-55",
  fadeInMs: "0",
  fadeOutMs: "0",
  targetSampleRate: "46875",
  targetDb: "-0.3",
  sourceBpm: "",
  targetBpm: "",
};

export function syncOfflineDspSettings(settings: SampleSettings) {
  const payload = {
    enabled: settings.enabled,
    autoTag: settings.autoTag,
    normalize: settings.normalize,
    reverseCopy: settings.reverse,
    pingPongCopy: settings.pingPong,
    normalizeTargetDb: Number(settings.targetDb) || -0.3,
    gainDb: Number(settings.gainDb) || 0,
    trimSilence: settings.trim,
    trimThresholdDb: Number(settings.trimThresholdDb) || -55,
    fadeInMs: Number(settings.fadeInMs) || 0,
    fadeOutMs: Number(settings.fadeOutMs) || 0,
    mono: settings.mono,
    lowCutHz: settings.lowCut ? Number(settings.lowCutHz) || 35 : "",
    highCutHz: settings.highCut ? Number(settings.highCutHz) || 16000 : "",
    lofi: settings.lofi,
    lofiSampleRate: settings.lofi ? Number(settings.lofiSampleRate) || 22050 : "",
    lofiBitDepth: settings.lofi ? Number(settings.lofiBitDepth) || 12 : "",
    targetSampleRate: Number(settings.targetSampleRate) || 46875,
    sourceBpm: settings.sourceBpm,
    targetBpm: settings.targetBpm,
  };
  const current = window.ep133OfflineDsp?.settings || {};
  const next = { ...current, ...payload };
  if (window.ep133OfflineDsp?.setSettings) window.ep133OfflineDsp.setSettings(next);
  else if (window.ep133OfflineDsp) window.ep133OfflineDsp.settings = next;
  localStorage.setItem("ep133.offlineDsp", JSON.stringify(next));
}

export function loadInitialSampleSettings(): SampleSettings {
  try {
    const stored = JSON.parse(localStorage.getItem("ep133.offlineDsp") || "{}") as Record<string, unknown>;
    return {
      ...defaultSettings,
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : defaultSettings.enabled,
      normalize: typeof stored.normalize === "boolean" ? stored.normalize : defaultSettings.normalize,
      trim: typeof stored.trimSilence === "boolean" ? stored.trimSilence : defaultSettings.trim,
      mono: typeof stored.mono === "boolean" ? stored.mono : defaultSettings.mono,
      autoTag: typeof stored.autoTag === "boolean" ? stored.autoTag : defaultSettings.autoTag,
      reverse: typeof stored.reverseCopy === "boolean" ? stored.reverseCopy : defaultSettings.reverse,
      pingPong: typeof stored.pingPongCopy === "boolean" ? stored.pingPongCopy : defaultSettings.pingPong,
      lowCut: Number(stored.lowCutHz) > 0,
      highCut: Number(stored.highCutHz) > 0,
      lofi: typeof stored.lofi === "boolean" ? stored.lofi : defaultSettings.lofi,
      lowCutHz: stored.lowCutHz ? String(stored.lowCutHz) : defaultSettings.lowCutHz,
      highCutHz: stored.highCutHz ? String(stored.highCutHz) : defaultSettings.highCutHz,
      lofiSampleRate: stored.lofiSampleRate != null ? String(stored.lofiSampleRate) : defaultSettings.lofiSampleRate,
      lofiBitDepth: stored.lofiBitDepth != null ? String(stored.lofiBitDepth) : defaultSettings.lofiBitDepth,
      gainDb: stored.gainDb != null ? String(stored.gainDb) : defaultSettings.gainDb,
      trimThresholdDb: stored.trimThresholdDb != null ? String(stored.trimThresholdDb) : defaultSettings.trimThresholdDb,
      fadeInMs: stored.fadeInMs != null ? String(stored.fadeInMs) : defaultSettings.fadeInMs,
      fadeOutMs: stored.fadeOutMs != null ? String(stored.fadeOutMs) : defaultSettings.fadeOutMs,
      targetSampleRate: stored.targetSampleRate != null ? String(stored.targetSampleRate) : defaultSettings.targetSampleRate,
      targetDb: stored.normalizeTargetDb != null ? String(stored.normalizeTargetDb) : defaultSettings.targetDb,
      sourceBpm: stored.sourceBpm != null ? String(stored.sourceBpm) : defaultSettings.sourceBpm,
      targetBpm: stored.targetBpm != null ? String(stored.targetBpm) : defaultSettings.targetBpm,
    };
  } catch {
    return defaultSettings;
  }
}

export async function processTransferFiles(files: File[]) {
  const dsp = window.ep133OfflineDsp;
  if (!dsp?.settings?.enabled || !dsp.processFiles) return files;
  return dsp.processFiles(files);
}
