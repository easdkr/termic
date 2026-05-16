// Termic — main frontend.
// Layout: sidebar (projects/workspaces) + main pane (tabs + xterm.js terminal)
// + right panel (file list + auxiliary terminal).

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const dialogPlugin = window.__TAURI__.dialog;

const $  = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => Array.from(root.querySelectorAll(q));

// ── state ────────────────────────────────────────────────
// Each workspace has a list of tabs. Tabs are one of:
//   { id, type: "terminal", cli, title, ptyId?, host?, term?, fit?,
//     unread?, lastOutputAt?, lastInputAt? }
//   { id, type: "diff",     path, title }
//   { id, type: "edit",     path, title }
//
// Per-tab terminal state lives on the tab object itself (no global maps),
// so you can run claude AND gemini AND codex in the same workspace at the
// same time and each has independent attention/unread tracking.
const state = {
  projects: [],
  workspaces: [],
  activeProjectId: null,
  activeWorkspaceId: null,
  // pty_id -> { term, fit, host, ro, unlistenData, unlistenExit }
  terms: new Map(),
  // workspace_id -> pty_id (aux shell pty in bottom-right panel)
  auxPtys: new Map(),
  // workspace_id -> Tab[]
  chatTabs: new Map(),
};

const IDLE_MS = 3000;        // workspace is "waiting" after N ms of silence
const ATTENTION_DEBOUNCE_MS = 8000; // don't re-notify within this window

// Brand-mark SVGs for each agent CLI, sourced from lobehub/icons (currentColor,
// 24×24 viewBox). Used in the tab bar, sidebar workspace rows, and the
// "+ new tab" popover so each agent is visually distinct.
const CLI_ICONS = {
  claude: `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/></svg>`,
  gemini: `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"/></svg>`,
  codex: `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/></svg>`,
};
// Fallback for unknown/legacy CLIs — generic terminal glyph.
const CLI_ICON_FALLBACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
function cliIcon(cli) { return CLI_ICONS[cli] || CLI_ICON_FALLBACK; }

// Sets the CLI pill-group selection in the New Workspace dialog and mirrors
// the value into the hidden #nw-cli input that workspace_create reads.
function setCliPill(cli) {
  const pills = $$("#nw-cli-pills .cli-pill");
  if (!pills.length) return;
  const valid = pills.some(p => p.dataset.cli === cli) ? cli : "claude";
  pills.forEach(p => p.classList.toggle("active", p.dataset.cli === valid));
  const inp = $("#nw-cli");
  if (inp) inp.value = valid;
}

// ── tiny helpers ─────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, kind = "info") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = kind;
  el.style.opacity = "1";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.style.opacity = "0"), 3500);
}

// ── data load ────────────────────────────────────────────
async function loadAll() {
  try {
    state.projects = await invoke("projects_list");
    state.workspaces = await invoke("workspaces_list");
    renderSidebar();
  } catch (e) {
    toast("load failed: " + e, "error");
  }
}

function stateActiveTabFor(wsId) {
  const w = state.workspaces.find(x => x.id === wsId);
  return w?._activeTab;
}

// ── sidebar render ───────────────────────────────────────
function renderSidebar() {
  // Skip if an inline rename is in progress — re-rendering would yank the
  // input out of the DOM and the user's edit disappears mid-type.
  if (document.querySelector("#projects-tree .rename-input")) return;
  const tree = $("#projects-tree");
  tree.innerHTML = "";
  const totalUnread = state.workspaces.filter(w => workspaceHasUnread(w.id)).length;
  // Update unread badge in the section header if present.
  const head = $(".sb-section-head span");
  if (head) {
    head.textContent = totalUnread > 0 ? `Projects (${totalUnread})` : "Projects";
  }
  for (const p of state.projects) {
    const row = document.createElement("div");
    row.className = "proj-row";
    row.dataset.projectId = p.id;
    row.title = p.name;  // tooltip useful in compact mode
    row.innerHTML = `
      <div class="left">
        <span class="badge">P</span>
        <span>${esc(p.name)}</span>
      </div>
      <span class="add-ws" title="New workspace" data-add-ws="${p.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </span>`;
    tree.appendChild(row);

    const wsList = state.workspaces.filter(w => w.project_id === p.id && !w.archived);
    for (const w of wsList) {
      const wr = document.createElement("div");
      const isUnread = workspaceHasUnread(w.id);
      const reason = (state.chatTabs.get(w.id) || []).find(t => t.unread)?.unread?.reason;
      const isLoaded = workspaceIsLoaded(w.id);
      wr.className = "ws-row"
        + (w.id === state.activeWorkspaceId ? " active" : "")
        + (isUnread ? " unread" : "")
        + (isLoaded ? " loaded" : " unloaded")
        + (w.cli ? ` t-cli-${w.cli}` : "");
      wr.dataset.workspaceId = w.id;
      // Tooltip always includes the workspace name + cli (vital when the
      // sidebar is in compact mode and the label is hidden).
      const label = `${w.name} · ${w.cli || ""}`.trim().replace(/ ·\s*$/, "");
      wr.title = isUnread
        ? `${label} — needs attention (${reason})`
        : isLoaded ? label : `${label} — not loaded, click to start`;
      // Two mutually-exclusive states get a visible indicator:
      //   left orange dot → unread / needs attention
      //   right moon icon → asleep (unloaded session)
      // A loaded-and-read workspace shows neither.
      const trailing = (!isLoaded && !isUnread)
        ? `<span class="ws-trail sleep" title="Asleep — click to wake">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
           </span>`
        : "";
      wr.innerHTML = `<span class="dot ${isUnread ? "on" : ""}"></span>
        <span class="ic">${cliIcon(w.cli)}</span>
        <span class="ws-name">${esc(w.name)}</span>
        ${trailing}`;
      tree.appendChild(wr);
    }
  }
}

// Returns true if ANY terminal tab in the workspace currently has unread.
function workspaceHasUnread(wsId) {
  const tabs = state.chatTabs.get(wsId) || [];
  return tabs.some(t => t.type === "terminal" && t.unread);
}

// Returns true if the workspace has at least one alive terminal PTY.
function workspaceIsLoaded(wsId) {
  const tabs = state.chatTabs.get(wsId) || [];
  return tabs.some(t => t.type === "terminal" && t.ptyId);
}

