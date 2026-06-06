// Shared dropdown body for project-level actions: "Open repo with <agent>"
// per registered agent + "New worktree". Used in the sidebar's project-row
// `+` icon, the sidebar's empty-project placeholder CTA, and the dashboard
// project card header. Centralizes the agent registry lookup + handler
// wiring so the menu's shape stays consistent everywhere.
//
// Wrap in a `<DropdownMenu>` at the call site; this component renders
// only the items (so the caller can also customize positioning).

import { useApp } from "@/store/app";
import { useUI } from "@/store/ui";
import { workspaceOpenRepo } from "@/lib/ipc";
import { visibleCliIds } from "@/lib/agents";
import { CliIcon, CLI_BRAND_COLOR } from "@/icons/cli";
import { DropdownItem, DropdownSeparator } from "@/components/ui/Dropdown";

/** Small section header: uppercase label + one-line explanation.
 *  Used to collapse "same hint, three rows" patterns into a single
 *  intro above the action group. Not a dropdown menu item — pure
 *  visual, doesn't trap focus. */
function SectionHeader({ title, hint, tone = "dim" }: {
  title: string; hint: string; tone?: "dim" | "warn";
}) {
  return (
    <div className="px-2 pb-1 pt-1.5">
      <div className="text-[11px] uppercase tracking-wider text-[var(--color-fg-faint)]">{title}</div>
      <div className={cn(
        "text-[11.5px] leading-snug",
        tone === "warn" ? "text-[var(--color-warn)]" : "text-[var(--color-fg-dim)]",
      )}>{hint}</div>
    </div>
  );
}
import { GitBranchPlus, TerminalSquare, SquareChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Optional override for the "Run in repo with <agent>" rows. When
 *  provided, picking an agent calls this instead of the immediate
 *  `workspace_open_repo` IPC — the caller (sidebar) uses this to
 *  surface an inline name-prompt row before creating the workspace,
 *  so multiple repo-root sessions get unique, user-chosen names. The
 *  "Terminal" row uses the shell sentinel "shell" if you pass it in. */
export function ProjectActionsMenuItems({ projectId, onPickRepoCli }: {
  projectId: string;
  onPickRepoCli?: (cli: string) => void;
}) {
  const agents = useApp(s => s.agents);
  const detectedClis = useApp(s => s.detectedClis);
  const setActive = useApp(s => s.setActiveWorkspace);
  const loadAll = useApp(s => s.loadAll);
  const openNewWorkspace = useUI(s => s.openNewWorkspace);
  const openCustomCommand = useUI(s => s.openCustomCommand);
  const openIssueImport = useUI(s => s.openIssueImport);
  // Multi-repo projects need different copy: "New worktree" means
  // branched copies of EVERY member, and "Open repo" means the host
  // dir with live symlinks to each member checkout — same actions,
  // very different mental model, hints should reflect that.
  const project = useApp(s => s.projects.find(p => p.id === projectId));
  const isMulti = (project?.type ?? "single") === "multi";
  // Non-git projects (issue #4) have no branches / worktrees — the only
  // way in is "Run in repo" (agent at the folder). Hide the worktree +
  // import actions and reword the section hint for them.
  const isNonGit = !!project?.non_git;
  // Hide disabled / not-installed agents from the Open-repo list.
  const visibleClis = visibleCliIds(agents.map(a => a.id), agents, detectedClis);

  return (
    <>
      <SectionHeader
        title={isNonGit ? "RUN IN FOLDER" : "RUN IN REPO"}
        hint={isNonGit
          ? "Launch the agent at the folder root (no git)."
          : "No worktree, launch the agent in the repo's current branch."}
        tone={isMulti ? "warn" : "dim"}
      />
      {agents.filter(a => visibleClis.has(a.id)).map(a => (
        <DropdownItem key={a.id} onSelect={async () => {
          if (onPickRepoCli) { onPickRepoCli(a.id); return; }
          try {
            const w = await workspaceOpenRepo(projectId, a.id);
            await loadAll();
            setActive(w.id);
          } catch (err) {
            console.error("workspace_open_repo failed:", err);
          }
        }}>
          <span className={cn("shrink-0", CLI_BRAND_COLOR[a.id] || "text-[var(--color-fg-dim)]")}>
            <CliIcon cli={a.id} className="h-4 w-4" />
          </span>
          <span className="truncate">{a.display_name}</span>
        </DropdownItem>
      ))}
      {/* Plain login-shell variant of "Run in repo" — same workspace
          shape (no worktree, current branch), but the default tab is
          a shell instead of an agent. cli="shell" is the same sentinel
          the TabBar uses for its "+ New terminal" option, and
          TerminalPane.tsx switches on it to skip agent argv resolution. */}
      <DropdownItem onSelect={async () => {
        // Shells don't have sessions to resume → no reason to prompt
        // for a name in the sidebar inline-row UX (that exists so
        // agent workspaces get a unique session uuid). Always take
        // the immediate-create path; Rust auto-names to the branch.
        try {
          const w = await workspaceOpenRepo(projectId, "shell");
          await loadAll();
          setActive(w.id);
        } catch (err) {
          console.error("workspace_open_repo (shell) failed:", err);
        }
      }}>
        <TerminalSquare className="h-4 w-4 shrink-0 text-[var(--color-fg-dim)]" />
        <span className="truncate">Terminal</span>
      </DropdownItem>
      {/* Custom launch command — same repo-root workspace shape as
          Terminal, but the default tab runs a user-supplied command
          (ssh, dev server, repl) in a login shell. Needs both a name
          and a command, so it opens a dialog instead of inline-creating. */}
      <DropdownItem onSelect={() => openCustomCommand(projectId)}>
        <SquareChevronRight className="h-4 w-4 shrink-0 text-[var(--color-fg-dim)]" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate">Custom command</span>
          <span className="text-[11.5px] text-[var(--color-fg-faint)]">
            Launch with your own command (ssh, dev server, …)
          </span>
        </div>
      </DropdownItem>
      {/* Worktree actions only make sense for git projects. A non-git
          folder has no branches to worktree off (issue #4). */}
      {!isNonGit && (
        <>
          <DropdownSeparator />
          <DropdownItem onSelect={() => openNewWorkspace(projectId)}>
            <GitBranchPlus className="h-4 w-4 text-[var(--color-fg-dim)]" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate">New git worktree</span>
              <span className="text-[11.5px] text-[var(--color-fg-faint)]">
                {isMulti ? "Separate working directory per member, run agents in parallel" : "Separate working directory, run agents in parallel"}
              </span>
            </div>
          </DropdownItem>
          {/* "Import from issue" — opens the IssueImportDialog for this
              project. Lives in the worktree block because it creates
              a new worktree the same way "New git worktree" does;
              the issue body just seeds the title + (optionally) the
              setup script. Hidden for non-git projects because the
              resulting workspace would be a flat folder with no
              branch to put the issue in. */}
          <DropdownItem onSelect={() => openIssueImport(projectId)}>
            <svg
              className="h-4 w-4 shrink-0 text-[var(--color-fg-dim)]"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.34c-2.22.48-2.69-1.07-2.69-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.22.83 1.22.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.62 7.62 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
            </svg>
            <div className="flex min-w-0 flex-col">
              <span className="truncate">From issue URL</span>
              <span className="text-[11.5px] text-[var(--color-fg-faint)]">
                Paste a GitHub issue to seed the workspace
              </span>
            </div>
          </DropdownItem>
          {/* "Import existing worktree" now lives inside the New Workspace
              dialog itself (the "Import an existing worktree instead"
              link), so it's not duplicated here. */}
        </>
      )}
    </>
  );
}
