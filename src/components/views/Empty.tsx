import { useUI } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { TermicHero } from "@/icons/TermicLogo";

export function Empty() {
  const openNewProject = useUI(s => s.openNewProject);
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center max-w-md flex flex-col items-center gap-8">
        <TermicHero />
        <div className="flex flex-col items-center gap-2">
          <p className="text-[14px] text-[var(--color-fg-dim)] max-w-sm">
            Workspaces are isolated git worktrees with their own agent terminal.
            Add a project from the sidebar, then create a workspace.
          </p>
          <Button variant="primary" size="md" onClick={openNewProject} className="mt-2">+ Add project</Button>
        </div>
      </div>
    </div>
  );
}
