(function () {
  "use strict";

  const PROJECTS = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
  const GROUPS = ["A", "B", "C", "D"];
  const PAD_ORDER = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const KIT_WORDS = [
    ["kick", 0, /\b(kick|bd|bassdrum|808)\b/i],
    ["snare", 1, /\b(snare|snr|sd)\b/i],
    ["clap", 2, /\b(clap)\b/i],
    ["hat", 3, /\b(hat|hh|closed)\b/i],
    ["open hat", 4, /\b(open|ohat|openhat)\b/i],
    ["ride", 5, /\b(ride)\b/i],
    ["crash", 6, /\b(crash|cym)\b/i],
    ["tom", 7, /\b(tom)\b/i],
    ["perc", 8, /\b(perc|rim|clave|conga|bongo)\b/i],
    ["bass", 9, /\b(bass|sub)\b/i],
    ["loop", 10, /\b(loop|break|groove)\b/i],
    ["fx", 11, /\b(fx|sfx|impact|riser|noise)\b/i],
  ];

  const bridge = {
    device: {},
    uploader: {},
    listeners: new Set(),
    setDeviceState(payload) {
      this.device = { ...this.device, ...payload };
      this.emit();
    },
    setUploaderState(payload) {
      this.uploader = { ...this.uploader, ...payload };
      this.emit();
    },
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    emit() {
      this.listeners.forEach((listener) => listener(this));
    },
  };

  window.ep133KitBridge = bridge;

  const ui = {
    panel: null,
    body: null,
    pads: null,
    status: null,
    drop: null,
    soundCache: new Map(),
    busy: false,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(message) {
    if (ui.status) ui.status.textContent = message || "";
  }

  function activeName(item) {
    return item && item.node ? item.node.name : "";
  }

  function shortPath(path) {
    return path ? path.split("/").pop() || path : "";
  }

  function safeName(value) {
    return String(value || "kit").replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "kit";
  }

  function padLabel(name) {
    const index = PAD_ORDER.indexOf(name);
    return index === -1 ? name : String(index + 1).padStart(2, "0");
  }

  function sortedPads() {
    const pads = bridge.device.activePads || [];
    return [...pads].sort((a, b) => PAD_ORDER.indexOf(a.node.name) - PAD_ORDER.indexOf(b.node.name));
  }

  function filterAudioFiles(files) {
    return files.filter((file) => file.type.startsWith("audio/") || /\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i.test(file.name));
  }

  async function filesFromEntry(entry) {
    if (!entry) return [];
    if (entry.isFile) {
      return await new Promise((resolve) => entry.file((file) => resolve([file]), () => resolve([])));
    }
    if (!entry.isDirectory) return [];
    const reader = entry.createReader();
    const entries = [];
    let batch = [];
    do {
      batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
      entries.push(...batch);
    } while (batch.length > 0);
    const nested = await Promise.all(entries.map(filesFromEntry));
    return nested.flat();
  }

  async function audioFilesFromEvent(event) {
    const items = Array.from(event.dataTransfer ? event.dataTransfer.items || [] : []);
    const entries = items.map((item) => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) {
      const files = (await Promise.all(entries.map(filesFromEntry))).flat();
      return filterAudioFiles(files);
    }
    return filterAudioFiles(Array.from(event.dataTransfer ? event.dataTransfer.files : []));
  }

  function classifyFiles(files) {
    const remaining = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const output = new Array(Math.min(12, remaining.length)).fill(null);

    for (const [, slot, pattern] of KIT_WORDS) {
      const index = remaining.findIndex((file) => pattern.test(file.name));
      if (index !== -1 && slot < output.length && output[slot] == null) {
        output[slot] = remaining.splice(index, 1)[0];
      }
    }

    for (let slot = 0; slot < output.length; slot++) {
      if (output[slot] == null) output[slot] = remaining.shift() || null;
    }

    return output.filter(Boolean);
  }

  async function getSoundName(path) {
    if (!path) return "";
    if (ui.soundCache.has(path)) return ui.soundCache.get(path);
    const service = bridge.device.deviceService;
    if (!service || !service.getSound) return shortPath(path);
    try {
      const sound = await service.getSound(path);
      const name = sound && sound.meta && sound.meta.name ? sound.meta.name : shortPath(path);
      ui.soundCache.set(path, name);
      renderPads();
      return name;
    } catch {
      return shortPath(path);
    }
  }

  async function refresh() {
    if (bridge.device.refresh) await bridge.device.refresh();
    render();
  }

  async function setProject(project) {
    if (ui.busy) return;
    ui.busy = true;
    setStatus(`loading project ${project}`);
    try {
      if (bridge.device.setProject) await bridge.device.setProject(project);
      await refresh();
      setStatus("");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "project change failed");
    } finally {
      ui.busy = false;
    }
  }

  async function setGroup(group) {
    if (ui.busy) return;
    ui.busy = true;
    setStatus(`loading group ${group}`);
    try {
      if (bridge.device.setGroup) await bridge.device.setGroup(group);
      await refresh();
      setStatus("");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "group change failed");
    } finally {
      ui.busy = false;
    }
  }

  function waitForUploads(startIds, timeoutMs) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const uploads = bridge.uploader.fileCollection || [];
        const matches = startIds.map((id) => uploads.find((upload) => upload.id === id));
        const done = matches.every((upload) => upload && ["complete", "failed", "aborted"].includes(upload.status));
        if (done) {
          clearInterval(timer);
          resolve(matches);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error("upload timed out"));
        }
      }, 300);
    });
  }

  async function processForUpload(files) {
    if (window.ep133OfflineDsp && window.ep133OfflineDsp.settings.enabled) {
      return await window.ep133OfflineDsp.processFiles(files);
    }
    return files;
  }

  async function uploadFilesToPads(files, pads) {
    if (ui.busy) return;
    const uploader = bridge.uploader;
    if (!uploader.enqueueFiles || !uploader.findNextFreeSoundSlot) {
      setStatus("connect the device before kit upload");
      return;
    }

    ui.busy = true;
    try {
      const selectedPads = pads.slice(0, files.length);
      const processed = (await processForUpload(files))
        .filter((file) => !/_(rev|pingpong)\.wav$/i.test(file.name))
        .slice(0, selectedPads.length);
      const ids = [];
      let cursor = 1;
      for (let index = 0; index < processed.length; index++) {
        const id = uploader.findNextFreeSoundSlot(cursor);
        if (!id || id === -1) throw new Error("no free sound slots");
        ids.push(id);
        cursor = id + 1;
      }
      const err = uploader.enqueueFiles(ids[0], processed);
      if (err instanceof Error) throw err;
      setStatus(`uploading ${processed.length} sample${processed.length === 1 ? "" : "s"}`);
      const uploads = await waitForUploads(ids, Math.max(60000, processed.length * 30000));
      const failed = uploads.filter((upload) => upload.status !== "complete");
      if (failed.length) throw new Error(`${failed.length} upload${failed.length === 1 ? "" : "s"} failed`);

      setStatus("assigning pads");
      for (let index = 0; index < selectedPads.length; index++) {
        const sound = bridge.uploader.sounds && bridge.uploader.sounds[ids[index] - 1];
        if (sound && sound.path) {
          await bridge.device.deviceService.assignSound(sound.path, selectedPads[index].path);
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      }
      await refresh();
      setStatus("kit assigned");
      setTimeout(() => setStatus(""), 2500);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "kit upload failed");
    } finally {
      ui.busy = false;
    }
  }

  async function clearPad(pad) {
    if (!bridge.device.deviceService || !pad.path) return;
    try {
      await bridge.device.deviceService.setMetadata(pad.path, { sym: 0 });
      await refresh();
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "clear failed");
    }
  }

  async function playPad(pad) {
    if (!bridge.device.deviceService || !pad.path) return;
    try {
      await bridge.device.deviceService.setActivePad(pad.path);
      if (pad.assignedPath) await bridge.device.deviceService.playback(pad.path);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "play failed");
    }
  }

  async function downloadPad(pad) {
    if (!bridge.device.deviceService || !pad.assignedPath) return;
    try {
      const blob = await bridge.device.deviceService.downloadSoundAsWav(pad.assignedPath);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${shortPath(pad.assignedPath)}.wav`;
      document.body.append(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "download failed");
    }
  }

  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }

  function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  async function readZip(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoder = new TextDecoder();
    const entries = new Map();
    let offset = 0;

    while (offset + 30 <= bytes.length) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
      if (view.getUint32(0, true) !== 0x04034b50) break;
      const method = view.getUint16(8, true);
      const compressedSize = view.getUint32(18, true);
      const uncompressedSize = view.getUint32(22, true);
      const nameLength = view.getUint16(26, true);
      const extraLength = view.getUint16(28, true);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (method !== 0) throw new Error("kit zip uses unsupported compression");
      const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
      const data = bytes.slice(dataStart, dataEnd);
      if (data.length !== uncompressedSize) throw new Error("kit zip entry is corrupt");
      entries.set(name, new Blob([data]));
      offset = dataEnd;
    }

    return entries;
  }

  async function createZip(entries) {
    const encoder = new TextEncoder();
    const now = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const data = new Uint8Array(await entry.blob.arrayBuffer());
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      writeUint32(localView, 0, 0x04034b50);
      writeUint16(localView, 4, 20);
      writeUint16(localView, 6, 0);
      writeUint16(localView, 8, 0);
      writeUint16(localView, 10, now.time);
      writeUint16(localView, 12, now.day);
      writeUint32(localView, 14, crc);
      writeUint32(localView, 18, data.length);
      writeUint32(localView, 22, data.length);
      writeUint16(localView, 26, name.length);
      writeUint16(localView, 28, 0);
      local.set(name, 30);
      localParts.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      writeUint32(centralView, 0, 0x02014b50);
      writeUint16(centralView, 4, 20);
      writeUint16(centralView, 6, 20);
      writeUint16(centralView, 8, 0);
      writeUint16(centralView, 10, 0);
      writeUint16(centralView, 12, now.time);
      writeUint16(centralView, 14, now.day);
      writeUint32(centralView, 16, crc);
      writeUint32(centralView, 20, data.length);
      writeUint32(centralView, 24, data.length);
      writeUint16(centralView, 28, name.length);
      writeUint16(centralView, 30, 0);
      writeUint16(centralView, 32, 0);
      writeUint16(centralView, 34, 0);
      writeUint16(centralView, 36, 0);
      writeUint32(centralView, 38, 0);
      writeUint32(centralView, 42, offset);
      central.set(name, 46);
      centralParts.push(central);
      offset += local.length + data.length;
    }

    const centralOffset = offset;
    const central = concatBytes(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, entries.length);
    writeUint16(endView, 10, entries.length);
    writeUint32(endView, 12, central.length);
    writeUint32(endView, 16, centralOffset);
    writeUint16(endView, 20, 0);

    return new Blob([...localParts, central, end], { type: "application/zip" });
  }

  async function exportKitArchive() {
    const service = bridge.device.deviceService;
    if (!service) {
      setStatus("connect the device before exporting");
      return;
    }
    const pads = sortedPads().filter((pad) => pad.assignedPath);
    if (!pads.length) {
      setStatus("no assigned pads to export");
      return;
    }

    ui.busy = true;
    try {
      const project = activeName(bridge.device.activeProject) || "unknown";
      const group = activeName(bridge.device.activeGroup) || "unknown";
      const manifest = {
        type: "ep-tools-kit",
        version: 1,
        exportedAt: new Date().toISOString(),
        device: bridge.device.deviceService.device
          ? {
              name: bridge.device.deviceService.device.name,
              serial: bridge.device.deviceService.device.serial,
            }
          : null,
        project,
        group,
        pads: [],
      };
      const entries = [];

      for (let index = 0; index < pads.length; index++) {
        const pad = pads[index];
        const padNumber = padLabel(pad.node.name);
        const name = ui.soundCache.get(pad.assignedPath) || shortPath(pad.assignedPath) || `pad_${padNumber}`;
        const fileName = `pads/pad_${padNumber}_${safeName(name)}.wav`;
        setStatus(`exporting pad ${padNumber}`);
        const wav = await service.downloadSoundAsWav(pad.assignedPath);
        entries.push({ name: fileName, blob: wav });
        manifest.pads.push({
          pad: padNumber,
          devicePad: pad.node.name,
          soundId: pad.meta && pad.meta.sym ? pad.meta.sym : null,
          name,
          assignedPath: pad.assignedPath,
          file: fileName,
        });
      }

      entries.unshift({
        name: "kit.json",
        blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
      });
      const zip = await createZip(entries);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zip);
      a.download = `EP_kit_P${safeName(project)}_${safeName(group)}.zip`;
      document.body.append(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
      setStatus(`exported ${pads.length} pad${pads.length === 1 ? "" : "s"}`);
      setTimeout(() => setStatus(""), 2500);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "kit export failed");
    } finally {
      ui.busy = false;
    }
  }

  async function importKitArchive(file) {
    if (!file) return;
    if (ui.busy) return;
    ui.busy = true;
    try {
      setStatus("reading kit archive");
      const entries = await readZip(file);
      const manifestBlob = entries.get("kit.json");
      if (!manifestBlob) throw new Error("kit.json missing");
      const manifest = JSON.parse(await manifestBlob.text());
      if (!manifest || !Array.isArray(manifest.pads)) throw new Error("invalid kit archive");

      const pads = sortedPads();
      const files = [];
      const targetPads = [];
      for (const item of manifest.pads) {
        const blob = entries.get(item.file);
        const padIndex = Number(item.pad) - 1;
        const pad = pads[padIndex];
        if (blob && pad) {
          files.push(new File([blob], shortPath(item.file), { type: "audio/wav" }));
          targetPads.push(pad);
        }
      }

      if (!files.length) throw new Error("kit archive has no usable samples");
      setStatus(`importing ${files.length} pad${files.length === 1 ? "" : "s"}`);
      await uploadFilesToPads(files, targetPads);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "kit import failed");
    } finally {
      ui.busy = false;
    }
  }

  function renderSelectors() {
    const project = activeName(bridge.device.activeProject);
    const group = activeName(bridge.device.activeGroup);
    const projectRow = byId("ep133-kit-projects");
    const groupRow = byId("ep133-kit-groups");
    projectRow.innerHTML = "<span class=\"ep133-kit-label\">Project</span>";
    groupRow.innerHTML = "<span class=\"ep133-kit-label\">Group</span>";
    PROJECTS.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item;
      button.className = item === project ? "active" : "";
      button.disabled = !bridge.device.deviceService || ui.busy;
      button.addEventListener("click", () => setProject(item));
      projectRow.append(button);
    });
    GROUPS.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item;
      button.className = item === group ? "active" : "";
      button.disabled = !bridge.device.deviceService || ui.busy;
      button.addEventListener("click", () => setGroup(item));
      groupRow.append(button);
    });
  }

  function renderPads() {
    if (!ui.pads) return;
    const pads = sortedPads();
    ui.pads.innerHTML = "";
    if (!bridge.device.deviceService) {
      ui.pads.innerHTML = "<div class=\"ep133-kit-pad\">Connect an EP device to inspect pads.</div>";
      return;
    }
    pads.forEach((pad) => {
      const card = document.createElement("div");
      card.className = `ep133-kit-pad${pad.assignedPath ? " assigned" : ""}`;
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        card.classList.add("drop-target");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
      card.addEventListener("drop", async (event) => {
        event.preventDefault();
        card.classList.remove("drop-target");
        const files = await audioFilesFromEvent(event);
        if (files.length) await uploadFilesToPads(files.slice(0, 1), [pad]);
      });

      const name = ui.soundCache.get(pad.assignedPath) || shortPath(pad.assignedPath) || "empty";
      if (pad.assignedPath && !ui.soundCache.has(pad.assignedPath)) getSoundName(pad.assignedPath);

      card.innerHTML = `
        <div class="ep133-kit-pad-num">PAD ${padLabel(pad.node.name)}</div>
        <div class="ep133-kit-pad-name">${escapeHtml(name)}</div>
        <div class="ep133-kit-pad-meta">${pad.meta && pad.meta.sym ? `sound ${pad.meta.sym}` : "unassigned"}</div>
      `;
      const actions = document.createElement("div");
      actions.className = "ep133-kit-actions";
      [
        ["play", () => playPad(pad), false],
        ["wav", () => downloadPad(pad), !pad.assignedPath],
        ["clear", () => clearPad(pad), !pad.assignedPath],
      ].forEach(([label, handler, disabled]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = disabled || ui.busy;
        button.addEventListener("click", handler);
        actions.append(button);
      });
      card.append(actions);
      ui.pads.append(card);
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function render() {
    if (!ui.panel) return;
    renderSelectors();
    renderPads();
  }

  bridge.uploadFilesToPads = uploadFilesToPads;
  bridge.sortedPads = sortedPads;
  bridge.padOrder = PAD_ORDER;

  function buildPanel() {
    const panel = document.createElement("section");
    panel.id = "ep133-kit-inspector";
    panel.innerHTML = `
      <div id="ep133-kit-body">
        <div class="ep133-kit-row" id="ep133-kit-projects"></div>
        <div class="ep133-kit-row" id="ep133-kit-groups"></div>
        <div id="ep133-kit-drop">drop a 12-sample kit folder or files here</div>
        <div id="ep133-kit-pads"></div>
        <div class="ep133-kit-row">
          <button type="button" id="ep133-kit-refresh">refresh</button>
          <button type="button" id="ep133-kit-import">import kit</button>
          <button type="button" id="ep133-kit-export">export kit</button>
          <input id="ep133-kit-import-file" type="file" accept=".zip,application/zip">
          <span id="ep133-kit-status"></span>
        </div>
      </div>
    `;
    ui.panel = panel;
    ui.body = panel.querySelector("#ep133-kit-body");
    ui.pads = panel.querySelector("#ep133-kit-pads");
    ui.status = panel.querySelector("#ep133-kit-status");
    ui.drop = panel.querySelector("#ep133-kit-drop");

    panel.querySelector("#ep133-kit-refresh").addEventListener("click", refresh);
    panel.querySelector("#ep133-kit-export").addEventListener("click", exportKitArchive);
    panel.querySelector("#ep133-kit-import").addEventListener("click", () => panel.querySelector("#ep133-kit-import-file").click());
    panel.querySelector("#ep133-kit-import-file").addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      importKitArchive(file);
    });
    ui.drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      ui.drop.classList.add("drop-target");
    });
    ui.drop.addEventListener("dragleave", () => ui.drop.classList.remove("drop-target"));
    ui.drop.addEventListener("drop", async (event) => {
      event.preventDefault();
      ui.drop.classList.remove("drop-target");
      const files = classifyFiles(await audioFilesFromEvent(event));
      if (!files.length) return;
      await uploadFilesToPads(files, sortedPads());
    });

    bridge.subscribe(render);
    window.ep133Features.register({
      id: "kit",
      label: "Kit",
      panel,
      accent: "var(--ep-display-sample-size, #00a69c)",
    });
    render();
  }

  window.addEventListener("DOMContentLoaded", buildPanel);
})();