function setActiveWorkspace(id) {
  // Leaving a tab: reset its activity timestamps so the idle heuristic
  // requires NEW input + NEW output before firing. Otherwise stale state
  // from before the switch keeps triggering "fake" idle notifications a
  // few seconds after you navigate away.
  const prevId = state.activeWorkspaceId;
  if (prevId && prevId !== id) {
    const prevTabs = state.chatTabs.get(prevId) || [];
    const prevActive = prevTabs.find(t => t.id === stateActiveTabFor(prevId));
    if (prevActive) {
      prevActive.lastInputAt = null;
      prevActive.lastOutputAt = null;
    }
  }
  state.activeWorkspaceId = id;
  // Selecting a workspace clears unread on its active terminal tab.
  if (id) {
    const tabs = state.chatTabs.get(id) || [];
    const active = tabs.find(t => t.id === stateActiveTabFor(id));
    if (active && active.unread) {
      active.unread = null;
      renderSidebar();
    }
  }
  $$(".ws-row").forEach(r => r.classList.toggle("active", r.dataset.workspaceId === id));
  const w = state.workspaces.find(x => x.id === id);
  const p = state.projects.find(x => x.id === w?.project_id);
  if (!w || !p) {
    $("#empty-view").classList.remove("hidden");
    $("#ws-view").classList.add("hidden");
    $("#rpanel").classList.add("hidden");
    // Drop the reserved 360px column AND clear topbar chrome that only makes
    // sense in the context of a workspace.
    $("#app").classList.add("no-rpanel");
    $("#crumbs").innerHTML = "";
    $("#open-folder").classList.add("hidden");
    $("#cli-switcher")?.classList.add("hidden");
    $("#toggle-rpanel").classList.add("hidden");
    return;
  }
  $("#empty-view").classList.add("hidden");
  $("#ws-view").classList.remove("hidden");
  $("#rpanel").classList.remove("hidden");
  // Re-claim the right column now that a workspace is open.
  $("#app").classList.remove("no-rpanel");
  $("#toggle-rpanel").classList.remove("hidden");
  // Reset right-panel tab to "All files" and refresh changes count.
  switchRTab("files");
  renderChanges(w);     // populates the badge even if tab isn't open
  startChangesPolling();
  $("#crumbs").innerHTML = `
    <span class="repo-tag">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      ${esc(p.name)}
    </span>
    <span class="sep">›</span>
    <span>${esc(w.name)}</span>`;
  $("#open-folder").classList.remove("hidden");
  $("#open-folder-label").textContent = w.name;
  $("#open-folder").onclick = () => invoke("open_path", { path: w.path });
  // Wire CLI switcher
  const cliSel = $("#cli-switcher");
  const cliInput = $("#cli-switcher-value");
  cliSel.classList.remove("hidden");
  ddSetValue(cliSel, w.cli);
  // CLI switcher in topbar = set the workspace's DEFAULT CLI (for new tabs).
  // No longer kills the current tab's agent — to switch the running CLI, just
  // open a new tab via the "+" picker.
  cliInput.onchange = async () => {
    const newCli = cliInput.value;
    if (newCli === w.cli) return;
    try {
      const updated = await invoke("workspace_set_cli", { id: w.id, cli: newCli });
      Object.assign(w, updated);
      toast(`default CLI is now ${newCli} — open a new tab with "+" to spawn it`, "ok");
    } catch (e) { toast("switch failed: " + e, "error"); }
  };

  // Ensure at least one terminal tab exists (uses the workspace's default CLI).
  let tabs = state.chatTabs.get(w.id);
  if (!tabs || !tabs.length) {
    tabs = [{ id: crypto.randomUUID(), title: w.cli, type: "terminal", cli: w.cli }];
    state.chatTabs.set(w.id, tabs);
    w._activeTab = tabs[0].id;
  }
  renderTabs(w);
  renderActiveTab(w);
  renderFiles(w);
  ensureAuxTerminal(w);
}

// ── tabs ─────────────────────────────────────────────────
// Tabs come in two flavors:
//   { id, title, type: "terminal" }         — the agent PTY (first tab)
//   { id, title, type: "diff", path }       — opened by clicking a Changes row
function renderTabs(w) {
  const bar = $("#tabs");
  const tabs = state.chatTabs.get(w.id) || [];
  bar.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === w._activeTab ? " active" : "") + ` t-${t.type || "terminal"}`
      + (t.cli ? ` t-cli-${t.cli}` : "");
    // Distinct icon + colored class per type:
    //   diff   → git-compare (red/green tinted), prefixed with "Δ"
    //   edit   → file (blue)
    //   chat   → sparkle (accent)
    let iconSvg, prefix = "";
    if (t.type === "diff") {
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h7a2 2 0 0 1 2 2v7"/><path d="M15 18H8a2 2 0 0 1-2-2V9"/></svg>`;
      prefix = `<span class="t-prefix">Δ</span>`;
    } else if (t.type === "edit") {
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`;
    } else {
      iconSvg = cliIcon(t.cli);
    }
    el.innerHTML = `<span class="ic">${iconSvg}</span>${prefix} <span class="title">${esc(t.title)}</span>` +
      (tabs.length > 1 ? `<span class="close" title="Close tab">×</span>` : "");
    el.onclick = (ev) => {
      if (ev.target.closest(".close")) { closeTab(w, t.id); return; }
      w._activeTab = t.id;
      renderTabs(w);
      renderActiveTab(w);
    };
    bar.appendChild(el);
  }
  if (!tabs.find(t => t.id === w._activeTab)) {
    w._activeTab = tabs[0]?.id;
  }
}

// Swap the main-pane content based on the active tab's type.
async function renderActiveTab(w) {
  const tabs = state.chatTabs.get(w.id) || [];
  const tab = tabs.find(t => t.id === w._activeTab) || tabs[0];
  if (!tab) return;
  const termC = $("#terminal-container");
  const diffC = $("#diff-container");
  const editC = $("#edit-container");

  if (tab.type === "terminal") {
    diffC.classList.add("hidden");
    editC.classList.add("hidden");
    termC.classList.remove("hidden");
    await ensureTabTerminal(w, tab);
    return;
  }
  if (tab.type === "diff") {
    termC.classList.add("hidden");
    editC.classList.add("hidden");
    diffC.classList.remove("hidden");
    diffC.innerHTML = `<div class="diff-toolbar">
      <span class="muted">${esc(tab.path)}</span>
      <div class="row gap">
        <button class="ghost" data-act="external">Open externally</button>
        <button class="ghost" data-act="view">View file</button>
      </div>
    </div>
    <div class="diff-body" id="diff-body-${tab.id}">loading…</div>`;
    diffC.querySelector('[data-act="external"]').addEventListener("click", () =>
      invoke("open_path", { path: `${w.path}/${tab.path}` }).catch(()=>{}));
    diffC.querySelector('[data-act="view"]').addEventListener("click", () =>
      openEditTab(w, tab.path));
    try {
      const text = await invoke("workspace_file_diff", { id: w.id, path: tab.path });
      renderDiffInto($("#diff-body-" + tab.id), text);
    } catch (e) {
      const el = diffC.querySelector(".diff-body");
      if (el) el.textContent = "error: " + e;
    }
  } else if (tab.type === "edit") {
    termC.classList.add("hidden");
    diffC.classList.add("hidden");
    editC.classList.remove("hidden");
    editC.innerHTML = `<div class="diff-toolbar">
      <span class="muted">${esc(tab.path)}</span>
      <div class="row gap">
        <button class="ghost" data-act="external">Open externally</button>
        <button class="ghost" data-act="diff">View diff</button>
      </div>
    </div>
    <pre class="edit-body" id="edit-body-${tab.id}">loading…</pre>`;
    editC.querySelector('[data-act="external"]').addEventListener("click", () =>
      invoke("open_path", { path: `${w.path}/${tab.path}` }).catch(()=>{}));
    editC.querySelector('[data-act="diff"]').addEventListener("click", () =>
      openDiffTab(w, tab.path));
    try {
      const text = await invoke("workspace_file_read", { id: w.id, path: tab.path });
      renderEditInto($("#edit-body-" + tab.id), text);
    } catch (e) {
      $("#edit-body-" + tab.id).textContent = "error: " + e;
    }
  }
}

// Render a file's text into a viewer with line numbers.
function renderEditInto(el, text) {
  if (!el) return;
  const lines = (text ?? "").split("\n");
  const html = lines.map((line, i) =>
    `<span class="edit-lno">${i + 1}</span><span class="edit-ltxt">${esc(line) || "&nbsp;"}</span>`
  ).join("");
  el.innerHTML = html;
}

// Open (or focus existing) an "edit" tab for a file path.
function openEditTab(w, path) {
  let tabs = state.chatTabs.get(w.id) || [];
  const existing = tabs.find(t => t.type === "edit" && t.path === path);
  if (existing) {
    w._activeTab = existing.id;
  } else {
    const newTab = {
      id: crypto.randomUUID(),
      title: path.split("/").pop(),
      type: "edit",
      path,
    };
    tabs.push(newTab);
    state.chatTabs.set(w.id, tabs);
    w._activeTab = newTab.id;
  }
  renderTabs(w);
  renderActiveTab(w);
}

// Render a unified-diff blob into the given element with cheap colorization.
function renderDiffInto(el, text) {
  if (!el) return;
  if (!text || !text.trim()) {
    el.innerHTML = '<div class="muted" style="padding:20px;">No diff (file matches HEAD).</div>';
    return;
  }
  const lines = text.split("\n");
  const html = lines.map(line => {
    let cls = "";
    if (line.startsWith("+++") || line.startsWith("---")) cls = "diff-meta";
    else if (line.startsWith("@@")) cls = "diff-hunk";
    else if (line.startsWith("+")) cls = "diff-add";
    else if (line.startsWith("-")) cls = "diff-del";
    else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file")) cls = "diff-file";
    return `<div class="diff-line ${cls}">${esc(line) || "&nbsp;"}</div>`;
  }).join("");
  el.innerHTML = html;
}

// Open a diff tab for a path (or focus the existing one).
function openDiffTab(w, path) {
  let tabs = state.chatTabs.get(w.id) || [];
  const existing = tabs.find(t => t.type === "diff" && t.path === path);
  if (existing) {
    w._activeTab = existing.id;
  } else {
    const newTab = {
      id: crypto.randomUUID(),
      title: path.split("/").pop(),
      type: "diff",
      path,
    };
    tabs.push(newTab);
    state.chatTabs.set(w.id, tabs);
    w._activeTab = newTab.id;
  }
  renderTabs(w);
  renderActiveTab(w);
}

function closeTab(w, tabId) {
  const tabs = state.chatTabs.get(w.id) || [];
  if (tabs.length <= 1) return;
  const idx = tabs.findIndex(t => t.id === tabId);
  const tab = tabs[idx];
  if (tab?.type === "terminal" && tab.ptyId) {
    invoke("pty_kill", { ptyId: tab.ptyId }).catch(()=>{});
    state.terms.delete(tab.ptyId);
    tab.ptyId = null;
  }
  tabs.splice(idx, 1);
  if (w._activeTab === tabId) {
    w._activeTab = tabs[Math.max(0, idx - 1)]?.id;
  }
  renderTabs(w);
  renderSidebar();
  renderActiveTab(w);
}

// ── xterm.js plumbing ────────────────────────────────────
function buildTerminal(container) {
  const term = new window.Terminal({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 13,
    cursorBlink: true,
    convertEol: false,
    allowProposedApi: true,
    theme: {
      background: "#0e1014",
      foreground: "#e6e6e6",
      cursor: "#d97757",
      selectionBackground: "#ffffff20",
    },
    scrollback: 5000,
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  try {
    const wl = new window.WebLinksAddon.WebLinksAddon();
    term.loadAddon(wl);
  } catch (e) { /* optional */ }
  // Host element for the terminal (kept around so we can re-parent on tab switch).
  const host = document.createElement("div");
  host.className = "term-host";
  container.innerHTML = "";
  container.appendChild(host);
  term.open(host);
  return { term, fit, host };
}

// Run fit() after the next paint so we measure the real laid-out size.
function fitSoon(t) {
  if (!t || !t.fit) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { t.fit.fit(); } catch (e) { /* ignore */ }
  }));
}

async function spawnPty({ cwd, cmd, args = [], env = {}, rows, cols }) {
  return await invoke("pty_spawn", {
    args: { cwd, cmd, args, env, rows, cols },
  });
}

function attachPtyToTerm(ptyId, term, fit, wsId, host, tab = null) {
  const unlistenDataP = listen(`pty://${ptyId}`, ev => {
    const data = ev.payload.data;
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    term.write(u8);
    if (tab) {
      tab.lastOutputAt = Date.now();
      if (u8.includes(0x07) && tab.lastInputAt) {
        invoke("log_line", { msg: `BEL detected, tab.cli=${tab.cli} lastInputAt=${tab.lastInputAt}` }).catch(()=>{});
        markTabAttention(wsId, tab, "bell");
      }
    }
  });
  const unlistenExitP = listen(`pty-exit://${ptyId}`, ev => {
    const code = ev.payload?.code;
    term.write(`\r\n\x1b[1;33m[process exited${code != null ? `: ${code}` : ""}]\x1b[0m\r\n`);
    if (tab) {
      tab.ptyId = null;     // tab no longer has a live agent
      markTabAttention(wsId, tab, "exit");
    }
    invoke("notify", { title: "termic", body: `process exited${code != null ? `: ${code}` : ""}` }).catch(()=>{});
    renderSidebar();
  });
  term.onData(data => {
    const u8 = new TextEncoder().encode(data);
    invoke("pty_write", { ptyId, data: Array.from(u8) }).catch(()=>{});
    if (tab) {
      tab.lastInputAt = Date.now();
      invoke("log_line", { msg: `pty_write tab.cli=${tab.cli} bytes=${u8.length}` }).catch(()=>{});
    }
  });
  // Terminal grid resize → PTY resize. Critical for correct line wrapping.
  term.onResize(({ rows, cols }) => {
    invoke("pty_resize", { ptyId, rows, cols }).catch(()=>{});
  });
  // Observe the host's parent (the visible container). Debounce with RAF so we
  // don't thrash during a window drag.
  let rafId;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { try { fit.fit(); } catch (e) {} });
  });
  if (host?.parentElement) ro.observe(host.parentElement);
  state.terms.set(ptyId, {
    term, fit, host, ro,
    unlistenData: async () => (await unlistenDataP)(),
    unlistenExit: async () => (await unlistenExitP)(),
  });
}

