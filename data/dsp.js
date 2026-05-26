(function () {
  "use strict";

  const STORE_KEY = "ep133.offlineDsp";
  const SYNTHETIC_DROP = "__ep133DspSyntheticDrop";
  const DEFAULTS = {
    enabled: true,
    normalize: true,
    reverseCopy: false,
    pingPongCopy: false,
    gainDb: 0,
    normalizeTargetDb: -0.3,
    trimSilence: false,
    trimThresholdDb: -55,
    fadeInMs: 0,
    fadeOutMs: 0,
    mono: false,
    lowCutHz: "",
    highCutHz: "",
    targetSampleRate: 46875,
    sourceBpm: "",
    targetBpm: "",
    autoTag: true,
  };

  const state = {
    settings: loadSettings(),
    processing: false,
    panel: null,
    status: null,
  };

  function loadSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.settings));
  }

  function setStatus(message) {
    if (state.status) state.status.textContent = message || "";
  }

  function isAudioFile(file) {
    return file && (file.type.startsWith("audio/") || /\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i.test(file.name));
  }

  function shouldProcess(files) {
    return state.settings.enabled && !state.processing && files.some(isAudioFile);
  }

  function dbToGain(db) {
    return Math.pow(10, Number(db || 0) / 20);
  }

  function dbToLinear(db) {
    return Math.pow(10, Number(db) / 20);
  }

  function clampSample(value) {
    return Math.max(-1, Math.min(1, value));
  }

  function taggedName(name) {
    if (!state.settings.autoTag) return name;
    const lower = name.toLowerCase();
    const rules = [
      ["kick", /\b(kick|bd|bassdrum|808)\b/],
      ["snare", /\b(snare|snr|sd|clap)\b/],
      ["cymb", /\b(hat|hh|cym|ride|crash)\b/],
      ["perc", /\b(perc|tom|rim|clave|conga|bongo)\b/],
      ["bass", /\b(bass|sub)\b/],
      ["loop", /\b(loop|break|drumloop|groove)\b/],
      ["sfx", /\b(fx|sfx|impact|riser|noise)\b/],
    ];
    const hit = rules.find(([, pattern]) => pattern.test(lower));
    return hit && !lower.startsWith(hit[0] + "_") ? `${hit[0]}_${name}` : name;
  }

  function splitName(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ".wav"];
  }

  async function decodeAudio(file) {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    try {
      return await context.decodeAudioData(await file.arrayBuffer());
    } finally {
      if (context.close) await context.close();
    }
  }

  async function conformBpm(buffer) {
    const source = Number(state.settings.sourceBpm);
    const target = Number(state.settings.targetBpm);
    if (!source || !target || source <= 0 || target <= 0 || source === target) return buffer;

    const ratio = source / target;
    const length = Math.max(1, Math.round(buffer.length * ratio));
    const offline = new OfflineAudioContext(buffer.numberOfChannels, length, buffer.sampleRate);
    const node = offline.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = target / source;
    node.connect(offline.destination);
    node.start(0);
    return await offline.startRendering();
  }

  async function renderAtTargetRate(buffer) {
    const targetRate = Number(state.settings.targetSampleRate);
    if (!targetRate || targetRate === buffer.sampleRate) return buffer;
    const length = Math.max(1, Math.round(buffer.duration * targetRate));
    const offline = new OfflineAudioContext(buffer.numberOfChannels, length, targetRate);
    const node = offline.createBufferSource();
    node.buffer = buffer;
    node.connect(offline.destination);
    node.start(0);
    return await offline.startRendering();
  }

  async function applyFilters(buffer) {
    const lowCut = Number(state.settings.lowCutHz);
    const highCut = Number(state.settings.highCutHz);
    const useLowCut = lowCut > 0;
    const useHighCut = highCut > 0 && highCut < buffer.sampleRate / 2;
    if (!useLowCut && !useHighCut) return buffer;

    const offline = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    let tail = source;

    if (useLowCut) {
      const filter = offline.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = lowCut;
      filter.Q.value = 0.707;
      tail.connect(filter);
      tail = filter;
    }

    if (useHighCut) {
      const filter = offline.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = highCut;
      filter.Q.value = 0.707;
      tail.connect(filter);
      tail = filter;
    }

    tail.connect(offline.destination);
    source.start(0);
    return await offline.startRendering();
  }

  async function prepareBuffer(file) {
    const decoded = await decodeAudio(file);
    const stretched = await conformBpm(decoded);
    const resampled = await renderAtTargetRate(stretched);
    return await applyFilters(resampled);
  }

  function trimRange(buffer) {
    if (!state.settings.trimSilence) return [0, buffer.length];
    const threshold = dbToLinear(state.settings.trimThresholdDb || -55);
    let start = 0;
    let end = buffer.length - 1;

    startSearch:
    for (; start < buffer.length; start++) {
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        if (Math.abs(buffer.getChannelData(ch)[start]) >= threshold) break startSearch;
      }
    }

    endSearch:
    for (; end > start; end--) {
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        if (Math.abs(buffer.getChannelData(ch)[end]) >= threshold) break endSearch;
      }
    }

    return [start, Math.min(buffer.length, end + 1)];
  }

  function getSourceChannels(buffer, start, end) {
    const length = Math.max(1, end - start);
    if (!state.settings.mono || buffer.numberOfChannels === 1) {
      return Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch).slice(start, end));
    }

    const mono = new Float32Array(length);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const source = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) mono[i] += source[start + i] / buffer.numberOfChannels;
    }
    return [mono];
  }

  function renderBuffer(buffer, mode) {
    const channels = [];
    const [start, end] = trimRange(buffer);
    const sourceChannels = getSourceChannels(buffer, start, end);
    const multiplier = mode === "pingpong" ? 2 : 1;
    let peak = 0;

    for (const source of sourceChannels) {
      const output = new Float32Array(source.length * multiplier);
      if (mode === "reverse") {
        for (let i = 0; i < source.length; i++) output[i] = source[source.length - 1 - i];
      } else if (mode === "pingpong") {
        output.set(source, 0);
        for (let i = 0; i < source.length; i++) output[source.length + i] = source[source.length - 1 - i];
      } else {
        output.set(source, 0);
      }
      for (let i = 0; i < output.length; i++) peak = Math.max(peak, Math.abs(output[i]));
      channels.push(output);
    }

    const gain = dbToGain(state.settings.gainDb);
    const normalizeTarget = dbToGain(state.settings.normalizeTargetDb);
    const normalizeGain = state.settings.normalize && peak > 0 ? normalizeTarget / peak : 1;
    const finalGain = gain * normalizeGain;
    const fadeIn = Math.max(0, Math.round((Number(state.settings.fadeInMs) / 1000) * buffer.sampleRate));
    const fadeOut = Math.max(0, Math.round((Number(state.settings.fadeOutMs) / 1000) * buffer.sampleRate));
    channels.forEach((channel) => {
      for (let i = 0; i < channel.length; i++) {
        const inGain = fadeIn > 0 && i < fadeIn ? i / fadeIn : 1;
        const outGain = fadeOut > 0 && i >= channel.length - fadeOut ? (channel.length - i - 1) / fadeOut : 1;
        channel[i] = clampSample(channel[i] * finalGain * Math.min(inGain, outGain));
      }
    });

    return encodeWav(channels, buffer.sampleRate);
  }

  function encodeWav(channels, sampleRate) {
    const channelCount = channels.length;
    const frameCount = channels[0].length;
    const dataSize = frameCount * channelCount * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let offset = 0;

    function text(value) {
      for (let i = 0; i < value.length; i++) view.setUint8(offset++, value.charCodeAt(i));
    }

    text("RIFF");
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    text("WAVE");
    text("fmt ");
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, channelCount, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * channelCount * 2, true); offset += 4;
    view.setUint16(offset, channelCount * 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    text("data");
    view.setUint32(offset, dataSize, true); offset += 4;

    for (let i = 0; i < frameCount; i++) {
      for (let ch = 0; ch < channelCount; ch++) {
        const sample = clampSample(channels[ch][i]);
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  async function processAudioFile(file) {
    const buffer = await prepareBuffer(file);
    const [base] = splitName(taggedName(file.name));
    const output = [
      new File([renderBuffer(buffer, "normal")], `${base}.wav`, { type: "audio/wav" }),
    ];
    if (state.settings.reverseCopy) {
      output.push(new File([renderBuffer(buffer, "reverse")], `${base}_rev.wav`, { type: "audio/wav" }));
    }
    if (state.settings.pingPongCopy) {
      output.push(new File([renderBuffer(buffer, "pingpong")], `${base}_pingpong.wav`, { type: "audio/wav" }));
    }
    return output;
  }

  async function processFiles(files) {
    const output = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      setStatus(`processing ${index + 1}/${files.length}: ${file.name}`);
      if (isAudioFile(file)) output.push(...await processAudioFile(file));
      else output.push(file);
    }
    return output;
  }

  function replayDrop(originalEvent, files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    const event = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    });
    Object.defineProperty(event, SYNTHETIC_DROP, { value: true });
    originalEvent.target.dispatchEvent(event);
  }

  async function onDrop(event) {
    if (event[SYNTHETIC_DROP]) return;
    if (event.target && event.target.closest && event.target.closest("#ep133-kit-inspector")) return;
    const files = Array.from(event.dataTransfer ? event.dataTransfer.files : []);
    if (!shouldProcess(files)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    state.processing = true;

    try {
      const processed = await processFiles(files);
      setStatus(`ready: ${processed.length} file${processed.length === 1 ? "" : "s"}`);
      replayDrop(event, processed);
    } catch (error) {
      console.error("EP-133 DSP processing failed", error);
      setStatus(error instanceof Error ? error.message : "DSP failed");
    } finally {
      state.processing = false;
      setTimeout(() => setStatus(""), 3000);
    }
  }

  function control(label, key, type, attrs) {
    const row = document.createElement("label");
    row.className = "ep133-dsp-row";
    row.append(document.createTextNode(label));
    const input = document.createElement("input");
    input.type = type;
    Object.entries(attrs || {}).forEach(([name, value]) => input.setAttribute(name, value));
    if (type === "checkbox") input.checked = !!state.settings[key];
    else input.value = state.settings[key];
    input.addEventListener("change", () => {
      state.settings[key] = type === "checkbox" ? input.checked : input.value;
      saveSettings();
    });
    row.append(input);
    return row;
  }

  function group(title, controls) {
    const fieldset = document.createElement("section");
    fieldset.className = "ep133-dsp-group";
    const heading = document.createElement("div");
    heading.className = "ep133-dsp-group-title";
    heading.textContent = title;
    fieldset.append(heading, ...controls);
    return fieldset;
  }

  function buildPanel() {
    const panel = document.createElement("section");
    panel.id = "ep133-dsp-panel";
    panel.className = "ep133-utility-drawer open";
    panel.innerHTML = "<header><span>DSP</span><button type=\"button\">close</button></header>";
    const body = document.createElement("div");
    body.id = "ep133-dsp-body";
    body.append(
      group("transfer", [
        control("DSP on drop", "enabled", "checkbox"),
        control("Auto-tag names", "autoTag", "checkbox"),
        control("Output Hz", "targetSampleRate", "number", { min: "8000", max: "96000", step: "1" }),
      ]),
      group("level", [
        control("Normalize peak", "normalize", "checkbox"),
        control("Peak dBFS", "normalizeTargetDb", "number", { min: "-12", max: "0", step: "0.1" }),
        control("Gain trim dB", "gainDb", "number", { min: "-24", max: "24", step: "0.5" }),
      ]),
      group("edit", [
        control("Trim silence", "trimSilence", "checkbox"),
        control("Trim dBFS", "trimThresholdDb", "number", { min: "-90", max: "-12", step: "1" }),
        control("Fade in ms", "fadeInMs", "number", { min: "0", max: "5000", step: "1" }),
        control("Fade out ms", "fadeOutMs", "number", { min: "0", max: "5000", step: "1" }),
        control("Mono mix", "mono", "checkbox"),
      ]),
      group("tone/time", [
        control("Low cut Hz", "lowCutHz", "number", { min: "0", max: "12000", step: "1", placeholder: "off" }),
        control("High cut Hz", "highCutHz", "number", { min: "0", max: "22000", step: "1", placeholder: "off" }),
        control("Source BPM", "sourceBpm", "number", { min: "40", max: "300", step: "1", placeholder: "off" }),
        control("Target BPM", "targetBpm", "number", { min: "40", max: "300", step: "1", placeholder: "off" }),
      ]),
      group("variants", [
        control("Reverse copy", "reverseCopy", "checkbox"),
        control("Ping-pong copy", "pingPongCopy", "checkbox"),
      ])
    );
    state.status = document.createElement("div");
    state.status.id = "ep133-dsp-status";
    body.append(state.status);
    panel.append(body);
    panel.querySelector("button").addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      panel.classList.toggle("open", !panel.classList.contains("collapsed"));
      panel.querySelector("button").textContent = panel.classList.contains("collapsed") ? "open" : "close";
    });
    document.body.append(panel);
    state.panel = panel;
  }

  window.addEventListener("drop", onDrop, true);
  window.addEventListener("DOMContentLoaded", buildPanel);
  window.ep133OfflineDsp = {
    settings: state.settings,
    processFiles,
  };
})();
