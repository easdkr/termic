// User-visible UI preferences (separate from app data and transient UI state).
// Persisted to localStorage so they survive launches. Currently just the mono
// font, but built for future things (themes, terminal opacity, etc.).

import { create } from "zustand";
import { listMonospaceFonts } from "@/lib/ipc";
import {
  DEFAULT_BINDINGS,
  type Binding,
  type BindingMap,
  type ShortcutId,
} from "@/lib/shortcuts";

const LS_EDITOR_FONT   = "editorFont";
const LS_EDITOR_THEME  = "editorThemeId";
const LS_TERMINAL_FONT = "terminalFont";
const LS_TERMINAL_SIZE = "terminalFontSize";
const LS_EDITOR_SIZE   = "editorFontSize";
const LS_LIGATURES     = "codeLigatures";
const LS_THEME         = "themeMode";
const LS_YOLO          = "yoloMode";
const LS_DESKTOPNOTIF  = "desktopNotifications";
const LS_SETTLED_HIGHLIGHT = "settledHighlight";
const LS_DEFAULT_SANDBOX = "globalDefaultSandbox";
const LS_SANDBOX_BYPASS  = "sandboxBypassPermissions";
const LS_TERMINAL_LETTERSPACING = "terminalLetterSpacing";
const LS_TERMINAL_SCROLLBACK   = "terminalScrollback";
const LS_WS_EXPAND_MODE = "workspaceExpandMode";
const LS_SHORTCUTS     = "shortcutBindings";

// Linear is the only theme. Legacy themes (claude, dark, light, etc.) were
// removed to keep the UI consistent. The theme system is kept as a minimal
// stub so existing localStorage values don't crash on load.
export type ThemeMode = "linear";
export type ResolvedTheme = "linear";

function parseThemeMode(raw: string): ThemeMode {
  return "linear";
}

/** Static Linear xterm theme — no switching, no lookup table. */
const LINEAR_TERMINAL_THEME: Record<string, string> = {
  background: "#0E0E10",
  foreground: "#F0F0F5",
  cursor: "#5E6AD2",
  cursorAccent: "#0E0E10",
  selectionBackground: "rgba(94,106,210,0.45)",
  black: "#1a1a1f", red: "#ef5350", green: "#4caf50", yellow: "#f0b13a",
  blue: "#5E6AD2", magenta: "#a78bfa", cyan: "#22d3ee", white: "#eceef1",
  brightBlack: "#6e6e7a", brightRed: "#ff6b66", brightGreen: "#7cd57e", brightYellow: "#ffd166",
  brightBlue: "#8b98ff", brightMagenta: "#d7a4ff", brightCyan: "#67e8f9", brightWhite: "#ffffff",
};

export function currentTerminalTheme(): Record<string, string> {
  return LINEAR_TERMINAL_THEME;
}

/** COLORFGBG — always dark-family since Linear is dark-only. */
export function currentColorFgBg(): string {
  return "15;0";
}

