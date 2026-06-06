// Issue import dialog: paste a GitHub issue URL, fetch title + body
// via the `github_issue_fetch` IPC, pre-fill the new-workspace form
// (slugified name + branch), and create the workspace. The fetched
// body can optionally be copied into the new workspace's setup
// script via the "Use as setup note" checkbox — that's the only
// thing the issue body touches in the current flow (Task 14 will
// wire the body into the agent's first prompt as a separate change).
//
// Task 9 of the termic-vs-conductor plan. Lives next to
// `NewWorkspaceDialog` so future maintainers find both workspace-
// creation flows in the same directory.

import { useEffect, useMemo, useRef, useState } from "react";
import { useUI } from "@/store/ui";
import { useApp } from "@/store/app";
import { AppDialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { githubIssueFetch, workspaceCreate } from "@/lib/ipc";
import { slugify, cn } from "@/lib/utils";
import { Loader2, GitBranch, AlertTriangle, ExternalLink, Check } from "lucide-react";
import type { IssueSeed } from "@/lib/types";

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; seed: IssueSeed }
  | { kind: "err"; message: string };

/** Default branch prefix inferred from the issue title's leading verb.
 *  Matches the "fix/... or feat/..." convention the plan spec calls
 *  out. Empty string = no prefix (user can still edit). */
function prefixForTitle(title: string): "" | "fix" | "feat" {
  const lower = title.toLowerCase().trim();
  if (lower.startsWith("fix ") || lower.startsWith("fix:") || lower.startsWith("bug") || lower.startsWith("regression")) return "fix";
  if (
    lower.startsWith("add ") || lower.startsWith("add:")
    || lower.startsWith("implement") || lower.startsWith("feature")
    || lower.startsWith("feat ") || lower.startsWith("feat:")
  ) return "feat";
  return "";
}

