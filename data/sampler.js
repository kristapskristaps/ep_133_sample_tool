(function () {
  "use strict";

  const state = {
    panel: null,
    status: null,
    canvas: null,
    source: "system",
    mediaStream: null,
    displayStream: null,
    recorder: null,
    chunks: [],
    audioBuffer: null,
    markers: [],
    playing: null,
    startedAt: 0,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(message) {
    if (state.status) state.status.textContent = message || "";
  }

  function setActiveSource(source) {
    state.source = source;
    document.querySelectorAll("[data-sampler-source]").forEach((button) => {
      button.classList.toggle("active", button.dataset.samplerSource === source);
    });
  }

  function stopStream() {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => track.stop());
      state.mediaStream = null;
    }
    if (state.displayStream) {
      state.displayStream.getTracks().forEach((track) => track.stop());
      state.displayStream = null;
    }
  }

  async function getCaptureStream() {
    if (state.source === "mic") {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("no system/tab audio track selected");
    }
    state.displayStream = stream;
    return new MediaStream(stream.getAudioTracks());
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setStatus("recording is not supported in this browser");
      return;
    }
    if (state.recorder && state.recorder.state === "recording") return;
    state.chunks = [];
    stopPlayback();
    try {
      state.mediaStream = await getCaptureStream();
      state.recorder = new MediaRecorder(state.mediaStream);
      state.recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) state.chunks.push(event.data);
      });
      state.recorder.addEventListener("stop", finishRecording);
      state.recorder.start();
      setStatus(state.source === "mic" ? "recording microphone" : "recording shared audio");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "recording failed");
      stopStream();
    }
  }

  function stopRecording() {
    if (state.recorder && state.recorder.state === "recording") {
      state.recorder.stop();
    }
  }

  async function finishRecording() {
    stopStream();
    if (!state.chunks.length) {
      setStatus("nothing recorded");
      return;
    }
    const blob = new Blob(state.chunks, { type: state.recorder.mimeType || "audio/webm" });
    await loadBlob(blob);
    setStatus(`captured ${formatTime(state.audioBuffer.duration)}`);
  }

  async function loadBlob(blob) {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    try {
      state.audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
      state.markers = [];
      drawWaveform();
    } finally {
      if (context.close) await context.close();
    }
  }

  async function loadFile(file) {
    if (!file) return;
    await loadBlob(file);
    setStatus(`loaded ${file.name}`);
  }

  function formatTime(seconds) {
    return `${seconds.toFixed(2)}s`;
  }

  function drawWaveform() {
    const canvas = state.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = getCss("--ep-display", "#000005");
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!state.audioBuffer) {
      ctx.fillStyle = getCss("--ep-display-sample-size", "#00a69c");
      ctx.fillText("record or load audio", 10, rect.height / 2);
      return;
    }

    const data = state.audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / rect.width));
    const mid = rect.height / 2;
    ctx.strokeStyle = getCss("--ep-display-sample-size", "#00a69c");
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < rect.width; x++) {
      let min = 1;
      let max = -1;
      const start = x * step;
      for (let i = 0; i < step && start + i < data.length; i++) {
        const value = data[start + i];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      ctx.moveTo(x, mid + min * mid * 0.9);
      ctx.lineTo(x, mid + max * mid * 0.9);
    }
    ctx.stroke();

    ctx.strokeStyle = getCss("--accent", "#f15a22");
    state.markers.forEach((marker) => {
      const x = marker * rect.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
    });
  }

  function getCss(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function addMarkerFromEvent(event) {
    if (!state.audioBuffer) return;
    const rect = state.canvas.getBoundingClientRect();
    const marker = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    if (marker <= 0.01 || marker >= 0.99) return;
    state.markers.push(marker);
    state.markers = [...new Set(state.markers.map((item) => Number(item.toFixed(4))))].sort((a, b) => a - b).slice(0, 11);
    drawWaveform();
    setStatus(`${state.markers.length + 1} chop${state.markers.length === 0 ? "" : "s"}`);
  }

  function clearMarkers() {
    state.markers = [];
    drawWaveform();
  }

  function equalChops(count) {
    if (!state.audioBuffer) return;
    state.markers = [];
    for (let index = 1; index < count; index++) state.markers.push(index / count);
    drawWaveform();
    setStatus(`${count} equal chops`);
  }

  function transientChops() {
    if (!state.audioBuffer) return;
    const data = state.audioBuffer.getChannelData(0);
    const sampleRate = state.audioBuffer.sampleRate;
    const windowSize = Math.max(128, Math.floor(sampleRate * 0.012));
    const energies = [];
    for (let pos = 0; pos < data.length; pos += windowSize) {
      let sum = 0;
      for (let i = 0; i < windowSize && pos + i < data.length; i++) sum += Math.abs(data[pos + i]);
      energies.push(sum / windowSize);
    }
    const average = energies.reduce((sum, value) => sum + value, 0) / Math.max(1, energies.length);
    const markers = [];
    let cooldown = 0;
    for (let index = 1; index < energies.length - 1; index++) {
      const rising = energies[index] > energies[index - 1] * 1.8 && energies[index] > average * 1.4;
      if (cooldown <= 0 && rising) {
        const marker = (index * windowSize) / data.length;
        if (marker > 0.02 && marker < 0.98) markers.push(marker);
        cooldown = Math.floor(sampleRate * 0.12 / windowSize);
      }
      cooldown--;
    }
    state.markers = markers.slice(0, 11);
    drawWaveform();
    setStatus(`${state.markers.length + 1} transient chops`);
  }

  async function playFull() {
    if (!state.audioBuffer) return;
    stopPlayback();
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const source = context.createBufferSource();
    source.buffer = state.audioBuffer;
    source.connect(context.destination);
    source.addEventListener("ended", () => {
      if (state.playing && state.playing.source === source) {
        context.close();
        state.playing = null;
      }
    });
    source.start();
    state.playing = { source, context };
  }

  function stopPlayback() {
    if (!state.playing) return;
    try {
      state.playing.source.stop();
    } catch {}
    if (state.playing.context.close) state.playing.context.close();
    state.playing = null;
  }

  function renderSlice(startFrame, endFrame, name) {
    const channelCount = state.audioBuffer.numberOfChannels;
    const length = Math.max(1, endFrame - startFrame);
    const channels = [];
    for (let ch = 0; ch < channelCount; ch++) {
      channels.push(state.audioBuffer.getChannelData(ch).slice(startFrame, endFrame));
    }
    return new File([encodeWav(channels, state.audioBuffer.sampleRate)], name, { type: "audio/wav" });
  }

  function renderChops() {
    if (!state.audioBuffer) return [];
    const points = [0, ...state.markers, 1].sort((a, b) => a - b);
    const files = [];
    for (let index = 0; index < points.length - 1; index++) {
      const start = Math.floor(points[index] * state.audioBuffer.length);
      const end = Math.floor(points[index + 1] * state.audioBuffer.length);
      if (end - start > state.audioBuffer.sampleRate * 0.015) {
        files.push(renderSlice(start, end, `sample_chop_${String(index + 1).padStart(2, "0")}.wav`));
      }
    }
    return files.slice(0, 12);
  }

  function encodeWav(channels, sampleRate) {
    const channelCount = channels.length;
    const frameCount = channels[0].length;
    const dataSize = frameCount * channelCount * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let offset = 0;
    const text = (value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset++, value.charCodeAt(i));
    };
    text("RIFF");
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    text("WAVEfmt ");
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
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  async function assignChops() {
    const bridge = window.ep133KitBridge;
    if (!bridge || !bridge.uploadFilesToPads || !bridge.sortedPads) {
      setStatus("connect the kit bridge first");
      return;
    }
    const files = renderChops();
    if (!files.length) {
      setStatus("no chops to assign");
      return;
    }
    const startPad = Math.max(1, Math.min(12, Number(byId("ep133-sampler-start-pad").value || 1)));
    const pads = bridge.sortedPads().slice(startPad - 1, startPad - 1 + files.length);
    if (!pads.length) {
      setStatus("connect the device before assigning");
      return;
    }
    setStatus(`assigning ${Math.min(files.length, pads.length)} chop${files.length === 1 ? "" : "s"}`);
    await bridge.uploadFilesToPads(files.slice(0, pads.length), pads);
  }

  function buildPanel() {
    const panel = document.createElement("section");
    panel.id = "ep133-sampler";
    panel.innerHTML = `
      <div id="ep133-sampler-body">
        <div class="ep133-sampler-row">
          <button type="button" data-sampler-source="system" class="active">system</button>
          <button type="button" data-sampler-source="mic">mic</button>
          <button type="button" id="ep133-sampler-load">file</button>
          <input id="ep133-sampler-file" type="file" accept="audio/*">
        </div>
        <div class="ep133-sampler-row">
          <button type="button" id="ep133-sampler-rec">record</button>
          <button type="button" id="ep133-sampler-stop-rec">stop</button>
          <button type="button" id="ep133-sampler-play">play</button>
          <button type="button" id="ep133-sampler-stop-play">mute</button>
        </div>
        <canvas id="ep133-sampler-wave"></canvas>
        <div class="ep133-sampler-row">
          <button type="button" id="ep133-sampler-transient">transient</button>
          <button type="button" id="ep133-sampler-4">4</button>
          <button type="button" id="ep133-sampler-8">8</button>
          <button type="button" id="ep133-sampler-12">12</button>
          <button type="button" id="ep133-sampler-clear">clear</button>
        </div>
        <label class="ep133-sampler-field">
          <span>Start pad</span>
          <input id="ep133-sampler-start-pad" type="number" min="1" max="12" step="1" value="1">
        </label>
        <div class="ep133-sampler-row">
          <button type="button" id="ep133-sampler-assign">assign chops</button>
          <span id="ep133-sampler-status"></span>
        </div>
      </div>
    `;
    state.panel = panel;
    state.status = byId("ep133-sampler-status");
    state.canvas = byId("ep133-sampler-wave");
    drawWaveform();

    window.ep133Features.register({
      id: "sample",
      label: "Sample",
      panel,
      accent: "var(--ep-btn-shift, #b0babe)",
    });
    window.addEventListener("ep133-feature-tab", (event) => {
      if (event.detail && event.detail.id === "sample") requestAnimationFrame(drawWaveform);
    });
    document.querySelectorAll("[data-sampler-source]").forEach((button) => {
      button.addEventListener("click", () => setActiveSource(button.dataset.samplerSource));
    });
    byId("ep133-sampler-rec").addEventListener("click", startRecording);
    byId("ep133-sampler-stop-rec").addEventListener("click", stopRecording);
    byId("ep133-sampler-play").addEventListener("click", playFull);
    byId("ep133-sampler-stop-play").addEventListener("click", stopPlayback);
    byId("ep133-sampler-load").addEventListener("click", () => byId("ep133-sampler-file").click());
    byId("ep133-sampler-file").addEventListener("change", (event) => loadFile(event.target.files && event.target.files[0]));
    byId("ep133-sampler-wave").addEventListener("click", addMarkerFromEvent);
    byId("ep133-sampler-transient").addEventListener("click", transientChops);
    byId("ep133-sampler-4").addEventListener("click", () => equalChops(4));
    byId("ep133-sampler-8").addEventListener("click", () => equalChops(8));
    byId("ep133-sampler-12").addEventListener("click", () => equalChops(12));
    byId("ep133-sampler-clear").addEventListener("click", clearMarkers);
    byId("ep133-sampler-assign").addEventListener("click", assignChops);
    window.addEventListener("resize", drawWaveform);
  }

  window.addEventListener("DOMContentLoaded", buildPanel);
})();