// Curated list of monospace fonts we probe for. JetBrains Mono ships
// locally via @fontsource so it's always present; the rest are detected at
// runtime via document.fonts.check(). We don't enumerate the system font
// catalog (WKWebView has no API for it) — this list covers ~95% of what real
// devs install. Add yours here if missing.
export const MONO_FONT_OPTIONS: { id: string; label: string; stack: string }[] = [
  { id: "jetbrains",     label: "JetBrains Mono",        stack: `"JetBrains Mono", monospace` },
  { id: "sfmono",        label: "SF Mono",               stack: `"SF Mono", ui-monospace, monospace` },
  { id: "menlo",         label: "Menlo",                 stack: `Menlo, monospace` },
  { id: "monaco",        label: "Monaco",                stack: `Monaco, monospace` },
  { id: "firacode",      label: "Fira Code",             stack: `"Fira Code", monospace` },
  { id: "firamono",      label: "Fira Mono",             stack: `"Fira Mono", monospace` },
  { id: "cascadiacode",  label: "Cascadia Code",         stack: `"Cascadia Code", monospace` },
  { id: "cascadiamono",  label: "Cascadia Mono",         stack: `"Cascadia Mono", monospace` },
  { id: "hack",          label: "Hack",                  stack: `Hack, monospace` },
  { id: "sourcecodepro", label: "Source Code Pro",       stack: `"Source Code Pro", monospace` },
  { id: "ibmplex",       label: "IBM Plex Mono",         stack: `"IBM Plex Mono", monospace` },
  { id: "geist",         label: "Geist Mono",            stack: `"Geist Mono", monospace` },
  { id: "iosevka",       label: "Iosevka",               stack: `Iosevka, monospace` },
  { id: "iosevkaterm",   label: "Iosevka Term",          stack: `"Iosevka Term", monospace` },
  { id: "iosevkanf",     label: "Iosevka Nerd Font",     stack: `"Iosevka Nerd Font", monospace` },
  { id: "victormono",    label: "Victor Mono",           stack: `"Victor Mono", monospace` },
  { id: "operatormono",  label: "Operator Mono",         stack: `"Operator Mono", monospace` },
  { id: "monolisa",      label: "MonoLisa",              stack: `MonoLisa, monospace` },
  { id: "berkeleymono",  label: "Berkeley Mono",         stack: `"Berkeley Mono", monospace` },
  { id: "commitmono",    label: "Commit Mono",           stack: `"Commit Mono", monospace` },
  { id: "comicmono",     label: "Comic Mono",            stack: `"Comic Mono", monospace` },
  { id: "comicshanns",   label: "Comic Shanns Mono",     stack: `"Comic Shanns Mono", monospace` },
  { id: "inconsolata",   label: "Inconsolata",           stack: `Inconsolata, monospace` },
  { id: "ubuntumono",    label: "Ubuntu Mono",           stack: `"Ubuntu Mono", monospace` },
  { id: "robotomono",    label: "Roboto Mono",           stack: `"Roboto Mono", monospace` },
  { id: "spacemono",     label: "Space Mono",            stack: `"Space Mono", monospace` },
  { id: "anonymouspro",  label: "Anonymous Pro",         stack: `"Anonymous Pro", monospace` },
  { id: "dejavusansmono",label: "DejaVu Sans Mono",      stack: `"DejaVu Sans Mono", monospace` },
  { id: "ptmono",        label: "PT Mono",               stack: `"PT Mono", monospace` },
  { id: "courierprime",  label: "Courier Prime",         stack: `"Courier Prime", monospace` },
  { id: "courier",       label: "Courier",               stack: `Courier, monospace` },
  { id: "couriernew",    label: "Courier New",           stack: `"Courier New", monospace` },
  { id: "consolas",      label: "Consolas",              stack: `Consolas, monospace` },
  { id: "lucidaconsole", label: "Lucida Console",        stack: `"Lucida Console", monospace` },
  { id: "andalemono",    label: "Andale Mono",           stack: `"Andale Mono", monospace` },
  { id: "monoid",        label: "Monoid",                stack: `Monoid, monospace` },
  { id: "monofur",       label: "Monofur",               stack: `Monofur, monospace` },
  { id: "anonymice",     label: "AnonymicePro Nerd Font", stack: `"AnonymicePro Nerd Font", monospace` },
  { id: "hasklig",       label: "Hasklig",               stack: `Hasklig, monospace` },
  { id: "input",         label: "Input Mono",            stack: `"Input Mono", monospace` },
  { id: "monaspaceneon", label: "Monaspace Neon",        stack: `"Monaspace Neon", monospace` },
  { id: "monaspaceradon",label: "Monaspace Radon",       stack: `"Monaspace Radon", monospace` },
  { id: "monaspaceargon",label: "Monaspace Argon",       stack: `"Monaspace Argon", monospace` },
  { id: "monaspacekrypton",label:"Monaspace Krypton",    stack: `"Monaspace Krypton", monospace` },
  { id: "monaspacexenon",label: "Monaspace Xenon",       stack: `"Monaspace Xenon", monospace` },
  { id: "intel",         label: "Intel One Mono",        stack: `"Intel One Mono", monospace` },
  // Meslo + the Powerline / Nerd Font patched variants — popular in iTerm2 setups.
  { id: "meslolgs",      label: "Meslo LG S",            stack: `"Meslo LG S", monospace` },
  { id: "meslolgm",      label: "Meslo LG M",            stack: `"Meslo LG M", monospace` },
  { id: "meslolgl",      label: "Meslo LG L",            stack: `"Meslo LG L", monospace` },
  { id: "meslolgsnf",    label: "MesloLGS NF",           stack: `"MesloLGS NF", "MesloLGS Nerd Font", monospace` },
  { id: "meslolgmnf",    label: "MesloLGM NF",           stack: `"MesloLGM NF", "MesloLGM Nerd Font", monospace` },
  { id: "meslolglnf",    label: "MesloLGL NF",           stack: `"MesloLGL NF", "MesloLGL Nerd Font", monospace` },
  { id: "meslopl",       label: "Meslo LG S for Powerline", stack: `"Meslo LG S for Powerline", monospace` },
];