// Per-tab terminal: each terminal tab has its own PTY, term, fit, host.
// Switching tabs re-parents the host into #terminal-container.
async function ensureTabTerminal(w, tab) {
  const container = $("#terminal-container");
  if (tab.ptyId && state.terms.has(tab.ptyId)) {
    const stored = state.terms.get(tab.ptyId);
    container.innerHTML = "";
    container.appendChild(stored.host);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { stored.fit.fit(); } catch (e) {}
      invoke("pty_resize", { ptyId: tab.ptyId, rows: stored.term.rows, cols: stored.term.cols }).catch(()=>{});
      if (!document.querySelector(".rename-input")) {
        try { stored.term.focus(); } catch (e) {}
      }
    }));
    return;
  }
  const { term, fit, host } = buildTerminal(container);
  tab.term = term; tab.fit = fit; tab.host = host;

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try { fit.fit(); } catch (e) {}
  const cols = Math.max(40, term.cols || 100);
  const rows = Math.max(10, term.rows || 30);

  try {
    const newPtyId = await spawnPty({
      cwd: w.path,
      cmd: tab.cli,
      args: [],
      env: {
        TERMIC_PORT: String(w.port),
        TERMIC_TASK: w.name,
        TERMIC_WORKSPACE_NAME: w.name,
      },
      rows, cols,
    });
    tab.ptyId = newPtyId;
    tab.lastOutputAt = Date.now();
    attachPtyToTerm(newPtyId, term, fit, w.id, host, tab);
    requestAnimationFrame(() => {
      if (document.querySelector(".rename-input")) return;
      try { term.focus(); } catch (e) {}
    });
    renderSidebar();
    setTimeout(() => {
      try { fit.fit(); invoke("pty_resize", { ptyId: newPtyId, rows: term.rows, cols: term.cols }).catch(()=>{}); } catch (e) {}
    }, 200);
    setTimeout(() => {
      try { fit.fit(); invoke("pty_resize", { ptyId: newPtyId, rows: term.rows, cols: term.cols }).catch(()=>{}); } catch (e) {}
    }, 600);
  } catch (e) {
    term.write(`\x1b[1;31mspawn failed: ${e}\x1b[0m\r\n`);
    toast("spawn failed: " + e, "error");
  }
}

async function ensureAuxTerminal(w) {
  const container = $("#aux-terminal-container");
  let ptyId = state.auxPtys.get(w.id);
  if (ptyId && state.terms.has(ptyId)) {
    const t = state.terms.get(ptyId);
    container.innerHTML = "";
    container.appendChild(t.host);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { t.fit.fit(); } catch (e) {}
      invoke("pty_resize", {
        ptyId, rows: t.term.rows, cols: t.term.cols,
      }).catch(() => {});
    }));
    return;
  }
  const { term, fit, host } = buildTerminal(container);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try { fit.fit(); } catch (e) {}
  const cols = Math.max(40, term.cols || 100);
  const rows = Math.max(10, term.rows || 30);
  try {
    const newPtyId = await spawnPty({
      cwd: w.path,
      cmd: process_shell(),
      args: ["-l"],
      env: { TERMIC_PORT: String(w.port), TERMIC_TASK: w.name },
      rows, cols,
    });
    state.auxPtys.set(w.id, newPtyId);
    // Aux terminal is user-driven; don't track unread on it (wsId omitted).
    attachPtyToTerm(newPtyId, term, fit, null, host);
  } catch (e) {
    term.write(`\x1b[1;31mshell spawn failed: ${e}\x1b[0m\r\n`);
  }
}

function process_shell() {
  // macOS default
  return "/bin/zsh";
}

