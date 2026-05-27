export type NativeMidiDevice = {
  deviceId?: number;
  inputId?: string;
  outputId?: string;
  inputName?: string;
  outputName?: string;
  model?: string;
  storageBytes?: number;
  sku?: string;
};

export type NativeMidiScan = {
  access: MIDIAccess;
  inputs: MIDIInput[];
  outputs: MIDIOutput[];
  devices: NativeMidiDevice[];
  status: string;
};

const TE_MIDI_ID = [0, 32, 118];
const MB = 1024 * 1024;

function formatSku(data: Uint8Array) {
  const product = data[8] ^ (data[9] << 7);
  const variant = data[10] ^ (data[11] << 7);
  return `TE${String(product).padStart(3, "0")}AS${String(variant).padStart(3, "0")}`;
}

function parseIdentityResponse(data: Uint8Array) {
  if (data.length !== 17) return null;
  const universal = data[0] === 0xf0 && data[1] === 0x7e;
  const teenage = data[5] === TE_MIDI_ID[0] && data[6] === TE_MIDI_ID[1] && data[7] === TE_MIDI_ID[2];
  if (!universal || !teenage) return null;
  return { deviceId: data[2], sku: formatSku(data) };
}

function normalizedPortName(name?: string | null) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function likelyEpPort(name?: string | null) {
  return /EP|KO|K\.O|teenage|engineering/i.test(name || "");
}

function inferModel(...values: Array<string | undefined>) {
  const text = values.filter(Boolean).join(" ").toUpperCase();
  if (text.includes("EP-40") || text.includes("EP40")) return "EP-40";
  if (text.includes("EP-1320") || text.includes("EP1320")) return "EP-1320";
  if (text.includes("EP-133") || text.includes("EP133") || text.includes("KO II") || text.includes("K.O. II")) return "EP-133";
  return "";
}

function storageBytesForModel(model: string) {
  if (model === "EP-40" || model === "EP-1320") return 128 * MB;
  return 64 * MB;
}

function pairByName(inputs: MIDIInput[], outputs: MIDIOutput[], identities: Map<string, { deviceId: number; sku: string }>) {
  const devices: NativeMidiDevice[] = [];
  const usedOutputs = new Set<string>();

  for (const input of inputs) {
    const inputKey = normalizedPortName(input.name);
    const output = outputs.find((candidate) => {
      if (usedOutputs.has(candidate.id)) return false;
      return normalizedPortName(candidate.name) === inputKey || likelyEpPort(candidate.name);
    });
    if (output) usedOutputs.add(output.id);
    if (likelyEpPort(input.name) || likelyEpPort(output?.name) || identities.has(input.id)) {
      const identity = identities.get(input.id);
      const model = inferModel(input.name || undefined, output?.name || undefined, identity?.sku);
      devices.push({
        inputId: input.id,
        outputId: output?.id,
        inputName: input.name || undefined,
        outputName: output?.name || undefined,
        deviceId: identity?.deviceId,
        model,
        storageBytes: storageBytesForModel(model),
        sku: identity?.sku,
      });
    }
  }

  for (const output of outputs) {
    if (usedOutputs.has(output.id) || !likelyEpPort(output.name)) continue;
    const model = inferModel(output.name || undefined);
    devices.push({ outputId: output.id, outputName: output.name || undefined, model, storageBytes: storageBytesForModel(model) });
  }

  return devices;
}

export async function scanNativeMidi(): Promise<NativeMidiScan> {
  if (!navigator.requestMIDIAccess) throw new Error("Web MIDI is not available in this runtime");
  const access = await navigator.requestMIDIAccess({ sysex: true });
  const inputs = Array.from(access.inputs.values());
  const outputs = Array.from(access.outputs.values());
  const identities = new Map<string, { deviceId: number; sku: string }>();
  const previousHandlers = new Map<string, ((event: MIDIMessageEvent) => void) | null>();

  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 450);
    inputs.forEach((input) => {
      previousHandlers.set(input.id, input.onmidimessage);
      input.onmidimessage = (event) => {
        if (!event.data) return;
        const identity = parseIdentityResponse(event.data);
        if (identity) {
          identities.set(input.id, identity);
          window.clearTimeout(timer);
          resolve();
        }
        previousHandlers.get(input.id)?.(event);
      };
    });
    outputs.forEach((output) => output.send([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]));
  }).finally(() => {
    inputs.forEach((input) => {
      input.onmidimessage = previousHandlers.get(input.id) || null;
    });
  });

  const devices = pairByName(inputs, outputs, identities);
  const count = `${inputs.length} input${inputs.length === 1 ? "" : "s"}, ${outputs.length} output${outputs.length === 1 ? "" : "s"}`;
  const names = devices.flatMap((device) => [device.inputName, device.outputName]).filter(Boolean);
  const status = names.length ? `Native MIDI found ${count}: ${[...new Set(names)].slice(0, 2).join(", ")}` : `Native MIDI found ${count}; no EP port matched`;
  return { access, inputs, outputs, devices, status };
}