/** Returns the subset of MONO_FONT_OPTIONS whose primary face is actually
 *  installed (always includes the bundled JetBrains Mono). Synchronous —
 *  for the *full* system enumeration use availableMonoFontsAsync(). */
export function availableMonoFonts() {
  // Always return the full curated list. Canvas-based installed-detection
  // is unreliable inside WKWebView for faces with unusual naming (Meslo's
  // "Meslo LG S" vs "MesloLGS", Powerline / Nerd Font variants, etc.) —
  // previous filter dropped Meslo entirely on macs that clearly had it
  // installed. If the user picks a font they don't have, the CSS stack
  // falls back to `monospace`, which is harmless.
  return MONO_FONT_OPTIONS;
}

// Process-wide cache for the Rust-enumerated list. Populated by the first
// availableMonoFontsAsync() call, kept until the app exits.
let _systemFontsCache: string[] | null = null;

/** Returns the curated installed list MERGED with every monospace font Rust
 *  finds via font-kit. Fonts not in the curated map get an auto-generated
 *  entry (id = "system:<name>", label = family name, stack = family). */
export async function availableMonoFontsAsync(): Promise<typeof MONO_FONT_OPTIONS> {
  const curated = availableMonoFonts();
  if (!_systemFontsCache) {
    try { _systemFontsCache = await listMonospaceFonts(); }
    catch { _systemFontsCache = []; }
  }
  // Names already covered by curated (case-insensitive match against the
  // first family in each stack) — we keep the curated entry so the brand
  // label / id stays stable across launches.
  const covered = new Set(curated.map(o =>
    o.stack.split(",")[0].trim().replace(/^"|"$/g, "").toLowerCase()
  ));
  const extras = _systemFontsCache
    .filter(name => !covered.has(name.toLowerCase()))
    .map(name => ({
      id: `system:${name}`,
      label: name,
      stack: `"${name}", monospace`,
    }));
  return [...curated, ...extras];
}

/** Resolve a font id → CSS font-family stack, defaulting to JetBrains. */
function stackFor(id: string) {
  const opt = MONO_FONT_OPTIONS.find(o => o.id === id) || MONO_FONT_OPTIONS[0];
  return opt.stack;
}