async function detectHome() {
  if (detectHome._cache) return detectHome._cache;
  detectHome._cache = await invoke("home_dir");
  return detectHome._cache;
}
async function pathExists(p) {
  try { return await invoke("path_exists", { path: p }); }
  catch { return false; }
}

// ── right panel ──────────────────────────────────────────
async function renderFiles(w) {
  const list = $("#files-list");
  list.innerHTML = '<div class="file-row muted">loading…</div>';
  try {
    const files = await invoke("workspace_files", { id: w.id });
    list.innerHTML = files.map(f => {
      const isDir = !f.includes(".") || f.endsWith("/");
      const ic = isDir
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
      return `<div class="file-row" data-path="${esc(f)}" data-isdir="${isDir}" title="${esc(f)}">
        <span class="ic">${ic}</span> ${esc(f)}
      </div>`;
    }).join("");
    list.querySelectorAll(".file-row").forEach(row => {
      row.addEventListener("click", () => {
        const path = row.dataset.path;
        if (row.dataset.isdir === "true") return;
        openEditTab(w, path);
      });
      // Double-click escapes to the host editor (Finder default for the extension).
      row.addEventListener("dblclick", () => {
        const path = row.dataset.path;
        invoke("open_path", { path: `${w.path}/${path}` }).catch(e => toast("open failed: " + e, "error"));
      });
    });
  } catch (e) {
    list.innerHTML = `<div class="file-row" style="color: var(--err)">${esc(e)}</div>`;
  }
}

const STATUS_LABEL = { M: "modified", A: "added", D: "deleted", R: "renamed",
                       "??": "untracked", "!!": "ignored", U: "conflict" };
const STATUS_COLOR = { M: "var(--accent)", A: "var(--ok)", D: "var(--err)",
                       R: "var(--accent)", "??": "var(--fg-faint)", U: "var(--err)" };

async function renderChanges(w) {
  const list = $("#changes-list");
  list.innerHTML = '<div class="file-row muted">loading…</div>';
  try {
    const ch = await invoke("workspace_changes", { id: w.id });
    updateChangesBadge(ch.count);
    if (!ch.files.length) {
      list.innerHTML = '<div class="file-row muted" style="padding: 14px;">No changes — working tree is clean.</div>';
      return;
    }
    list.innerHTML = ch.files.map(f => {
      const key = f.status.length > 1 ? f.status : f.status.trim() || "M";
      const label = STATUS_LABEL[key] || key;
      const color = STATUS_COLOR[key] || "var(--fg-dim)";
      return `<div class="file-row change" data-path="${esc(f.path)}" title="${esc(label)}: ${esc(f.path)} — click to view diff">
        <span class="status-pill" style="background:${color}">${esc(key)}</span>
        <span>${esc(f.path)}</span>
      </div>`;
    }).join("");
    list.querySelectorAll(".file-row.change").forEach(row => {
      row.addEventListener("click", () => openDiffTab(w, row.dataset.path));
    });
  } catch (e) {
    list.innerHTML = `<div class="file-row" style="color: var(--err)">${esc(e)}</div>`;
  }
}

function updateChangesBadge(n) {
  const b = $("#changes-badge");
  if (!b) return;
  b.textContent = String(n);
  b.classList.toggle("has", n > 0);
}

// Polls workspace_changes for the active workspace every 4s so the badge
// and (if visible) the Changes list stay live as the agent edits files.
let _changesPollTimer = null;
function startChangesPolling() {
  clearInterval(_changesPollTimer);
  _changesPollTimer = setInterval(async () => {
    const w = state.workspaces.find(x => x.id === state.activeWorkspaceId);
    if (!w) return;
    try {
      const ch = await invoke("workspace_changes", { id: w.id });
      updateChangesBadge(ch.count);
      // If the Changes tab is visible, refresh its list too.
      if (!$("#r-changes").classList.contains("hidden")) {
        await renderChanges(w);
      }
    } catch {}
  }, 4000);
}

// ── add project ──────────────────────────────────────────
// Also wire the gear next to "Projects" as a quick "refresh" button.
$("#filter-projects")?.addEventListener("click", async () => {
  await loadAll();
  toast(`refreshed (${state.projects.length} project${state.projects.length === 1 ? "" : "s"})`, "ok");
});

$("#add-project")?.addEventListener("click", async () => {
  // Re-sync state from disk in case projects were added externally (or by
  // a previous session) — avoids "already added" errors with a stale list.
  await loadAll();
  $("#np-path").value = "";
  await populateDiscoveredRepos();
  $("#new-project-dialog").showModal();
});

// Render the "Discovered repos" block at the top of the Add Project dialog.
// Hidden entirely if no repos_dir is set or nothing is found.
async function populateDiscoveredRepos() {
  const box = $("#np-discovered");
  const list = $("#np-discovered-list");
  const meta = $("#np-discovered-meta");
  if (!box || !list) return;
  let settings = {};
  try { settings = await invoke("settings_load") || {}; } catch {}
  const dir = (settings.repos_dir || "").trim();
  if (!dir) { box.classList.add("hidden"); return; }
  let repos = [];
  try { repos = await invoke("discover_repos", { dir }) || []; } catch (e) {
    box.classList.add("hidden");
    return;
  }
  const unadded = repos.filter(r => !r.already_added);
  if (!unadded.length) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  meta.textContent = `${unadded.length} in ${dir}`;
  list.innerHTML = unadded.map(r => `
    <div class="np-discovered-row" data-path="${esc(r.path)}" title="${esc(r.path)}">
      <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
      <span class="np-name">${esc(r.name)}</span>
      <span class="np-add">Add</span>
    </div>`).join("");
  list.querySelectorAll(".np-discovered-row").forEach(row => {
    row.addEventListener("click", async () => {
      const path = row.dataset.path;
      try {
        await invoke("project_add", { rootPath: path });
        await loadAll();
        await populateDiscoveredRepos();
        toast(`added ${row.querySelector(".np-name").textContent}`, "ok");
      } catch (e) {
        toast("add failed: " + e, "error");
      }
    });
  });
}

// ── welcome wizard ───────────────────────────────────────
// Shown once, on first launch, when settings.json has no `welcomed` flag.
// One quick page: pick a repos dir + see which CLIs are installed.
async function maybeShowWelcome() {
  let settings = {};
  try { settings = await invoke("settings_load") || {}; } catch {}
  if (settings.welcomed) return;
  const dlg = $("#welcome-dialog");
  if (!dlg) return;
  $("#ww-repos-dir").value = settings.repos_dir || "";
  $("#ww-discover-summary").textContent = "";
  renderCliStatus([]); // placeholder while detect runs
  invoke("detect_clis").then(renderCliStatus).catch(() => renderCliStatus([]));
  dlg.showModal();
  // Live preview as the user types/picks a path.
  refreshWelcomeDiscovery();
}

function renderCliStatus(clis) {
  const host = $("#ww-cli-status");
  if (!host) return;
  if (!clis.length) { host.textContent = "Checking…"; return; }
  host.innerHTML = clis.map(c => `
    <div class="ww-cli-row ${c.found ? "found" : "missing"} t-cli-${c.name}">
      <span class="ic">${cliIcon(c.name)}</span>
      <span class="ww-cli-name">${esc(c.name)}</span>
      <span class="ww-cli-meta">${c.found
        ? esc(c.version || c.path)
        : `<span class="ww-missing">not installed</span>`}</span>
    </div>`).join("");
}

async function refreshWelcomeDiscovery() {
  const dir = $("#ww-repos-dir")?.value.trim();
  const summary = $("#ww-discover-summary");
  if (!summary) return;
  if (!dir) { summary.textContent = ""; return; }
  try {
    const repos = await invoke("discover_repos", { dir });
    const unadded = repos.filter(r => !r.already_added).length;
    summary.textContent = repos.length === 0
      ? `No git repos found in ${dir}.`
      : `Found ${repos.length} repo${repos.length === 1 ? "" : "s"} (${unadded} not yet added).`;
  } catch (e) {
    summary.textContent = "Couldn't read that path.";
  }
}

