// Issue import dialog: list open GitHub issues for the project's repo,
// let the user pick one, then pre-fill the new-workspace form and create
// the worktree. The fetched body can optionally be copied into the new
// workspace's setup script via the "Use as setup note" checkbox.
//
// Replaces the previous URL-paste flow with a direct issue list fetched
// via `gh issue list`.

import { useEffect, useMemo, useRef, useState } from "react";
import { useUI } from "@/store/ui";
import { useApp } from "@/store/app";
import { AppDialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { githubIssueList, githubIssueFetch, workspaceCreate } from "@/lib/ipc";
import { slugify, cn } from "@/lib/utils";
import { Loader2, GitBranch, AlertTriangle, ExternalLink, Check, Search } from "lucide-react";
import type { IssueSeed, GitHubIssue } from "@/lib/types";
import { ghErrorToToastText } from "@/lib/errors";

type ListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; issues: GitHubIssue[] }
  | { kind: "err"; message: string };

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; seed: IssueSeed }
  | { kind: "err"; message: string };

/** Default branch prefix inferred from the issue title's leading verb. */
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

  const [listState, setListState] = useState<ListState>({ kind: "idle" });
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "idle" });
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Editable name (slugified title from fetch, user can override).
  const [name, setName] = useState("");
  // Editable branch (auto-derived from name + prefix; user can override).
  const [branch, setBranch] = useState("");
  const [branchEdited, setBranchEdited] = useState(false);
  // "Use as setup note" — defaults off per plan spec.
  const [useAsSetupNote, setUseAsSetupNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const submittingRef = useRef(false);

  // Pick a CLI that's actually present, mirroring NewWorkspaceDialog.
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

  // Reset all transient state when the dialog (re-)opens.
  useEffect(() => {
    if (projectId) {
      setListState({ kind: "idle" });
      setFetchState({ kind: "idle" });
      setSelectedIssue(null);
      setSearchQuery("");
      setName("");
      setBranch("");
      setBranchEdited(false);
      setUseAsSetupNote(false);
      setSubmitting(false);
      setSubmitErr(null);
      submittingRef.current = false;
      // Auto-fetch issues when dialog opens.
      doList(projectId);
    }
  }, [projectId]);

  // Auto-derive branch from name + inferred prefix.
  useEffect(() => {
    if (branchEdited) return;
    const slug = slugify(name).slice(0, 50);
    const prefix = prefixForTitle(name);
    setBranch(prefix ? `${prefix}/${slug}` : slug);
  }, [name, branchEdited]);

  async function doList(pid: string) {
    setListState({ kind: "loading" });
    try {
      const issues = await githubIssueList(pid);
      setListState({ kind: "ok", issues });
    } catch (e) {
      const msg = String(e);
      setListState({ kind: "err", message: msg });
      const t = ghErrorToToastText(msg);
      useUI.getState().pushToast(t.message, t.severity);
    }
  }

  async function onSelectIssue(issue: GitHubIssue) {
    setSelectedIssue(issue);
    setFetchState({ kind: "loading" });
    try {
      const seed = await githubIssueFetch(issue.url);
      setFetchState({ kind: "ok", seed });
      setName(seed.title);
      setBranchEdited(false);
    } catch (e) {
      const msg = String(e);
      setFetchState({ kind: "err", message: msg });
      const t = ghErrorToToastText(msg);
      useUI.getState().pushToast(t.message, t.severity);
    }
  }

  function onDeselect() {
    setSelectedIssue(null);
    setFetchState({ kind: "idle" });
    setName("");
    setBranch("");
    setBranchEdited(false);
    setUseAsSetupNote(false);
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
      addTab(w.id, { id: crypto.randomUUID(), type: "terminal", title: cli, cli });
      close();
    } catch (e) {
      setSubmitErr(String(e));
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  const filteredIssues = useMemo(() => {
    if (listState.kind !== "ok") return [];
    if (!searchQuery.trim()) return listState.issues;
    const q = searchQuery.toLowerCase();
    return listState.issues.filter(
      i => i.title.toLowerCase().includes(q) || String(i.number).includes(q)
    );
  }, [listState, searchQuery]);

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
        onSubmit={(e) => { e.preventDefault(); if (fetchState.kind === "ok") { submit(); } }}
        className="flex flex-col gap-4"
      >
        {/* Issue list section */}
        {!selectedIssue && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-[var(--color-fg)]">
                Open issues
              </label>
              {listState.kind === "ok" && (
                <span className="text-[11.5px] text-[var(--color-fg-faint)]">
                  {listState.issues.length} issue{listState.issues.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {listState.kind === "loading" && (
              <div className="flex items-center gap-2 py-6 text-[12.5px] text-[var(--color-fg-dim)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading issues…
              </div>
            )}

            {listState.kind === "err" && (
              <div className="flex items-start gap-2 rounded-md border border-[var(--color-err)]/40 bg-[var(--color-err)]/10 px-3 py-2 text-[12.5px] text-[var(--color-err)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="break-words">{listState.message}</div>
                </div>
              </div>
            )}

            {listState.kind === "ok" && (
              <>
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
                  <Input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search issues…"
                    className="pl-8"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
                  />
                </div>

                {/* Issue list */}
                {filteredIssues.length === 0 ? (
                  <div className="py-4 text-center text-[12.5px] text-[var(--color-fg-faint)]">
                    {searchQuery.trim() ? "No matching issues." : "No open issues found."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 max-h-[240px] overflow-auto rounded-md border border-[var(--color-border)]">
                    {filteredIssues.map(issue => (
                      <button
                        key={issue.number}
                        type="button"
                        onClick={() => onSelectIssue(issue)}
                        className="flex items-start gap-2 px-3 py-2 text-left hover:bg-[var(--color-hover)] transition-colors border-b border-[var(--color-border)] last:border-b-0"
                      >
                        <span className="mt-0.5 text-[11px] font-mono text-[var(--color-fg-faint)] shrink-0">
                          #{issue.number}
                        </span>
                        <span className="text-[13px] text-[var(--color-fg)] leading-snug line-clamp-2">
                          {issue.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Selected issue preview + edit form */}
        {selectedIssue && (
          <div className="flex flex-col gap-3">
            {/* Selected issue header */}
            <div className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-ok)]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-[var(--color-fg-faint)]">
                    #{selectedIssue.number}
                  </span>
                  <a
                    href={selectedIssue.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 break-all text-[12.5px] text-[var(--color-accent)] hover:underline"
                  >
                    {selectedIssue.url}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
                <div className="mt-1 text-[13px] text-[var(--color-fg)]">
                  {selectedIssue.title}
                </div>
              </div>
            </div>

            {fetchState.kind === "loading" && (
              <div className="flex items-center gap-2 py-2 text-[12.5px] text-[var(--color-fg-dim)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Fetching issue details…
              </div>
            )}

            {fetchState.kind === "err" && (
              <div className="flex items-start gap-2 rounded-md border border-[var(--color-err)]/40 bg-[var(--color-err)]/10 px-3 py-2 text-[12.5px] text-[var(--color-err)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="break-words">{fetchState.message}</div>
                </div>
              </div>
            )}

            {fetchState.kind === "ok" && (
              <div className="flex flex-col gap-3">
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
                  <div className="min-w-0 max-h-[180px] overflow-auto rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-1)] p-2.5 font-mono text-[11.5px] leading-snug text-[var(--color-fg-dim)]">
                    {body && body.trim()
                      ? <pre className="whitespace-pre-wrap break-words font-mono">{body}</pre>
                      : <span className="italic text-[var(--color-fg-faint)]">(no body)</span>}
                  </div>
                </div>

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

            {/* Back button to pick a different issue */}
            <button
              type="button"
              onClick={onDeselect}
              className="self-start text-[12.5px] text-[var(--color-accent)] hover:underline"
            >
              ← Pick a different issue
            </button>
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