interface PrefsState {
  /** YOLO mode — appends each agent's "auto-approve everything" flag to its
   *  spawn args. Toggleable from the unified bar. For agents that support
   *  runtime mode-switching, live PTYs receive a slash command on
   *  toggle; for the rest (claude/codex), new tabs pick it up but existing
   *  PTYs need a respawn. */
  yoloMode: boolean;
  /** Send OS notifications when an inactive tab's agent settles (output
   *  stopped changing). OFF by default — too noisy for many users. */
  desktopNotifications: boolean;
  /** Highlight workspaces / tabs whose agent has just settled (idle).
   *  ON by default — the brand-color icon swap on settle is the
   *  in-app "done" signal. Some users find it distracting and want
   *  the sidebar to stay calm regardless. */
  settledHighlight: boolean;
  /** Default for the NewWorkspaceDialog's Sandbox toggle when neither
   *  the project's `default_sandbox` nor an explicit user pick is in
   *  effect. Lets a single-keystroke toggle apply across all projects
   *  without per-project bookkeeping. */
  globalDefaultSandbox: boolean;
  /** When a workspace is sandboxed, auto-pass the agent's "bypass
   *  permissions" (YOLO) flag at spawn even if the YOLO toggle is off.
   *  ON by default: the seatbelt cage is the real security boundary, so
   *  the agent's own permission prompts are just friction. Users who
   *  still want the agent to ask inside a sandbox can turn this off. */
  sandboxBypassPermissions: boolean;
  /** Kept for backward compat; always "linear". */
  themeMode: ThemeMode;
  /** Font for the CodeMirror editor + diff viewer. */
  editorFontId: string;
  /** Syntax theme for the editor + diff viewer (atomone, tokyo-night, …).
   *  Independent of the app `themeMode` — the surface still tracks the
   *  app palette, only the token colors come from this. */
  editorThemeId: string;
  /** Font for the xterm terminals (main + aux). Kept separate because power
   *  users often want a Nerd Font for the shell but a clean prose-friendly
   *  font for the editor. */
  terminalFontId: string;
  /** xterm font size in px. Editor size is currently fixed at 13. */
  terminalFontSize: number;
  /** Extra pixels added to each xterm cell's advance. xterm.js measures
   *  the natural glyph advance and rounds to integer px, which produces
   *  a tighter cell than iTerm/Terminal.app at the same font. Bumping
   *  to 1 or 2 px adds the cushion. Integer only — fractional values
   *  misalign the WebGL atlas. */
  terminalLetterSpacing: number;
  /** Lines of scrollback kept in agent terminals. Aux terminal uses half this value. */
  terminalScrollback: number;
  editorFontSize: number;
  /** Enable font ligatures (=>, !==, ...) in the editor. */
  codeLigatures: boolean;
  /** How a workspace row's tab list (its "agents") expands in the sidebar:
   *  - "chevron": only the chevron toggles. Row click just activates.
   *               No auto-expand. Default — most predictable.
   *  - "click":   click on the active row's title also toggles, AND the
   *               workspace auto-expands when it grows to 2+ agents.
   *  - "always":  workspaces are always expanded by default. The chevron
   *               still collapses, and that collapsed-state sticks. */
  workspaceExpandMode: "chevron" | "click" | "always";
  /** Resolved keyboard shortcut bindings (defaults merged with the user's
   *  overrides). Read live by `useShortcuts`; edited from the Shortcuts
   *  settings page. */
  shortcuts: BindingMap;

  setEditorFontId:    (id: string) => void;
  setEditorThemeId:   (id: string) => void;
  setTerminalFontId:  (id: string) => void;
  setTerminalFontSize:(px: number) => void;
  setTerminalLetterSpacing:(px: number) => void;
  setTerminalScrollback:  (n: number) => void;
  setEditorFontSize:  (px: number) => void;
  setCodeLigatures:   (v: boolean) => void;
  /** Restore every Appearance-section pref (fonts, sizes, weight,
   *  letter-spacing, ligatures) to `APPEARANCE_DEFAULTS`. */
  resetAppearance:    () => void;
  setThemeMode:       (m: ThemeMode) => void;
  setYoloMode:        (v: boolean) => void;
  setDesktopNotifications: (v: boolean) => void;
  setSettledHighlight: (v: boolean) => void;
  setGlobalDefaultSandbox: (v: boolean) => void;
  setSandboxBypassPermissions: (v: boolean) => void;
  setWorkspaceExpandMode: (m: "chevron" | "click" | "always") => void;
  /** Rebind a single shortcut. */
  setShortcut: (id: ShortcutId, binding: Binding) => void;
  /** Restore one shortcut to its factory binding. */
  resetShortcut: (id: ShortcutId) => void;
  /** Restore every shortcut to its factory binding. */
  resetAllShortcuts: () => void;
}