$("#ww-repos-dir")?.addEventListener("input", () => {
  clearTimeout($("#ww-repos-dir")._t);
  $("#ww-repos-dir")._t = setTimeout(refreshWelcomeDiscovery, 200);
});
$("#ww-browse")?.addEventListener("click", async () => {
  try {
    const sel = await dialogPlugin.open({ directory: true, multiple: false });
    if (sel) { $("#ww-repos-dir").value = sel; refreshWelcomeDiscovery(); }
  } catch (e) { toast("browse failed: " + e, "error"); }
});
$("#ww-skip")?.addEventListener("click", async () => {
  // Skip still marks `welcomed: true` so the wizard doesn't nag on every boot.
  try { await invoke("settings_save", { s: { repos_dir: "", welcomed: true } }); } catch {}
  $("#welcome-dialog").close();
});
$("#welcome-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const dir = $("#ww-repos-dir").value.trim();
  try {
    await invoke("settings_save", { s: { repos_dir: dir, welcomed: true } });
    $("#welcome-dialog").close();
    toast("ready — open Add Project to import a discovered repo", "ok");
  } catch (e) { toast("save failed: " + e, "error"); }
});
$("#np-browse")?.addEventListener("click", async () => {
  try {
    const sel = await dialogPlugin.open({ directory: true, multiple: false });
    if (sel) $("#np-path").value = sel;
  } catch (e) { toast("browse failed: " + e, "error"); }
});
$("#np-cancel")?.addEventListener("click", () => $("#new-project-dialog").close());
$("#new-project-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const path = $("#np-path").value.trim();
  if (!path) return;
  try {
    await invoke("project_add", { rootPath: path });
    $("#new-project-dialog").close();
    await loadAll();
    toast("project added", "ok");
  } catch (e) {
    // Even on failure, refresh the sidebar — "already added" means the project
    // IS on disk, just not in the frontend's stale cache.
    await loadAll();
    toast("add failed: " + e, "error");
  }
});

// ── add workspace (per project) ──────────────────────────
// Double-click a row → inline rename (workspace or project).
$("#projects-tree")?.addEventListener("dblclick", (ev) => {
  const wsRow = ev.target.closest(".ws-row");
  const projRow = ev.target.closest(".proj-row");
  if (wsRow) {
    startRename(wsRow, "workspace", wsRow.dataset.workspaceId);
  } else if (projRow) {
    startRename(projRow, "project", projRow.dataset.projectId);
  }
});

function startRename(row, kind, id) {
  // Find the existing label and swap it for an input.
  const nameSpan = row.querySelector(".ws-name") || row.querySelector(".left > span:last-child");
  if (!nameSpan) return;
  const oldName = nameSpan.textContent.trim();
  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = oldName;
  inp.className = "rename-input";
  inp.spellcheck = false;
  inp.autocomplete = "off";
  nameSpan.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    const newName = inp.value.trim();
    const restore = document.createElement("span");
    restore.className = nameSpan.className;
    restore.textContent = save ? newName || oldName : oldName;
    inp.replaceWith(restore);
    if (!save || !newName || newName === oldName) return;
    try {
      if (kind === "workspace") {
        await invoke("workspace_rename", { id, name: newName });
      } else {
        await invoke("project_rename", { id, name: newName });
      }
      await loadAll();
      toast("renamed", "ok");
    } catch (e) {
      toast("rename failed: " + e, "error");
    }
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    e.stopPropagation();
  });
  inp.addEventListener("blur", () => commit(true));
  // Prevent the click that lands inside the input from re-firing the tree handler
  inp.addEventListener("click", e => e.stopPropagation());
  inp.addEventListener("dblclick", e => e.stopPropagation());
}

$("#projects-tree")?.addEventListener("click", (ev) => {
  const addBtn = ev.target.closest("[data-add-ws]");
  if (addBtn) {
    ev.stopPropagation();
    state.activeProjectId = addBtn.dataset.addWs;
    const p = state.projects.find(x => x.id === state.activeProjectId);
    $("#nw-name").value = "";
    $("#nw-base").value = p?.base_branch || "";
    $("#nw-branch").value = "";
    setCliPill(p?.default_cli || "claude");
    // Reset to "feature" prefix
    $$("#nw-prefix-pills .pill-radio").forEach(b =>
      b.classList.toggle("active", b.dataset.prefix === "feature"));
    nwState.branchEdited = false;
    nwState.prefix = "feature";
    updateBranchPreview();
    $("#new-ws-dialog").showModal();
    setTimeout(() => $("#nw-name").focus(), 50);
    return;
  }
  const wsRow = ev.target.closest(".ws-row");
  if (wsRow) {
    setActiveWorkspace(wsRow.dataset.workspaceId);
    return;
  }
});
$("#nw-cancel")?.addEventListener("click", () => $("#new-ws-dialog").close());

// New-workspace dialog: branch-name UX state. We auto-derive the branch from
// `<prefix>/<slug(name)>` until the user manually edits the branch input —
// then we stop overwriting (so explicit user input wins).
const nwState = { prefix: "feature", branchEdited: false };

function slugifyName(s) {
  return (s || "").toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function updateBranchPreview() {
  if (nwState.branchEdited) return;
  const slug = slugifyName($("#nw-name")?.value || "");
  const inp = $("#nw-branch");
  if (!inp) return;
  if (nwState.prefix === "__custom__") {
    // Custom: keep what the user has, default to just the slug if empty
    if (!inp.value) inp.value = slug;
  } else if (nwState.prefix) {
    inp.value = slug ? `${nwState.prefix}/${slug}` : "";
  } else {
    inp.value = slug;
  }
}

document.addEventListener("click", (ev) => {
  const cliPill = ev.target.closest("#nw-cli-pills .cli-pill");
  if (cliPill) { setCliPill(cliPill.dataset.cli); return; }
  const b = ev.target.closest("#nw-prefix-pills .pill-radio");
  if (!b) return;
  $$("#nw-prefix-pills .pill-radio").forEach(x => x.classList.toggle("active", x === b));
  nwState.prefix = b.dataset.prefix;
  if (nwState.prefix === "__custom__") {
    // Hand control to the user — focus the branch input.
    nwState.branchEdited = true;
    $("#nw-branch").focus();
    $("#nw-branch").select();
  } else {
    // Prefix changed → re-derive even if user had touched the field, as a
    // convenience (Termic.build does the same).
    nwState.branchEdited = false;
    updateBranchPreview();
  }
});

$("#nw-name")?.addEventListener("input", updateBranchPreview);
$("#nw-branch")?.addEventListener("input", () => { nwState.branchEdited = true; });

$("#new-ws-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = $("#nw-name").value.trim();
  const branch = $("#nw-branch").value.trim();
  if (!name || !state.activeProjectId) return;
  if (!branch) { toast("branch name required", "error"); return; }
  try {
    const w = await invoke("workspace_create", {
      args: {
        project_id: state.activeProjectId,
        name,
        cli: $("#nw-cli").value,
        base_branch: $("#nw-base").value.trim() || null,
        branch: branch,
      },
    });
    $("#new-ws-dialog").close();
    await loadAll();
    setActiveWorkspace(w.id);
    toast("workspace created", "ok");
  } catch (e) { toast("create failed: " + e, "error"); }
});

// ── settings (placeholder for now) ────────────────────────
$("#open-settings")?.addEventListener("click", () => {
  $("#settings-dialog").showModal();
  renderSettings();
});
$("#settings-back")?.addEventListener("click", () => $("#settings-dialog").close());

