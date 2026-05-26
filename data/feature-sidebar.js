(function () {
  "use strict";

  const state = {
    ready: false,
    active: localStorage.getItem("ep133.features.active") || "dsp",
    items: new Map(),
    shell: null,
    tabs: null,
    content: null,
  };

  function ensureShell() {
    if (state.shell) return;
    state.shell = document.createElement("aside");
    state.shell.id = "ep133-feature-sidebar";
    state.shell.innerHTML = `
      <header>
        <span>EP Tools</span>
        <button type="button" id="ep133-feature-collapse">hide</button>
      </header>
      <nav id="ep133-feature-tabs" aria-label="EP tools"></nav>
      <div id="ep133-feature-content"></div>
    `;
    document.body.append(state.shell);
    state.tabs = document.getElementById("ep133-feature-tabs");
    state.content = document.getElementById("ep133-feature-content");
    document.getElementById("ep133-feature-collapse").addEventListener("click", () => {
      state.shell.classList.toggle("collapsed");
      document.getElementById("ep133-feature-collapse").textContent = state.shell.classList.contains("collapsed") ? "show" : "hide";
    });
  }

  function activate(id) {
    state.active = id;
    localStorage.setItem("ep133.features.active", id);
    state.items.forEach((item, key) => {
      item.button.classList.toggle("active", key === id);
      item.panel.classList.toggle("active", key === id);
      item.panel.hidden = key !== id;
    });
    window.dispatchEvent(new CustomEvent("ep133-feature-tab", { detail: { id } }));
  }

  function register({ id, label, panel, accent }) {
    if (!state.ready) {
      window.addEventListener("DOMContentLoaded", () => register({ id, label, panel, accent }), { once: true });
      return;
    }
    ensureShell();
    if (state.items.has(id)) return;
    panel.classList.add("ep133-feature-panel");
    panel.dataset.feature = id;
    panel.hidden = true;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.setProperty("--feature-accent", accent || "var(--accent, #f15a22)");
    button.addEventListener("click", () => activate(id));
    state.tabs.append(button);
    state.content.append(panel);
    state.items.set(id, { button, panel });
    if (!state.items.has(state.active)) state.active = id;
    activate(state.active);
  }

  window.ep133Features = { register, activate };
  window.addEventListener("DOMContentLoaded", () => {
    state.ready = true;
    ensureShell();
  });
})();