const lsGet = (k: string, fallback: string) => {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
};
const lsGetNum = (k: string, fallback: number) => {
  const v = Number(lsGet(k, String(fallback)));
  return Number.isFinite(v) ? v : fallback;
};
const lsGetBool = (k: string, fallback: boolean) => lsGet(k, fallback ? "1" : "0") === "1";

/** Resolve the stored keybinding overrides onto the defaults. Merging onto
 *  defaults (rather than trusting the stored blob) means commands added in a
 *  later version always have a binding even if the saved JSON predates them,
 *  and a malformed entry just falls back to its default. */
function loadShortcuts(): BindingMap {
  const merged: BindingMap = { ...DEFAULT_BINDINGS };
  try {
    const raw = localStorage.getItem(LS_SHORTCUTS);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, Partial<Binding>>;
      for (const id of Object.keys(merged) as ShortcutId[]) {
        const b = parsed[id];
        if (b && typeof b.key === "string"
            && typeof b.cmd === "boolean" && typeof b.shift === "boolean" && typeof b.alt === "boolean") {
          merged[id] = { cmd: b.cmd, shift: b.shift, alt: b.alt, key: b.key };
        }
      }
    }
  } catch {}
  return merged;
}

function persistShortcuts(map: BindingMap) {
  try { localStorage.setItem(LS_SHORTCUTS, JSON.stringify(map)); } catch {}
}

/** Factory defaults for the Appearance section — single source of
 *  truth for both first-launch fallbacks and the "Reset to defaults"
 *  button. Default weight is 500 (Medium), not 400: xterm's WebGL
 *  addon rasterizes glyphs through Canvas2D, and WKWebView's Canvas2D
 *  path renders noticeably lighter than Core Text (what iTerm /
 *  Terminal.app use). 500 closes most of that gap out of the box. */
export const APPEARANCE_DEFAULTS = {
  editorFontId:          "jetbrains",
  terminalFontId:        "jetbrains",
  terminalFontSize:      13,
  terminalLetterSpacing: 1,
  terminalScrollback:    5000,
  editorFontSize:        13,
  codeLigatures:         true,
} as const;

const initialEditorFont   = lsGet(LS_EDITOR_FONT, APPEARANCE_DEFAULTS.editorFontId);
const initialEditorTheme  = lsGet(LS_EDITOR_THEME, "atomone");
const initialTerminalFont = lsGet(LS_TERMINAL_FONT, APPEARANCE_DEFAULTS.terminalFontId);
const initialTerminalSize = lsGetNum(LS_TERMINAL_SIZE, APPEARANCE_DEFAULTS.terminalFontSize);
const initialTerminalLetterSpacing = Math.max(0, Math.round(lsGetNum(LS_TERMINAL_LETTERSPACING, APPEARANCE_DEFAULTS.terminalLetterSpacing)));
const initialTerminalScrollback    = Math.max(1000, Math.min(100000, Math.round(lsGetNum(LS_TERMINAL_SCROLLBACK, APPEARANCE_DEFAULTS.terminalScrollback))));
const initialEditorSize   = lsGetNum(LS_EDITOR_SIZE, APPEARANCE_DEFAULTS.editorFontSize);
const initialLigatures    = lsGetBool(LS_LIGATURES, APPEARANCE_DEFAULTS.codeLigatures);
const initialTheme        = parseThemeMode(lsGet(LS_THEME, "linear"));
const initialYolo         = lsGetBool(LS_YOLO, false);
const initialDesktopNotif = lsGetBool(LS_DESKTOPNOTIF, false);
// WIP feature - the "agent has settled" heuristic produces false
// positives often enough that the highlight is noise more than
// Default ON. Claude Code's title classifier (Braille spinner glyph
// while working, "✳" brand prefix when idle — see TerminalPane.tsx
// classifyTitle) gives us a reliable busy→idle edge for Claude;
// Codex have explicit "Ready"/"Working" title states. Existing
// users who toggled it OFF keep their setting (lsGetBool returns the
// stored value when present).
const initialSettledHighlight = lsGetBool(LS_SETTLED_HIGHLIGHT, true);
const initialDefaultSandbox = lsGetBool(LS_DEFAULT_SANDBOX, false);
// ON by default — sandboxed agents bypass their own permission prompts
// because the seatbelt is the real boundary. Users can opt out.
const initialSandboxBypass = lsGetBool(LS_SANDBOX_BYPASS, true);
const initialWsExpandMode: "chevron" | "click" | "always" = (() => {
  const raw = lsGet(LS_WS_EXPAND_MODE, "chevron");
  return raw === "click" || raw === "always" ? raw : "chevron";
})();