function renderSettings() {
  const sb = $("#settings-repos");
  sb.innerHTML = state.projects.map(p =>
    `<button data-pid="${p.id}"><span class="badge" style="margin-right:8px">P</span>${esc(p.name)}</button>`
  ).join("");
  sb.onclick = (ev) => {
    const b = ev.target.closest("[data-pid]");
    if (!b) return;
    showProjectSettings(b.dataset.pid);
  };
  if (state.projects.length) showProjectSettings(state.projects[0].id);
}
function showProjectSettings(pid) {
  const p = state.projects.find(x => x.id === pid);
  if (!p) return;
  $("#settings-body").innerHTML = `
    <h1><span class="badge">P</span> ${esc(p.name)}</h1>
    <div class="settings-field">
      <label>Root path</label>
      <input value="${esc(p.root_path)}" readonly />
      <div class="hint">Do not move or delete this directory.</div>
    </div>
    <div class="settings-field">
      <label>Workspaces path</label>
      <input id="set-ws-path" value="${esc(p.workspaces_path)}" />
      <div class="hint">Where worktrees go.</div>
    </div>
    <div class="settings-field">
      <label>Branch new workspaces from</label>
      <input id="set-base" value="${esc(p.base_branch)}" />
    </div>
    <div class="settings-field">
      <label>Remote origin</label>
      <input id="set-remote" value="${esc(p.remote)}" />
    </div>
    <div class="settings-field">
      <label>Preview URL</label>
      <div class="hint">Supports $TERMIC_PORT, $TERMIC_WORKSPACE_NAME.</div>
      <input id="set-preview" value="${esc(p.preview_url)}" />
    </div>
    <div class="settings-field">
      <label>Files to copy (one per line; globs allowed)</label>
      <textarea id="set-files">${esc((p.files_to_copy||[]).join("\n"))}</textarea>
    </div>
    <hr class="settings-divider" />
    <div class="settings-field">
      <label>Setup script (runs after creating a workspace)</label>
      <textarea id="set-setup" placeholder="e.g. just up">${esc(p.setup_script)}</textarea>
    </div>
    <div class="settings-field">
      <label>Run script (▶ in Run tab)</label>
      <textarea id="set-run" placeholder="e.g. cd src && uv run manage.py runserver 0.0.0.0:$TERMIC_PORT">${esc(p.run_script)}</textarea>
    </div>
    <div class="settings-field">
      <label>Archive script</label>
      <textarea id="set-archive" placeholder="e.g. rm -rf node_modules">${esc(p.archive_script)}</textarea>
    </div>
    <div class="settings-field">
      <label>Default CLI</label>
      <select id="set-cli">
        ${["claude","gemini","codex"].map(c => `<option ${p.default_cli===c?"selected":""}>${c}</option>`).join("")}
      </select>
    </div>
    <div class="row">
      <button id="save-settings" class="primary">Save</button>
      <button id="del-project" class="danger">Remove repository</button>
    </div>`;
  $("#save-settings").onclick = async () => {
    const upd = {
      ...p,
      workspaces_path: $("#set-ws-path").value,
      base_branch: $("#set-base").value,
      remote: $("#set-remote").value,
      preview_url: $("#set-preview").value,
      files_to_copy: $("#set-files").value.split("\n").map(s=>s.trim()).filter(Boolean),
      setup_script: $("#set-setup").value,
      run_script: $("#set-run").value,
      archive_script: $("#set-archive").value,
      default_cli: $("#set-cli").value,
    };
    try {
      await invoke("project_update", { p: upd });
      await loadAll();
      toast("saved", "ok");
    } catch (e) { toast("save failed: " + e, "error"); }
  };
  $("#del-project").onclick = async () => {
    if (!confirm(`Remove repository "${p.name}"? Workspaces stay on disk.`)) return;
    try {
      await invoke("project_remove", { id: p.id });
      $("#settings-dialog").close();
      await loadAll();
    } catch (e) { toast("remove failed: " + e, "error"); }
  };
}

// ── archive workspace ───────────────────────────────────
// (wire to a context menu / button when we add it)
async function archiveActiveWorkspace() {
  if (!state.activeWorkspaceId) return;
  if (!confirm("Archive this workspace? The worktree will be removed.")) return;
  try {
    await invoke("workspace_archive", { id: state.activeWorkspaceId });
    state.activeWorkspaceId = null;
    await loadAll();
    setActiveWorkspace(null);
    toast("archived", "ok");
  } catch (e) { toast("archive failed: " + e, "error"); }
}

// ── toggle panes ─────────────────────────────────────────
$("#toggle-sb")?.addEventListener("click", () => {
  const app = $("#app");
  app.classList.toggle("compact-sidebar");
  // Persist so the choice survives reloads/relaunches.
  try { localStorage.setItem("compactSidebar", app.classList.contains("compact-sidebar") ? "1" : "0"); } catch {}
});
$("#toggle-rpanel")?.addEventListener("click", () => {
  $("#app").classList.toggle("no-rpanel");
});

// ── dashboard / history sidebar items ────────────────────
$$(".sb-item").forEach(item => {
  item.addEventListener("click", () => {
    const view = item.dataset.view;
    $$(".sb-item").forEach(i => i.classList.remove("active"));
    item.classList.add("active");
    if (view === "dashboard") showDashboard();
    else if (view === "history") showHistory();
  });
});

// Empty-state actions
document.addEventListener("click", (ev) => {
  if (ev.target.id === "empty-add-project") {
    $("#add-project")?.click();
  } else if (ev.target.id === "empty-go-dashboard") {
    $$(".sb-item").forEach(i => i.classList.toggle("active", i.dataset.view === "dashboard"));
    showDashboard();
  }
});

function showDashboard() {
  state.activeWorkspaceId = null;
  $("#empty-view").classList.remove("hidden");
  $("#ws-view").classList.add("hidden");
  $("#rpanel").classList.add("hidden");
  $("#app").classList.add("no-rpanel");
  $("#toggle-rpanel").classList.add("hidden");
  $("#open-folder").classList.add("hidden");
  $("#cli-switcher")?.classList.add("hidden");
  $("#crumbs").innerHTML = '<span>Dashboard</span>';
  const active = state.workspaces.filter(w => !w.archived);
  const html = active.length
    ? `<h2>Active workspaces (${active.length})</h2>
       <ul class="dash-list">${active.map(w => {
         const p = state.projects.find(p => p.id === w.project_id);
         return `<li data-ws="${w.id}"><b>${esc(w.name)}</b>
                   <span class="muted">in ${esc(p?.name||"?")} on <code>${esc(w.branch)}</code></span></li>`;
       }).join("")}</ul>`
    : '<h2>No active workspaces</h2><p class="muted">Pick a project + ＋ in the sidebar.</p>';
  $(".empty-state").innerHTML = html;
  $$(".dash-list li").forEach(li => {
    li.addEventListener("click", () => setActiveWorkspace(li.dataset.ws));
  });
}

function showHistory() {
  state.activeWorkspaceId = null;
  $("#empty-view").classList.remove("hidden");
  $("#ws-view").classList.add("hidden");
  $("#rpanel").classList.add("hidden");
  $("#app").classList.add("no-rpanel");
  $("#toggle-rpanel").classList.add("hidden");
  $("#open-folder").classList.add("hidden");
  $("#cli-switcher")?.classList.add("hidden");
  $("#crumbs").innerHTML = '<span>History</span>';
  const archived = state.workspaces.filter(w => w.archived);
  $(".empty-state").innerHTML = archived.length
    ? `<h2>Archived workspaces</h2>
       <ul class="dash-list">${archived.map(w => {
         const p = state.projects.find(p => p.id === w.project_id);
         return `<li><b>${esc(w.name)}</b> <span class="muted">in ${esc(p?.name||"?")} · <code>${esc(w.branch)}</code> · ${new Date(w.created).toLocaleString()}</span>
                   <button data-del="${w.id}" class="danger">Delete</button></li>`;
       }).join("")}</ul>`
    : '<h2>No archived workspaces yet</h2><p class="muted">When you archive a workspace, it lands here.</p>';
  $$("[data-del]").forEach(b => {
    b.addEventListener("click", async () => {
      if (!confirm("Permanently delete this archived workspace?")) return;
      try {
        await invoke("workspace_delete", { id: b.dataset.del });
        await loadAll();
        showHistory();
      } catch (e) { toast("delete failed: " + e, "error"); }
    });
  });
}

