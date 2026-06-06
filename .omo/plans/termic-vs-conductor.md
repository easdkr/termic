# Termic vs Conductor: Feature Gap Implementation

## TL;DR

> **Quick Summary**: Implement 6 missing features in termic that conductor (proprietary competitor) has: external directory mounting (`/add-dir`), CI checks tab, issue-to-workspace auto-creation, end-to-end PR workflow, diff inline comments synced to GitHub PR, and archived workspace restore.
>
> **Deliverables**:
> - `/add-dir`: Per-project external directory symlinks into workspaces
> - Checks tab: GitHub Actions status polling in right-panel footer
> - Issue → Workspace: Paste GitHub/Linear URL, auto-seed workspace name/branch
> - PR Workflow: Create, view, merge PRs via `gh` CLI integration
> - Diff Comments: Inline comments in DiffPane posted as GitHub PR review comments
> - Archive Restore: Recreate worktrees from archived workspace metadata
>
> **Estimated Effort**: XL
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: Type definitions → Rust IPC commands → Frontend UI → Integration tests

---

## Context

### Original Request
User provided a detailed list of 7 conductor features missing from termic, with descriptions of what each feature does and what termic currently lacks.

### Interview Summary
**Key Discussions**:
- **GitHub auth**: Use `gh` CLI auth (no token UI) — shells out to `gh auth status` / `gh api`
- **PR workflow scope**: Full lifecycle (create → merge)
- **Checks tab scope**: GitHub Actions only
- **Diff comments**: Post to GitHub PR review comments
- **`/add-dir` persistence**: Per-project (stored in project JSON)
- **Composer @ suggestions**: SKIP — Cursor-specific, doesn't map to termic's terminal-based architecture

**Research Findings**:
- History.tsx has "Read-only list for now" comment — restore is missing
- DiffPane uses CodeMirror 6 merge view — no comment infrastructure
- types.ts has no PR/issue/CI types
- ipc.ts has no PR/issue/CI IPC calls
- lib.rs has no PR/issue/CI commands
- README roadmap explicitly mentions: "Linear + GitHub PR integration. Paste an issue / PR URL, get a workspace seeded with title + body. Create the PR from the app via `gh`. No OAuth."

### Metis Review
**Identified Gaps** (addressed):
- GitHub auth method clarified (use `gh` CLI)
- PR workflow scope clarified (full lifecycle)
- Checks tab limited to GitHub Actions only
- Diff comments scope clarified (post to GitHub)
- `/add-dir` persistence clarified (per-project)
- Composer @ feature skipped

---

## Work Objectives

### Core Objective
Implement 6 conductor-competitive features in termic using `gh` CLI integration, extending the existing Tauri/React architecture without breaking PTY lifecycle or existing patterns.

### Concrete Deliverables
1. **Type definitions** (`src/lib/types.ts` + Rust structs): PR, Check, Comment, Issue, SymlinkEntry types
2. **Rust IPC commands** (`src-tauri/src/lib.rs`): 15+ new commands for GitHub ops, symlink management, archive restore
3. **Frontend UI components**: Checks tab, PR dialog, diff comment UI, issue import dialog, archive restore button
4. **GitHub integration layer**: `gh` CLI wrapper commands with error handling
5. **State management**: Zustand slices for PRs, checks, comments

### Definition of Done
- [ ] All 6 features are functional and accessible from the UI
- [ ] `bun test` passes (existing + new tests)
- [ ] `cargo check` passes
- [ ] No regressions in existing PTY lifecycle
- [ ] Each feature has agent-executable QA scenarios

### Must Have
- [ ] `/add-dir`: Symlink external directories into workspace, persisted per-project
- [ ] Checks tab: Poll GitHub Actions API for workflow runs, display status
- [ ] Issue → Workspace: Parse GitHub/Linear issue URL, create workspace with title/body
- [ ] PR Workflow: Create PR (draft/regular), view PR list/status, merge when green
- [ ] Diff Comments: Add inline comments in DiffPane, post as GitHub PR review comments
- [ ] Archive Restore: Recreate worktree from archived workspace metadata
- [ ] All features use `gh` CLI for GitHub operations (no OAuth, no PAT storage)
- [ ] Follow existing patterns: ipc.ts wrappers, types.ts sync, Dialogs.tsx for modals

