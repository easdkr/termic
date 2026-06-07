// Single horizontal chrome strip spanning the whole window. Mirrors
// Termic's design: traffic-light reservation on the left, sidebar toggle,
// project/workspace breadcrumbs in the middle, action icons on the right.
// The whole strip is a drag region so the user can move the window from any
// empty space, with `no-drag` opted-in on every interactive child.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp, useActiveWorkspace } from "@/store/app";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/Tooltip";
import {
  PanelLeft, PanelRight, FolderOpen, Play, Archive, ShieldCheck, Shield,
  Zap, ArrowUpToLine, GitPullRequest,
} from "lucide-react";
import { CliIcon, CLI_BRAND_COLOR } from "@/icons/cli";
import { UpdaterBanner } from "@/components/UpdaterBanner";
import { openPath, workspaceRunScript, workspaceArchive, workspaceSendDiffToMain } from "@/lib/ipc";
import { useUI } from "@/store/ui";
import { usePrefs } from "@/store/prefs";
import { useIsFullscreen } from "@/hooks/useIsFullscreen";
import { cn } from "@/lib/utils";

// Reserve enough room for the 3 traffic lights + breathing room before the
// first interactive control. 16 (x offset) + ~58 (3 buttons + gaps) + 10 pad.
// In macOS full-screen the traffic lights are hidden, so the bar reclaims this
// space and the controls sit flush-left like the rest of the chrome.
const TRAFFIC_LIGHT_WIDTH = 84;

