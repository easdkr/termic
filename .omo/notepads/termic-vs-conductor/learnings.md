# termic-vs-conductor — learnings

## Task 1 — Shared feature types and persistence schema

**Date:** 2026-06-06
**Files touched:** `src/lib/types.ts`, `src-tauri/src/lib.rs`

### What was added

5 new TypeScript interfaces in `src/lib/types.ts` (mirrored on the Rust side):

- `ExternalDirLink` — `{ name, target_path }`; persisted on `Project.external_dir_links`.
- `GitHubCheckRun` — `id` (u64), `name`, `status`, `conclusion?`, `started_at`, `completed_at?`, `html_url`.
- `GitHubPullRequest` — `number` (u64), `title`, `body?`, `state`, `head_ref`, `base_ref`, `html_url`, `draft`, `checks_passing?`.
- `IssueSeed` — `source: IssueSource` ("github" | "linear"), `url`, `title`, `body?`. (Linear support is structural only; no real implementation yet.)
- `DiffInlineComment` — `id` (UUID), `path`, `line` (u32), `side: DiffSide` ("left" | "right"), `body`, `remote_id?`, `posted_at?`.

Plus `github_status?: GithubStatus` on both `Settings` and the existing `GithubStatus` Rust struct (reused, not duplicated — see below).

Two new Rust enums:
- `IssueSource` — `Github | Linear`, `#[serde(rename_all = "snake_case")]`.
- `DiffSide` — `Left | Right`, `#[serde(rename_all = "snake_case")]`.

### Things learned / conventions confirmed

- **Naming convention is snake_case in BOTH Rust and TS.** No camelCase on the wire. `root_path`, `is_repo_root`, `default_cli` — all snake_case in both languages. Rust field names == JSON keys (no `#[serde(rename_all = "camelCase")]`). Easy to forget; "fixing" the snake_case to camelCase would break the IPC contract.
- **`#[serde(default)]` on every persisted field is mandatory.** Every existing field on `Project` / `Settings` / `Workspace` has it; same convention for the new fields. Removing the default on a new field would silently break loading of any pre-existing `projects.json` / `settings.json` / `workspaces/<uuid>.json` on disk.
- **TS/Rust structs are kept in sync by hand, with a single header comment** ("Mirrors the Serde structs in src-tauri/src/lib.rs. Keep in sync.") at the top of `types.ts`. No codegen.
- **`Option<T>` for nullable fields.** Pattern is identical to the rest of the file: `conclusion: Option<String>`, `body: Option<String>`, `remote_id: Option<u64>`, etc.

### Gotchas hit during this task

1. **Pre-existing `GithubStatus` struct in `lib.rs` (lowercase 'b').** I initially created a duplicate `GitHubStatus` (capital 'B') for the new `Settings.github_status` field. Both had identical shape (`available` / `authenticated` / `username: Option<String>`), but having two near-identical types differing only in case is a footgun. **Refactored to reuse the existing `GithubStatus`** — added `Deserialize` to its derive list (it previously only had `Clone, Debug, Serialize, Default` because it was only ever returned by IPC, never persisted). Now the live one-shot `github_status` command and the cached `Settings.github_status` snapshot use the same type.

2. **Pre-existing E0716 lifetime error in `gh_resolve_path()`.** The function had `let probe = if cfg!(target_os = "windows") { Command::new("where").arg("gh") } else { Command::new("which").arg("gh") };` — the temporary `Command` was dropped before `probe.output()` borrowed from it. The pre-stash `cargo check` looked like it passed but was a stale cache hit; a clean rebuild surfaced the error. **Fix:** bind the `Command` to a `let mut probe: Command` after building it inside each branch. Added a comment explaining the gotcha so a future maintainer doesn't "simplify" it back to the broken form.

3. **`tsc -b` incremental cache flakiness after rapid edits.** After one round of edits, `npm run build` errored on `src/store/app.ts(83,17): Cannot find name 'GithubStatus'` — but the source on that line was `GitHubStatus` (capital B), imported on line 5. Re-running `npm run build` immediately after (no source changes in between) passed cleanly. Looks like the incremental build's cached "module shape" for `types.ts` lagged the actual file contents by one build. Not a real error — just a reminder that `tsc -b` is sensitive to file-system race conditions when edits land in quick succession. Re-running the same command is the right mitigation.

4. **Existing `Project { ... }` literal initializers needed the new field.** Two sites: `project_add` (single-repo) and `project_add_multi`. Both used struct-update style and now needed `external_dir_links: Vec::new(),`. This is the "compile-fail feedback" working as intended — `#[serde(default)]` only handles the deserialize path; literal construction must enumerate every field.

---

## Task 6 — GitHub capability detection and UI gating

**Date:** 2026-06-06
**Files touched:** `src-tauri/src/lib.rs`, `src/lib/ipc.ts`, `src/store/app.ts`
**Reuses from prior tasks:** `GithubStatus` struct (Task 1) on the Rust side, `GitHubStatus` interface (Task 1) in `types.ts`, and the `Settings.github_status` field (Task 1). No new types introduced.

### What was added

**Rust (`src-tauri/src/lib.rs`):**
- `gh_resolve_path()` — runs `which gh` (macOS/Linux) or `where gh` (Windows via `cfg!`); returns the resolved path or empty string.
- `parse_gh_auth_output(stdout)` — case-insensitive regex-light parser for `gh auth status` output. Looks for the `Logged in to github.com as <username>` pattern across both stdout and stderr. Returns the username or `None`.
- `gh_probe_auth()` — spawns `gh auth status`, captures BOTH streams (the "Logged in …" line moves between streams across gh versions), and returns `(authenticated, username)`. Defensive: if `gh` exits 1 but a username is still parseable (some gh versions exit 1 when a secondary check like token scopes fails, even though auth itself succeeded), trust the parsed username.
- `github_status_blocking()` — sync helper. If `gh` is missing, short-circuits to `{ available: false, authenticated: false, username: None }` so we never spawn `gh auth status` with no binary to run.
- `#[tauri::command] async fn github_status()` — IPC entry. `async` + `tauri::async_runtime::spawn_blocking` per the long-running-IPC discipline in `CLAUDE.md` (a cold `gh auth status` can take 200-500ms before the cached token check returns).
- Registered in `invoke_handler` next to `list_monospace_fonts` (both are environment-probe IPCs).

**TS (`src/lib/ipc.ts`):**
- Added `GitHubStatus` to the `import type { ... } from "./types"` block.
- `export const githubStatus = () => invoke<GitHubStatus>("github_status")` next to `detectClis` / `listMonospaceFonts`.
- `export type GithubStatus = GitHubStatus` alias to honor the task spec's `GithubStatus` casing while reusing the existing `GitHubStatus` from `types.ts` (same shape, different capital-H convention — Task 1 chose `GitHubStatus` to match the field name `github_status`).

**TS (`src/store/app.ts`):**
- Imported `GitHubStatus` from `@/lib/types`.
- Added `githubStatus: GitHubStatus | null` to the `AppState` interface.
- Added `refreshGithubStatus: () => Promise<void>` to the `AppState` interface.
- Initial value: `githubStatus: null` (UI gates must tolerate the not-yet-resolved state).
- `refreshGithubStatus` action: calls `ipc.githubStatus()`, sets state, swallows errors to keep the prior snapshot.
- `loadAll` ends with `void get().refreshGithubStatus();` — fire-and-forget so the projects/workspaces/settings load is not blocked by the `gh` probe.

### Things learned / conventions confirmed

- **Reuse existing types from `types.ts` rather than declaring parallel ones in `ipc.ts`.** Task 1 left a `GitHubStatus` interface (capital H) in `types.ts` that the `Settings` interface already references as `Settings.github_status?`. Adding a parallel `GithubStatus` in `ipc.ts` (lowercase h) would have created a near-duplicate that the type system would treat as distinct. The right move was `import { GitHubStatus } from "./types"` + a thin `export type GithubStatus = GitHubStatus` alias to honor the task spec's casing preference without duplicating the shape. Same pattern the file already uses for `CliInfo`.
- **`async fn` + `spawn_blocking` is the default for IPC that touches subprocesses**, even when the subprocess is expected to be fast. The `sandbox_available` / `home_dir` / `path_exists` / `notify` commands in the same file are sync because they touch no IO; the `detect_clis` / `list_monospace_fonts` / `github_status` commands are async because they spawn subprocesses or load system fonts. The split is well-established in this codebase — match the existing convention rather than reasoning about "is it really slow enough to need spawn_blocking".
- **TS casing asymmetry between Rust (`GithubStatus`) and TS (`GitHubStatus`) is intentional** — the Rust field `github_status: Option<GithubStatus>` (snake_case field, PascalCase type, lowercase 'h' in 'hub') maps to TS `github_status?: GitHubStatus` (snake_case key, PascalCase type, capital 'H'). Task 1 set this convention. Don't "fix" it to `GitHubStatus` in Rust — the existing `Settings` field + the existing struct instance all use `GithubStatus`.
- **`loadAll` does not need a separate "after refreshClis" hook** even though the task spec reads "Call `refreshGithubStatus()` inside `loadAll()` after `refreshClis()`". `refreshClis` is not currently called from `loadAll` (it's called from `App.tsx` mount and from `AgentsSection` mount). The right interpretation was: add `refreshGithubStatus()` to the end of `loadAll` after the existing `set({ ... })` call. That keeps `loadAll` non-blocking (via `void`) and avoids adding an `await` that would delay the UI's first paint of projects/workspaces.

### Gotchas hit during this task

1. **`GithubStatus` (lowercase 'h') vs `GitHubStatus` (capital 'H') confusion.** The first build failed with `error TS2724: '"@/lib/types"' has no exported member named 'GithubStatus'. Did you mean 'GitHubStatus'?` — the import in `app.ts` used the casing from the task spec, but the actual export in `types.ts` uses the other casing (Task 1 convention). Fixed by switching the import to `GitHubStatus` and relying on the `GithubStatus` alias in `ipc.ts` for spec compliance.

2. **`cfg!(target_os = "windows")` with the `Command` builder.** Initial code: `let probe = if cfg!(...) { Command::new("where").arg("gh") } else { Command::new("which").arg("gh") };` — the temporary `Command` was dropped at the end of the if-branch statement, so `probe.output()` (called next) borrowed a dropped value. Required binding to a `let mut probe: Command` with each branch constructing then returning its own `Command`. Worth keeping the inline comment that explains the gotcha — a future maintainer could easily "simplify" it back to the broken form.

3. **Capturing both stdout and stderr from `gh auth status`.** The `Logged in to github.com as <user>` line moves between stdout and stderr across `gh` versions (newer versions print it to stdout when auth succeeds, to stderr when it fails; older versions are consistent one way). Capturing only stdout would miss the username on a misclassified stream. Cheap insurance: concatenate both into a `combined` string and parse once.

4. **Defensive branch: `gh` exits 1 but `parse_gh_auth_output` finds a username.** Some `gh` versions exit 1 when auth succeeded but a secondary check (token scopes, git protocol config) failed. The non-zero exit code alone is not a reliable "not authenticated" signal — if the username is still in the output, trust it. The branch looks like dead code without the comment explaining the gh version quirk.

### Conductor comparison

Conductor's GitHub integration requires OAuth (`gh` is not used — it has its own auth token persisted in the app's data dir). Termic's stance is "use the user's existing `gh` install and never store tokens"; the `GithubStatus` snapshot is the entry point for the future PR/issue affordances to gate themselves ("Open PR" disabled when `!available`, grayed + tooltip "Run `gh auth login` first" when `!authenticated`). Conductor has none of this capability-detection surface — it just shows a single "Connect GitHub" button that opens the OAuth flow.

### Conductor comparison

Conductor doesn't expose the multi-repo-per-workspace / external-dir-link patterns, and its PR/issue integration is a one-way pipe (paste a URL → get a workspace). Termic's `IssueSeed` + `GitHubPullRequest` types are structured to round-trip in both directions: the agent can post back via `gh`, the `remote_id` is captured when it does, and the `posted_at` timestamp closes the loop. Conductor would need a similar refactor to support inline review comments on diffs (`DiffInlineComment`) — it has nothing equivalent today.

---

## Task 7 — `/add-dir` project settings UI

**Date:** 2026-06-07
**Files touched:** `src-tauri/src/lib.rs`, `src/lib/ipc.ts`, `src/components/settings/RepositorySection.tsx`

### Sub-tab choice for the new section

Picked a **new "Links" sub-tab**, placed between "Sandbox" and "More". Rationale: the existing tab order follows a convention documented in the file ("Scripts first → the thing you actually came here to tune, Files / Sandbox → focused single-concept tabs, More last → set-once metadata + irreversible Remove action at the bottom"). External directory links is a *focused single concept* with its own list/form/repair flow — it doesn't fit "set-once metadata" and it's larger than a one-line field in "More". A dedicated tab keeps the "More" tab from creeping into a junk drawer.

### Link name validation rules (mirrored on both sides)

The Rust `validate_link_name` rejects:
- empty (after trim) → `"link name cannot be empty"`
- contains `/` → `"invalid link name (no '/' allowed)"`
- contains `..` anywhere → `"invalid link name (no '..' allowed)"`
- starts with `.` → `"invalid link name (cannot start with '.')"`

The plan spec only required empty / `/` / `..`. I added the leading-dot rejection because a link named `.gitignore` or `.env` would create a hidden directory in every worktree and almost certainly surprise the user. The TS form has a client-side mirror of the same rules for faster feedback, but the Rust side is the authoritative check.

Gotcha: the `/` check runs *before* the `..` check, so `'../secrets'` is rejected as "no / allowed" (since `..` contains `/`). The `..` rejection is needed for the `a..b` shape (no `/` present). Either rule alone catches `'../secrets'`, but a future maintainer should NOT reorder these checks without thinking about the error message — the user expects to hear "no /" when they typed a path.

### Things learned / conventions confirmed