### Must NOT Have (Guardrails)
- [ ] OAuth flows or PAT input UI
- [ ] Non-GitHub CI providers (CircleCI, Travis, etc.)
- [ ] Composer @ suggestions (skipped per user decision)
- [ ] Breaking existing PTY lifecycle or terminal mounting
- [ ] Re-enabling React StrictMode
- [ ] Auto-sync of `/add-dir` symlinks (manual only)
- [ ] Threaded replies on diff comments (single-level only for MVP)
- [ ] PR review/approve actions (create/view/merge only)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Vitest for frontend, `cargo test` for Rust)
- **Automated tests**: Tests-after (new features get tests after implementation)
- **Framework**: Vitest (frontend), built-in Rust test runner
- **Agent QA**: Every task includes agent-executed QA scenarios

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright — Navigate, interact, assert DOM, screenshot
- **Rust/Backend**: Bash (cargo test) — Run unit tests, assert pass
- **API/Integration**: Bash (curl + gh CLI) — Verify GitHub API calls
- **E2E**: Bash (npm run tauri:dev) — Start app, verify feature works

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types + Rust commands + base UI):
├── Task 1: Type definitions (PR, Check, Comment, Issue, SymlinkEntry)
├── Task 2: Rust IPC commands — GitHub integration base (gh CLI wrappers)
├── Task 3: Rust IPC commands — Symlink management (/add-dir)
├── Task 4: Rust IPC commands — Archive restore
├── Task 5: Frontend state slices (Zustand) for PRs, checks, comments
└── Task 6: GitHub auth detection (gh CLI availability check)

Wave 2 (Core features — MAX PARALLEL):
├── Task 7: /add-dir UI (project settings dialog + symlink creation)
├── Task 8: Checks tab (right-panel footer tab + GitHub Actions polling)
├── Task 9: Issue → Workspace dialog (URL paste + title/body parsing)
├── Task 10: PR Create dialog (draft/regular + auto-description)
├── Task 11: Diff inline comments UI (CodeMirror extension + comment markers)
└── Task 12: Archive restore UI (HistoryView restore button)

Wave 3 (Integration + Advanced features):
├── Task 13: PR View/Merge UI (PR list, status checks, merge button)
├── Task 14: Diff comments → GitHub PR (post review comments via gh CLI)
├── Task 15: Issue parsing — Linear support (Linear API via gh CLI)
├── Task 16: Checks tab — Real-time polling + status badges
└── Task 17: /add-dir — Symlink lifecycle (validate on workspace create)

