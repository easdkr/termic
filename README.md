# termic

Tauri GUI orchestrator for parallel coding-agent sessions, each in its own
**Ghostty** terminal window. Reproduces the core termic.dev UX:

- 1 task = 1 git worktree + 1 branch + 1 agent (claude / gemini / codex)
- Each task gets its own Ghostty window, titled `dpf:<task-name>`
- The Tauri GUI shows the task list and lets you create / focus / diff / land / drop
- Task state is detected by querying Ghostty via AppleScript

Sibling project to `~/Work/Opt/dpf_agents` — when present, agents launch
through `dpf_agents/lib/bin/sandbox-cli` (sandboxed). Otherwise unsandboxed.

## Run / build

```sh
cd ~/Work/Opt/termic

# dev mode (live reload of frontend; Rust rebuilds on save)
npm run tauri dev          # or: just dev

# release build → src-tauri/target/release/bundle/macos/termic.app
# `prebuild` runs scripts/fetch-deps.sh to copy /Applications/Ghostty.app
# into src-tauri/vendor/ so it's embedded inside the .app bundle.
npm run tauri build        # or: just build
```

## Embedded dependencies

The release bundle is **self-contained**. `npm run tauri build` invokes
`scripts/fetch-deps.sh` first, which populates `src-tauri/vendor/` with:

| Item | Source | Bundled at | Size |
|---|---|---|---|
| `Ghostty.app` | `/Applications/Ghostty.app` (or upstream dmg) | `Contents/Resources/_up_/vendor/Ghostty.app` inside `termic.app` | ~62 MB |

`vendor/` is **gitignored**; the script repopulates it before each build.

At runtime, `ghostty_app_path()` resolves in this order:
1. `/Applications/Ghostty.app` if present (use the user's install — respects their config / fonts / themes)
2. `<termic.app>/Contents/Resources/vendor/Ghostty.app` (the bundled fallback — works on a fresh machine)
3. Error toast if neither exists

This means: users with Ghostty already installed get their own configured terminal; users without Ghostty still have a working app because Ghostty was bundled.

To also embed `gh`:

```sh
./scripts/fetch-deps.sh all      # ghostty + gh
```

(Plus a corresponding entry in `tauri.conf.json` `bundle.resources` — currently only Ghostty is wired.)

## How it works

| Concern | Mechanism |
|---|---|
| Spawn a window | `open -na Ghostty.app --args --working-directory=… --title=dpf:<name> -e bash -lc 'env; exec <cli>'` |
| Focus a window | `osascript`: `tell application "Ghostty" … set index of w to 1 …` |
| Detect alive | AppleScript loops windows, returns `true`/`false` for name match |
| Close on drop | AppleScript `close w` on the matching window |
| State storage | `~/Library/Application Support/termic/tasks/<name>.json` |
| Worktree location | `~/Library/Application Support/termic/worktrees/<repo>__<task>/` |
| Sandboxed launch | `dpf_agents/lib/bin/sandbox-cli <cli>` if path exists, else `<cli>` directly |
| Per-task env | `TERMIC_PORT`, `TERMIC_TASK`, `TERMIC_WORKSPACE_NAME` |

## Why Ghostty (not xterm.js in the webview)

Three options were considered:
- **libghostty embedded** — months-away alpha (only the VT parser is in libghostty-vt today; not a paneable widget). Out for now.
- **Ghostty as child process per task** ← chosen — native terminal, full Ghostty config, zero embedding work. Each task = a real OS window.
- xterm.js in the webview — works but loses Ghostty (font rendering, GPU, themes).

Trade-off: tasks live in OS windows, not embedded in the GUI. You see the
control plane in the termic window and switch to the agent's Ghostty
window via the Focus button (or just ⌘+Tab).

## Layout

```
termic/
├── src/                     # frontend (vanilla HTML/JS/CSS)
│   ├── index.html
│   ├── main.js
│   └── styles.css
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── src/lib.rs           # all Tauri commands + Ghostty integration
├── justfile
├── package.json
└── README.md
```

## Tauri commands exposed

| command | args | purpose |
|---|---|---|
| `cmd_repos` | – | enumerate repos under `~/Work/Opt/dpf_agents/repos/` and `~/Work/Repos/` |
| `cmd_list` | – | list all tasks |
| `cmd_new` | `repo, name, cli?, base?` | create worktree + branch + spawn Ghostty |
| `cmd_focus` | `name` | bring task's Ghostty window to front |
| `cmd_diff` | `name` | `git log` + `git diff --stat` + full diff vs base |
| `cmd_land` | `name, mode` | `pr` (gh pr create --fill --draft) or `merge` (local --no-ff) |
| `cmd_drop` | `name` | close window, remove worktree, delete merged branch |
| `cmd_alive` | `name` | true if task's Ghostty window is still open |

## Requirements

**To build:**
- macOS (uses AppleScript and `open -na Ghostty.app`)
- Rust (rustup) — `cargo check` succeeds with `rustc 1.95+`
- Node.js 20+ (for the Tauri CLI)
- Ghostty in `/Applications/` at build time so `fetch-deps.sh` can copy it (or use the upstream-dmg fallback in the script)
- `gh` CLI if you want PR-mode landing

**To run the bundled .app:**
- macOS 12+
- Nothing else — Ghostty is embedded.

**Status:**
- ✅ Backend compiles cleanly (release profile, 0 warnings — `cargo check --release` passes)
- ✅ Ghostty spawn verified via `open -na Ghostty.app --args -e …`
- ⏳ Not yet visually tested — `npm run tauri dev` to confirm the UI