export const usePrefs = create<PrefsState>(set => ({
  themeMode: initialTheme,
  yoloMode: initialYolo,
  desktopNotifications: initialDesktopNotif,
  settledHighlight: initialSettledHighlight,
  globalDefaultSandbox: initialDefaultSandbox,
  sandboxBypassPermissions: initialSandboxBypass,
  editorFontId: initialEditorFont,
  editorThemeId: initialEditorTheme,
  terminalFontId: initialTerminalFont,
  terminalFontSize: initialTerminalSize,
  terminalLetterSpacing: initialTerminalLetterSpacing,
  terminalScrollback: initialTerminalScrollback,
  editorFontSize: initialEditorSize,
  codeLigatures: initialLigatures,
  workspaceExpandMode: initialWsExpandMode,
  shortcuts: loadShortcuts(),

  setEditorFontId: (id) => {
    try { localStorage.setItem(LS_EDITOR_FONT, id); } catch {}
    applyEditorFont(id);
    set({ editorFontId: id });
  },
  setEditorThemeId: (id) => {
    try { localStorage.setItem(LS_EDITOR_THEME, id); } catch {}
    set({ editorThemeId: id });
  },
  setTerminalFontId: (id) => {
    try { localStorage.setItem(LS_TERMINAL_FONT, id); } catch {}
    // Terminal font does NOT touch --font-mono (which the editor uses);
    // it's read by xterm directly via currentTerminalStack().
    set({ terminalFontId: id });
  },
  setTerminalFontSize: (px) => {
    try { localStorage.setItem(LS_TERMINAL_SIZE, String(px)); } catch {}
    set({ terminalFontSize: px });
  },
  setTerminalLetterSpacing: (px) => {
    // Clamp to non-negative integer. Fractional values misalign the
    // WebGL atlas; very high values break TUI column math.
    const clamped = Math.max(0, Math.min(6, Math.round(px)));
    try { localStorage.setItem(LS_TERMINAL_LETTERSPACING, String(clamped)); } catch {}
    set({ terminalLetterSpacing: clamped });
  },
  setTerminalScrollback: (n) => {
    const clamped = Math.max(1000, Math.min(100000, Math.round(n)));
    try { localStorage.setItem(LS_TERMINAL_SCROLLBACK, String(clamped)); } catch {}
    set({ terminalScrollback: clamped });
  },
  setEditorFontSize: (px) => {
    try { localStorage.setItem(LS_EDITOR_SIZE, String(px)); } catch {}
    set({ editorFontSize: px });
  },
  setCodeLigatures: (v) => {
    try { localStorage.setItem(LS_LIGATURES, v ? "1" : "0"); } catch {}
    set({ codeLigatures: v });
  },
  resetAppearance: () => {
    // Route through the individual setters so each one's side
    // effects fire (localStorage write, applyEditorFont, clamps).
    const d = APPEARANCE_DEFAULTS;
    const s = usePrefs.getState();
    s.setEditorFontId(d.editorFontId);
    s.setTerminalFontId(d.terminalFontId);
    s.setTerminalFontSize(d.terminalFontSize);
    s.setTerminalLetterSpacing(d.terminalLetterSpacing);
    s.setTerminalScrollback(d.terminalScrollback);
    s.setEditorFontSize(d.editorFontSize);
    s.setCodeLigatures(d.codeLigatures);
  },
  setThemeMode: (_m) => {
    // Theme switching removed — Linear only.
    set({ themeMode: "linear" });
  },
  setYoloMode: (v) => {
    try { localStorage.setItem(LS_YOLO, v ? "1" : "0"); } catch {}
    set({ yoloMode: v });
  },
  setDesktopNotifications: (v) => {
    try { localStorage.setItem(LS_DESKTOPNOTIF, v ? "1" : "0"); } catch {}
    set({ desktopNotifications: v });
  },
  setSettledHighlight: (v) => {
    try { localStorage.setItem(LS_SETTLED_HIGHLIGHT, v ? "1" : "0"); } catch {}
    set({ settledHighlight: v });
  },
  setGlobalDefaultSandbox: (v) => {
    try { localStorage.setItem(LS_DEFAULT_SANDBOX, v ? "1" : "0"); } catch {}
    set({ globalDefaultSandbox: v });
  },
  setSandboxBypassPermissions: (v) => {
    try { localStorage.setItem(LS_SANDBOX_BYPASS, v ? "1" : "0"); } catch {}
    set({ sandboxBypassPermissions: v });
  },
  setWorkspaceExpandMode: (m) => {
    try { localStorage.setItem(LS_WS_EXPAND_MODE, m); } catch {}
    set({ workspaceExpandMode: m });
  },
  setShortcut: (id, binding) => {
    const next = { ...usePrefs.getState().shortcuts, [id]: binding };
    persistShortcuts(next);
    set({ shortcuts: next });
  },
  resetShortcut: (id) => {
    const next = { ...usePrefs.getState().shortcuts, [id]: DEFAULT_BINDINGS[id] };
    persistShortcuts(next);
    set({ shortcuts: next });
  },
  resetAllShortcuts: () => {
    const next: BindingMap = { ...DEFAULT_BINDINGS };
    persistShortcuts(next);
    set({ shortcuts: next });
  },
}));

