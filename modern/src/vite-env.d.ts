/// <reference types="vite/client" />

interface Window {
  ep133KitBridge?: unknown;
  ep133OfflineDsp?: {
    settings: Record<string, unknown>;
    processFiles?: (files: File[]) => Promise<File[]>;
  };
  __EP133_ENGINE_LOADED?: boolean;
  __EP133_ENGINE_ONLY?: boolean;
  __EP133_ENGINE_ROOT_ID?: string;
}