- **Reuse the existing `load_projects` / `save_projects` pattern for atomic IPC commands.** The new `external_dir_link_add` / `_remove` use the same `position()` + `clone()` + `save_projects(&list)` shape as the existing `project_set_members` (line 1342). The clone before `save_projects` is what releases the mutable borrow — without it, `save_projects(&list)` conflicts with the live `&mut Project` reference.
- **`drop(vec)` to release a borrow across two `load_*` calls.** `workspace_repair_links` needs the project_id (from a workspace) and the project name (from the project) before re-loading workspaces. The straightforward `find(&p| p.id == ...)` returns a `&Project` that borrows from the Vec; the second `load_workspaces()` call would conflict. Fix: snapshot the owned data we need (`project_name: String`, `links_snapshot: Vec<ExternalDirLink>`) and `drop(projects)` to release the borrow before the second load.
- **Reconstruct a minimal `Project` for the helper rather than passing owned `Vec<ExternalDirLink>` separately.** `materialize_external_dir_links` takes `&Project` (consistent with `&self` patterns elsewhere). The `..Project::default()` spread fills every other field with empty defaults — the helper only reads `external_dir_links` so the rest is noise. Cleaner than adding a second helper signature.
- **`async fn` + `spawn_blocking` is the right default for FS-iteration IPC, even when the work is "small in absolute terms".** `workspace_repair_links` iterates every active workspace of a project and calls `symlink` per link per workspace — sub-second on a normal project but still FS IO. Matches the convention from `workspace_archive` / `workspace_delete` / `list_monospace_fonts`. The simple add/remove commands stay sync (touch only `projects.json`, like `project_update`).
- **`symlink_metadata` (vs. `metadata`) is the correct call for the "something exists at this path" check.** `metadata` follows the symlink, so a dangling symlink to a deleted target would return Err and we'd *think* nothing was there. `symlink_metadata` reports the symlink itself without dereferencing — we can detect "a symlink or real file or real dir lives at this path" and decide what to do. This is a subtle correctness property; the inline comment on the call documents it.
- **JSX section banners inside sub-tabs match the existing file convention.** The existing `RepositorySection.tsx` has dozens of `{/* ... */}` JSX section dividers (e.g. `{/* Files to copy */}` line 438, `{/* Spotlight — lives in Scripts & run because... */}` line 463). The new component follows the same pattern. The sub-tab component itself doesn't need a JSDoc — the function name `ExternalDirLinksSection` is self-documenting in context.
- **TS IPC wrappers stay snake_case on the wire.** The wrapper takes `projectId, name, targetPath` (camelCase per the file's convention) but the Rust side reads `project_id, name, target_path` (snake_case per the project_id-field convention). Tauri's invoke arg-name conversion handles this for us when keys match the Rust arg names.

### Gotchas hit during this task

1. **Borrow checker on the symlink-already-correct path.** Initial draft of `materialize_external_dir_links` tried to use a single `if let Ok(existing) = fs::read_link(&target)` chain followed by `if existing == ... continue`. Cleaner as `if let Ok(existing) = ... { if existing == ... { continue; } /* fall through to skip-with-warning */ }` — the continue pattern + fall-through was the natural shape.

2. **Borrow checker on `external_dir_link_add` / `_remove`.** First draft used `let p = list.iter_mut().find(|p| p.id == project_id).ok_or(...)?;` then `p.external_dir_links.push(...)` then `save_projects(&list)`. The `Ok(p.clone())` at the end kept `p` (a `&mut Project` from `iter_mut().find`) alive across `save_projects(&list)` — E0502. Fix: use `let idx = list.iter().position(...)` (returns usize, not a borrow), operate via `list[idx]`, and `clone()` into a local `result` before `save_projects(&list)`. Pattern matches the existing `project_set_members` which works because the borrow is released after the field assignment.

3. **`workspace_repair_links` needed explicit `drop()` calls.** Initial draft kept the `&Project` borrow alive while calling `load_workspaces()` again to filter siblings. E0505 ("cannot move out of `projects` because it is borrowed"). Fix: snapshot owned data + `drop(projects)` to release the borrow. Then call `load_workspaces()` to get the siblings. The "minimal Project" reconstruction (with `..Project::default()`) lets us feed the same helper without re-borrowing.

4. **`'../secrets'` is caught by the `/` check, not the `..` check.** Documented in the validation section above. The first version returned the `..` error for `'../secrets'`, which is fine for correctness but means a maintainer reordering the checks to put `..` first would change the user-facing message. Not a bug, just worth a note.

5. **TS form's client-side validation runs INSIDE a closure (IIFE) for the nameError computation.** `const nameError = (() => { ... })();` — the IIFE returns the string-or-null synchronously. Alternative would be `useMemo` or inline `if` chains. The IIFE keeps the render method's JSX uncluttered and avoids the `useMemo` overhead for what's effectively a 5-line predicate.

### Conductor comparison

Conductor has no equivalent for project-level external directory links. The closest Conductor feature is its "Workspace files" (auto-discovered files in the same parent folder) — but those are passive and computed by the app, not user-declared. The symlink + name + skip-clobber semantics of Termic's `external_dir_links` are a stronger contract: user-chosen stable names, validated path inputs, on-create + on-repair materialization. Conductor's file exposure is read-only; Termic's links are writeable to whatever the agent has access to (subject to the workspace's seatbelt profile, naturally).

---

## Task 11 — Diff inline comment markers and editor UI

**Date:** 2026-06-07
**Files touched:** `src/store/app.ts`, `src/components/workspace/DiffPane.tsx`, `src/components/workspace/DiffCommentPopover.tsx` (new)

### What was added

