export type Pad = {
  number: string;
  name: string;
  type: string;
  size?: string;
  assignedPath?: string;
  raw?: unknown;
};

export type Sound = {
  id: number;
  name: string;
  path?: string;
  size?: string;
  usageProjects?: string[];
  meta?: {
    name?: string;
    channels?: number;
    samplerate?: number;
    format?: string;
  };
  raw?: unknown;
};

export type EngineBridge = {
  device?: {
    deviceService?: {
      device?: {
        name?: string;
        serial?: string;
        metadata?: {
          os_version?: string;
          used_storage_bytes?: number;
          free_storage_bytes?: number;
        };
      };
      playback?: (path: string, preview?: boolean) => Promise<void>;
      deleteSound?: (path: string) => Promise<void>;
      downloadSoundAsWav?: (path: string) => Promise<Blob>;
      getProjectPadMeta?: (project: string) => AsyncIterable<{ sym?: number } | null | undefined>;
    };
    activeProject?: { node?: { name?: string } };
    activeGroup?: { node?: { name?: string } };
    activePads?: Array<{
      node?: { name?: string };
      path?: string;
      assignedPath?: string;
      meta?: { sym?: number; name?: string };
    }>;
    currentPad?: unknown;
    isScanning?: boolean;
    deviceError?: string;
    deviceCount?: number;
    engineLocked?: boolean;
    requestMidi?: () => void;
    refresh?: () => Promise<void>;
    setProject?: (project: string) => Promise<void>;
    setGroup?: (group: string) => Promise<void>;
  };
  uploader?: {
    isUploading?: boolean;
    fileCollection?: Array<{ status?: string }>;
    sounds?: Array<{
      id?: number;
      path?: string;
      file?: { size?: number };
      meta?: Sound["meta"];
    }>;
    enqueueFiles?: (startId: number, files: File[]) => Error | undefined;
    findNextFreeSoundSlot?: (startId?: number) => number;
  };
  sortedPads?: () => unknown[];
  classifyFiles?: (files: File[]) => File[];
  uploadFilesToPads?: (files: File[], pads: unknown[]) => Promise<void>;
  getPadByNumber?: (number: string | number) => unknown | null;
  playPad?: (pad: unknown) => Promise<void>;
  clearPad?: (pad: unknown) => Promise<void>;
  downloadPad?: (pad: unknown) => Promise<void>;
  exportKitArchive?: () => Promise<void>;
  importKitArchive?: (file: File) => Promise<void>;
};

export type EngineState = {
  ready: boolean;
  connected: boolean;
  deviceName: string;
  target: string;
  memory: string;
  pads: Pad[];
  activeProject: string;
  activeGroup: string;
  uploading: boolean;
  status: string;
  sounds: Sound[];
  memoryUsedPercent: number;
};

export type DeviceActions = {
  connect: () => void | Promise<void>;
  refresh: () => void | Promise<void>;
  setProject: (project: string) => void | Promise<void>;
  setGroup: (group: string) => void | Promise<void>;
  uploadToPads: (files: File[], pads: Pad[]) => void | Promise<void>;
  uploadSamples: (files: File[]) => void | Promise<void>;
  playSound: (sound?: Sound) => void | Promise<void>;
  deleteSound: (sound?: Sound) => void | Promise<void>;
  downloadSound: (sound?: Sound) => void | Promise<void>;
  playPad: (pad?: Pad) => void | Promise<void>;
  clearPad: (pad?: Pad) => void | Promise<void>;
  downloadPad: (pad?: Pad) => void | Promise<void>;
  exportKit: () => void | Promise<void>;
  importKit: (file: File) => void | Promise<void>;
};

export type DeviceEngine = EngineState & DeviceActions;