Wave 4 (Polish + Cross-feature integration):
├── Task 18: Error handling + user feedback (toast notifications for GitHub ops)
├── Task 19: Settings integration (GitHub config in Repository settings)
├── Task 20: Keyboard shortcuts + accessibility
└── Task 21: Performance optimization (polling intervals, caching)

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 2 → Task 7-12 → Task 13-17 → Task 18-21 → F1-F4 → user okay
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 6 (Wave 2)
```

### Dependency Matrix

- **1**: - - 2-6, 7-12
- **2**: 1 - 8, 9, 10, 13, 14, 15
- **3**: 1 - 7, 17
- **4**: 1 - 12
- **5**: 1 - 8, 10, 11, 13
- **6**: - - 2, 8, 9, 10, 13, 14, 15
- **7**: 3 - 17
- **8**: 2, 5 - 13, 16
- **9**: 2, 6 - 15
- **10**: 2, 5, 6 - 13
- **11**: 5 - 14
- **12**: 4 - -
- **13**: 8, 10 - 18
- **14**: 2, 11 - 18
- **15**: 2, 6, 9 - 18
- **16**: 8 - 18
- **17**: 7 - 18
- **18**: 13, 14, 15, 16, 17 - 19, 20, 21
- **19**: 18 - 20, 21
- **20**: 18 - 21
- **21**: 18 - F1-F4

### Agent Dispatch Summary

- **1**: **6** - T1-T6 → `quick` (types, base commands, state)
- **2**: **6** - T7-T12 → `unspecified-high` (UI components)
- **3**: **5** - T13-T17 → `unspecified-high` (integration)
- **4**: **4** - T18-T21 → `unspecified-high` (polish)
- **FINAL**: **4** - F1-F4 → `oracle`, `unspecified-high`, `unspecified-high`, `deep`

---

## TODOs

- [x] 1. Shared feature types and persistence schema

  **What to do**: Add TypeScript and Rust structs for `ExternalDirLink`, `GitHubCheckRun`, `GitHubPullRequest`, `IssueSeed`, and `DiffInlineComment`. Keep `src/lib/types.ts` and `src-tauri/src/lib.rs` serde shapes synchronized.
  **Must NOT do**: Do not add OAuth or token fields.
  **Recommended Agent Profile**: Category `quick`. Skills: none. Omitted: `test-driven-development`, tests are added in this task after schema changes.
  **Parallelization**: Wave 1. Blocks 2-5 and 7-17. Blocked by none.
  **References**: `src/lib/types.ts:5-182` for Project/Workspace shape. `src-tauri/src/lib.rs:41-200` for matching Rust structs. `src/lib/ipc.ts:1-10` for import patterns.
  **Acceptance Criteria**: `npm run build` reaches type-check for new exported types. `cargo check --manifest-path src-tauri/Cargo.toml` compiles new structs.
  **QA Scenarios**:
  ```
  Scenario: Type exports compile
    Tool: Bash
    Preconditions: Repo checkout clean enough to build
    Steps: 1. Run npm run build 2. Capture output
    Expected Result: TypeScript reports 0 type errors related to new types
    Evidence: .omo/evidence/task-1-type-build.txt
  Scenario: Rust serde structs compile
    Tool: Bash
    Preconditions: Rust toolchain installed
    Steps: 1. Run cargo check --manifest-path src-tauri/Cargo.toml
    Expected Result: Exit code 0
    Evidence: .omo/evidence/task-1-cargo-check.txt
  ```
  **Commit**: NO, group with 2-6.

- [x] 2. GitHub `gh` CLI IPC foundation

  **What to do**: Add Rust helper functions and Tauri commands for `gh auth status`, `gh api`, and safe JSON parsing. Add frontend wrappers in `src/lib/ipc.ts`.
  **Must NOT do**: Do not store credentials. Do not call GitHub directly from frontend.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 1. Blocks 8-10 and 13-16. Blocked by 1 and 6.
  **References**: `src/lib/ipc.ts:14-24` for wrapper style. `src-tauri/src/lib.rs` command pattern. README roadmap says "No OAuth".
  **Acceptance Criteria**: New command returns authenticated username or a structured auth error. JSON parse errors include stderr.
  **QA Scenarios**:
  ```
  Scenario: gh auth status succeeds
    Tool: Bash
    Preconditions: gh authenticated in shell
    Steps: 1. Run gh auth status 2. Run cargo test gh_auth
    Expected Result: Test passes and output includes logged-in host github.com
    Evidence: .omo/evidence/task-2-gh-auth.txt
  Scenario: gh missing or unauthenticated is graceful
    Tool: Bash
    Preconditions: PATH can be overridden
    Steps: 1. Run test with PATH=/tmp 2. Capture error JSON
    Expected Result: Error code is gh_unavailable or gh_unauthenticated, no panic
    Evidence: .omo/evidence/task-2-gh-error.txt
  ```
  **Commit**: NO, group with 1-6.

- [x] 3. Per-project external directory link backend

  **What to do**: Add `external_dir_links` to Project. Add IPC to add, list, remove, and materialize symlinks inside workspaces. Materialize links on workspace creation.
  **Must NOT do**: Do not auto-sync contents beyond symlink creation. Do not allow link names containing `/` or `..`.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 1. Blocks 7 and 17. Blocked by 1.
  **References**: `src/lib/types.ts:5-52` Project fields. `src-tauri/src/lib.rs:41-110` Project struct. Existing workspace create commands in `src/lib/ipc.ts:28-51`.
  **Acceptance Criteria**: Adding a link persists in project JSON and creates a symlink in new workspaces.
  **QA Scenarios**:
  ```
  Scenario: External dir link materializes
    Tool: Bash
    Preconditions: Temp project and temp external dir exist
    Steps: 1. Add link name shared-docs 2. Create workspace 3. Run test -L <workspace>/shared-docs
    Expected Result: Symlink exists and resolves to external dir
    Evidence: .omo/evidence/task-3-link-create.txt
  Scenario: Invalid link name rejected
    Tool: Bash
    Preconditions: Temp project exists
    Steps: 1. Try link name ../secrets 2. Capture IPC error
    Expected Result: Error mentions invalid link name and no symlink is created
    Evidence: .omo/evidence/task-3-link-invalid.txt
  ```
  **Commit**: NO, group with 1-6.

- [x] 4. Archive restore backend

  **What to do**: Add IPC command to restore archived workspace by recreating the git worktree from saved branch/base metadata and flipping `archived=false`.
  **Must NOT do**: Do not delete or mutate existing branch history. Do not restore repo-root workspace by copying files.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 1. Blocks 12. Blocked by 1.
  **References**: `src/components/views/History.tsx:1-40` current read-only UI. `src/lib/ipc.ts:52-53` archive/delete wrappers. `src/lib/types.ts:89-138` Workspace fields.
  **Acceptance Criteria**: Archived workspace can become active again and path exists. Missing branch reports actionable error.
  **QA Scenarios**:
  ```
  Scenario: Restore archived worktree
    Tool: Bash
    Preconditions: Test workspace archived with branch feature/restore-demo
    Steps: 1. Invoke workspace_restore 2. List workspaces 3. Check archived=false and path exists
    Expected Result: Workspace is visible as active and git worktree list contains its path
    Evidence: .omo/evidence/task-4-restore.txt
  Scenario: Restore missing branch fails clearly
    Tool: Bash
    Preconditions: Archived workspace branch deleted
    Steps: 1. Invoke workspace_restore 2. Capture error
    Expected Result: Error includes missing branch and workspace remains archived
    Evidence: .omo/evidence/task-4-missing-branch.txt
  ```
  **Commit**: NO, group with 1-6.

- [x] 5. Frontend state for GitHub and comments

  **What to do**: Add a small Zustand store or app-store slices for checks, PRs, issue seeds, and diff comments with stable selectors and frozen empty constants.
  **Must NOT do**: Do not return new arrays from selectors without caching.
  **Recommended Agent Profile**: Category `quick`. Skills: none.
  **Parallelization**: Wave 1. Blocks 8, 10, 11, 13, 14. Blocked by 1.
  **References**: `src/store/app.ts:812-825` selector rules. `src/store/scriptRuns.ts` for live output state pattern. `src/lib/types.ts` for shared types.
  **Acceptance Criteria**: Store tests prove selector stability and update behavior.
  **QA Scenarios**:
  ```
  Scenario: Store selectors are stable
    Tool: Bash
    Preconditions: Vitest installed
    Steps: 1. Run npm test -- src/store/github.test.ts
    Expected Result: Tests pass and selector returns same empty reference across calls
    Evidence: .omo/evidence/task-5-store-tests.txt
  Scenario: Comment state updates one workspace only
    Tool: Bash
    Preconditions: Store test data has two workspace IDs
    Steps: 1. Add comment to ws-a 2. Assert ws-b comments empty
    Expected Result: ws-b unchanged
    Evidence: .omo/evidence/task-5-isolation.txt
  ```
  **Commit**: NO, group with 1-6.

- [x] 6. GitHub capability detection and UI gating

  **What to do**: Detect `gh` availability and auth status on app load or when GitHub UI opens. Surface disabled states and setup guidance.
  **Must NOT do**: Do not block app startup on network calls.
  **Recommended Agent Profile**: Category `quick`. Skills: none.
  **Parallelization**: Wave 1. Blocks 2, 8-10, 13-16. Blocked by none.
  **References**: `src/store/app.ts:228-237` CLI detection pattern. `src/lib/ipc.ts:316-320` settings/discovery wrappers. `src/components/settings/AgentsSection.tsx` install badge pattern.
  **Acceptance Criteria**: GitHub features show a disabled state with `Install and authenticate gh` when unavailable.
  **QA Scenarios**:
  ```
  Scenario: gh available enables GitHub UI
    Tool: Playwright
    Preconditions: gh authenticated
    Steps: 1. Open app 2. Open Checks tab 3. Assert button [data-testid="checks-refresh"] enabled
    Expected Result: Checks UI is enabled
    Evidence: .omo/evidence/task-6-gh-enabled.png
  Scenario: gh unavailable shows guidance
    Tool: Playwright
    Preconditions: Mock IPC returns gh_unavailable
    Steps: 1. Open PR dialog 2. Assert text contains Install and authenticate gh
    Expected Result: Create PR button disabled
    Evidence: .omo/evidence/task-6-gh-disabled.png
  ```
  **Commit**: YES. Message: `feat(github): add gh cli foundation`

- [x] 7. `/add-dir` project settings UI

  **What to do**: Add UI in Repository settings for project-level external directory links: list, add via directory picker/path input, remove, and materialize for existing workspaces on demand.
  **Must NOT do**: Do not add composer slash command handling inside PTY.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 2. Blocks 17. Blocked by 3.
  **References**: `src/components/settings/RepositorySection.tsx` repository settings pattern. `src/lib/ipc.ts:386-388` path/open helpers. `src-tauri/src/lib.rs` existing project update commands.
  **Acceptance Criteria**: Add/remove link updates project settings and new workspace gets symlink.
  **QA Scenarios**:
  ```
  Scenario: Add external dir in settings
    Tool: Playwright
    Preconditions: App has project TermicTest and temp dir /tmp/termic-shared
    Steps: 1. Open Settings > Repository 2. Fill [data-testid="external-link-name"] with shared 3. Fill path 4. Click Add
    Expected Result: Row shared appears with path /tmp/termic-shared
    Evidence: .omo/evidence/task-7-add-dir.png
  Scenario: Duplicate link rejected
    Tool: Playwright
    Preconditions: shared link already exists
    Steps: 1. Add shared again 2. Read error region
    Expected Result: Error text contains Link name already exists
    Evidence: .omo/evidence/task-7-duplicate.png
  ```
  **Commit**: YES. Message: `feat(workspace): add external directory links`

- [x] 8. Checks tab base UI

  **What to do**: Add a Checks tab to the right-panel footer. Display workflow runs, commit status checks, conclusion, duration, and links to GitHub.
  **Must NOT do**: Do not support non-GitHub providers.
  **Recommended Agent Profile**: Category `visual-engineering`. Skills: none.
  **Parallelization**: Wave 2. Blocks 13 and 16. Blocked by 2, 5, 6.
  **References**: `src/components/workspace/RightPanel.tsx` footer tabs. `src/store/scriptRuns.ts` stream status UI. `src/lib/ipc.ts` GitHub wrappers from Task 2.
  **Acceptance Criteria**: Checks tab appears per workspace and renders mocked runs.
  **QA Scenarios**:
  ```
  Scenario: Checks tab displays green workflow
    Tool: Playwright
    Preconditions: Mock IPC returns build success
    Steps: 1. Open workspace 2. Click [data-testid="right-tab-checks"] 3. Assert text Build and Success
    Expected Result: Green status badge visible
    Evidence: .omo/evidence/task-8-checks-success.png
  Scenario: Checks tab handles no PR
    Tool: Playwright
    Preconditions: Mock IPC returns no associated PR
    Steps: 1. Open Checks 2. Assert empty state text
    Expected Result: Text contains No PR or checks found for this branch
    Evidence: .omo/evidence/task-8-checks-empty.png
  ```
  **Commit**: NO, group with 16.

- [x] 9. Issue URL to workspace creation dialog

  **What to do**: Add dialog to paste GitHub or Linear issue URL, fetch title/body, prefill workspace name, branch, and initial agent prompt or setup note.
  **Must NOT do**: Do not add OAuth. Do not edit the issue remotely.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 2. Blocks 15. Blocked by 2 and 6.
  **References**: `src/components/dialogs/NewWorkspaceDialog.tsx` workspace creation flow. README roadmap issue URL text. `src/lib/ipc.ts:28-32` workspace create wrappers.
  **Acceptance Criteria**: GitHub issue URL creates workspace with sanitized branch and seeded description.
  **QA Scenarios**:
  ```
  Scenario: GitHub issue seeds workspace
    Tool: Playwright
    Preconditions: Mock gh api returns title Fix login bug and body Steps here
    Steps: 1. Open issue import dialog 2. Paste https://github.com/acme/app/issues/123 3. Click Create
    Expected Result: Workspace name Fix login bug appears in sidebar
    Evidence: .omo/evidence/task-9-github-issue.png
  Scenario: Invalid URL rejected
    Tool: Playwright
    Preconditions: App open
    Steps: 1. Paste https://example.com/nope 2. Click Fetch
    Expected Result: Error contains Unsupported issue URL
    Evidence: .omo/evidence/task-9-invalid-url.png
  ```
  **Commit**: NO, group with 15.

- [x] 10. PR create dialog

  **What to do**: Add dialog for draft/regular PR creation. Auto-draft description from branch diff and issue seed when present. Use `gh pr create` through backend.
  **Must NOT do**: Do not post approvals. Do not bypass `gh` auth.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 2. Blocks 13. Blocked by 2, 5, 6.
  **References**: `src/components/dialogs/ReviewDialog.tsx` agent-driven prompt dialog. `src/components/dialogs/Dialogs.tsx` mount pattern. `src/lib/review.ts` diff prompt pattern.
  **Acceptance Criteria**: Dialog creates draft and non-draft PRs and surfaces returned URL.
  **QA Scenarios**:
  ```
  Scenario: Create draft PR
    Tool: Playwright
    Preconditions: Mock backend returns https://github.com/acme/app/pull/42
    Steps: 1. Open PR dialog 2. Check Draft 3. Click Create PR
    Expected Result: Success text contains /pull/42
    Evidence: .omo/evidence/task-10-draft-pr.png
  Scenario: Empty title blocked
    Tool: Playwright
    Preconditions: PR dialog open
    Steps: 1. Clear title input 2. Click Create PR
    Expected Result: Error contains Title is required
    Evidence: .omo/evidence/task-10-empty-title.png
  ```
  **Commit**: NO, group with 13.

- [x] 11. Diff inline comment markers and editor UI

  **What to do**: Extend DiffPane with line-level comment controls using CodeMirror decorations or gutters. Store draft comment text locally before posting.
  **Must NOT do**: Do not implement threaded replies.
  **Recommended Agent Profile**: Category `visual-engineering`. Skills: none.
  **Parallelization**: Wave 2. Blocks 14. Blocked by 5.
  **References**: `src/components/workspace/DiffPane.tsx:49-160` CodeMirror setup. `src/components/workspace/EditorPane.tsx` CodeMirror theme reuse. `src/store/app.ts:638-685` tab update pattern.
  **Acceptance Criteria**: User can attach comment to changed line and see marker after tab remount.
  **QA Scenarios**:
  ```
  Scenario: Add inline diff comment
    Tool: Playwright
    Preconditions: Workspace has modified src/App.tsx line
    Steps: 1. Open diff 2. Click [data-testid="diff-comment-add-1"] 3. Type Please simplify 4. Save
    Expected Result: Comment marker visible and text Please simplify displayed
    Evidence: .omo/evidence/task-11-comment-add.png
  Scenario: Empty comment rejected
    Tool: Playwright
    Preconditions: Diff comment editor open
    Steps: 1. Leave textarea empty 2. Click Save
    Expected Result: Error contains Comment cannot be empty
    Evidence: .omo/evidence/task-11-empty-comment.png
  ```
  **Commit**: NO, group with 14.

- [x] 12. History restore UI

  **What to do**: Add Restore button to archived workspace rows and refresh app state after restore. Show progress and errors.
  **Must NOT do**: Do not remove archived history until restore succeeds.
  **Recommended Agent Profile**: Category `quick`. Skills: none.
  **Parallelization**: Wave 2. Blocks none. Blocked by 4.
  **References**: `src/components/views/History.tsx:1-40` target UI. `src/store/app.ts:215-226` loadAll refresh. `src/lib/ipc.ts:52-53` archive/delete wrappers.
  **Acceptance Criteria**: Restore button reactivates workspace and row disappears from archived list.
  **QA Scenarios**:
  ```
  Scenario: Restore archived workspace from History
    Tool: Playwright
    Preconditions: Archived workspace named restore-demo exists
    Steps: 1. Open History 2. Click [data-testid="restore-workspace-restore-demo"]
    Expected Result: restore-demo appears in sidebar as active workspace
    Evidence: .omo/evidence/task-12-restore-ui.png
  Scenario: Restore error remains archived
    Tool: Playwright
    Preconditions: Mock restore IPC fails missing branch
    Steps: 1. Click Restore 2. Assert error toast
    Expected Result: Row remains in History and error contains missing branch
    Evidence: .omo/evidence/task-12-restore-error.png
  ```
  **Commit**: YES. Message: `feat(workspace): restore archived workspaces`

- [x] 13. PR view and merge UI

  **What to do**: Add PR list/status panel and merge button gated on green checks. Use `gh pr view`, `gh pr checks`, and `gh pr merge`.
  **Must NOT do**: Do not add approve/review actions.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 3. Blocks 18. Blocked by 8 and 10.
  **References**: Task 8 Checks tab UI. Task 10 PR dialog. `src/components/workspace/RightPanel.tsx` panel layout.
  **Acceptance Criteria**: Merge button disabled until checks green, enabled when all required checks pass.
  **QA Scenarios**:
  ```
  Scenario: Merge enabled on green checks
    Tool: Playwright
    Preconditions: Mock PR status open and checks success
    Steps: 1. Open PR panel 2. Assert Merge button enabled 3. Click Merge
    Expected Result: Success toast contains PR merged
    Evidence: .omo/evidence/task-13-merge-green.png
  Scenario: Merge blocked on red checks
    Tool: Playwright
    Preconditions: Mock check failure
    Steps: 1. Open PR panel 2. Read Merge button state
    Expected Result: Merge button disabled and text contains Checks failing
    Evidence: .omo/evidence/task-13-merge-red.png
  ```
  **Commit**: YES. Message: `feat(github): add pr lifecycle ui`

- [x] 14. Post diff inline comments to GitHub PR

  **What to do**: Convert local diff comments to GitHub PR review comments using `gh api` with commit SHA, path, side, and line. Mark posted comments with remote ID.
  **Must NOT do**: Do not post duplicate comments on retry.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 3. Blocks 18. Blocked by 2 and 11.
  **References**: GitHub PR review comments API via `gh api`. `src/components/workspace/DiffPane.tsx` path and line mapping. Task 11 local comment state.
  **Acceptance Criteria**: Posted comment receives remote ID and duplicate post is prevented.
  **QA Scenarios**:
  ```
  Scenario: Post one inline comment
    Tool: Bash
    Preconditions: Mock gh api records payload
    Steps: 1. Create local comment on src/App.tsx line 10 2. Invoke post command
    Expected Result: Payload contains path src/App.tsx and body Please simplify
    Evidence: .omo/evidence/task-14-post-payload.json
  Scenario: Retry does not duplicate
    Tool: Bash
    Preconditions: Comment already has remote_id 123
    Steps: 1. Invoke post command again
    Expected Result: No gh api call made and result says already_posted
    Evidence: .omo/evidence/task-14-no-duplicate.txt
  ```
  **Commit**: YES. Message: `feat(diff): post inline comments to github`

- [x] 15. Linear issue URL support

  **What to do**: Extend issue import to Linear URLs using `gh api` only where possible for GitHub URLs and a no-auth public fetch fallback for Linear issue pages if accessible. If Linear cannot be read without auth, surface clear unsupported/auth-required error.
  **Must NOT do**: Do not add Linear OAuth or token storage.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 3. Blocks 18. Blocked by 2, 6, 9.
  **References**: README roadmap says Linear + GitHub PR integration with no OAuth. Task 9 dialog URL parsing.
  **Acceptance Criteria**: GitHub URLs work fully. Linear URLs either seed workspace from public data or fail with `Linear authentication not configured`.
  **QA Scenarios**:
  ```
  Scenario: Linear public URL parsed
    Tool: Playwright
    Preconditions: Mock fetch returns Linear title Fix cache bug
    Steps: 1. Paste Linear URL 2. Click Fetch
    Expected Result: Workspace title field contains Fix cache bug
    Evidence: .omo/evidence/task-15-linear-public.png
  Scenario: Private Linear URL fails clearly
    Tool: Playwright
    Preconditions: Mock fetch returns 403
    Steps: 1. Paste private Linear URL 2. Click Fetch
    Expected Result: Error contains Linear authentication not configured
    Evidence: .omo/evidence/task-15-linear-private.png
  ```
  **Commit**: YES. Message: `feat(workspace): seed workspaces from issue urls`

- [x] 16. Checks polling and badges

  **What to do**: Add polling with debounce/backoff for Checks tab. Show sidebar or tab badge for pending, green, red states.
  **Must NOT do**: Do not poll when tab is hidden for inactive workspace unless user has opened Checks once.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 3. Blocks 18. Blocked by 8.
  **References**: `src/hooks/useAttentionNotifier.ts` focus gating. `src/store/app.ts:79-84` per-project status map pattern. `src/components/workspace/TabBar.tsx` status badge pattern.
  **Acceptance Criteria**: Poll interval backs off after failures and stops on unmount.
  **QA Scenarios**:
  ```
  Scenario: Pending check updates to success
    Tool: Playwright
    Preconditions: Mock IPC returns pending then success
    Steps: 1. Open Checks 2. Wait 3s 3. Assert badge success
    Expected Result: Pending spinner replaced by Success badge
    Evidence: .omo/evidence/task-16-poll-success.png
  Scenario: Polling stops on tab close
    Tool: Playwright
    Preconditions: Mock IPC counts calls
    Steps: 1. Open Checks 2. Close workspace tab 3. Wait 5s
    Expected Result: Call count does not increase after close
    Evidence: .omo/evidence/task-16-poll-stop.txt
  ```
  **Commit**: YES. Message: `feat(github): add checks polling`

- [~] 17. External link lifecycle on workspace create and repair

  **What to do**: Ensure project external links are applied to new workspaces and add repair command for existing workspaces. Handle existing path conflicts.
  **Must NOT do**: Do not overwrite real files at the target link path.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 3. Blocks 18. Blocked by 7.
  **References**: Task 3 backend link materialization. `src-tauri/src/lib.rs` workspace creation flow. `src/components/dialogs/NewWorkspaceDialog.tsx` post-create behavior.
  **Acceptance Criteria**: New workspaces receive links automatically, conflicting paths are reported and skipped.
  **QA Scenarios**:
  ```
  Scenario: New workspace receives project links
    Tool: Bash
    Preconditions: Project has shared external link
    Steps: 1. Create workspace 2. Run test -L workspace/shared
    Expected Result: Symlink exists and points to configured directory
    Evidence: .omo/evidence/task-17-create-link.txt
  Scenario: Existing file conflict skipped
    Tool: Bash
    Preconditions: Workspace has real file named shared
    Steps: 1. Run repair links 2. Capture result
    Expected Result: Result lists conflict and original file remains
    Evidence: .omo/evidence/task-17-conflict.txt
  ```
  **Commit**: YES. Message: `feat(workspace): apply external links on create`

- [x] 18. Error handling and user feedback

  **What to do**: Normalize GitHub, symlink, and restore errors. Add toast or inline error messages with actionable commands.
  **Must NOT do**: Do not swallow errors silently.
  **Recommended Agent Profile**: Category `unspecified-high`. Skills: none.
  **Parallelization**: Wave 4. Blocks 19-21. Blocked by 13-17.
  **References**: `src/components/ui/Toaster.tsx` toast pattern. `src/store/ui.ts` dialog state. Existing IPC catch usage in `DiffPane.tsx:154`.
  **Acceptance Criteria**: Common failures show actionable text and preserve prior state.
  **QA Scenarios**:
  ```
  Scenario: GitHub auth error toast
    Tool: Playwright
    Preconditions: Mock gh_unauthenticated
    Steps: 1. Click Create PR 2. Read toast
    Expected Result: Toast contains Run gh auth login
    Evidence: .omo/evidence/task-18-gh-toast.png
  Scenario: Symlink permission error preserves config
    Tool: Playwright
    Preconditions: Mock permission denied on symlink
    Steps: 1. Add external link 2. Observe error
    Expected Result: Config row remains and error contains permission denied
    Evidence: .omo/evidence/task-18-symlink-error.png
  ```
  **Commit**: NO, group with 19-21.

- [x] 19. Repository settings integration

  **What to do**: Add GitHub integration status and external dir configuration to Repository settings, matching existing visual conventions.
  **Must NOT do**: Do not add token fields.
  **Recommended Agent Profile**: Category `visual-engineering`. Skills: none.
  **Parallelization**: Wave 4. Blocks 20-21. Blocked by 18.
  **References**: `src/components/settings/RepositorySection.tsx`, `src/components/settings/AgentsSection.tsx`, `src/components/ui/Input.tsx` with spellCheck conventions.
  **Acceptance Criteria**: Settings show gh status, project repo remote, and external links.
  **QA Scenarios**:
  ```
  Scenario: Repository GitHub status shown
    Tool: Playwright
    Preconditions: Mock gh auth success
    Steps: 1. Open Settings > Repository 2. Locate [data-testid="github-status"]
    Expected Result: Text contains GitHub CLI authenticated
    Evidence: .omo/evidence/task-19-github-status.png
  Scenario: No spellcheck on path inputs
    Tool: Playwright
    Preconditions: Settings open
    Steps: 1. Inspect external path input attributes
    Expected Result: spellcheck=false and autocorrect=off
    Evidence: .omo/evidence/task-19-input-attrs.json
  ```
  **Commit**: NO, group with 18-21.

- [x] 20. Keyboard shortcuts and discoverability

  **What to do**: Add shortcuts or command entry points for PR create and issue import. Add tooltips for Checks, Restore, and Add Dir.
  **Must NOT do**: Do not conflict with existing shortcuts.
  **Recommended Agent Profile**: Category `quick`. Skills: none.
  **Parallelization**: Wave 4. Blocks 21. Blocked by 18.
  **References**: `src/hooks/useShortcuts.ts` current shortcuts. `src/components/dialogs/ShortcutsHelpDialog.tsx` help UI. `src/components/ui/Tooltip.tsx` tooltip pattern.
  **Acceptance Criteria**: New shortcuts open correct dialogs and are documented.
  **QA Scenarios**:
  ```
  Scenario: PR shortcut opens dialog
    Tool: Playwright
    Preconditions: Workspace active
    Steps: 1. Press Meta+Shift+P 2. Assert PR dialog visible
    Expected Result: Dialog title contains Create Pull Request
    Evidence: .omo/evidence/task-20-pr-shortcut.png
  Scenario: Shortcut conflict absent
    Tool: Bash
    Preconditions: Shortcut test file exists
    Steps: 1. Run npm test -- src/lib/shortcuts.test.ts
    Expected Result: Test passes and no duplicate shortcut bindings found
    Evidence: .omo/evidence/task-20-shortcut-test.txt
  ```
  **Commit**: NO, group with 19-21.

- [x] 21. Polling and rendering performance pass

  **What to do**: Ensure Checks polling, PR state, and diff comment decorations do not re-render terminal panes or unmount PTYs. Add memoization and stable selectors where needed.
  **Must NOT do**: Do not destructure whole Zustand stores in components.
  **Recommended Agent Profile**: Category `deep`. Skills: none.
  **Parallelization**: Wave 4. Blocks F1-F4. Blocked by 18-20.
  **References**: `CLAUDE.md` performance bear traps. `src/store/app.ts:812-815` frozen constants. `src/components/workspace/MainArea.tsx` keep-mounted behavior.
  **Acceptance Criteria**: Switching Checks/PR/diff comments does not remount TerminalPane and tests pass.
  **QA Scenarios**:
  ```
  Scenario: Terminal stays mounted while Checks updates
    Tool: Playwright
    Preconditions: Workspace has running terminal with marker text stay-alive-123
    Steps: 1. Open Checks 2. Wait for two polls 3. Return to terminal
    Expected Result: Terminal still contains stay-alive-123 and PTY id unchanged
    Evidence: .omo/evidence/task-21-terminal-mounted.png
  Scenario: No React selector warnings
    Tool: Bash
    Preconditions: Dev build logs captured
    Steps: 1. Run npm run build 2. Search captured output for getSnapshot should be cached
    Expected Result: No matching warning
    Evidence: .omo/evidence/task-21-selector-warnings.txt
  ```
  **Commit**: YES. Message: `feat(github): complete pr and checks integration`

---

## Final Verification Wave (MANDATORY, after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle` (run inline: `oracle` is not a valid category; the orchestrator performed the read-only audit directly)
  Read the plan end-to-end. Verify every Must Have exists and every Must NOT Have is absent. Check evidence files exist in `.omo/evidence/`. Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`.

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run build`, `bun test`, and `cargo check --manifest-path src-tauri/Cargo.toml`. Review changed files for `as any`, `@ts-ignore`, empty catches, prod `console.log`, commented-out code, and broad Zustand selectors. Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`.

- [x] F3. **Real Manual QA** — `unspecified-high`
  Execute every QA scenario from tasks 1-21 using Playwright and Bash. Save evidence to `.omo/evidence/final-qa/`. Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`.