// ── new chat tab in current workspace ────────────────────
function openNewTabPopover() {
  invoke("log_line", { msg: `openNewTabPopover called, activeWsId=${state.activeWorkspaceId}` }).catch(()=>{});
  const btn = document.getElementById("new-tab");
  if (!btn) { toast("new-tab button not in DOM!", "error"); return; }
  const w = state.workspaces.find(x => x.id === state.activeWorkspaceId);
  if (!w) { toast("no active workspace", "error"); return; }
  const existing = document.getElementById("new-tab-popover");
  if (existing) { existing.remove(); return; }
  const r = btn.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.id = "new-tab-popover";
  pop.className = "popover";
  pop.style.top = `${r.bottom + 4}px`;
  pop.style.left = `${Math.max(8, r.right - 160)}px`;
  pop.innerHTML = ["claude", "gemini", "codex"].map(c => `
    <div class="popover-item t-cli-${c}" data-cli="${c}">
      <span class="ic">${CLI_ICONS[c]}</span> <span>${c}</span>
    </div>`).join("");
  document.body.appendChild(pop);
  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const item = e.target.closest("[data-cli]");
    if (!item) return;
    pop.remove();
    spawnNewTab(w, item.dataset.cli);
  });
  const dismiss = (e) => {
    if (!e.target.closest("#new-tab-popover") && !e.target.closest("#new-tab")) {
      pop.remove();
      document.removeEventListener("mousedown", dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", dismiss, true), 50);
}

function handleNewTabClick(ev) {
  if (!ev.target.closest("#new-tab")) return;
  invoke("log_line", { msg: `+ button: ${ev.type} fired (target=${ev.target.tagName})` }).catch(()=>{});
  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();
  openNewTabPopover();
}
// Bind ONLY to click on capture phase. Binding to both mousedown and click
// fires the handler twice for one user click — the first creates the
// popover, the second toggles it back off.
document.addEventListener("click", handleNewTabClick, true);

// Also bind directly on the button itself (belt + suspenders) after boot.
function bindNewTabDirect() {
  const btn = document.getElementById("new-tab");
  if (btn && !btn.dataset._wired) {
    btn.dataset._wired = "1";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openNewTabPopover();
    });
  }
}

function spawnNewTab(w, cli) {
  const tabs = state.chatTabs.get(w.id) || [];
  const newTab = { id: crypto.randomUUID(), title: cli, type: "terminal", cli };
  tabs.push(newTab);
  state.chatTabs.set(w.id, tabs);
  w._activeTab = newTab.id;
  renderTabs(w);
  renderActiveTab(w);
}