export function IssueImportDialog() {
  const projectId = useUI(s => s.issueImportProjectId);
  const close = useUI(s => s.closeIssueImport);
  const project = useApp(s => projectId ? s.projects.find(p => p.id === projectId) : null);
  const setActive = useApp(s => s.setActiveWorkspace);
  const addTab = useApp(s => s.addTab);
  const loadAll = useApp(s => s.loadAll);
  const agents = useApp(s => s.agents);
  const detectedClis = useApp(s => s.detectedClis);

  const [url, setUrl] = useState("");
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "idle" });
  // Editable name (slugified title from fetch, user can override).
  const [name, setName] = useState("");
  // Editable branch (auto-derived from name + prefix; user can override).
  const [branch, setBranch] = useState("");
  const [branchEdited, setBranchEdited] = useState(false);
  // "Use as setup note" — defaults off per plan spec.
  const [useAsSetupNote, setUseAsSetupNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  // Ref guard against double-submit (same pattern as
  // NewWorkspaceDialog). React batches setSubmitting so the button's
  // disabled only updates on the next render — without this, mashing
  // Create fires multiple workspaceCreate IPCs.
  const submittingRef = useRef(false);

  // Pick a CLI that's actually present, mirroring NewWorkspaceDialog.
  // Falls back to "shell" if nothing's installed (Terminal-only ws).
  const cli = useMemo(() => {
    const detected = detectedClis;
    const list = agents;
    const detectionRan = Object.keys(detected).length > 0;
    const isInstalled = (id: string) => detected[id]?.found === true;
    const isUsable = (id: string) => id === "shell" || !detectionRan || isInstalled(id);
    const projectDefault = project?.default_cli || "";
    if (projectDefault && isUsable(projectDefault)) return projectDefault;
    const firstInstalled = list.find(a => !a.disabled && isInstalled(a.id))?.id;
    return firstInstalled ?? "shell";
  }, [project, agents, detectedClis]);

  // Reset all transient state when the dialog (re-)opens. Same
  // pattern NewWorkspaceDialog uses — without this, a prior
  // successful submit leaves `submitting=true` forever.
  useEffect(() => {
    if (projectId) {
      setUrl("");
      setFetchState({ kind: "idle" });
      setName("");
      setBranch("");
      setBranchEdited(false);
      setUseAsSetupNote(false);
      setSubmitting(false);
      setSubmitErr(null);
      submittingRef.current = false;
    }
  }, [projectId]);

  // Auto-derive branch from name + inferred prefix. Capped at 50
  // chars per the plan spec so long titles don't blow past the
  // git ref limit on the worktree branch.
  useEffect(() => {
    if (branchEdited) return;
    const slug = slugify(name).slice(0, 50);
    const prefix = prefixForTitle(name);
    setBranch(prefix ? `${prefix}/${slug}` : slug);
  }, [name, branchEdited]);

  async function doFetch() {
    if (!url.trim()) return;
    setFetchState({ kind: "loading" });
    setName("");
    try {
      const seed = await githubIssueFetch(url.trim());
      setFetchState({ kind: "ok", seed });
      // Auto-fill name + branch from the fetched title. Cap the
      // title-derived slug at 50 chars so a long issue title
      // doesn't push the branch over git's 100-byte ref limit
      // (50 + 5 prefix + 1 slash = 56, well under the limit).
      setName(seed.title);
      setBranchEdited(false);
    } catch (e) {
      setFetchState({ kind: "err", message: String(e) });
    }
  }

  // Submit-on-Enter in the URL field. The form's onSubmit handler
  // also handles this for the Fetch button click; the explicit
  // keydown handler means Enter from the input fires it without
  // requiring the user to click Fetch.
  function onUrlKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "Enter") { ev.preventDefault(); doFetch(); }
  }

  async function submit() {
    if (!projectId) return;
    if (fetchState.kind !== "ok") return;
    if (submittingRef.current) return;
    if (!name.trim() || !branch.trim()) return;
    submittingRef.current = true;
    setSubmitting(true); setSubmitErr(null);
    try {
      const seed = fetchState.seed;
      // When "use as setup note" is checked AND the fetched body is
      // non-empty, pass it through as a per-workspace setup_script
      // override. Rust honors the override; an empty / untrimmed
      // value falls back to the project default.
      const setupScript = useAsSetupNote && seed.body && seed.body.trim()
        ? seed.body
        : undefined;
      const w = await workspaceCreate({
        project_id: projectId,
        name: name.trim(),
        cli,
        branch: branch.trim(),
        base_branch: null,
        setup_script: setupScript,
      });
      await loadAll();
      setActive(w.id);
      // Add a default terminal tab so the user can start typing
      // immediately (mirrors NewWorkspaceDialog's success path).
      addTab(w.id, { id: crypto.randomUUID(), type: "terminal", title: cli, cli });
      close();
    } catch (e) {
      setSubmitErr(String(e));
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  const body = fetchState.kind === "ok" ? fetchState.seed.body : null;
  const canSubmit =
    fetchState.kind === "ok"
    && name.trim().length > 0
    && branch.trim().length > 0
    && !submitting;

  return (
    <AppDialog
      open={!!projectId}
      onOpenChange={(v) => { if (!v && !submitting) close(); }}
      title="New workspace from issue"
      description={project ? `in ${project.name}` : undefined}
      className="max-w-xl"
    >
      <form
        onSubmit={(e) => { e.preventDefault(); if (fetchState.kind === "idle" || fetchState.kind === "err") { doFetch(); } else { submit(); } }}
        className="flex flex-col gap-4"
      >
        {/* URL row — text input + Fetch button. Enter in the
            textbox fires Fetch (handled via onKeyDown); Enter
            elsewhere in the form (after a successful fetch)
            fires Create (handled via the form's onSubmit). */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-[var(--color-fg)]">
            Issue URL
          </label>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={e => { setUrl(e.target.value); if (fetchState.kind === "err") setFetchState({ kind: "idle" }); }}
              onKeyDown={onUrlKeyDown}
              placeholder="https://github.com/owner/repo/issues/123"
              autoFocus
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              className="flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={doFetch}
              disabled={!url.trim() || fetchState.kind === "loading"}
            >
              {fetchState.kind === "loading"
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Fetching…</>
                : "Fetch"}
            </Button>
          </div>
          <div className="text-[11.5px] text-[var(--color-fg-faint)]">
            GitHub issues only. Linear support lands in a later release.
          </div>
        </div>

        {/* Error banner for the IPC call. Only the GitHub-side
            failures surface here; the unsupported-URL validation is
            all client-side. The prefix-matching lets us word the
            right message ("install gh" vs "authenticate"). */}
        {fetchState.kind === "err" && (
          <div className="flex items-start gap-2 rounded-md border border-[var(--color-err)]/40 bg-[var(--color-err)]/10 px-3 py-2 text-[12.5px] text-[var(--color-err)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="break-words">{fetchState.message}</div>
            </div>
          </div>
        )}

        {/* Preview section: only renders after a successful fetch.
            Title is editable (the user often wants to shorten it);
            body is shown as read-only preview with an overflow-
            scroll fallback for very long issue bodies. */}
        {fetchState.kind === "ok" && (
          <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <div className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-ok)]" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-[var(--color-fg-faint)]">Fetched from</div>
                <a
                  href={fetchState.seed.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all text-[12.5px] text-[var(--color-accent)] hover:underline"
                >
                  {fetchState.seed.url}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-[var(--color-fg)]">Title</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Fix login bug"
                required
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-[var(--color-fg)]">Branch</label>
              <div className="flex items-center gap-2">
                <GitBranch className="h-3.5 w-3.5 text-[var(--color-fg-faint)]" />
                <Input
                  value={branch}
                  onChange={e => { setBranch(e.target.value); setBranchEdited(true); }}
                  placeholder="fix/fix-login-bug"
                  required
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  className="flex-1"
                />
              </div>
              <div className="text-[11.5px] text-[var(--color-fg-faint)]">
                Auto-derived from the title. Edit if you want a different shape.
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-[var(--color-fg)]">Body preview</label>
              {/* min-w-0 is required here because the parent is a
                  CSS grid (Dialog.Content uses grid) — grid items
                  default to min-width: auto and won't shrink below
                  the intrinsic width of their content. Long
                  monospace lines would push the dialog past
                  max-w-xl. min-w-0 lets the inner overflow-auto
                  actually clip + scroll. */}
              <div className="min-w-0 max-h-[180px] overflow-auto rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-1)] p-2.5 font-mono text-[11.5px] leading-snug text-[var(--color-fg-dim)]">
                {body && body.trim()
                  ? <pre className="whitespace-pre-wrap break-words font-mono">{body}</pre>
                  : <span className="italic text-[var(--color-fg-faint)]">(no body)</span>}
              </div>
            </div>

            {/* "Use as setup note" checkbox. Off by default per
                the plan spec; when on AND body is non-empty, the
                body is passed as the per-workspace setup_script
                override at create time. */}
            {body && body.trim() && (
              <label className="flex items-start gap-2 cursor-pointer rounded-md border border-[var(--color-border-soft)] px-2.5 py-2 hover:bg-[var(--color-hover)]">
                <Checkbox
                  checked={useAsSetupNote}
                  onChange={setUseAsSetupNote}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] text-[var(--color-fg)]">Use as setup note</span>
                  <span className="text-[11.5px] text-[var(--color-fg-faint)]">
                    Run the issue body as the workspace's setup script. Useful when the issue lists setup steps.
                  </span>
                </div>
              </label>
            )}
          </div>
        )}

        {submitErr && <p className="text-[13.5px] text-[var(--color-err)]">{submitErr}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={close} disabled={submitting}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!canSubmit}
          >
            {submitting
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating…</>
              : "Create workspace"}
          </Button>
        </div>
      </form>
    </AppDialog>
  );
}