- [x] F4. **Scope Fidelity Check** — `deep`
  Compare the git diff to each task. Reject any OAuth/token UI, non-GitHub CI provider support, Composer @ feature, or PTY lifecycle regression. Output: `Tasks [N/N compliant] | Scope Creep [CLEAN/N issues] | VERDICT`.

---

## Commit Strategy

- **1**: `feat(github): add gh cli foundation` — Tasks 1-6, run `npm run build` and `cargo check --manifest-path src-tauri/Cargo.toml`
- **2**: `feat(workspace): add external directory links` — Tasks 7 and 17, run link lifecycle tests
- **3**: `feat(workspace): restore archived workspaces` — Tasks 4 and 12, run archive restore tests
- **4**: `feat(github): add pr lifecycle ui` — Tasks 10 and 13, run PR UI tests
- **5**: `feat(diff): post inline comments to github` — Tasks 11 and 14, run diff comment tests
- **6**: `feat(workspace): seed workspaces from issue urls` — Tasks 9 and 15, run issue import tests
- **7**: `feat(github): complete pr and checks integration` — Tasks 8, 16, 18-21, run full verification

---

## Success Criteria

### Verification Commands
```bash
npm run build                                  # Expected: TypeScript and Vite build pass
bun test                                       # Expected: all Vitest tests pass
cargo check --manifest-path src-tauri/Cargo.toml # Expected: Rust check pass
gh auth status                                 # Expected: authenticated to github.com for GitHub features
```

### Final Checklist
- [ ] All 6 in-scope conductor gap features implemented
- [ ] Composer @ suggestions absent by design
- [ ] GitHub auth uses only `gh` CLI, no OAuth or PAT UI
- [ ] Checks tab limited to GitHub Actions/status checks/deployments
- [ ] Diff inline comments post to GitHub PR and avoid duplicates
- [ ] Archive restore works and handles missing branch errors
- [ ] External dir links are per-project and materialize safely
- [ ] No PTY lifecycle regressions
