const MIDI_SYSEX_START = 0xf0;
const MIDI_SYSEX_END = 0xf7;
const TE_MIDI_ID = [0x00, 0x20, 0x76];
const MIDI_SYSEX_TE = 0x40;
const BIT_IS_REQUEST = 0x40;
const BIT_REQUEST_ID_AVAILABLE = 0x20;

export const TE_SYSEX_STATUS = {
  OK: 0,
  ERROR: 1,
  COMMAND_NOT_FOUND: 2,
  BAD_REQUEST: 3,
  SPECIFIC_ERROR_START: 16,
  SPECIFIC_SUCCESS_START: 64,
} as const;

export type TeSysexMessage = {
  identityCode: number;
  requestId: number;
  hasRequestId: boolean;
  status: number;
  command: number;
  type: "request" | "response";
  data: Uint8Array;
};

export class TeSysexError extends Error {
  constructor(public messageData: TeSysexMessage) {
    super(`TE Sysex command ${messageData.command} failed with status ${messageData.status}`);
    this.name = "TeSysexError";
  }
}

export class TeSysexTimeoutError extends Error {
  constructor(requestId: number, timeoutMs: number) {
    super(`Timed out waiting for TE Sysex response ${requestId} after ${timeoutMs}ms`);
    this.name = "TeSysexTimeoutError";
  }
}

function packedLength(length: number) {
  return length > 0 ? length + Math.ceil(length / 7) : 0;
}

export function pack7Bit(data: Uint8Array, output: Uint8Array) {
  let write = 1;
  let header = 0;
  for (let index = 0; index < data.length; index++) {
    const bit = index % 7;
    output[header] |= (data[index] >> 7) << bit;
    output[write++] = data[index] & 0x7f;
    if (bit === 6 && index < data.length - 1) {
      header += 8;
      write++;
    }
  }
}

export function unpack7Bit(data: Uint8Array) {
  let read = 0;
  let write = 0;
  let bit = 0;
  let header = data[read];
  const output = new Uint8Array(data.length);
  for (let cursor = 1; cursor < data.length;) {
    output[write++] = ((header & (1 << bit) ? 1 : 0) << 7) | (data[cursor] & 0x7f);
    bit++;
    cursor++;
    if (bit > 6) {
      cursor++;
      bit = 0;
      read += 8;
      header = data[read];
    }
  }
  return output.subarray(0, write);
}

export function buildTeSysex(deviceId: number, requestId: number, command: number, payload = new Uint8Array()) {
  const packedPayloadLength = packedLength(payload.length);
  const message = new Uint8Array(10 + packedPayloadLength);
  message[0] = MIDI_SYSEX_START;
  message[1] = TE_MIDI_ID[0];
  message[2] = TE_MIDI_ID[1];
  message[3] = TE_MIDI_ID[2];
  message[4] = deviceId & 0x7f;
  message[5] = MIDI_SYSEX_TE;
  message[6] = BIT_IS_REQUEST | BIT_REQUEST_ID_AVAILABLE | ((requestId >> 7) & 0x1f);
  message[7] = requestId & 0x7f;
  message[8] = command & 0x7f;
  message[message.length - 1] = MIDI_SYSEX_END;
  pack7Bit(payload, message.subarray(9, 9 + packedPayloadLength));
  return message;
}

export function parseTeSysex(data: Uint8Array): TeSysexMessage | null {
  if (
    data.length < 9 ||
    data[0] !== MIDI_SYSEX_START ||
    data[1] !== TE_MIDI_ID[0] ||
    data[2] !== TE_MIDI_ID[1] ||
    data[3] !== TE_MIDI_ID[2] ||
    data[5] !== MIDI_SYSEX_TE ||
    data[data.length - 1] !== MIDI_SYSEX_END
  ) {
    return null;
  }

  const hasRequestId = Boolean(data[6] & BIT_REQUEST_ID_AVAILABLE);
  const type = data[6] & BIT_IS_REQUEST ? "request" : "response";
  const requestId = hasRequestId ? ((data[6] & 0x1f) << 7) | (data[7] & 0x7f) : 0;
  let cursor = 9;
  const status = type === "response" ? data[cursor++] : -1;
  return {
    identityCode: data[4],
    requestId,
    hasRequestId,
    status,
    command: data[8],
    type,
    data: unpack7Bit(data.subarray(cursor, data.length - 1)),
  };
}

export class TeSysexClient {
  private nextRequestId = Math.floor(Math.random() * 4095);
  private pending = new Map<number, {
    resolve: (message: TeSysexMessage) => void;
    reject: (error: Error) => void;
    timer: number;
  }>();
  private previousHandler: ((event: MIDIMessageEvent) => void) | null = null;

  constructor(
    private input: MIDIInput,
    private output: MIDIOutput,
    private deviceId = 0x7f,
  ) {}

  open() {
    this.previousHandler = this.input.onmidimessage;
    this.input.onmidimessage = (event) => {
      if (event.data) this.handleMessage(event.data);
      this.previousHandler?.(event);
    };
  }

  close() {
    this.input.onmidimessage = this.previousHandler;
    this.previousHandler = null;
    this.pending.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("TE Sysex client closed"));
    });
    this.pending.clear();
  }

  send(command: number, payload = new Uint8Array(), timeoutMs = 20000) {
    this.nextRequestId = (this.nextRequestId + 1) % 4096;
    const requestId = this.nextRequestId;
    const message = buildTeSysex(this.deviceId, requestId, command, payload);
    this.output.send(message);
    return new Promise<TeSysexMessage>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new TeSysexTimeoutError(requestId, timeoutMs));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  private handleMessage(data: Uint8Array) {
    const message = parseTeSysex(data);
    if (!message?.hasRequestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.status < TE_SYSEX_STATUS.SPECIFIC_SUCCESS_START) {
      this.pending.delete(message.requestId);
      window.clearTimeout(pending.timer);
    }
    if (message.status === TE_SYSEX_STATUS.OK || message.status === TE_SYSEX_STATUS.SPECIFIC_SUCCESS_START) {
      pending.resolve(message);
    } else if (message.status < TE_SYSEX_STATUS.SPECIFIC_SUCCESS_START) {
      pending.reject(new TeSysexError(message));
    }
  }
}