export function UnifiedBar() {
  const compact = useApp(s => s.compactSidebar);
  const toggleCompact = useApp(s => s.toggleCompactSidebar);
  const toggleRP = useApp(s => s.toggleRightPanel);
  const setActive = useApp(s => s.setActiveWorkspace);
  const loadAll = useApp(s => s.loadAll);
  const ws = useActiveWorkspace();
  const proj = useApp(s => ws ? s.projects.find(p => p.id === ws.project_id) : null);
  const openReview = useUI(s => s.openReview);
  const openPrCreate = useUI(s => s.openPrCreate);
  const yoloMode = usePrefs(s => s.yoloMode);
  const setYoloMode = usePrefs(s => s.setYoloMode);
  const sandboxBypassPermissions = usePrefs(s => s.sandboxBypassPermissions);
  const isFullscreen = useIsFullscreen();

  return (
    <header
      data-tauri-drag-region
      // Imperative fallback: data-tauri-drag-region + -webkit-app-region: drag
      // both *should* work, but for whatever reason the WKWebView in this build
      // ignores both. onMouseDown → startDragging() is the bulletproof escape
      // hatch. Guarded so we only drag on a primary click that hits the bar
      // itself (or a non-interactive descendant like the breadcrumb text).
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        const t = e.target as HTMLElement;
        if (t.closest("[data-no-drag]") || t.closest("button") || t.closest("input")) return;
        getCurrentWindow().startDragging().catch(() => {});
      }}
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("[data-no-drag]") || t.closest("button") || t.closest("input")) return;
        // macOS convention: double-click title bar zooms the window.
        getCurrentWindow().toggleMaximize().catch(() => {});
      }}
      className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-1)]/80 backdrop-blur-md px-2"
      style={{
        // px-2 (8px) already pads the left in full-screen; only reserve the
        // wide traffic-light gap when the lights are actually there.
        paddingLeft: isFullscreen ? undefined : TRAFFIC_LIGHT_WIDTH,
        WebkitAppRegion: "drag",
      } as any}
    >
      {/* Sidebar toggle */}
      <div
        data-tauri-drag-region="false"
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: "no-drag" } as any}
      >
        <Tip content={compact ? "Expand sidebar" : "Collapse sidebar"} side="bottom">
          <Button size="icon" variant="icon" onClick={() => {
            // Suppress the 220ms grid-template-columns transition for
            // this single toggle. Animating the column lerp makes the
            // toggle feel laggy — user clicked a button, they expect
            // instant. We restore the transition on the next frame so
            // RightPanel show/hide still animates normally.
            const root = document.documentElement;
            root.style.setProperty("--cols-transition", "none");
            toggleCompact();
            requestAnimationFrame(() => requestAnimationFrame(() => {
              root.style.removeProperty("--cols-transition");
            }));
          }}>
            <PanelLeft className="h-[18px] w-[18px]" />
          </Button>
        </Tip>
        {/* Self-update pill — only renders when an update is actually
            available. */}
        <UpdaterBanner />
        {/* YOLO visualizes its safety state based on the active workspace's
            sandbox pin:
              - OFF                 → dim gray, neutral tooltip
              - ON  + sandboxed     → green, "safe" tooltip (sandbox cages
                                       any damage the agent could do)
              - ON  + NOT sandboxed → red, DANGER tooltip - the agent
                                       can rm -rf $HOME if it wants to
            The visual difference between "green safe" and "red dangerous"
            is the load-bearing UX: a casual glance has to communicate
            "you are taking on real risk right now."

            When sandbox is on we ALSO auto-pass YOLO at spawn even if
            the toggle is off (sandbox is the real boundary), so the
            toggle is informational in that case - it just affects
            unsandboxed workspaces. */}
        {(() => {
          const sandboxed = !!ws?.sandbox_enabled;
          // Sandboxed workspaces auto-pass YOLO at spawn unless the user
          // disabled it in Settings → General.
          const autoYolo = sandboxed && sandboxBypassPermissions;
          const dangerous = yoloMode && !sandboxed;
          const tipContent = dangerous
            ? "⚠️ YOLO ON without a sandbox. Agents auto-approve EVERY action, including writes outside the worktree, network calls, and shell commands. Click to disable, or enable the workspace sandbox first."
            : yoloMode && sandboxed
              ? "YOLO ON, safe: this workspace is sandboxed, so auto-approval is bounded by the seatbelt profile."
              : autoYolo
                ? "YOLO OFF (but this workspace is sandboxed, so YOLO is auto-on for it anyway)."
                : sandboxed
                  ? "YOLO OFF. This workspace is sandboxed but bypass-permissions is off, so agents still ask for approvals."
                  : "YOLO OFF. Agents will ask for approvals. YOLO mode is automatically enabled for sandboxed agents.";
          return (
            <Tip content={tipContent} side="bottom">
              <Button
                size="icon" variant="icon" onClick={() => setYoloMode(!yoloMode)}
                className={cn(
                  dangerous && "text-white bg-[var(--color-err)] hover:bg-[var(--color-err)]/80 ring-1 ring-[var(--color-err)]",
                  yoloMode && sandboxed && "text-[var(--color-ok)] bg-[var(--color-ok)]/15",
                  !yoloMode && sandboxed && "text-[var(--color-ok)] opacity-70",
                )}
              >
                <Zap className="h-[18px] w-[18px]" />
              </Button>
            </Tip>
          );
        })()}
      </div>

      {/* Breadcrumbs / title — text doesn't select on drag (matches AppKit title bar). */}
      <div className="ml-2 flex min-w-0 flex-1 select-none items-baseline gap-2 text-[14px]">
        {ws && proj ? (
          <>
            <span className="text-[var(--color-fg-faint)]">{proj.name}</span>
            <span className="text-[var(--color-fg-faint)]">/</span>
            {/* self-center pulls the icon off the baseline so it
                stays vertically centered next to text — items-baseline
                on the parent would otherwise stick the icon's bottom
                to the text baseline and float it too high. */}
            <span className={cn("flex items-center self-center", CLI_BRAND_COLOR[ws.cli])}>
              <CliIcon cli={ws.cli} className="h-4 w-4" />
            </span>
            {/* Workspace name == branch means the user never renamed it,
                so "<branch> on <branch>" reads as noise. Mirror the
                sidebar: render the REPO ROOT chip for the repo-root
                pseudo-workspace; otherwise just show the branch alone. */}
            {ws.is_repo_root && ws.name === ws.branch ? (
              <span className="shrink-0 rounded-md border border-[var(--color-border)] px-1 py-px text-[10.5px] font-semibold uppercase tracking-wide bg-[var(--color-bg-2)] text-[var(--color-fg-dim)]">
                REPO ROOT
              </span>
            ) : ws.name === ws.branch ? (
              <span className="truncate font-mono text-[13px] leading-tight text-[var(--color-fg)]">{ws.branch}</span>
            ) : (
              <>
                <span className="min-w-0 truncate pr-0.5 font-medium leading-tight text-[var(--color-fg)]">{ws.name}</span>
                <span className="leading-tight text-[var(--color-fg-faint)]">on</span>
                <span className="truncate font-mono text-[12px] leading-tight text-[var(--color-fg-dim)]">{ws.branch}</span>
              </>
            )}
            {/* Multi-repo: just a small chip with the member count.
                The full per-member breakdown (which dir_name, which
                branch, worktree vs live) lives in the right-panel
                target tabs where it actually matters. Stuffing it
                into the breadcrumb made the bar unreadable past 2
                members and pushed real chrome (Review / Send to main)
                off-screen on narrow windows. */}
            {(ws.composition?.length ?? 0) > 0 && (
              <span
                className="ml-1 inline-flex shrink-0 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider leading-none text-[var(--color-fg-dim)]"
                title={ws.composition!.map(m => m.mode === "worktree" ? `${m.dir_name} @${m.branch}` : `${m.dir_name} (live)`).join(" · ")}
              >
                {ws.composition!.length} repos
              </span>
            )}
          </>
        ) : (
          <span className="text-[var(--color-fg-faint)]">No workspace selected</span>
        )}
      </div>

      {/* Right-aligned actions */}
      <div
        data-tauri-drag-region="false"
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: "no-drag" } as any}
      >
        {ws && proj && (
          <>
            <Tip content="Run" side="bottom">
              <Button size="icon" variant="icon" onClick={() => workspaceRunScript(ws.id).catch(() => {})}>
                <Play className="h-4 w-4" />
              </Button>
            </Tip>
            <Tip content="AI code review" side="bottom">
              <Button size="sm" variant="ghost" onClick={() => openReview(ws.id)} className="gap-1.5">
                <ShieldCheck className="h-4 w-4" />
                <span>Review</span>
              </Button>
            </Tip>
            {(() => {
              const canCreatePr = !proj.non_git && !ws.is_repo_root;
              const tip = canCreatePr
                ? "Create pull request"
                : proj.non_git
                  ? "PRs require a git repository"
                  : "Create a PR from a worktree workspace, not the repo root";
              return (
                <Tip content={tip} side="bottom">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-disabled={!canCreatePr}
                    onClick={() => { if (canCreatePr) openPrCreate(ws.id); }}
                    className={cn("gap-1.5", !canCreatePr && "opacity-50")}
                  >
                    <GitPullRequest className="h-4 w-4" />
                    <span>Create PR</span>
                  </Button>
                </Tip>
              );
            })()}
            {/* Send-to-main: only shown on actual worktrees, not the
                repo-root pseudo-workspace (which IS the main checkout —
                nothing to send). Hard-blocks on a dirty main checkout
                rather than risk mixing change sets; the error bubbles
                up via the alert below. */}
            {!ws.is_repo_root && (
              <Tip content="Bring this worktree's diff into the project's main checkout" side="bottom">
                <Button size="sm" variant="ghost" className="gap-1.5"
                  onClick={async () => {
                    const ok = await useUI.getState().askConfirm({
                      title: `Send "${ws.name}" to main?`,
                      message:
                        `Applies all tracked changes (committed + staged + unstaged) and copies untracked files into ${proj.root_path}. ` +
                        `The main checkout must be clean. Commit or stash there first.`,
                      confirmLabel: "Send to main",
                    });
                    if (!ok) return;
                    try {
                      const r = await workspaceSendDiffToMain(ws.id);
                      // Build a compact, human-readable summary. Quietly
                      // omit the zero halves so it reads as a result, not
                      // a checklist of nothings-happened.
                      const parts: string[] = [];
                      if (r.tracked_files)   parts.push(`${r.tracked_files} tracked diff${r.tracked_files === 1 ? "" : "s"} applied`);
                      if (r.untracked_files) parts.push(`${r.untracked_files} untracked file${r.untracked_files === 1 ? "" : "s"} copied`);
                      const summary = parts.length ? parts.join(", ") : "no changes to send";
                      useUI.getState().pushToast(`Sent to main checkout: ${summary}`, "success");
                    } catch (e) {
                      await useUI.getState().askConfirm({
                        title: "Send to main failed",
                        message: String(e),
                        confirmLabel: "OK",
                        cancelLabel: "",
                        destructive: true,
                      });
                    }
                  }}>
                  <ArrowUpToLine className="h-4 w-4" />
                  <span>Send to main</span>
                </Button>
              </Tip>
            )}
            <Tip content={ws.sandbox_enabled ? "Sandbox settings" : "Enable sandbox"} side="bottom">
              <Button size="icon" variant="icon"
                onClick={() => useUI.getState().openSandbox(ws.id)}
                className={ws.sandbox_enabled ? "text-[var(--color-ok)]" : undefined}
              >
                <Shield className="h-4 w-4" fill={ws.sandbox_enabled ? "currentColor" : "none"} />
              </Button>
            </Tip>
            <Tip content="Archive workspace" side="bottom">
              <Button size="icon" variant="icon"
                onClick={async () => {
                  const ok = await useUI.getState().askConfirm({
                    title: `Archive "${ws.name}"?`,
                    // Repo-root entries aren't worktrees - archiving
                    // drops the Termic row only; the project checkout
                    // on disk is untouched and can be re-opened later.
                    message: ws.is_repo_root
                      ? "This removes the Termic entry for the project's main checkout. The repo on disk is NOT touched, so you can re-open it any time. Any agent running here will be terminated."
                      : (ws.composition?.length ?? 0) > 0
                      ? `Branches stay in git, so you can recreate the workspace later. This removes: the host worktree + every member worktree (${ws.composition!.filter(m => m.mode === "worktree").map(m => m.dir_name).join(", ") || "none"}), plus any member symlinks to live checkouts (those live repos are NOT touched). Any running agent will be terminated.`
                      : "The branch stays in git, so you can spin up a fresh worktree on it later. This removes only the on-disk worktree directory (build artifacts: node_modules, .venv, untracked files) and terminates any running agent. Can't be undone from inside Termic.",
                    confirmLabel: ws.is_repo_root ? "Remove entry" : "Archive",
                    destructive: true,
                    checkbox: ws.is_repo_root
                      ? undefined
                      : (ws.composition?.length ?? 0) > 0
                      ? {
                          label: "Delete the git branches",
                          defaultValue: false,
                        }
                      : {
                          label: "Delete the git branch:",
                          branchName: ws.branch || undefined,
                          defaultValue: false,
                        },
                  });
                  const confirmed = typeof ok === "boolean" ? ok : ok.confirmed;
                  const deleteBranch = typeof ok === "boolean" ? false : ok.checked;
                  if (!confirmed) return;
                  try {
                    useUI.getState().setBusy(`Archiving "${ws.name}"…`);
                    await workspaceArchive(ws.id, deleteBranch); setActive(null); await loadAll();
                  } catch (e) { console.error(e); }
                  finally { useUI.getState().setBusy(null); }
                }}
              ><Archive className="h-4 w-4" /></Button>
            </Tip>
            <Tip content="Open in Finder" side="bottom">
              <Button size="icon" variant="icon" onClick={() => openPath(ws.path).catch(() => {})}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </Tip>
            <div className="mx-1 h-4 w-px bg-[var(--color-border-soft)]" />
            <Tip content="Toggle right panel" side="bottom">
              <Button size="icon" variant="icon" onClick={toggleRP}>
                <PanelRight className="h-4 w-4" />
              </Button>
            </Tip>
          </>
        )}
      </div>
    </header>
  );
}