/** No-op: Linear is the only theme. Kept for API compat. */
export function resolveTheme(_mode: ThemeMode): "dark" {
  return "dark";
}

/** No-op: Linear is the only theme. Kept for API compat. */
export function resolveThemeFull(_mode: ThemeMode): ResolvedTheme {
  return "linear";
}

/** Apply the Linear theme class. Legacy multi-theme switching removed. */
export function applyTheme(_mode: ThemeMode) {
  const html = document.documentElement;
  html.classList.add("linear");
  html.style.colorScheme = "dark";
}

// Apply at module load so the first paint uses Linear.
applyTheme(initialTheme);

/** Editor font drives the --font-mono CSS var so any `font-mono` class +
 *  CodeMirror picks it up via `var(--font-mono)`. */
export function applyEditorFont(id: string) {
  document.documentElement.style.setProperty("--font-mono", stackFor(id));
}

export const currentEditorStack   = () => stackFor(usePrefs.getState().editorFontId);

/** Terminal font stack with a bundled fallback injected before the
 *  generic `monospace`. JetBrains Mono (static 400/700 masters) ships
 *  with the app and covers glyphs many monospace fonts lack — notably
 *  the Romanian comma-below ș/ț (U+0219/U+021B). Without it, a glyph
 *  missing from the chosen font falls back to the OS `monospace`. */
export const currentTerminalStack = () => {
  const stack = stackFor(usePrefs.getState().terminalFontId);
  return stack.replace(/\bmonospace\s*$/, '"JetBrains Mono", monospace');
};

// Apply editor font at module load so the first paint uses the right font.
applyEditorFont(initialEditorFont);
