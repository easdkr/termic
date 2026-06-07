// History: archived workspaces. Each row has a Restore button that
// re-materializes the worktree via `workspace_restore` IPC and, on
// success, navigates to the workspace so the user lands in a live
// session instead of an empty History pane.

import { useApp } from "@/store/app";
import { useUI } from "@/store/ui";
import { CliIcon, CLI_BRAND_COLOR } from "@/icons/cli";
import { workspaceRestore } from "@/lib/ipc";
import { RotateCcw } from "lucide-react";
import { Tip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

/** `data-testid` may only contain [a-zA-Z0-9_-] — sanitise the
 *  user-chosen workspace name so the QA selector is valid CSS
 *  regardless of the original string. */
function restoreTestId(name: string): string {
  return "restore-workspace-" + name.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function HistoryView() {
  const projects = useApp(s => s.projects);
  const workspaces = useApp(s => s.workspaces);
  const loadAll = useApp(s => s.loadAll);
  const setActive = useApp(s => s.setActiveWorkspace);
  const archived = workspaces.filter(w => w.archived);

  const onRestore = async (wsId: string, wsName: string) => {
    const ok = await useUI.getState().askConfirm({
      title: `Restore workspace "${wsName}"?`,
      message:
        `Re-creates the git worktree at its saved path on branch "${workspaces.find(w => w.id === wsId)?.branch || "(unknown)"}". ` +
        `If the branch was deleted, the workspace stays archived. Any external directory links are re-materialized.`,
      confirmLabel: "Restore",
    });
    if (!ok) return;
    const { setBusy, pushToast } = useUI.getState();
    setBusy(`Restoring "${wsName}"…`);
    try {
      const ws = await workspaceRestore(wsId);
      await loadAll();
      setActive(ws.id);
      pushToast(`Restored "${wsName}"`, "success");
    } catch (e) {
      pushToast(String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-[15px] font-medium mb-4">
          History <span className="text-[var(--color-fg-faint)]">({archived.length})</span>
        </h1>
        {archived.length === 0 ? (
          <p className="text-[14px] text-[var(--color-fg-dim)]">No archived workspaces.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {archived.map(w => {
              const p = projects.find(x => x.id === w.project_id);
              return (
                <div key={w.id} className="flex items-center gap-3 rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-1)] px-3 py-2.5 opacity-70">
                  <span className={cn("shrink-0", CLI_BRAND_COLOR[w.cli] || "text-[var(--color-fg-dim)]")}>
                    <CliIcon cli={w.cli} className="h-4 w-4" />
                  </span>
                  <span className="font-medium text-[13px]">{w.name}</span>
                  <span className="text-[13.5px] text-[var(--color-fg-faint)]">in {p?.name}</span>
                  <span className="ml-auto text-[11.5px] uppercase tracking-wider text-[var(--color-fg-faint)]">archived</span>
                  <Tip content="Re-create the worktree at its saved path and switch into it">
                    <button
                      type="button"
                      data-testid={restoreTestId(w.name)}
                      onClick={() => onRestore(w.id, w.name)}
                      className="ml-2 inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-medium bg-[var(--color-bg-3)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] hover:bg-[var(--color-hover)]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Restore</span>
                    </button>
                  </Tip>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