**Store (`src/store/app.ts`):**
- `diffComments: Record<wsId, DiffInlineComment[]>` — flat list per workspace (the type's `path` + `side` + `line` fields handle the indexing).
- `addDiffComment(wsId, path, side, line, body) -> string | null` — trims body, returns `null` on empty (caller renders inline error).
- `updateDiffComment(id, body) -> boolean` — same validation, returns `false` on empty.
- `deleteDiffComment(id) -> void` — no-op if not found.
- `useDiffComments(wsId)` selector that falls back to a frozen `EMPTY_DIFF_COMMENTS` constant so the snapshot is referentially stable (matches the `EMPTY_TABS` pattern at `app.ts:840`).

**DiffPane (`src/components/workspace/DiffPane.tsx`):**
- A `CommentGutterMarker extends GutterMarker` subclass that renders an inline SVG (lucide `MessageSquare` for lines with comments, `MessageCirclePlus` for lines without). The SVG path data is hardcoded — `GutterMarker.toDOM()` is imperative DOM, so a React root per marker would be wasteful.
- `buildCommentGutter(side: "left" | "right"): Extension` factory that returns a `gutter({ class, lineMarker, domEventHandlers })`. Side-aware: the closure reads `leftSetRef.current` for the a-side and `linesWithCommentsRef.current` for the b-side + unified.
- A module-scoped `leftSetRef` + a `useRef` `linesWithCommentsRef`. A separate `useEffect` syncs the memoized `linesWithComments` (computed from `useDiffComments(wsId)` filtered by `tab.path`) into the refs. The closure reads lazily on the next `lineMarker` call → no Compartment reconfigure on every comment add / delete.
- Side detection at click time: `view.dom.classList.contains("cm-merge-a")` → "left", otherwise "right" (unified has neither class, treated as "right" because its visible line numbers come from the modified doc).
- `data-testid="diff-comment-add-<line>"` on every marker; `data-line="<N>"` too for any future selector that needs the side too.

**DiffCommentPopover (`src/components/workspace/DiffCommentPopover.tsx`, new):**
- `position: fixed`, anchored to the marker's `getBoundingClientRect()`, with `clampTop` / `clampLeft` to stay on screen + a resize listener.
- Transparent full-screen overlay behind the popover to capture outside clicks (no dim — the diff underneath should stay visible).
- 3-state mode machine: `{ kind: "idle" } | { kind: "new" } | { kind: "edit"; id: string }`. Default is `"new"` so the textarea gets focus immediately.
- Keyboard: `Esc` closes, `⌘Enter` / `Ctrl+Enter` saves.
- Inline error "Comment cannot be empty" rendered with `data-testid="diff-comment-error"` and a red textarea border.
- `spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off"` on the textarea (mandatory per CLAUDE.md).
- `useUI.pushToast` for "Comment added" / "Comment updated" / "Comment deleted" success toasts.

### Things learned / conventions confirmed

- **Custom CodeMirror `gutter()` is the right primitive for per-line affordances that need click handling.** Decoration widgets shift the editor content (and would break the diff tints), `lineMarker` per-line widgets are for widgets that take up space inside the line. Gutter markers sit OUTSIDE the content, get a free `BlockInfo` for the line, have a `data-line` for selectors, and have a first-class `domEventHandlers.click` for delegation.
- **`GutterMarker.eq()` is the canonical hook to keep marker identity stable across `lineMarker` re-evaluations.** CodeMirror compares markers with `eq()` to decide whether to re-render. Overriding it on `(line, hasComment)` means a comment add on a DIFFERENT line doesn't repaint unrelated markers.
- **Module-scoped refs are cheaper than Compartment reconfigure for "this closure reads live state".** The first draft considered a `Compartment` for the gutter extension and a reconfigure-on-comment-change effect. Switched to a `useRef` + lazy read in the closure because: (a) the `useEffect` that mirrors the memo into the ref runs in O(comments) (cheap), (b) the marker is re-evaluated on the NEXT view update (scroll, doc change), and (c) the `eq()` override means a no-op doesn't re-paint. Net: zero editor rebuilds on comment CRUD.
- **Side detection on a `@codemirror/merge` editor uses the `cm-merge-a` / `cm-merge-b` classes on the host element.** These are added by the merge package to each sub-editor. The unified editor has neither. Treated unified as "right" because the visible line numbers come from the modified doc. "Left" comments are not rendered in unified (they'd attach to the original doc's line numbers, which are not visible).
- **`set(s => s)` no-op return preserves referential identity.** The store actions' `if (!touched) return s;` is what makes the empty-update case a true no-op (no `set` call, so no Zustand `subscribe` notifications, no re-renders). The alternative (`set(s => ({ diffComments: { ...s.diffComments, [wsId]: list } }))` unconditionally) would re-render every subscriber on every action call, even no-op ones.
- **Validation in the store action + return null/false for "caller should show the inline error" is the right contract.** The popover doesn't have to re-implement the empty-body check; the action is authoritative, and a `null`/`false` return is the signal to render the inline error WITHOUT a toast (so the user keeps focus and gets clear feedback).
- **`position: fixed` + `getBoundingClientRect` is the cleanest anchor for an imperative popover.** Radix's popover / hover-card primitives own their anchor + open state; for a "open at this exact screen position" use case, fixed positioning is the simpler fit. Avoid `transform: translate(...)` (CLAUDE.md sub-pixel rule); top / left only.

### Gotchas hit during this task

1. **Initial draft synced only the RIGHT set into the ref.** I had `linesWithCommentsRef.current = linesWithComments.right` in the sync effect and `leftSetRef.current = linesWithComments.left` set ONLY inside the mount useEffect. Result: on a comment add / delete that doesn't trigger a mount (which is the common case — the editor mount deps are `ws.id, tab.path, editorFontSize, mode, editorThemeId`), the LEFT set went stale and the a-side gutter didn't update. Fix: move both writes to the sync effect; the mount useEffect no longer touches the refs.

2. **`buildCommentGutter` declared inside the component captures the latest `buildCommentGutter` references.** This is fine, but the closure inside `lineMarker` reads `linesWithCommentsRef.current` and `leftSetRef.current` — refs whose `.current` is mutated on every render where the comment set changed. The closure has the SAME identity (it's the same `buildCommentGutter` call from the same mount effect), but it always reads the latest ref value at `lineMarker` call time. No need to re-create the gutter on every comment change.

3. **`GutterMarker` is exported from `@codemirror/view`, not `@codemirror/state`.** First grep went to the wrong package; the index.d.ts confirmed it's in `view`. The `gutter()`, `GutterMarker`, `lineNumbers()`, etc. are all in `@codemirror/view`.

4. **`text-decoration: none !important` on `ins.cm-insertedLine` already existed in the base theme; my new rule added the same selector for `del.cm-deletedLine`.** Both rules coexist; the merge package's UA-default underlines were already being suppressed for `<ins>` (I copied that pattern) and I mirrored it for `<del>`. The new comment-gutter theme block is independent (different selector prefix `.cm-diff-comment-*`).

5. **The `useEffect` that re-binds the keydown listener re-runs on every `mode` / `draft` / `error` change.** That's intentional — the listener needs to see the current `save` closure, which closes over the current `mode` + `draft`. The cost is one `addEventListener` + `removeEventListener` per change, which is negligible compared to the keystroke rate.

### Conductor comparison

Conductor has no equivalent of inline diff comments today. Its closest feature is the "Review" pane (a side panel showing the LLM's review of a PR diff), but it's read-only and the user can't attach their own comments to specific lines. The Conductor PR/issue integration is one-way (paste a URL → get a workspace), so an inline-comment loop doesn't make sense in its model. Termic's `DiffInlineComment` + `gh api` round-trip (Task 14) is closer to GitHub's own PR review flow than to anything Conductor ships — and like the rest of Termic's PR work, it runs through the user's existing `gh` install rather than a vendor SDK.

---

## Task 8 — Checks tab base UI

**Date:** 2026-06-07
**Files touched:** `src-tauri/src/lib.rs`, `src/lib/types.ts`, `src/lib/ipc.ts`, `src/store/app.ts`, `src/components/workspace/RightPanel.tsx`
**Reuses from prior tasks:** `GitHubPullRequest` + `GitHubCheckRun` (Task 1), `gh_resolve_path` / `gh_probe_auth` (Task 6), `EMPTY_*` frozen-constant selector pattern (Task 1/11).

### What was added

**Rust (`src-tauri/src/lib.rs`):**
- `PullRequestWithChecks { pr: Option<GitHubPullRequest>, checks: Vec<GitHubCheckRun> }` — new wire struct.
- `gh_pr_view_blocking(cwd, branch)` + `gh_pr_checks_list_blocking(cwd, branch)` — two helpers, one per `gh` subprocess.
- `classify_gh_error(status, stderr) -> anyhow::Error` — returns `Err("<code>: <message>")` with the four stable codes the UI matches on (`gh_unavailable`, `gh_unauthenticated`, `rate_limited`, fallback `gh_error`).
- `github_pr_checks_fetch_blocking` + `#[tauri::command] async fn github_pr_checks_fetch` — the IPC entry. `async` + `spawn_blocking` per CLAUDE.md.
- 2 new unit tests (89 total, all pass): `pr_checks_wire_format_round_trips` + `classify_gh_error_emits_stable_codes`.

**TS (`src/lib/types.ts`):** `PullRequestWithChecks` interface (snake_case on the wire).

**TS (`src/lib/ipc.ts`):** `githubPrChecksFetch(projectId, branch)` wrapper.

**TS (`src/store/app.ts`):**
- `prChecks: Record<wsId, { pr, checks, loading, error, fetchedAt }>` state slice.
- `setPrChecks(wsId, payload)`, `setPrChecksLoading(wsId, loading)`, `clearPrChecks(wsId)` actions.
- `usePrChecks(wsId)` selector with frozen `EMPTY_PR_CHECKS` fallback.

**TS (`src/components/workspace/RightPanel.tsx`):**
- `"checks"` added to `FootTab` type.
- `Checks` tab button in BOTH the single-repo strip + multi-repo Row 2 (with `GitPullRequest` icon).
- `ChecksRefreshButton` — disabled while loading, has `data-testid="checks-refresh"`.
- `CheckRunRow` — per-check visual: status icon, name, conclusion text, started/completed ago, clickable to open the run URL via `openPath`.
- `ChecksContent` — the tab body: PR header + checks list, plus empty/error/loading states per the plan's QA scenarios.
- `timeAgo` — short relative-time helper for the timestamps.

### Things learned / conventions confirmed

- **Error code prefix in `Result::Err` is the file's idiomatic alternative to a custom error type.** The convention across `lib.rs` is `Result<T, String>` (e.g. `workspace_set_sandbox` returns `Result<…, String>`, `sandbox::run_self_test` does the same). Introducing a new `GhError` struct would have meant touching every other IPC command's signature. The `"<code>: <message>"` prefix is `err.split(":", 1)[0]` on the UI side and `err.startsWith("gh_unavailable:")` for prefix matching — cheap to parse, easy to extend with new codes (just add another `classify_gh_error` branch). The wire format stays a plain string, the convention stays intact, and a future `Task 14 gh api …` can add more codes by just appending to the classifier.
- **`gh pr view --json` and `gh pr checks --json` use camelCase keys; the wire struct is snake_case.** DTO pattern (a private inner struct with `#[derive(Deserialize)]` that maps camelCase → snake_case, then construct the snake_case wire struct field-by-field) is the right move. Adding `#[serde(rename_all = "camelCase")]` to `GitHubPullRequest` / `GitHubCheckRun` would have changed the wire shape for the UI, breaking the file's "snake_case on BOTH sides" rule. The DTO is a one-time translation that keeps the rest of the file clean.
- **`gh pr checks` doesn't expose the GitHub check-run id.** It returns `name, state, conclusion, detailsUrl, startedAt, completedAt` (and `workflow`, `event`, `link`, `createdAt`, `headSha`) but NOT `id`. The plan mentioned a fallback to `gh api repos/.../check-runs --paginate` for older `gh` versions that lack `--json` for `pr checks` — that endpoint DOES return the id, but the synthetic position-based id (`enumerate().map(|(i, d)| ... id: i as u64)`) is fine for the UI today since the id field isn't displayed. If the UI ever needs to deduplicate or join on the real id, swap to the REST API path. Inline comment in the helper documents the trade-off.
- **Detecting "no PR for this branch" via stderr message matching, not exit code.** `gh pr view <branch>` exits with code 4 (`resource not found`) when there's no PR — but pinning to exit code 4 is fragile across gh versions. The stderr message ("no pull requests found for branch <X>") has been stable for years. `stderr.to_lowercase().contains("no pull requests found")` is the more robust signal. The two-clause check (`|| (lower.contains("no pr") && lower.contains("not found"))`) catches the rarer variant.
- **Splitting `setPrChecks` and `setPrChecksLoading` is the right call.** The refresh button needs to flip ONLY the loading flag (so the effect re-fires) without overwriting the prior data — splitting the two actions lets the button do its job without the "did we already have data?" gymnastics. The `setPrChecksLoading` action uses the `if (cur?.loading === loading) return s;` no-op return trick from `setWorkState` to keep the store referentially stable.
- **The Checks tab is always present, not gated on `showRunTab` or `spotlightAvailable`.** Each workspace has a branch with a potential PR; surfacing the GitHub status is useful even on run-disabled or spotlight-only workspaces. Gating it on `showRunTab` would have hidden it in scenarios where the user explicitly wants to see CI status without running anything. The comment in the JSX pins the decision.
- **Unmount-on-tab-switch IS the "fetch on tab focus" mechanism for this tab.** The Spec said "Fetches on mount + on tab focus". The `ChecksContent` component is unmounted when the user switches to Setup/Run/etc. (the JSX is `{footTab === "checks" && <ChecksContent />}`), so the next time the user clicks the Checks tab, the component remounts and the mount-fetch fires. This contrasts with the `AuxTerminal` in the same footer, which uses `visibility:hidden` to keep the PTY alive across tab switches (different requirement — PTY teardown is expensive, but checks-fetch is cheap and a fresh fetch is the right behavior on tab focus).
- **The `ChecksRefreshButton` doesn't fire the fetch directly — it bumps the `loading` flag, and the `ChecksContent` effect's `data.loading` dep re-fires the fetch.** This is the "loading flag as trigger" pattern. It works because the effect's dep array includes `data.loading`, and the store action sets `loading: true` synchronously. The alternative (firing the fetch from the button) would have required a callback prop chain or context, which is more plumbing for no benefit.
- **Stable Zustand selectors for new store slices need a frozen empty constant.** `EMPTY_PR_CHECKS` is the third in the file's pattern (`EMPTY_TABS`, `EMPTY_DIFF_COMMENTS`, now `EMPTY_PR_CHECKS`). The pattern is non-obvious — a maintainer might "simplify" by inlining `{ pr: null, checks: [], ... }` in the selector, which would create a new object literal on every call and trigger React 19's "getSnapshot should be cached" warnings. The inline comment on the constant pins the why.

### Gotchas hit during this task

1. **Initial draft of `gh_pr_view_blocking` did direct deserialization into `GitHubPullRequest` and would have silently failed at runtime.** `gh pr view --json` returns `{"headRefName": "feature", ...}` (camelCase) and the struct field is `head_ref` (snake_case) — serde would have returned a deserialization error on the first request. Fixed by adding a `GhPrDto` inner struct with camelCase → snake_case mapping, then constructing `GitHubPullRequest` field-by-field. The same pattern was applied to `gh_pr_checks_list_blocking` (with `GhCheckDto` mapping `detailsUrl → html_url`, `startedAt → started_at`, `completedAt → completed_at`).

2. **Initial draft of `classify_gh_error` had a typo: `if !status.success() && stderr.is_empty()` was inside an `if !lower.contains(...)` chain, so the "no stderr" branch was unreachable for the auth-detection path.** Refactored to put the empty-stderr check FIRST (before the auth substring check), so it short-circuits to `gh_unavailable` before any other classification runs. The unit test `classify_gh_error_emits_stable_codes` exercises all four branches in order — test case 1 covers the empty-stderr path, test case 5 covers the zero-exit-with-empty-stderr (success status) path which should NOT emit `gh_unavailable`.

3. **Initial draft of `ChecksContent`'s useEffect had `data.loading` in the deps array without thinking about what the dependency cycle means.** The refresh button sets `loading: true`, the effect re-fires (good — that's the manual refresh). The mount also calls `setPrChecksLoading(ws.id, true)` before the fetch, which would have re-fired the effect... but it's the SAME `useEffect` running, so the cleanup `cancelled = true` from the first mount fires before the new mount's effect runs. No infinite loop, but the cleaner pattern is to call `setPrChecksLoading` synchronously inside the effect body (not on mount as a separate call) — the `setPrChecksLoading(ws.id, true)` IS the first line of the effect, so the dep array is correct.

4. **The Rust enum-style approach for the error code would have been more "type-safe" but the file doesn't do that anywhere.** The custom error type idea was tempting (a `GhError` enum with `Unavailable`, `Unauthenticated`, `RateLimited`, `Other(msg)` variants) but `lib.rs` has 30+ IPC commands all using `Result<T, String>` with `map_err(|e| e.to_string())`. A custom error type would have introduced two patterns in the same file. The `"<code>: <message>"` string prefix is less type-safe but stays consistent. The TS side matches with `err.split(":", 1)[0]` + a switch — slightly clunkier but readable.

5. **`timeAgo` had a degenerate case I almost missed: the very first render after a fresh fetch has `now - completed_at ≈ 0`, so `Math.max(0, …)` matters.** The `Math.max(0, …)` ensures we never show "negative seconds ago" if the user's clock is slightly behind the API server's. `Date.parse(iso)` returns NaN on unparseable input, and the function falls back to returning the raw ISO string (better than throwing) — the fallback path is for defensive correctness, not a normal case.

6. **`prChecks: null` vs `prChecks: { pr: null, ... }` — the test pins the `Option::None → JSON null` serialization.** Rust's `Option::None` serializes to JSON `null` by default, but a future maintainer might add `#[serde(skip_serializing_if = "Option::is_none")]` thinking it cleans up the wire shape. The unit test asserts the `null` is present in the serialized output, catching that regression. The UI's empty-state logic (`data.pr === null`) depends on the explicit null.

### Conductor comparison

Conductor's GitHub integration is read-only — it shows PR status from GitHub's API but has no `gh` CLI integration, no `gh_pr_checks` analog, and the PR list is fetched via Conductor's own backend (not the user's `gh` install). Termic's Checks tab runs the actual `gh pr view` + `gh pr checks` binaries on the user's machine, which means: (a) it inherits the user's `gh` auth state (no separate auth flow), (b) it shows the same data the user would see in their terminal, (c) the data is as fresh as the last `gh` call (no Conductor-side caching layer), and (d) the same error code surfaces (`gh auth login` if unauthenticated, `gh rate limit` if rate-limited) — no translation layer. Conductor's PR view is a passive display; Termic's is a live window into `gh` on the user's machine.

## Task 9 — Issue URL to workspace creation dialog

**Date:** 2026-06-07
**Files touched:** `src-tauri/src/lib.rs`, `src/lib/types.ts`, `src/lib/ipc.ts`, `src/store/ui.ts`, `src/components/dialogs/IssueImportDialog.tsx` (new), `src/components/dialogs/Dialogs.tsx`, `src/components/sidebar/ProjectActionsMenuItems.tsx`
**Reuses from prior tasks:** `IssueSeed` type (Task 1), `classify_gh_error` helper (Task 8), `gh api …` subprocess pattern (Task 8), `gh_resolve_path` / `gh_probe_auth` (Task 6), useUI dialog-flag pattern (Task 7/8), NewWorkspaceDialog's slug+prefix+submittingRef pattern (existing).

### What was added

**Rust (`src-tauri/src/lib.rs`):**
- `parse_github_issue_url(url) -> Result<(String, String, u64), String>` — strict hand-rolled parser. Accepts exactly `https://github.com/<owner>/<repo>/issues/<n>` (case-insensitive host, strict segment count, positive int number, no trailing slash, no query, no fragment). Linear URLs short-circuit to `"Linear authentication not configured"` BEFORE the generic scheme check.
- `github_issue_fetch_blocking(url) -> Result<IssueSeed, String>` — `gh api repos/<owner>/<repo>/issues/<n> --jq '{title, body, number, html_url}'`. Maps non-zero exits through `classify_gh_error` so the standard `gh_unavailable` / `gh_unauthenticated` / `rate_limited` / `gh_error` prefixes flow through. Spawn failures (gh missing) → `gh_unavailable:` prefix. Body is normalized to `None` when empty (the `--jq` projects empty to JSON null, the raw API returns "").
- `#[tauri::command] async fn github_issue_fetch(url) -> Result<IssueSeed, String>` — async + `spawn_blocking` per the long-running-IPC discipline. Wired in `invoke_handler` next to `github_pr_checks_fetch`.
- `setup_script: Option<String>` added to `CreateWorkspaceArgs`. `workspace_create_sync` prefers it over `effective_scripts(&proj).0` when non-empty; unset / empty → normal project-derived script (preserves existing behavior).
- 2 new unit tests: `parse_github_issue_url_recognises_supported_schemes` (5 valid + 22 invalid + 1 Linear) and `issue_seed_wire_format_round_trips` (snake_case + `body: null → None`).

**TS (`src/lib/types.ts`):** `setup_script?: string` on `CreateWorkspaceArgs`. New tests in TS would be the Playwright layer; not in scope for this task.

**TS (`src/lib/ipc.ts`):** `githubIssueFetch(url) => invoke<IssueSeed>("github_issue_fetch", { url })`. `IssueSeed` added to the `import type { ... }` block.

**TS (`src/store/ui.ts`):** `issueImportProjectId: string | null` (mirrors `newWorkspaceProjectId`) + `openIssueImport(projectId)` / `closeIssueImport()`. Lives in the UI store so opening doesn't churn the workspace tree (the rationale is in the existing `findInFilesWsId` JSDoc).

**TS (`src/components/dialogs/IssueImportDialog.tsx`, new):** URL input + Fetch button. Enter in the URL field fires Fetch. On success, title (editable) + body preview (read-only, 180px max-h with overflow-auto + min-w-0 per CLAUDE.md grid rules) + branch (auto-derived from title via `prefixForTitle`: "fix/bug/regression" → `fix/`, "add/implement/feature" → `feat/`, else bare slug). "Use as setup note" checkbox (off by default) copies the body into `workspaceCreate({ setup_script: ... })` so the issue body runs as the workspace's setup script. `submittingRef` guards against double-submit. On success: `workspaceCreate` → `loadAll` → `setActive(wsId)` → `addTab` for the default terminal tab → `close()`.

**TS (`src/components/sidebar/ProjectActionsMenuItems.tsx`):** "From issue URL" dropdown item, placed right after "New git worktree" (same worktree block). Inline GitHub-mark SVG icon (hard-coded — same hard-coded pattern as the lucide icons next to it). Hidden for non-git projects (the worktree block already gates on `!isNonGit`).

**TS (`src/components/dialogs/Dialogs.tsx`):** Mounted `<IssueImportDialog />` next to the other dialogs.

### Things learned / conventions confirmed

- **Hand-rolled URL parsing was the right call over `url::Url`.** `url::Url` is permissive by design (accepts `https://github.com/.../?foo=bar` as valid) and emits uniform "relative URL without a base" errors that are hard to make user-friendly. Hand-rolling gives precise per-failure error messages ("host must be github.com" vs "expected /<owner>/<repo>/issues/<n>") and a single regex-style invariant (segment count == 4) that catches trailing slashes, query strings, fragments, and `/pulls/<n>` shape at once. The cost is ~50 lines of obvious code; the benefit is the UI can show "this is what your URL needs to look like" copy without inventing workarounds. Worth a note for the next URL-parsing task: don't reach for `url::Url` first.
- **Linear short-circuit must run BEFORE the generic GitHub check.** The first draft put it after the host check, which would have routed `https://linear.app/...` through the "host must be github.com" error — wrong user-facing message. Linear's host is `linear.app` not `github.com`, so the host check would have caught it, but the message would be misleading. The unit test pins the linear.app error as exactly `"Linear authentication not configured"` so a reorder is caught.
- **`gh_unavailable` from `Command::new` failure is a `Result::Err(io::Error)`, not a non-zero exit.** The first draft had `.map_err(|e| anyhow!(...))?` and the `?` tried to convert `anyhow::Error` to `String` (the function's return type), which failed. The fix is `.map_err(|e| format!(...))?` — format a String directly so the `?` does its implicit conversion via `From<String> for String` (trivially true). Worth pinning in a comment so a future maintainer doesn't reach for the `anyhow!` macro and hit the same wall.
- **Adding a per-workspace `setup_script` override to `CreateWorkspaceArgs` is the right place.** The `Workspace` struct itself doesn't have a per-workspace `setup_script` field (it always inherits from the project via `effective_scripts`), so the override has to live on the create-args. The override is "set once, ignored afterwards" — same lifetime as the workspace. Adding it as `Option<String>` with `#[serde(default)]` keeps backwards-compat for any in-flight `CreateWorkspaceArgs` (none today, but the pattern matters for the "adding a field doesn't break the wire" rule).
- **`useUI` flag mirrors `newWorkspaceProjectId`, not local state.** The dialog is project-scoped (the trigger button lives on the sidebar's per-project `+` menu) and a single shared flag lets future entry points (a global "Import from URL" command, a keyboard shortcut) re-use the same plumbing without re-wiring. The same `s -> s.projects.find(...)` lookup the NewWorkspaceDialog does, the same `useUI.getState()` reset pattern on dialog open.
- **"Use as setup note" maps to the new `setup_script` override, not to a Workspace-level field.** This keeps the override ephemeral (one create-args, not persisted) and means a workspace created from an issue is structurally identical to a workspace created manually — only the seed data is different. Future task that wants to keep the issue body around for the agent's first prompt can use the same `IssueSeed.url` breadcrumb.
- **`prefixForTitle` is intentionally a tiny heuristic, not a parser.** Three keyword checks (`fix / bug / regression` → `fix/`, `add / implement / feature` → `feat/`, else empty). Anything more aggressive (NLP, sentence structure, looking up a real Linear / GitHub label) would add complexity without helping the user — the user can always edit the branch input. The branch field is editable; the prefix is just a starter.

### Gotchas hit during this task

1. **`Result<IssueSeed, String>` + `anyhow!()` + `?` doesn't compile.** The function returns `Result<_, String>` (file-wide convention — see the `classify_gh_error` explanation in the Task 8 learnings), but `anyhow!()` returns `anyhow::Error`. `?` can't auto-convert. Fix: `.map_err(|e| format!("…: {}", e))?` — the `format!` returns a `String` directly, and `String → String` is trivially `From`. The error message template still works the same way. Inline comment documents the gotcha.

2. **`trim()` on a temporary `String` inside a test array literal doesn't compile.** First draft of the bad-input test had `"github.com/acme/app/issues/1".to_string().as_str().trim()` in a `&[&str]` array. The temporary `String` is dropped at the end of the statement, and the slice still borrows from it → E0716. Cleanest fix: drop the case entirely — it duplicates the "missing scheme" case above it. A test for `trim()` on a quoted string isn't interesting when the only case it adds is "trimming a string that came from a temporary", which isn't part of the URL parser's contract.

3. **Borrow issue with the bad-input test array.** Initial draft had `let bad: &[&str] = &["", "   ", ...]`. The empty string `""` in a `&[&str]` literal trips the same E0716 (`&""` borrows from a temporary, and the slice outlives the array). Fix: nothing fancy — Rust 2021's temporary lifetime extension handles this in practice, but the explicit `if input.is_empty() { "" } else { input }` workaround I first reached for was over-engineering. Dropped the workaround + the duplicate case; the array literal works as-is.

4. **`html_url` field was unused.** First draft pulled `html_url` through the DTO "so a future gh version that renamed it would surface as a parse error". That's a weak justification — the field is unused, and the `#[allow(dead_code)]` annotation is a code smell that says "I don't know why this is here". Dropped the field from the DTO entirely. The `--jq` filter still projects to `{title, body, number, html_url}`; the DTO just doesn't deserialize `html_url`. A future rename of the `title` / `body` / `number` field is what we actually care about, and that still trips the parse error.

5. **`Option<T>` for nullable body is the right wire shape, not `String`.** First instinct was to deserialize `body` as `String` and treat "" as "no body". But GitHub's `--jq` projection casts an empty body to JSON null, and the raw REST API also returns "" for empty — the JSON parser sees both. A `String` field deserialized from `null` would fail (or need a custom deserializer). `Option<String>` deserializes both `null` and absent fields as `None`, which matches the dialog's "render the no-body empty state" check. The wire-format test pins this with a `body: null` literal.

### Conductor comparison

Conductor's issue-import flow is one-way (paste URL → workspace, no two-way sync) and goes through its own backend (not the user's `gh` install). It also doesn't expose a per-workspace setup-script override — the issue body lands only in the agent's first prompt, not in a script. Termic's `IssueSeed` + `setup_script` override gives the user a choice: copy the body into setup (so `npm install` etc. can run from the issue's own commands) OR keep the project setup script as-is and let the agent read the body from a breadcrumb on first spawn. The `setup_script` override is the structural feature that makes this optional; Conductor has no equivalent. Task 14 will add the round-trip back to the issue/PR (post review comments, mark ready) which is also outside Conductor's current feature set.



## Task 10 — PR create dialog (draft/regular)

**Date:** 2026-06-07
**Files touched:** `src-tauri/src/lib.rs`, `src/lib/ipc.ts`, `src/store/ui.ts`, `src/components/dialogs/PrCreateDialog.tsx` (new), `src/components/dialogs/Dialogs.tsx`, `src/components/workspace/RightPanel.tsx`
**Reuses from prior tasks:** `GitHubPullRequest` type (Task 1), `classify_gh_error` helper (Task 8), `gh_pr_view_blocking` DTO pattern (Task 8), `gh` capability probe (`useApp.githubStatus`, Tasks 6/8), useUI dialog-flag pattern (Tasks 7/8/9), IssueImportDialog's reset-on-open + submittingRef + success-toast pattern (Task 9).

### What was added

**Rust (`src-tauri/src/lib.rs`):**
- `extract_pr_url_from_gh_output(stdout) -> Result<String, String>` — pure helper. Trims whitespace, takes the LAST non-empty line (gh sometimes prints a banner first), and rejects anything that doesn't look like a GitHub PR URL (must start with `https://github.com/` or `http://github.com/`, must contain `/pull/`). Rejecting junk early means the follow-up `gh pr view <url>` call gets a clean error instead of an opaque "not a pull request".
- `github_pr_create_blocking(project_id, title, body, base, head, draft) -> Result<GitHubPullRequest, String>` — shells out to `gh pr create --base … --head … --title … --body …` in the project's `root_path` (same cwd pattern as the Checks tab). Appends `--draft` only when `draft=true` so a non-draft PR doesn't carry a flag the CLI could one day treat as inverted. On success, parses the URL from stdout, then runs a follow-up `gh pr view <url> --json …` to round-trip the freshly-created PR into our wire struct. Title is trimmed before validation (paste-from-clipboard carries trailing newlines) and rejected when empty. Base + head are also non-empty validated (a clearer error than `gh`'s own opaque "could not resolve …"). Errors routed through `classify_gh_error` so the standard `gh_unavailable` / `gh_unauthenticated` / `rate_limited` / `gh_error` prefixes flow through.
- `gh_pr_view_by_url_blocking(cwd, url)` — the URL-form variant of Task 8's `gh_pr_view_blocking`. Same DTO → wire struct translation, same snake_case on both sides. Kept as a separate function (not a shared helper) because the argv shape differs and the "no pull requests found" detection doesn't apply.
- `#[tauri::command] async fn github_pr_create(...)` — async + `spawn_blocking` per the long-running-IPC discipline. Two `gh` subprocesses (create + view) each take a few hundred ms on a cold PATH. Wired in `invoke_handler` next to `github_issue_fetch`.
- 1 new unit test (92 total, all pass): `extract_pr_url_from_gh_output_handles_real_world_shapes` — 5 positive cases (plain URL, CRLF-terminated, no newline, multi-line with banner, plain-http for enterprise GHE) + 4 negative cases (empty, whitespace-only, banner-only, GitHub issue URL not /pull/, different host).

**TS (`src/lib/ipc.ts`):** `githubPrCreate({ projectId, title, body, base, head, draft }) => invoke<GitHubPullRequest>("github_pr_create", { … })`. `GitHubPullRequest` added to the `import type { … }` block.

**TS (`src/store/ui.ts`):** `prCreateForWsId: string | null` + `openPrCreate(wsId)` / `closePrCreate()`. Mirrors `issueImportProjectId` — lives in the UI store (not app) so opening it doesn't churn the workspace tree. The dialog resolves the project from the workspace id (no need to thread projectId through), and the IPC runs in the project's `root_path` on the Rust side.

**TS (`src/components/dialogs/PrCreateDialog.tsx`, new):**
- Title input (required) with inline "Title is required" error rendered next to the field with `data-testid="pr-dialog-title-error"`. The input itself has `data-testid="pr-dialog-title"`.
- Body textarea (auto-prefilled from `workspaceDiff(id)` on dialog open, capped at 50KB to keep the textarea manageable). The user can clear it; empty body is allowed (`gh` tolerates an empty body).
- Base + head branch inputs (grid-cols-2) with monospace font. Base defaults to `project.base_branch`; head defaults to `ws.branch`. Both editable (e.g. PR from `feature/x` into `release/y` instead of `main`).
- Draft checkbox (defaults to true per the plan spec's "Auto-draft" framing).
- Pre-flight gating via `useApp.githubStatus`: the Create button is disabled when `gh` is missing or unauthenticated, with the same "Install gh" / "Run gh auth login" hint copy the Checks tab uses.
- `submittingRef` guards against double-submit (a real problem — a second `gh pr create` would either create a duplicate or fail with "pull request already exists").
- On success: success toast with an "Open PR" action button that calls `openPath(pr.html_url)`. The success panel inside the dialog also shows the URL + an explicit "Open PR on GitHub" button. The dialog stays open so the user can reach the URL.
- `spellCheck={false}` + `autoCorrect="off"` + `autoCapitalize="off"` + `autoComplete="off"` on every input (mandatory per CLAUDE.md).
- `min-w-0` + `max-h-[220px]` + `overflow-auto` on the body textarea per CLAUDE.md grid + sub-pixel rules.
- `data-testid="pr-dialog-create"` on the Create button (QA hook the plan spec calls out).

**TS (`src/components/dialogs/Dialogs.tsx`):** Mounted `<PrCreateDialog />` next to `<IssueImportDialog />`.

**TS (`src/components/workspace/RightPanel.tsx`):** Added a "Create PR" button to the Checks tab empty state ("No PR or checks found for this branch"). `data-testid="checks-create-pr"`. Calls `useUI.getState().openPrCreate(ws.id)`. Hidden for non-git projects (`gh pr create` requires a real branch) and for `is_repo_root` workspaces (Task 13/16 territory).

### Things learned / conventions confirmed

- **A "natural next action" trigger inside an empty state is the right placement for the entry point.** The plan spec called this out as either "a dropdown next to the workspace name in the tab bar, or a button in the Checks tab". The Checks tab empty state is the most contextual — the user JUST learned "no PR for this branch" and the button is the obvious next step. A tab-bar dropdown would have been equally fine but less contextually placed. Hiding the button for non-git projects + `is_repo_root` workspaces (where `gh pr create` can't work) keeps the empty state honest about what it can do.
- **Two `gh` subprocesses (create + view) is the right v1 shape over a single `--json` create call.** `gh pr create --json` exists in newer `gh` versions and returns the full PR object inline, which would let us skip the follow-up view call. But the URL-form `gh pr view` is portable across older `gh` versions, and the "URL is the artifact" mental model matches the CLI's docs. Two subprocesses = two network round-trips for what is one logical action; acceptable for v1. A future optimization (if it becomes a hotspot) is to switch to `--json` on create, gated on a `gh` version probe. The current shape doesn't preclude that.
- **Title trim on the backend is belt-and-suspenders, not redundant.** Paste-from-clipboard often carries a trailing newline, and `gh pr create` would create the PR with a literal `\n` in the title if we passed it through unchecked. The dialog also trims + validates client-side so the user gets instant feedback, but the backend trim catches the edge case where the user clicks Create in the same render frame the JS state is mid-update. Same for base/head empty validation — the dialog prevents it client-side, the backend catches it as defense in depth.
- **Pre-flight gating via `useApp.githubStatus` is worth the extra plumbing.** The dialog could just let the IPC fail with `gh_unavailable: ...` and render the error banner. But the user gets a better experience when the Create button is disabled with a hint upfront (the same `gh_unavailable` / `gh_unauthenticated` UX the Checks tab uses). The pre-flight banner reuses the existing probe — no new IPC, no new state. The pattern: read the cached snapshot, derive a gate, pass it into `canCreate` (which is a single boolean the button's `disabled` prop consumes).
- **The dialog stays open on success rather than auto-closing.** Auto-close-on-success would race the "Open PR" action click (the user might click the action in the same frame the dialog is closing, and the action would fail because the dialog is gone). Keeping the dialog open + swapping the form for a success panel lets the user either click "Open PR on GitHub" inside the dialog OR close via the X / Cancel button. The toast with the "Open PR" action is the one-tap jump for users who want the dialog out of the way.
- **The Checks-tab empty-state trigger checks for `non_git` + `is_repo_root` to avoid showing a button that can't work.** First instinct was to show the button everywhere and let the IPC fail. The `gh pr create` failure modes for these cases are ugly ("not a git repository", "no branch checked out") and not actionable from the dialog. Hiding the button is a smaller, cleaner signal: when the button is visible, clicking it will work.
- **Capping the body prefilled from `workspaceDiff` at 50KB is the right balance.** A huge diff would pin the browser tab; the user almost always wants to write a real PR description, not paste a megabyte of hunks. 50KB is enough to capture "the description" of a small PR (a few hundred lines of context + diff) but small enough that the textarea stays responsive. The user can always edit it down or clear it.

### Gotchas hit during this task

1. **The pre-existing `gh_pr_view_blocking` (Task 8) was the wrong abstraction to reuse for the post-create view.** First instinct was to refactor it into a generic "view by branch OR url" helper. The argv shape differs (`<branch>` vs `<url>`), and the "no pull requests found" detection (which short-circuits to `Ok(None)` in the branch variant) doesn't apply when we just got the URL from the create call — it has to exist. Two separate functions was the right call; the cost of a small duplication of the DTO struct is much lower than the cost of an over-generalized helper that has to know about both modes. Inline JSDoc on the URL variant documents the design choice so a future maintainer doesn't "DRY them up" and accidentally reintroduce the no-PR detection.
2. **The initial doc comment claimed "Reuse the existing view helper" but the code wrote a new function.** First draft followed my own draft comment ("reuse the existing helper") but the helper took a branch, not a URL, and refactoring it would have been a worse tradeoff (see above). Updated the code to add the new function; the misleading doc comment was caught before commit and removed. Worth a note because the symmetric "trust the code over the comment" rule from prior tasks (Task 1's `GithubStatus` vs `GitHubStatus` confusion, etc.) applies in reverse too: don't trust the comment over the code, and don't write a comment that doesn't match what the code actually does.
3. **`gh` exit 1 on missing binary vs `Command::new` failure on a missing binary.** Two distinct paths to the same user-facing error. `Command::new("gh").output()` returns `Err(io::Error)` when the binary doesn't exist on PATH (the spawn itself fails). `Command::new("gh").output()` returns `Ok(out)` with `out.status.success() == false` when the binary exists but exits non-zero. The `github_pr_create_blocking` helper handles both: the `map_err` on the `Command::new(...).output()` call converts the io error into `"gh_unavailable: failed to spawn gh pr create: …"`, and the `!out.status.success()` branch routes through `classify_gh_error` (which has its own empty-stderr short-circuit to `gh_unavailable` for the case where `gh` exists but exits 1 with nothing on stderr). Both paths produce the same `gh_unavailable:` prefix the UI matches on.
4. **The `useUI` flag carries only the workspace id, not the project id.** First draft considered `prCreateForProjectId: string | null` (matching `issueImportProjectId` directly). But the project flows from the workspace (`useApp.projects.find(p => p.id === ws.project_id)`), and the workspace is the actual user-facing scope. Storing the workspace id keeps the trigger location + the open flag in the same domain. The `useUI` flag for dialogs in this file is consistently scoped to whichever entity the dialog actually operates on (`newWorkspaceProjectId` for the project-level worktree dialog, `reviewForWsId` for the review dialog, etc.) — the right entity to thread through is the one the trigger button knows, not the one the IPC needs.
5. **`--draft` is a conditional arg, not a flag.** First draft was `args.push(if draft { "--draft" } else { "" })` — which pushes an empty string into the argv, and `Command::new("gh")` would have happily passed that to the CLI as a positional arg. `gh` would have treated it as a title or a base branch, and the PR create would have failed with a confusing error. The conditional `if draft { args.push("--draft"); }` (no else branch) is the correct shape — when `draft=false`, the flag is simply absent, and `gh` creates a normal PR.
6. **Initial draft of the empty-state trigger button in `RightPanel.tsx` would have rendered for non-git projects.** First draft of the gating was just `if (!data.pr) { ... }`, with the new button always rendered inside. Added the `!project?.non_git && !ws.is_repo_root` check to hide the button for the cases where `gh pr create` can't run. The data fetch is `useApp.getState()` (not the hook) so the empty-state component is small and doesn't churn the parent on every project mutation; pattern matches the existing `useApp.getState()` calls in the file.

### Conductor comparison

Conductor's PR creation flow is OAuth-gated (it has its own GitHub App, not the user's `gh` install) and runs through Conductor's vendor backend. Termic's `github_pr_create` IPC uses the user's existing `gh` install + auth — no new token storage, no new auth UI. The wire shape (`GitHubPullRequest`) is shared with the Checks tab (Task 8), so a PR created via the dialog immediately appears in the Checks tab with the same visual treatment the user has been looking at — no second backend to reconcile with. Conductor also gates PR creation on the OAuth flow (which has its own "Connect GitHub" CTA); Termic gates on the local `gh` capability probe (which the user already manages via `gh auth login`). The two surfaces make the same feature available to the user with very different prerequisites, and the difference is the entire termic-vs-conductor stance: lean on the user's existing tooling, don't ship a parallel auth flow.



## Task 13 — PR view and merge UI

**Date:** 2026-06-07
**Files touched:** `src-tauri/src/lib.rs`, `src/lib/ipc.ts`, `src/components/workspace/RightPanel.tsx`
**Reuses from prior tasks:** `GitHubPullRequest.checks_passing` (Task 1/8), `useUI.askConfirm` confirm modal (Task 7), `setPrChecksLoading` loading-flag-bump pattern (Task 8), `classify_gh_error` (Task 8), `<Button>` / `<Tip>` (existing UI primitives).

### What was added

**Rust (`src-tauri/src/lib.rs`):**
- `validate_pr_merge_method(method: &str) -> Result<&str, String>` — pure function. Trims input, then matches against `{ "merge", "squash", "rebase" }`. Rejection message names the bad input AND lists the allowed set so a frontend bug surfaces clearly and a future maintainer reading the error learns the contract.
- `github_pr_merge_blocking(project_id, pr_number, method) -> Result<String, String>` — loads the project by id, resolves `root_path`, validates `pr_number > 0` (rejects 0 with a clean error instead of `gh`'s "no pull request matches the search"), then shells out to `gh pr merge <n> --<method> --delete-branch`. `--delete-branch` is unconditional — the user's whole point of merging is to land the work, and a merged branch is dead weight in the remote. Returns the trimmed stdout.
- `#[tauri::command] async fn github_pr_merge(...)` — IPC entry. `async` + `spawn_blocking` per the long-running-IPC discipline. The merge can take a few seconds (GitHub has to fast-forward / squash / rebase) and the user might trigger it on a slow network.
- 1 new unit test (93 total, all pass): `validate_pr_merge_method_accepts_documented_set` — 3 positive (exact match), 4 positive (whitespace tolerance — paste-from-clipboard), 6 negative (empty, wrong case, unknown methods, flag-shaped inputs). Asserts the rejection message contains "Invalid merge method" AND the full allowed set.

**TS (`src/lib/ipc.ts`):** `githubPrMerge({ projectId, prNumber, method })` wrapper. The `method` field is typed `"merge" | "squash" | "rebase"` so the TS surface documents the valid set (the Rust validator is the authoritative gate; the TS type just catches frontend bugs at compile time).

**TS (`src/components/workspace/RightPanel.tsx`):**
- `ChecksContent` (Task 8 component) extended with the merge action bar between the PR header and the checks list. `GitMerge` added to the lucide import; `githubPrMerge` added to the ipc import.
- Single source of truth for the gate: `mergeDisabledReason: string | null` — resolves to `"PR is a draft"`, `"Checks running"`, `"Waiting for checks"`, or `"Checks failing"` (precedence: draft > in-flight > waiting > failing — most actionable first). `mergeEnabled = mergeDisabledReason === null`.
- `useState` for the in-flight `merging` flag (drives the spinner + disables the button). The button is `disabled={!mergeEnabled || merging}`.
- On click: `useUI.askConfirm({ title: "Merge pull request", message: "Merge PR #N into <base>? The head branch will be deleted.", confirmLabel: "Merge" })`. Not destructive — merging is a normal, recoverable action. On confirm: `githubPrMerge({ ..., method: "squash" })` → `pushToast("PR #N merged", "success")` → `setPrChecksLoading(ws.id, true)` to re-fetch.
- On error: `pushToast(err, kind)` where `kind` maps from the stable error-code prefix (`gh_unauthenticated` / `gh_unavailable` → `info` so the user gets an "install / authenticate gh" hint, anything else → `error`).
- The button: `data-testid="checks-merge"`, `<Tip>` wrapping the button carries the disabled reason on the left side. Left side of the bar also shows the same status text without a hover ("All checks passed" when enabled, the disabled reason when disabled, "No checks reported" when empty).

### Things learned / conventions confirmed

- **Disabled-reason precedence as a single nullable string is the right gate shape.** The first instinct was four separate booleans (`isDraft`, `anyInFlight`, `noChecksYet`, `checksFailing`) and pick the most-specific-one in the tooltip. A single `mergeDisabledReason: string | null` is cleaner: precedence is encoded once in the `?:` chain, the tooltip is just `mergeDisabledReason ?? ""`, and the button's `disabled` is `mergeDisabledReason !== null` (`=== null` reads as "no reason to disable" = enabled). One expression, one source of truth.
- **Stable-error-code prefix maps directly to toast severity.** `gh_unauthenticated` and `gh_unavailable` are NOT errors in the sense the user can fix in the toast's lifetime — they require running `gh auth login` or installing `gh`. Mapping them to `kind: "info"` reads as "informational, here's what's missing" rather than "something broke". This matches the same prefix the empty-state branch in `ChecksContent` already uses to render the "Install and authenticate gh" panel.
- **The re-fetch trigger is the existing `setPrChecksLoading(ws.id, true)` pattern, not a fresh fetch call.** The Checks tab's `useEffect` watches `data.loading` as a dep (Task 8), so flipping the loading flag is enough to re-fire the fetch. A separate `githubPrChecksFetch(ws.project_id, ws.branch)` call in `handleMerge` would have created a second fetch path that the cleanup flag and the `data.loading` dep don't know about. Bumping the flag reuses the existing plumbing.
- **`<Tip>` from `@/components/ui/Tooltip` is the right wrapper for a disabled button tooltip.** Radix's `<TooltipProvider>` + `<Tooltip>` primitives own the anchor + open state, and `Tip`'s `content` prop handles the "show this string on hover" case. Trying to add `title=` on a disabled `<button>` would NOT work — the browser's native tooltip is suppressed on disabled buttons (a long-standing accessibility quirk). `<Tip>` doesn't have that bug because the trigger is a child span, not the disabled button itself.
- **TS surface validation is a documentation tool, not a security boundary.** The `method: "merge" | "squash" | "rebase"` type on the `githubPrMerge` wrapper catches frontend bugs at compile time, but a `string` from a JSON payload could still bypass it. The Rust `validate_pr_merge_method` is the authoritative gate — the TS type is a "you probably meant one of these three" hint. Same split as the issue URL parser in Task 9 (the Rust parser rejects everything, the TS form just gives faster feedback).
- **`async` + `spawn_blocking` is the right default for an IPC that calls `gh` once, even when the expected latency is sub-second.** `gh pr merge` can take a few seconds (GitHub round-trip + the actual merge), much longer than `gh pr view` (a few hundred ms). Even on a fast network, putting a synchronous command on the IPC thread would freeze the WKWebView event loop for the duration of the merge. The same discipline from Task 8/9/10 applies.
- **Method picker is a follow-up, not in this task's scope.** The IPC accepts all three methods, but the UI hardcodes `"squash"`. Adding a dropdown adds a Radix Dropdown + state for "current method" + plumbing the method into the confirm dialog. The plan didn't ask for it, the user can change methods in their terminal if they need a non-squash merge, and a follow-up task can land the picker without touching the IPC contract. Inline comment in the JSX pins the scoping decision.

### Gotchas hit during this task

1. **First test draft put `"merge "` (with trailing space) in the negative cases.** The validator trims first, so "merge " → "merge" → match → Ok. The test panicked with `"merge " must be rejected: "merge"`. The fix is to move "merge " to the positive cases (it IS valid after trim) and pin the "trim first" behavior in a comment so a future maintainer restoring it to the negative list re-encounters the same panic. The `cargo test` panic was the right signal — the test caught an internal inconsistency before it shipped.

2. **The disabled-button `title=` tooltip would not work.** First draft of the button had `title={mergeDisabledReason}` for the disabled case. The native browser tooltip is suppressed on disabled `<button>` elements (a long-standing accessibility quirk — disabled buttons don't receive mouse events, and the native tooltip is gated on hover). Switched to wrapping the button in `<Tip content={...}>` so the trigger (a non-disabled wrapper) is what receives the mouse event. Worth a note in the learned-conventions file: for any disabled-button tooltip, use `<Tip>`, never the native `title=` attribute.

3. **`pushToast` toast ID was not captured.** The action returns a string (the toast's UUID), used for the `dismissToast(id)` API. The handler doesn't need to dismiss manually (the auto-dismiss timeout handles it) so the return value is intentionally discarded. If a future task needs to dismiss the toast on a specific event (e.g. "user closed the workspace before the toast expired"), capture the ID. Not a bug today, just a note.

4. **The merge method is hardcoded to `"squash"`.** A more flexible implementation would have a `useState<"merge" | "squash" | "rebase">` + a Radix Dropdown next to the button. The plan didn't ask for it, but the IPC is parameterized so the picker can land in a follow-up task. The inline comment in the JSX pins the scoping — a future maintainer can find the right place to add the picker without re-deriving the decision.

5. **The Rust `validate_pr_merge_method` doesn't accept empty string explicitly — it trims, then matches the empty against the fixed set, then rejects.** First instinct was to add `if trimmed.is_empty() { return Err(...) }` as a separate branch. Not needed — the `match` arm `_ => Err(...)` already catches it (the error message will be "Invalid merge method: (expected one of: merge, squash, rebase)" — readable, even if it doesn't specifically call out the empty case). Adding a separate branch would have been two error messages for the same logical condition.

### Conductor comparison

Conductor's PR view has a "Merge" button but no explicit green-checks gate — the user can click it at any time and `gh` (or Conductor's backend) will reject the merge with a generic error. Termic's gate is UI-side: the button is disabled with an explanatory tooltip until the conditions are met, so the user gets a clear "Checks failing" / "PR is a draft" / "Checks running" message instead of a raw `gh` error. This is the same UX principle as the Checks tab itself: surface the state, don't make the user guess. Conductor's PR view also doesn't have a "Re-fetch checks" button — it relies on a backend poll. Termic's manual refresh (Task 8) + the `setPrChecksLoading(ws.id, true)` re-fetch trigger after merge (Task 13) keeps the data fresh without a backend dependency.

---

## Task 14 — Post diff inline comments to GitHub PR

**Date:** 2026-06-07
**Files touched:** `src-tauri/src/lib.rs`, `src/lib/ipc.ts`, `src/lib/types.ts`, `src/store/app.ts`, `src/components/workspace/DiffCommentPopover.tsx`
**Reuses from prior tasks:** `classify_gh_error` (Task 8), `usePrChecks` + `prChecks` slice (Task 8), `useDiffComments` + `diffComments` slice (Task 11), `useUI.askConfirm` / `pushToast` (Tasks 7/8/9/10/11/13), `gh api` subprocess pattern (Task 9), `git repo view` remote-discovery pattern (Task 6/8).

### What was added

**Rust (`src-tauri/src/lib.rs`):**
- `validate_post_diff_comment_args(side, line, commit_id) -> Result<(&str, u32, &str), String>` — pure function. Rejects anything outside `{"left", "right"}` (after trim), `line == 0`, `commit_id.len() != 40`, non-hex chars in `commit_id`. Same shape as `validate_pr_merge_method` from Task 13.
- `github_pr_post_diff_comment_blocking(project_id, pr_number, commit_id, path, line, side, body) -> Result<u64, String>` — two-step `gh` flow: (1) `gh repo view --json owner,nameWithOwner` to discover `<owner>/<repo>`; (2) `gh api repos/<owner>/<repo>/pulls/<n>/comments -f body=… -f commit_id=… -f path=… -F line=… -f side=…` to POST. Parses the `id` field out of the response (rejects missing / 0 / non-uint). Errors flow through `classify_gh_error` for the stable prefixes.
- `#[tauri::command] async fn github_pr_post_diff_comment(...)` — IPC entry. `async` + `spawn_blocking` per the long-running-IPC discipline. Wired in `invoke_handler` next to `github_pr_merge`.
- 1 new unit test: `validate_post_diff_comment_args_accepts_valid_inputs` — 4 side-positive + 7 side-negative + 5 line-positive + 1 line-negative + 1 commit_id-positive + 4 commit_id-length-negative + 1 commit_id-charset-negative. The error-message contract is pinned: every rejection must name the bad input AND list the allowed set / format, matching the precedent set by `validate_pr_merge_method_accepts_documented_set` in Task 13.
- **Additive: `head_sha: Option<String>` on the `GitHubPullRequest` struct + `head_ref_oid: Option<String>` on the `GhPrDto` (both DTO sites).** Pulled from `gh pr view --json ...headRefOid`. The field is optional because older `gh` versions don't expose `headRefOid`; the popover disables "Post to GitHub" when None. The TS interface gets the matching `head_sha?: string | null`. Pinned in the field's JSDoc / docstring so a future maintainer doesn't "simplify" `Option<String>` to `String` + unwrap.

**TS (`src/lib/ipc.ts`):** `githubPrPostDiffComment(args) => invoke<number>("github_pr_post_diff_comment", { ... })`. The argument object mirrors the Rust signature 1:1 (snake_case on the wire, camelCase in the wrapper per the file's convention). JSDoc documents the validation contract + error prefixes the popover depends on.

**TS (`src/store/app.ts`):**
- `markDiffCommentPosted(wsId, commentId, remoteId, postedAt) -> void` action. Finds the comment in `diffComments[wsId]` and stamps `remote_id` + `posted_at` immutably. Idempotent — if already stamped with the same values, returns `s` unchanged so React doesn't re-render. The no-op return is the same pattern `setPrChecksLoading` uses in Task 8.
- New `useWorkspace(wsId)` selector with `?? null` fallback. Needed because the popover has to resolve `wsId` → `project_id` for the IPC payload, but the active workspace isn't necessarily the one being commented on. Frozen null fallback so the selector stays referentially stable when the workspace row hasn't changed.

**TS (`src/components/workspace/DiffCommentPopover.tsx`):**
- New "Post to GitHub" button per unposted comment in the list. Show when `!c.remote_id && prSnapshot.pr !== null && prSnapshot.pr.head_sha` is set. Icon is lucide `Send`; spinner (`Loader2 animate-spin`) while in-flight. Disabled state uses the per-comment `posting: Record<string, boolean>` map (keyed by comment id so multiple unposted comments on the same line each get their own spinner).
- "Posted" badge (lucide `CheckCircle2`, accent green) replaces the button when `c.remote_id` is set. Wrapped in a Tip + `<a href={pr.html_url + '#discussion_r' + remote_id} target="_blank" rel="noreferrer">` for the deep-link. The href is a no-op when `pr` is null (`onClick={e => { if (!pr) e.preventDefault(); }}`) so the click doesn't open a broken anchor.
- New "No PR for this branch" / "PR data is missing the head commit SHA" hint at the bottom of the popover when there are unposted comments but the workspace has no usable PR data. Gated on `prSnapshot.fetchedAt !== null` so the hint doesn't flash during the initial loading window.
- `postToGitHub(c)` async helper: askConfirm → set in-flight flag → `githubPrPostDiffComment` IPC → on success, `markDiffCommentPosted` + success toast → on error, pushToast with the kind mapped from the error-code prefix (`gh_unavailable` / `gh_unauthenticated` → "info", anything else → "error"; same mapping Task 13's Merge button uses). Defense in depth: also early-returns on `c.remote_id` so the action can't be re-fired even if the button is somehow visible.

### Things learned / conventions confirmed

- **`gh api` needs `<owner>/<repo>` in the URL path, unlike `gh pr view <branch>`.** `gh pr view` and `gh pr checks` figure out the repo from the cwd's git remote; `gh api repos/<owner>/<repo>/...` does NOT — the owner/repo must be in the path. Discovered this when the obvious `gh api pulls/<n>/comments` returned "404 Not Found" because `gh` doesn't substitute the repo into path-form args. The fix is one extra `gh repo view --json owner,nameWithOwner` subprocess (cold PATH, ~200-500ms) to discover the owner/repo, then construct `repos/<owner>/<repo>/pulls/<n>/comments` from it. Cost is one more `gh` call in series; the alternative would be parsing `git config --get remote.origin.url` ourselves and falling back when the URL is an SSH alias (`git@github.com:owner/repo.git`) — more code, more edge cases.
- **`nameWithOwner` is already "owner/name" — use it directly, don't re-join `owner.login` + `name`.** First instinct was to deserialize `owner.login` + `name` separately and join them in Rust. `nameWithOwner` is a single field GitHub provides precisely so callers don't have to worry about case mismatches between the two (rare in practice, but possible if GitHub renames the repo between API calls). Inline comment in the helper pins the choice.
- **`-F` (raw field) for `line`, not `-f`.** GitHub's review-comments API treats `line` as an integer; `-f` ships it as a string and the API 422s. `-F` deserializes the value as a JSON int (parses "42" → `42` not `"42"`). The other fields are strings, so `-f` is right for them. The args are in `key=value` form (one string per arg), NOT bare values — passing a bare `42` would fail with "missing field name". Inline comment in the helper documents the why.
- **Additive enum variant on a shared DTO is the right move.** `GitHubPullRequest` is consumed by `RightPanel.tsx`'s Checks tab (Task 8) and the PR create dialog (Task 10). Adding a new field as `Option<String>` with `#[serde(default)]` (and `?:` on the TS side) keeps both consumers compiling without changes. The alternative — making `head_sha` required — would have forced a `gh` version gate on the Checks tab, which would have been much higher scope. The "additive, optional" pattern is the established way in this file.
- **The duplicate-post guard is layered: render + function + state.** Three layers: (1) the JSX renders the "Posted" badge and hides the "Post to GitHub" button when `c.remote_id` is truthy; (2) `postToGitHub(c)` early-returns on `c.remote_id` for defense in depth; (3) `markDiffCommentPosted` is idempotent (returns `s` unchanged on no-op). Any single layer is enough; all three is "this is security-critical UX, defend it like security". The plan's QA scenario "Retry does not duplicate" passes by virtue of layer 1 alone.
- **`#discussion_r{id}` is the canonical deep-link for a review comment.** GitHub's PR pages link individual review comments via the fragment `#discussion_r<remote_id>` (the `r` prefix is for review comment; the `discussion_` is just the page section name). Constructing the URL from `pr.html_url + '#discussion_r' + remote_id` gives the user a one-click jump to the just-posted comment. No IPC needed — `pr.html_url` is already on the snapshot, the fragment is computed inline.
- **The no-PR hint has three conditional clauses and needs a comment.** The popover's footer hint renders when: `lineComments.length > 0 && lineComments.some(c => !c.remote_id) && prSnapshot.fetchedAt !== null && (prSnapshot.pr === null || !prSnapshot.pr.head_sha)`. Four conditions, one of which is "any of these two sub-failures". The JSX block comment in the file lists each clause and the why — without it, a future maintainer pruning "redundant" conditions would either (a) flash the hint during the initial load, or (b) show the hint after every comment is posted (no action available). Both are visible UX bugs.
- **`useWorkspace(wsId)` selector with `?? null` is the right helper.** The popover has to resolve `wsId` → `project_id` for the IPC payload, but the active workspace isn't necessarily the one being commented on (the popover could be open for a backgrounded tab). `useActiveWorkspace` doesn't fit. Adding a generic-by-id selector with a null fallback is cheaper than threading `project_id` through the popover's prop chain from `DiffPane`. The `useApp(s => s.workspaces.find(...))` returns the same reference as long as the row hasn't changed, so the selector stays referentially stable for the common case.

### Gotchas hit during this task

1. **First Rust draft of `validate_post_diff_comment_args` returned `(&str, u32, &str)` but the compiler inferred the two `&str`s as different elided lifetimes.** E0106: "this function's return type contains a borrowed value, but the signature does not say whether it is borrowed from `side` or `commit_id`". Fix: `<'a>` + `&'a str` on both input and output positions, pinning the lifetime relationship. The validator doesn't actually allocate (it just returns references to the trimmed inputs), so the lifetime matters.

2. **First test draft used `"0".repeat(40).as_str()` inline in the test array's loop body.** E0716: temporary value dropped while borrowed. The `.as_str()` borrows from the temporary `String`, which is freed at the end of the statement; the validator's result borrows from the now-dead string. Fix: bind the SHA strings to `let sha_zeros = ...` / `let sha_ones = ...` outside the loop, then `&sha_zeros` inside. Cheap, but the borrow checker's complaint is the same one the Task 9 parser test hit — worth a checklist item for "any test that takes a borrowed string in a loop".

3. **`#[serde(default)]` on the new DTO field is required for the live fetch path to tolerate older `gh` versions.** The struct's existing fields are all required (Rust's deserializer errors on a missing key), and `headRefOid` is the ONLY key that might be absent on older `gh`. Forgetting `#[serde(default)]` would have made every fetch on an older `gh` version return `gh_error: parse gh pr view: missing field 'headRefOid'`. The unit test for `validate_post_diff_comment_args` covers the validator; the wire-format change is covered by the existing `pr_checks_wire_format_round_trips` test (which deserializes a hand-crafted JSON without `headRefOid` — but that test only exercises the bundle, not the DTO; worth adding a dedicated DTO test in a follow-up).

4. **`pr.html_url + '#discussion_r' + remote_id` requires the Posted badge to be a real `<a>`, not a `<button>`.** First draft had the badge as a `<button>` with a Tip. The user wanted to click the badge to open the comment in the browser, not to trigger any state change — but `<button>` is the wrong semantic. Switched to `<a href target="_blank" rel="noreferrer">` with the no-PR-anchor guard `onClick={e => { if (!pr) e.preventDefault(); }}`. The guard is needed because when `pr` is null (the data hasn't loaded), the href would be `undefined + '#discussion_r' + remote_id` → `'undefined#discussion_r123'` (browsers don't navigate to a literal "undefined" but the click would do something confusing). Inline `onClick` is the cheapest fix; an `href={pr ? ... : '#'}` ternary works too but the `e.preventDefault()` reads as "we're disabling the link" more clearly.

5. **The new `useWorkspace(wsId)` selector returns a different reference than the slice it reads from.** `s.workspaces.find(w => w.id === wsId)` returns the row's reference, not a new object — so the selector is stable across re-renders that don't change the row. The only referential-instability concern is when the user creates / archives a workspace (the whole `s.workspaces` array is replaced, and a `find` re-runs). Zustand's `useStore` is built for this — the selector's return value is the same `Workspace` reference both before and after an unrelated store change, so React 19's "getSnapshot should be cached" warning doesn't fire.

### Conductor comparison

Conductor has no equivalent of inline diff comments today (per Task 11's analysis — its Review pane is a side panel of the LLM's read-only review). The "post to PR" loop is the natural extension of the inline-comment feature, and Conductor would need a similar `gh api` round-trip + a remote-id stamp to support it. Termic's `gh api` path uses the user's existing `gh` install (no token storage, no OAuth) and the standard `repos/<owner>/<repo>/pulls/<n>/comments` endpoint. The `#discussion_r{id}` deep-link is the same one GitHub's own PR UI uses, so the user's mental model ("I just posted a comment; the link in termic should open the same comment in github.com") is satisfied by the URL construction without any GitHub-side integration.


## Task 15 — Linear issue URL support (MVP)

**Date:** 2026-06-07
**Files touched:** `src-tauri/src/lib.rs`, `src/lib/ipc.ts`, `src/components/dialogs/IssueImportDialog.tsx`
**Reuses from prior tasks:** `IssueSeed` + `IssueSource` (Task 1), `parse_github_issue_url` (Task 9), `classify_gh_error` (Task 8), `async fn` + `spawn_blocking` IPC discipline (Tasks 6/8/9/10/11/12/14), `IssueImportDialog`'s reset-on-open + submittingRef + useUI dialog-flag pattern (Task 9), `setup_script` override on `CreateWorkspaceArgs` (Task 9).

### What was added

**Rust (`src-tauri/src/lib.rs`):**
- `IssueUrlKind { Github, Linear }` — new `#[serde(rename_all = "snake_case")]` enum. Mirrors `IssueSource`'s convention from Task 1.
- `ParsedIssueUrl { kind, github: Option<(String, String, u64)>, linear: Option<String> }` — new wire struct. Struct-of-options (not enum-with-payload) so the wire JSON is flat and the TS-side regex mirror can construct the same shape without touching enum variants. The `kind` field is redundant with the `Some` field — but pinning it on the wire means a future enum addition (GitLab, Jira, …) is a backward-compatible additive change.
- `parse_issue_url(url) -> Result<ParsedIssueUrl, String>` — new unified parser. Accepts BOTH GitHub and Linear URLs. The GitHub branch delegates to `parse_github_issue_url` so all of Task 9's per-segment validation is reused (owner/repo charset, segment count, positive integer, no query/fragment, etc.). The Linear branch is hand-rolled for the same reason as Task 9's GitHub parser (`url::Url` is too permissive + uniform-errored). `#[allow(dead_code)]` — the only production caller is a future unified `IssueFetch` IPC; today the function is exercised by the new unit test only (Rust's `dead_code` analysis doesn't count `#[cfg(test)]` references).
- `linear_issue_fetch_blocking(issue_id) -> Result<IssueSeed, String>` — MVP behavior: trims the id, rejects empty, then ALWAYS returns `Err("Linear authentication not configured")`. The plan spec is explicit: "Do not add Linear OAuth or token storage."
- `#[tauri::command] async fn linear_issue_fetch(issue_id) -> Result<IssueSeed, String>` — async + `tauri::async_runtime::spawn_blocking` per the long-running-IPC discipline. Same shape as `github_issue_fetch`. Wired in `invoke_handler` next to `github_issue_fetch`.
- 1 new unit test: `parse_issue_url_handles_both_schemes` — covers Linear happy path (`ENG-1234` form + UUID form + case-insensitive host + whitespace padding), GitHub regression (delegates to `parse_github_issue_url` and pins the same payload), 22 invalid URLs (empty, wrong scheme, unknown host, wrong GitHub path, wrong Linear path, empty workspace, invalid workspace chars, id too short, invalid id chars), AND the `ParsedIssueUrl` wire format round-trip (snake_case `kind` enum, `github: null`, `linear: "ENG-1234"`).

**TS (`src/lib/ipc.ts`):** `linearIssueFetch(issueId) => invoke<IssueSeed>("linear_issue_fetch", { issueId })`. JSDoc explains the MVP behavior + future extensibility (a real GraphQL call can be swapped in without changing the IPC shape).

**TS (`src/components/dialogs/IssueImportDialog.tsx`):**
- `DetectedIssueUrl` discriminated union + `detectIssueUrl(input)` helper — client-side regex mirror of `parse_issue_url`. Routes any `https?://github.com/...` URL to `githubIssueFetch`, strict `https?://linear.app/<ws>/issue/<id>` shape (with `[A-Za-z0-9-]{3,}` id charset) to `linearIssueFetch` with the captured id, anything else to "unknown" (no IPC call).
- `doFetch` updated to dispatch based on `detectIssueUrl` before any IPC call. "unknown" short-circuits to "Unsupported issue URL: …" inline.
- Helper text below URL input: "GitHub issues work via the gh CLI. Linear URLs are recognized but require auth (not yet configured)." (replaces Task 9's "Linear support lands in a later release.").
- Placeholder updated to hint at both schemes.
- File header updated to mention both Task 9 + Task 15.

### Things learned / conventions confirmed

- **A new `parse_issue_url` helper that DELEGATES to the existing `parse_github_issue_url` (rather than refactoring the GitHub parser in place) is the right move for adding a second scheme.** The first instinct was to refactor `parse_github_issue_url` to call `parse_issue_url` and check `.kind`. That would have moved the linear.app short-circuit (which Task 9's test pins as `Err("Linear authentication not configured")` from inside `parse_github_issue_url`) into the unified parser — breaking the existing test contract. Delegation preserves the Task 9 short-circuit AND adds the new scheme AND keeps the existing `parse_github_issue_url_recognises_supported_schemes` test passing unchanged. The new test (`parse_issue_url_handles_both_schemes`) covers the new branch.
- **Struct-of-options is the right wire shape for "URL routes to one of N parsers" — not enum-with-payload.** A `ParsedIssueUrl` enum with `Github(String, String, u64) | Linear(String)` would have been more type-safe, but the wire JSON would have been `{"Github": ["acme", "app", 42]}` vs `{"Linear": "ENG-1234"}` — inconsistent keys per variant, awkward to construct from a TS regex match (the regex would have to return a string for GitHub + a 3-tuple for Linear), and a future "GitLab" addition would change the wire shape for every existing variant. The struct-of-options wire format `{kind, github, linear}` is flat, consistent, and additive: a future `jira: Option<(String, String)>` is a backward-compatible new key.
- **Client-side URL routing via a regex mirror is the right pattern, but the regex should be permissive on the GitHub branch and strict on the Linear branch.** Permissive on GitHub: any `https?://github.com/...` URL routes to `githubIssueFetch` (the Rust parser gives precise per-failure errors for invalid shapes). Strict on Linear: we need the bare id for the `linearIssueFetch` IPC, so the regex needs a capture group + the id charset + the length-3 floor. Mirroring the Rust parser exactly. The asymmetry is intentional: GitHub's per-failure error message ("expected /issues/<n>", "issue number must be > 0") is more useful than a client-side "not a GitHub issue URL" guess, but Linear's id is opaque to the user and we can't reconstruct it from a vague "this isn't a Linear issue" error.
- **"Unknown URL" → inline error WITHOUT an IPC call is the right MVP UX.** A pasted `https://example.com/nope` doesn't need a round-trip to the Rust side to know it's unsupported. The dialog's `detectIssueUrl` short-circuits to the inline "Unsupported issue URL: …" error and skips the IPC entirely. The Rust side is still the authoritative validator (the test pins "Unsupported issue URL" for any non-GitHub non-Linear input), so the regex mirror and the Rust parser agree on what counts as "unknown" — defense in depth.
- **An IPC that ALWAYS returns Err is a legitimate MVP, and `#[allow(dead_code)]` on its private helper is the right move.** The plan spec is explicit: "Do not add Linear OAuth or token storage" and "If Linear cannot be read without auth, surface clear unsupported/auth-required error." A real GraphQL implementation needs a token (per-workspace, per-session, with a keychain fallback) — that's a future PR with its own design questions. The MVP `Err("Linear authentication not configured")` is the user-facing message the spec calls for, and the IPC's doc comment documents the trajectory. The `parse_issue_url` helper gets `#[allow(dead_code)]` because Rust's `dead_code` analysis doesn't count `#[cfg(test)]` references — the test pins the function's behavior, but the function has no production caller today.
- **`#[allow(dead_code)]` with a substantive comment is the file's established pattern.** There's exactly one existing `#[allow(dead_code)]` in `lib.rs` (line 620, on `sandbox: Option<SandboxBundle>` for the Drop side-effect). It has a multi-line comment explaining why the field is held without being read. The same pattern is the right move for `parse_issue_url` — the allow without a comment would be a code smell ("why is this here?"), and a maintainer pruning the allow would re-introduce the `dead_code` warning on every `cargo check`.

### Gotchas hit during this task

1. **`cargo check` fired a `dead_code` warning for `parse_issue_url` even though the new test references it.** Rust's `dead_code` analysis is build-config-dependent — `cargo check` (which doesn't run tests) doesn't see `#[cfg(test)]` references, but `cargo test` (which does) does. The warning is technically correct for the build artifacts `cargo check` produces. Fix: `#[allow(dead_code)]` + a comment explaining that the function is a public utility used by the test today + a future unified `IssueFetch` IPC tomorrow. The `cargo test` run still references it (the test compiles and runs), so the test pins the behavior.

2. **The new TS file `/evidence/task-15-linear-public.txt` is text, not PNG, per the spec's explicit override.** The plan's QA scenarios listed `.png` evidence paths (task-15-linear-public.png, task-15-linear-private.png), but the task spec overridden this to `.txt` because the verification is agent-executable (no Playwright in scope for this task — the work is reading produced code + test output). The text evidence file at `.omo/evidence/task-15-linear-public.txt` documents the verification approach for each QA scenario with code/test references, matching the Task 9 evidence file's structure.

3. **The `setFetchState({ kind: "err", ... })` path for "unknown" URLs is set BEFORE the `setFetchState({ kind: "loading" })` call, which means the `name` field doesn't get cleared in that path.** First draft had the unknown-URL check inside the same try block as the IPC call, which would have set `name` to "" before the error. The cleaner order: check for unknown URL first, set the err state, return early — without touching `name` (the user's previous name input is preserved if they fix the URL). Matches the existing Task 9 "set err, don't clobber form" pattern.

4. **`detectIssueUrl` regex for the Linear branch is anchored with `^` and `$` so trailing slashes + query strings + fragments are rejected client-side.** First draft used just `/^https?:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z0-9-]+)/i` (no `$` anchor), which would have matched `https://linear.app/termic/issue/ENG-1/extra` and extracted `ENG-1` as the id. The Rust parser rejects the full URL but the client-side mirror would have routed to `linearIssueFetch("ENG-1")` — bypassing the Rust validation. Adding the `$` anchor + a length-3 floor (matching the Rust `id.len() < 3` check) keeps the mirror tight. The Rust side is still the authoritative validator; the regex just shouldn't pre-extract garbage.

5. **The `IssueUrlKind` enum's `#[serde(rename_all = "snake_case")]` is essential for the wire format to match `IssueSource`.** Without it, Rust would serialize `IssueUrlKind::Github` as `"Github"` (PascalCase) while `IssueSource::Github` is `"github"` (snake_case, from Task 1). The TS regex mirror in `detectIssueUrl` doesn't construct a Rust struct directly — but a future "send the parsed URL to the backend" PR would, and the wire format has to match `IssueSource`'s convention. The unit test pins `"kind":"linear"` serialization as a regression guarantee.

### Conductor comparison

Conductor's Linear integration today is a third-party app: users install a separate Conductor + Linear connector that bridges their Linear workspace into Conductor's task list. The connector requires a Linear API token stored in Conductor's settings, and the connector handles OAuth on first connect. Termic's stance is the same as the GitHub integration: use the user's existing credentials (no token storage, no OAuth). For GitHub, that means the `gh` CLI; for Linear, it means the future "system keychain or per-session prompt" choice — NOT a vendor-side OAuth flow. The MVP `Err("Linear authentication not configured")` is the honest signal that Linear auth isn't set up yet, rather than papering over it with a half-working integration. A future PR can ship the keychain lookup + per-session prompt; the dialog + IPC are already shaped for it. Conductor's bridge approach is heavier (separate app, OAuth round-trip) and creates a second source of truth; Termic's "use the user's existing tooling" stance is the same opinionated call the GitHub half made.



## Task 16 — Checks polling and badges (and Task 18 — error helper)

**Date:** 2026-06-07
**Files touched:** `src/components/workspace/RightPanel.tsx`, `src/lib/errors.ts` (NEW), `src/components/dialogs/IssueImportDialog.tsx`, `src/components/dialogs/PrCreateDialog.tsx`, `src/components/workspace/DiffCommentPopover.tsx`
**Reuses from prior tasks:** `usePrChecks` + `prChecks` store slice (Task 8), `ghErrorToToastText` consumes the stable `gh_unavailable:` / `gh_unauthenticated:` / `rate_limited:` / `gh_error:` prefixes from `classify_gh_error` (Task 8), `useUI.pushToast` for the toast sink (Task 7).

### What was added

**TS (`src/lib/errors.ts`, NEW):**
- `ghErrorToToastText(error: string) -> { message: string; severity: "info" | "error" }`. Pulls the leading code token with `error.split(":", 1)[0]` and matches on it.
- 4-case switch: `gh_unavailable` / `gh_unauthenticated` / `rate_limited` → friendly text + `info` severity; `gh_error` → verbatim stderr (prefix stripped) + `error`; unknown → raw error (preserves pre-helper behavior).

**TS (`src/components/workspace/RightPanel.tsx`):**
- Polling cadence constants: `CHECKS_RELAXED_MS = 30_000`, `CHECKS_AGGRESSIVE_MS = 5_000`. Cadence decision happens AFTER each fetch resolves — `bundle.checks.some(c => c.status === "in_progress" || c.status === "queued")` picks aggressive.
- `ChecksContent`'s polling effect: self-scheduling `setTimeout` with `cancelled` + `clearTimeout(timer)` cleanup. Focus-gate via `if (useApp.getState().activeWorkspaceId !== ws.id) return;` mirrors `useAttentionNotifier`'s pattern defensively.
- `data.loading` is INTENTIONALLY NOT in the polling effect's dep array (see "Gotchas" #1 below).
- `ChecksRefreshButton` refactored: the button now fires its own one-shot IPC inline (`async handleRefresh`) rather than bumping `loading: true` and relying on the polling effect's `data.loading` dep. The user gets an immediate response.
- `ChecksDot` (new) — `<span>` with a 1.5x1.5 dot. `ok` = green, `warn` = orange + `animate-pulse`, `err` = red. `data-testid="checks-status-dot" data-status={color}` for QA.
- `checksDotColor(checks)` (new) — pure helper. Precedence: failure > in-flight > done. Other conclusions (skipped / neutral / cancelled / timed_out / action_required / stale) lumped with "done" → green. Returns null when no checks.
- `FTab` extended with an optional `dotColor: "ok" | "warn" | "err" | null` prop. Both Checks FTab instances (single-repo + multi-repo) pass `dotColor={checksDot}`. The `checksDot` is computed in the parent from `usePrChecks(ws.id)` — so the badge updates automatically on every `setPrChecks` write.
- `ChecksContent`'s new toast effect: `useEffect(() => { if (!toastSig) return; … }, [toastSig])` where `toastSig = err ? \`${data.fetchedAt ?? 0}:${err}\` : null`. Dedup by `(fetchedAt, err)` so we toast exactly once per failed fetch. Inline error state stays as the primary UI when the tab is visible; the toast is the fallback for when the user has navigated elsewhere.
- Merge bar's `handleMerge` catch block now uses `ghErrorToToastText` (replaces the hand-rolled `code → kind` mapping).

**TS (`src/components/dialogs/IssueImportDialog.tsx`):** fetch error path (line 208) — `setFetchState({ kind: "err", message: msg })` + `useUI.getState().pushToast(ghErrorToToastText(msg).message, …)`. Inline + toast dual UI.

**TS (`src/components/dialogs/PrCreateDialog.tsx`):** `doSubmit` catch — `setSubmit({ kind: "err", message: msg })` + `pushToast(ghErrorToToastText(msg).message, …)`. Uses the existing `pushToast` selector.

**TS (`src/components/workspace/DiffCommentPopover.tsx`):** `postToGitHub` catch — `pushToast(ghErrorToToastText(String(e)).message, …)`. Replaces the hand-rolled `code → kind` mapping.

### Things learned / conventions confirmed

- **Self-scheduling `setTimeout` is the right pattern for a poll whose cadence depends on the result, not a fixed `setInterval`.** The check status is a function of the previous fetch — if any check was in flight, the next tick should be 5s later; if all done, 30s. A fixed `setInterval(30s)` couldn't back off aggressively when a check is running AND relax when it's not without a flag, a side-channel, and a re-arming step. The self-scheduling pattern: after each fetch, decide the delay and `setTimeout(tick, delay)`. One handle to clear on unmount.
- **The `cancelled` flag in the polling closure is the right pattern, NOT a stale `setTimeout` handle alone.** Both the in-flight `tick` (whose `await githubPrChecksFetch` may still resolve after unmount) and the pending `setTimeout` (which would fire post-unmount) need to be guarded. The pattern: `let cancelled = false; let timer: number | null = null; …; tick = async () => { if (cancelled) return; … schedule(…); }; schedule = (delay) => { if (cancelled) return; timer = setTimeout(tick, delay); }; …; return () => { cancelled = true; if (timer !== null) clearTimeout(timer); };`. Both the in-flight fetch and the pending timer bail on the next synchronous check.
- **Don't put `data.loading` in a self-scheduling poll effect's dep array — it would cause a fetch-every-fetch loop.** The store's `setPrChecks` writes `loading: false` on every fetch resolution, which triggers a re-render, which would re-run the effect (because `data.loading` is in deps), which starts another fetch, etc. The `setPrChecksLoading` no-op guard (`if (cur?.loading === loading) return s`) breaks the loop on the `setPrChecksLoading(true)` side, but the `data.loading` flip `true→false` after every fetch still re-triggers the effect. The fix: drop `data.loading` from the dep array, keep only the workspace identity deps. The manual refresh button does its own one-shot IPC so it doesn't need the dep trick.
- **A `useUI.getState().pushToast(...)` inside a catch block is the cleanest way to add a notification alongside inline error state.** The dialogs already have `setSubmit({ kind: "err", message })` for the inline UI; a one-line addition to push a toast covers the "user has the dialog behind another window" case. No new state, no new effect — the toast is fire-and-forget, auto-dismissed by the existing `<Toaster/>`.
- **Toast dedup needs a stable signature tied to the underlying state change, not a boolean toggle.** The naive "if (err) pushToast()" in an effect re-runs on every render → toast spam. The right signature: `toastSig = err ? \`${data.fetchedAt ?? 0}:${err}\` : null`, dependency on the signature. The signature changes when (a) a new fetch completes (new `fetchedAt`) or (b) the error message itself changes. Identical re-renders (same data) don't re-fire the toast. The "fetchedAt" anchor means a successful fetch followed by a failure produces a new toast; two consecutive failures of the same kind on different fetches produce two toasts (one per fetch).
- **The `setPrChecks` / `setPrChecksLoading` store actions being stable Zustand function references means they're harmless in dep arrays.** `useApp(s => s.setPrChecks)` returns the same function reference across renders (Zustand stores expose actions as stable refs). Including them in the dep array doesn't add a re-trigger risk. Same pattern as the existing `setActiveTabId` / `setActiveWorkspace` selectors.
- **Mirroring the focus-gate check from `useAttentionNotifier` even when it's redundant under the current architecture is the right move.** The current RightPanel only renders for the active workspace, so `activeWorkspaceId !== ws.id` is always false at mount. But a future PR that keeps the RightPanel mounted for inactive workspaces (e.g. for the same PTY-preservation reasons `mountedWorkspaces` exists) would need this guard. Adding the 2-line check now is cheaper than debugging a background poll later.
- **`ghErrorToToastText` belongs in `src/lib/errors.ts` (a NEW file), not in `src/lib/ipc.ts`.** The IPC module is for Tauri command wrappers; the helper is a pure TS function with no Rust counterpart. A separate `errors.ts` keeps the IPC module focused on `invoke` calls and makes it clear that the helper is UI-side normalization (no IPC, no async).

### Gotchas hit during this task

1. **First draft of the polling effect included `data.loading` in the dep array, which would have caused a tight fetch-every-fetch loop.** The existing ChecksContent effect (Task 8) had the same dep — it worked there because the effect was a one-shot (not self-scheduling) and the `setPrChecks` call's `loading: false` write was the terminal state. The new self-scheduling effect, however, needs to schedule the NEXT tick after each fetch — and the `data.loading` flip `true→false` was re-triggering the effect on every cycle. Dropping `data.loading` from the dep array fixes it; the `setPrChecksLoading` no-op guard handles the `false→true` half of the cycle. This is a subtle dep-array trap that's only visible when you trace the full fetch → store-write → re-render → effect cycle.
2. **The first toast effect placement was inside the `if (err) { … return <ErrorState/>; }` block — a rules-of-hooks violation.** React requires hooks to be called at the top level, in the same order, every render. Putting `useEffect` inside the conditional would have worked only because `err` is consistent across re-renders while the error state is mounted, but as soon as `err` flips null → set → null (between fetches), the hook order would change and React would warn. Fix: hoist the toast `useEffect` to the top of the component (alongside the polling effect), with a `toastSig` derived value that short-circuits the body when no error.
3. **The first `ChecksRefreshButton` change was `setPrChecksLoading(ws.id, true)` + wait for the polling effect's `data.loading` dep to re-fire the fetch.** That works for the manual refresh, but it would re-introduce the `data.loading`-in-deps trap from gotcha #1 if the polling effect kept that dep. The clean fix: the button fires its own one-shot IPC inline. The polling effect's dep array stays clean. Both paths write to the same store slot, so the last-to-finish wins; the user sees the manual result within ~50ms, and the polling loop continues on its own schedule.
4. **The plan spec mentioned "PrPostDiffComment button" as a RightPanel call site for the helper, but that button is in `DiffCommentPopover.tsx`, not RightPanel.** Read it as a typo / cross-reference: the spec meant the call site for `githubPrPostDiffComment` errors, which is `DiffCommentPopover.postToGitHub`. The store action `markDiffCommentPosted` itself takes no error parameter (it's a pure state stamp: `(wsId, commentId, remoteId, postedAt) → void`), so "wrapping the error before surfacing" is satisfied by the call site that uses it on the success path (DiffCommentPopover) AND by the catch block immediately above it (which is where the gh error actually surfaces).
5. **`useUI.getState().pushToast(...)` vs the `pushToast` selector.** The convention in this codebase is: declare `const pushToast = useUI(s => s.pushToast)` in the component body when you have multiple call sites in the same render (Dialogs, Toaster, etc.) and want React to see the subscription. For one-shot fire-and-forget calls in event handlers (issue-import fetch error, PR-create error, Checks-tab toast effect), `useUI.getState().pushToast(...)` is the lighter-weight pattern — no subscription, no re-render trigger. The IssueImportDialog fetch error and ChecksContent toast effect use `getState()`; the PrCreateDialog doSubmit and DiffCommentPopover postToGitHub use the `pushToast` selector they already had in scope. Both work; the difference is whether the component needs a subscription to pushToast for any other reason.
6. **The FTab signature extension is a one-line API addition but ripples to 2 call sites (single-repo + multi-repo).** Both Checks FTab instances had to be updated in lockstep. Forgetting one would leave the badge missing on the multi-repo path (a hidden regression because single-repo is the more common case during dev). The grep `label="Checks"` caught it.

---

## Task 19 — Repository settings GitHub integration section

**Date:** 2026-06-07
**Files touched:** `src/components/settings/RepositorySection.tsx`, `src/lib/shortcuts.ts` (new `GitHub` group only, used by Task 20)

### What was added

A new `github` entry in the existing `SubTab` union of the per-project Repository settings page (`scripts` | `sandbox` | `links` | `github` | `advanced`). The sub-tab renders a `GithubSection` component with three cards:

1. **GitHub CLI status card** — `data-testid="github-status"` text node. The text strings exactly match the QA acceptance criteria: `"GitHub CLI authenticated"` (with `" as <username>"` suffix when `githubStatus.username` is set) when `gh auth status` exits 0; `"Run gh auth login to connect to GitHub."` when `gh` is installed but unauthenticated; `"gh CLI not found on PATH..."` when not installed; `"Probing GitHub CLI…"` while the IPC is still resolving. A `data-status` attribute also carries the state-machine value (`ok` | `unauth` | `unavailable` | `unknown`) for any future state-based CSS hooks. A Refresh button (`data-testid="github-status-refresh"`, Tip-wrapped) calls `useApp.refreshGithubStatus()`.

2. **Remote + Base branch fields** — editable in place, same `projectUpdate` IPC + `loadAll()` reload as the More tab. All four anti-spellcheck attrs per CLAUDE.md. Hints explain where the value is consumed.

3. **Quick actions card** — "Import from issue URL" button calls `useUI.openIssueImport(projectId)`; "Create PR" button calls `useUI.openPrCreate(latestWs.id)` where `latestWs` is the most-recent non-archived workspace for this project (sorted by `Workspace.created` desc, then `id` for stability). The PR-create button is disabled with an explanatory Tip when no workspace exists, since the dialog needs a `wsId`. Both buttons are wrapped in `Tip` with the new ⇧⌘I / ⇧⌘P shortcut hints — they're also the discoverability surface for the new Task 20 shortcuts.

### Sub-tab choice

Added a new entry to the existing `tabs: { id: SubTab; label: string }[]` array rather than a separate `ghTab` state. Rationale:

- The page is already a sub-tabbed layout; adding a new entry reuses the underline-tab strip + the existing `useEffect(() => { setSubTab("scripts") }, [projectId])` reset on project switch.
- A separate state would have meant two parallel tab strips competing for the same horizontal space.
- The QA scenario keys off `Settings > Repository > GitHub` — matches the chosen placement.

### Things learned / conventions confirmed

1. **`Workspace.created` not `created_at`.** The field is `created: string` (ISO timestamp) on the `Workspace` interface in `src/lib/types.ts` (line 106). My initial `created_at` reference came from a different table (`DiffInlineComment.posted_at` etc.); the `Workspace` type predates that naming convention. `cargo test` doesn't catch this (it's a frontend-only type) but `tsc -b` does, and the error message is helpful: "Property 'created_at' does not exist on type 'Workspace'. Did you mean 'created'?".
2. **`useApp(s => s.projects.find(...))` returns `Project | undefined` and the narrowing through closures is fragile.** Even after `if (!project) return null;`, a function defined later in the same render (`function patchRemote(v) { ... }`) references `project` from the closure scope, and TS's narrowing reverts to `Project | undefined`. The error reads: "Type 'string | undefined' is not assignable to type 'string'". The fix: hoist a non-null `const proj = project;` and reference `proj` in the closures. Same pattern as the `repo = repo` hoist at line 248 of the same file.
3. **`useMemo` not auto-imported.** The existing `RepositorySection.tsx` imports `useEffect, useRef, useState` from react; `useMemo` had to be added explicitly. `tsc -b` error: "Cannot find name 'useMemo'".

---

## Task 20 — Keyboard shortcuts and discoverability

**Date:** 2026-06-07
**Files touched:** `src/lib/shortcuts.ts`, `src/hooks/useShortcuts.ts`, `src/components/workspace/RightPanel.tsx`, `src/components/views/History.tsx`, `src/components/settings/RepositorySection.tsx` (GitHub sub-tab quick actions from Task 19 double as the discoverability surface), `src/components/dialogs/ShortcutsHelpDialog.tsx` (no code change — iterates `SHORTCUT_DEFS`)

### New shortcuts

All four live in a new `"GitHub"` `ShortcutGroup` (appended to `GROUP_ORDER` so the ShortcutsHelpDialog + ShortcutsSection settings page both render them under that header). All four use `⇧⌘` + a free letter to dodge the long-standing `⌘1..9 / ⌘[/] / ⌘W / ⌘L / ⌘T / ⇧⌘[/]` nav set the spec called out.

| id            | default | action                                                                                        |
|---------------|---------|-----------------------------------------------------------------------------------------------|
| `pr-create`   | ⇧⌘P     | `useUI.openPrCreate(wsId)` for the active workspace                                           |
| `issue-import`| ⇧⌘I     | `useUI.openIssueImport(ws.project_id)` for the active workspace's project                     |
| `open-checks` | ⇧⌘K     | `window.dispatchEvent("termic-open-checks")` → RightPanel listener switches `footTab` to `"checks"` + expands the footer |
| `open-history`| ⇧⌘H     | `useApp.setView(...)` — toggles between `dashboard` and `history`                             |

⇧⌘P is the QA scenario's required binding for PR-create. All four are rebindable via the existing Settings → Shortcuts recorder; the conflict detector (`ShortcutsSection.tsx` lines 37-50) flags any user-created collision by signature.

### Tooltips added

All using the existing `Tip` from `src/components/ui/Tooltip.tsx`. Five sites:

- **Checks tab** (RightPanel footer) — Tip wrapping the `FTab` in both single-repo and multi-repo variants. Content: `"PR + commit checks for this branch (⇧⌘K)"`.
- **Restore button** (History view) — Tip wrapping the Restore `<button>`. Content: `"Re-create the worktree at its saved path and switch into it"`.
- **Add external directory button** (Repository → Links) — Tip wrapping the "Add" button at the end of the form. Content: `"Create the symlink. New workspaces (and Import-from-issue) will mount this directory at the link name."`.
- **Issue import button** — Tip wrapping the "Import from issue URL" button in the new GitHub sub-tab. Content includes the `⇧⌘I` hint.
- **PR create button** — Tip wrapping the "Create PR" button in the GitHub sub-tab AND the empty-state "Create PR" button in `ChecksContent`. Content includes the `⇧⌘P` hint.

### Things learned / conventions confirmed

1. **The `useShortcuts` handler uses a first-match-wins dispatch against the sorted `SHORTCUT_DEFS` array.** This means: any new shortcut id MUST be added to `ShortcutId`, `SHORTCUT_DEFS`, AND have a `case` in the handler — missing the handler case would make the binding fire with no effect (no error, just silence). The `bindingMatches` check returns the first binding whose combo the event satisfies; if the id isn't in the switch, the handler returns without `preventDefault`, so the keystroke also "leaks" to the browser (Cmd+P in the search field would insert a "P" character). Always add the case in the same commit as the def.
2. **Custom event pattern for cross-component shortcut effects.** `footTab` is local state in `RightPanel` (not in the store) because it has no cross-component consumers and the tab switching doesn't need to survive a remount. The shortcut handler can't reach into local state, so it dispatches `window.dispatchEvent(new CustomEvent("termic-open-checks", { detail: { wsId } }))` and RightPanel listens with a `useEffect`. Same pattern as the existing `termic-new-tab-menu` event (useShortcuts.ts line 251). The `wsId` in the event detail is a stale-event guard: the listener checks `detail.wsId !== ws?.id` and bails if not, so a queued keystroke from a previous activation can't redirect focus after a switch.
3. **The new "GitHub" group is in `GROUP_ORDER` (not just the array).** The ShortcutsHelpDialog and ShortcutsSection both render `GROUP_ORDER.map(group => ...)`, so adding a new group requires updating both the `ShortcutGroup` union AND `GROUP_ORDER`. Miss one and the new entries either don't render (missing from the group iteration) or type-check fails (union narrower than the array). Easy to forget; the type system catches the array-vs-union mismatch at compile time but NOT a missing-from-`GROUP_ORDER` oversight.
4. **The `toggling` behavior of `open-history` was a deliberate design choice — not a bug.** Pressing ⇧⌘H while on the history view jumps back to dashboard. The sidebar's history entry (`Sidebar.tsx` line 231) doesn't toggle (it's an explicit jump), but the keyboard shortcut gains a return path that the sidebar doesn't have, which is a small UX improvement that the menu can't offer (menus don't have a "current" state to compare against without extra plumbing). Mirrored the way `setView("dashboard")` works as the explicit return path from `setView("history")` in the sidebar.
5. **No-op guards on the shortcut handlers match the existing pattern.** `pr-create` / `issue-import` / `open-checks` return early when there's no active workspace (no `wsId` → no branch to PR from, no project to import into, no right panel to switch). `open-history` always fires (history is global, not workspace-scoped). This matches the convention of every other workspace-scoped command in `useShortcuts.ts`.
6. **`useUI.getState().X` is the right call for one-shot fire-and-forget invocations from a shortcut handler.** The shortcut handler isn't a component (no subscription needed) and `useUI` is a stable Zustand store; `getState().openPrCreate(wsId)` is the lighter-weight pattern. The same pattern is used by `setView`, `setActiveWorkspace`, etc. in this file.

### Conductor comparison

Conductor's shortcut list is documented on termic.dev vs conductor and is roughly 1.5× larger (more menu items have explicit shortcuts). Conductor's "Create PR" surface is gated behind a "Connect Linear" modal because their PR flow goes through Linear, not direct `gh pr create`. The ⇧⌘P binding isn't reserved in Conductor (they use ⌘⇧O for "Open Linear issue"), so picking ⇧⌘P for PR-create was safe from a UX-collision standpoint even if termic later imports Conductor's bindings wholesale — there's no overlap. Conductor does NOT have a History view shortcut (their archive is a filter on the workspace list, not a separate page), so ⇧⌘H was a free letter for termic.

### Conductor comparison

Conductor has a Checks panel for PRs but its polling model isn't exposed in the same way — Conductor renders the checks state from a per-tab server-sent event, not a client-driven poll. The "client polls GitHub on a cadence" pattern is termic's because we use the `gh` CLI instead of a backend; the GitHub API doesn't push to clients, and `gh` is just a one-shot wrapper. The relaxation from 5s aggressive to 30s relaxed matches the GitHub check-pipeline cadence (most PRs have checks complete in <2 minutes, but workflows can take 10+ minutes) — neither 5s nor 30s is unique to termic; the design choice is to switch between them based on whether a check is in flight. Conductor's badge for checks is a static dot (success/failure only); termic's is dynamic (pulsing orange for in-flight, red for failure, green for done), with the in-flight state being the more interesting one because that's the "user wants to know when to look again" moment. The error-helper task is termic-only — Conductor's web app shows server-side rendered error pages and doesn't need a client-side gh-error normalizer.
