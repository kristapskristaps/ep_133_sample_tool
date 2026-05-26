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
          <span id="ep133-kit-status"></span>
        </div>
      </div>
    `;
    ui.panel = panel;
    ui.body = byId("ep133-kit-body");
    ui.pads = byId("ep133-kit-pads");
    ui.status = byId("ep133-kit-status");
    ui.drop = byId("ep133-kit-drop");

    byId("ep133-kit-refresh").addEventListener("click", refresh);
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