// ── right-panel Setup/Run/Terminal swap ──────────────────
$$(".rf-tab").forEach(t => {
  t.addEventListener("click", async () => {
    $$(".rf-tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    const which = t.dataset.foot;
    const body = $(".r-foot-body");
    const w = state.workspaces.find(x => x.id === state.activeWorkspaceId);
    if (!w) return;
    if (which === "term") {
      body.innerHTML = '<div id="aux-terminal-container"></div>';
      ensureAuxTerminal(w);
    } else {
      body.innerHTML = `<div class="script-runner">
        <button id="run-script-btn">▶ Run ${esc(which)} script</button>
        <pre id="run-script-out" class="muted">(output will appear here)</pre>
      </div>`;
      $("#run-script-btn").onclick = async () => {
        $("#run-script-out").textContent = "running…";
        try {
          const out = await invoke("workspace_run_script", { id: w.id, which });
          $("#run-script-out").textContent = out || "(no output)";
        } catch (e) { $("#run-script-out").textContent = "error: " + e; }
      };
    }
  });
});

// ── archive / diff via crumbs ─────────────────────────────
$("#crumbs")?.addEventListener("click", () => {});
// expose a small action menu via the … in topbar (we don't have one yet —
// expose archive via context menu on the sidebar workspace row).
$("#projects-tree")?.addEventListener("contextmenu", async (ev) => {
  const row = ev.target.closest(".ws-row");
  if (!row) return;
  ev.preventDefault();
  const id = row.dataset.workspaceId;
  const w = state.workspaces.find(x => x.id === id);
  if (!w) return;
  const choice = prompt(
    `Workspace "${w.name}" — type:\n  d = diff\n  a = archive\n  X = delete (irreversible)\n`,
    "d"
  );
  if (choice === "d") {
    try {
      const text = await invoke("workspace_diff", { id });
      showDiffPopup(w.name, text);
    } catch (e) { toast("diff failed: " + e, "error"); }
  } else if (choice === "a") {
    if (!confirm(`Archive "${w.name}"?`)) return;
    try {
      await invoke("workspace_archive", { id });
      await loadAll();
      if (state.activeWorkspaceId === id) setActiveWorkspace(null);
      toast("archived", "ok");
    } catch (e) { toast("archive failed: " + e, "error"); }
  } else if (choice === "X") {
    if (!confirm(`Permanently DELETE "${w.name}"? Worktree removed.`)) return;
    try {
      await invoke("workspace_delete", { id });
      await loadAll();
      if (state.activeWorkspaceId === id) setActiveWorkspace(null);
    } catch (e) { toast("delete failed: " + e, "error"); }
  }
});

function showDiffPopup(name, text) {
  // Use the new-ws dialog's machinery: create a one-off popup
  let dlg = document.getElementById("diff-popup");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "diff-popup";
    dlg.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <h2 id="dp-title">Diff</h2>
      <button id="dp-close">×</button>
    </div>
    <pre id="dp-body" style="font-family:ui-monospace,Menlo,monospace;font-size:11px;max-height:70vh;overflow:auto;white-space:pre;background:var(--bg);padding:12px;border-radius:6px;"></pre>`;
    document.body.appendChild(dlg);
    dlg.querySelector("#dp-close").onclick = () => dlg.close();
  }
  dlg.querySelector("#dp-title").textContent = `Diff: ${name}`;
  dlg.querySelector("#dp-body").textContent = text || "(no diff)";
  dlg.style.width = "min(900px, 90vw)";
  dlg.showModal();
}

// ── right-panel "All files" / "Changes" tab switching ───
function switchRTab(which) {
  $$(".r-tab").forEach(t => t.classList.toggle("active", t.dataset.rtab === which));
  $("#r-files").classList.toggle("hidden", which !== "files");
  $("#r-changes").classList.toggle("hidden", which !== "changes");
  if (which === "changes") {
    const w = state.workspaces.find(x => x.id === state.activeWorkspaceId);
    if (w) renderChanges(w);
  }
}
document.addEventListener("click", (ev) => {
  const t = ev.target.closest(".r-tab");
  if (t && t.dataset.rtab) switchRTab(t.dataset.rtab);
});

// ── custom dropdown plumbing ────────────────────────────
// Wires every `.dd` element: trigger toggles the menu, item click sets both
// the visible label and the hidden <input>, outside click closes. Idempotent.
function wireDropdowns() {
  $$(".dd").forEach(dd => {
    if (dd.dataset.wired) return;
    dd.dataset.wired = "1";
    const trig = dd.querySelector(".dd-trigger");
    const menu = dd.querySelector(".dd-menu");
    const label = dd.querySelector(".dd-label");
    const valueInput = dd.querySelector("input[type=hidden]");
    trig.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !menu.classList.contains("hidden");
      $$(".dd-menu").forEach(m => m.classList.add("hidden"));
      if (!open) menu.classList.remove("hidden");
    });
    menu.querySelectorAll(".dd-item").forEach(item => {
      item.addEventListener("click", () => {
        const v = item.dataset.value;
        if (label) label.textContent = v;
        if (valueInput) {
          valueInput.value = v;
          valueInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        menu.querySelectorAll(".dd-item").forEach(i =>
          i.classList.toggle("selected", i === item));
        menu.classList.add("hidden");
      });
    });
  });
}
document.addEventListener("click", (ev) => {
  if (!ev.target.closest(".dd")) {
    $$(".dd-menu").forEach(m => m.classList.add("hidden"));
  }
});

// Programmatically set a dropdown's value (label + hidden input).
// `arg` can be the .dd element itself OR the id of the hidden input inside it.
function ddSetValue(arg, value) {
  const dd = typeof arg === "string"
    ? document.querySelector(`#${arg}`)?.closest(".dd")
    : arg;
  if (!dd) return;
  const label = dd.querySelector(".dd-label");
  const valueInput = dd.querySelector("input[type=hidden]");
  if (label) label.textContent = value;
  if (valueInput) valueInput.value = value;
  dd.querySelectorAll(".dd-item").forEach(i =>
    i.classList.toggle("selected", i.dataset.value === value));
}

// ── attention / unread tracking (per-tab) ────────────────
function markTabAttention(wsId, tab, reason) {
  const w = state.workspaces.find(x => x.id === wsId);
  const isActiveWs = wsId === state.activeWorkspaceId;
  const isActiveTab = tab.id === stateActiveTabFor(wsId);
  const ageSinceOutput = tab.lastOutputAt ? Date.now() - tab.lastOutputAt : null;
  const ageSinceInput = tab.lastInputAt ? Date.now() - tab.lastInputAt : null;
  invoke("log_line", { msg: `markTabAttention ws=${w?.name} cli=${tab.cli} reason=${reason} isActiveWs=${isActiveWs} isActiveTab=${isActiveTab} ageSinceOutput=${ageSinceOutput}ms ageSinceInput=${ageSinceInput}ms` }).catch(()=>{});
  // If the user is already looking at this exact tab, no badge.
  if (isActiveWs && isActiveTab) return;
  const now = Date.now();
  if (tab.unread && now - tab.unread.since < ATTENTION_DEBOUNCE_MS) {
    tab.unread.reason = reason;
    return;
  }
  tab.unread = { reason, since: now };
  invoke("log_line", { msg: `  -> set unread reason=${reason} ws=${w?.name}` }).catch(()=>{});
  renderSidebar();
  // If this tab belongs to the currently-active workspace, also refresh the
  // tab bar so the tab dot lights up immediately.
  if (wsId === state.activeWorkspaceId) renderTabs(state.workspaces.find(x => x.id === wsId));
  if (w) {
    const body = reason === "bell" ? "agent rang the bell"
              : reason === "exit" ? "process exited"
              : reason === "idle" ? "agent is idle / waiting"
              : "needs attention";
    invoke("notify", { title: `${w.name} · ${tab.cli || w.cli}`, body }).catch(()=>{});
  }
}

// Idle poller (per tab). Fires only when the agent actually responded to user
// input and then went silent — boot-and-wait doesn't trigger.
setInterval(() => {
  const now = Date.now();
  for (const [wsId, tabs] of state.chatTabs) {
    for (const tab of tabs) {
      if (tab.type !== "terminal" || !tab.ptyId) continue;
      if (wsId === state.activeWorkspaceId && tab.id === stateActiveTabFor(wsId)) continue;
      if (tab.unread) continue;
      const lastOut = tab.lastOutputAt;
      const lastIn = tab.lastInputAt;
      if (!lastOut || !lastIn) continue;
      if (lastOut <= lastIn) continue;
      if (now - lastOut < IDLE_MS) continue;
      markTabAttention(wsId, tab, "idle");
    }
  }
}, 2000);

// ── terminal diagnostics (⌘⇧D) ──────────────────────────
// Dumps everything the fit/PTY layer "thinks" about the active tab's
// terminal so we can see WHY gemini/claude render into half the pane.
// Output goes to the debug log AND the toast.
function diagnoseActiveTerminal() {
  const wsId = state.activeWorkspaceId;
  if (!wsId) { toast("no active workspace", "error"); return; }
  const tabs = state.chatTabs.get(wsId) || [];
  const tab = tabs.find(t => t.id === stateActiveTabFor(wsId));
  if (!tab || tab.type !== "terminal") { toast("active tab isn't a terminal", "error"); return; }
  const host = tab.host;
  const container = host?.parentElement;
  const xtermEl = host?.querySelector(".xterm");
  const screen = host?.querySelector(".xterm-screen");
  const viewport = host?.querySelector(".xterm-viewport");
  const dump = {
    cli: tab.cli,
    ptyId: tab.ptyId?.slice(0, 8),
    xterm: { rows: tab.term?.rows, cols: tab.term?.cols },
    container: container ? { w: container.clientWidth, h: container.clientHeight } : null,
    host: host ? { w: host.clientWidth, h: host.clientHeight } : null,
    xtermDiv: xtermEl ? { w: xtermEl.clientWidth, h: xtermEl.clientHeight } : null,
    screen: screen ? { w: screen.clientWidth, h: screen.clientHeight } : null,
    viewport: viewport ? { w: viewport.clientWidth, h: viewport.clientHeight } : null,
    // Approximate cell size
    cellHeight: screen ? screen.clientHeight / (tab.term?.rows || 1) : null,
  };
  const lines = ["===== terminal diagnostic ====="];
  for (const [k, v] of Object.entries(dump)) {
    lines.push(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
  // Force refit + log new state
  try { tab.fit.fit(); } catch (e) {}
  lines.push(`  after refit: term=${tab.term?.cols}x${tab.term?.rows}`);
  invoke("pty_resize", { ptyId: tab.ptyId, rows: tab.term.rows, cols: tab.term.cols }).catch(()=>{});
  lines.push(`  pushed pty_resize → ${tab.term.cols}x${tab.term.rows}`);
  const msg = lines.join("\n");
  invoke("log_line", { msg }).catch(()=>{});
  console.log(msg);
  toast(`diag → ${tab.term?.cols}x${tab.term?.rows} cell≈${Math.round(dump.cellHeight)}px`, "ok");
}

// ── global keybindings ───────────────────────────────────
window.addEventListener("keydown", (ev) => {
  const tag = (ev.target?.tagName || "").toLowerCase();
  const typingInForm = ["input", "textarea", "select"].includes(tag);

  // ⌘⇧D — dump terminal diagnostics
  if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === "d") {
    if (typingInForm) return;
    ev.preventDefault();
    diagnoseActiveTerminal();
    return;
  }

  // ⌘L (⌃L) → focus the active workspace's main terminal.
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "l") {
    if (typingInForm) return;
    const wsId = state.activeWorkspaceId;
    if (wsId) {
      const tabs = state.chatTabs.get(wsId) || [];
      const tab = tabs.find(t => t.id === stateActiveTabFor(wsId));
      if (tab?.term) {
        ev.preventDefault();
        try { tab.term.focus(); } catch (e) {}
      }
    }
    return;
  }

  // ⌘1..⌘9 (⌃1..⌃9) → switch to the Nth workspace (across all projects, in
  // sidebar order). Skips when typing in a form.
  if ((ev.metaKey || ev.ctrlKey) && /^[1-9]$/.test(ev.key)) {
    if (typingInForm) return;
    const ordered = state.projects.flatMap(p =>
      state.workspaces.filter(w => w.project_id === p.id && !w.archived)
    );
    const ws = ordered[parseInt(ev.key, 10) - 1];
    if (ws) {
      ev.preventDefault();
      setActiveWorkspace(ws.id);
    }
    return;
  }
});

// ── boot ─────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  wireDropdowns();
  bindNewTabDirect();
  // Restore the compact-sidebar preference before first paint so the layout
  // doesn't flash at full width then snap narrow.
  try {
    if (localStorage.getItem("compactSidebar") === "1") {
      $("#app").classList.add("compact-sidebar");
    }
  } catch {}
  // Inject brand SVGs into the CLI-picker pills in the New Workspace dialog.
  $$("#nw-cli-pills .cli-pill").forEach(p => {
    const slot = p.querySelector(".ic");
    if (slot && !slot.innerHTML.trim()) slot.innerHTML = cliIcon(p.dataset.cli);
  });
  await loadAll();
  // Default landing view: Dashboard (lists active workspaces). Beats the
  // bare "pick a workspace" empty state on first launch.
  $$(".sb-item").forEach(i => i.classList.toggle("active", i.dataset.view === "dashboard"));
  showDashboard();
  // First-launch wizard (no-op on subsequent boots).
  maybeShowWelcome();
  // Re-sync whenever the window regains focus — catches edits to the JSON
  // files from another process or terminal.
  window.addEventListener("focus", () => loadAll());
  // Window resize → refit every live terminal so PTY cols/rows stay accurate.
  let resizeRaf;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      for (const t of state.terms.values()) {
        try { t.fit.fit(); } catch (e) {}
      }
    });
  });
  // Also refit when the user toggles the side/right panels.
  const o = new MutationObserver(() => {
    for (const t of state.terms.values()) {
      try { t.fit.fit(); } catch (e) {}
    }
  });
  o.observe($("#app"), { attributes: true, attributeFilter: ["class"] });
});

// expose for console debugging
window.termic = { state, loadAll, archiveActiveWorkspace };
};
