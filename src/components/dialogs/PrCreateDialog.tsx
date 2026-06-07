// PR-create dialog: collect title / body / base / head / draft and
// call `githubPrCreate`. The backend shells out to `gh pr create` +
// a follow-up `gh pr view` in the project's root_path, round-trips
// the freshly-created PR into a `GitHubPullRequest`, and we render
// the returned URL + title + draft chip in a success toast with an
// "Open PR" action that calls `openPath` (handles URLs as well as
// filesystem paths on macOS).
//
// Task 10 of the termic-vs-conductor plan. Sits next to the other
// `gh`-backed dialogs (IssueImportDialog from Task 9, the Checks
// tab in RightPanel from Task 8) so future maintainers find every
// GitHub-affordance surface in one directory. Trigger button lives
// in the Checks tab empty state ("No PR or checks found for this
// branch") — the most natural "next action" after learning the
// branch has no PR yet.

import { useEffect, useRef, useState } from "react";
import { useUI } from "@/store/ui";
import { useApp } from "@/store/app";
import { AppDialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { githubPrCreate, openPath, workspaceDiff } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { Loader2, GitPullRequest, AlertTriangle, ExternalLink, Check } from "lucide-react";
import { ghErrorToToastText } from "@/lib/errors";

type SubmitState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; htmlUrl: string; title: string; draft: boolean; number: number }
  | { kind: "err"; message: string };

export function PrCreateDialog() {
  const wsId = useUI(s => s.prCreateForWsId);
  const close = useUI(s => s.closePrCreate);
  const pushToast = useUI(s => s.pushToast);
  // Look up the workspace + its project so we can default base/head
  // and resolve the project_id the IPC needs.
  const ws = useApp(s => wsId ? s.workspaces.find(w => w.id === wsId) : null);
  const project = useApp(s =>
    ws ? s.projects.find(p => p.id === ws.project_id) ?? null : null,
  );
  // GitHub capability gate — disable the Create button when `gh`
  // is missing or unauthenticated. Mirrors the Checks tab's
  // "Install and authenticate gh" empty state so the user gets
  // the same hint in both places.
  const githubStatus = useApp(s => s.githubStatus);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [draft, setDraft] = useState(true);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  // Ref guard against double-submit. React batches setSubmitting so
  // the button's disabled only updates on the next render; without
  // this, mashing Create would fire two PRs in a row (a real
  // problem — a second `gh pr create` would either create a
  // duplicate or fail with "pull request already exists").
  const submittingRef = useRef(false);

  // Reset transient state when the dialog (re-)opens. Same
  // pattern IssueImportDialog uses — without this, a prior
  // successful submit leaves the success toast / state visible
  // on the next open, which is confusing.
  useEffect(() => {
    if (!ws) return;
    setTitle("");
    setBody("");
    setBase(project?.base_branch ?? "");
    setHead(ws.branch);
    setDraft(true);
    setTitleError(null);
    setSubmit({ kind: "idle" });
    submittingRef.current = false;
  }, [wsId, ws?.id, project?.base_branch, ws?.branch]);

  // Prefill the body from the workspace's current `git diff` when
  // the dialog opens. The plan spec calls this out as a nice-to-
  // have. Capped at 50KB to keep the textarea manageable — a
  // huge diff would otherwise pin the browser tab. The user can
  // always paste more or type a real description; the prefilled
  // value is a starting point.
  useEffect(() => {
    if (!ws) return;
    let cancelled = false;
    workspaceDiff(ws.id)
      .then(diff => {
        if (cancelled) return;
        // Only set if the body is still empty — the user might
        // have started typing in the brief window between dialog
        // open and the diff IPC returning. No race, no clobber.
        setBody(prev => prev ? prev : (diff ? diff.slice(0, 50_000) : ""));
      })
      .catch(() => { /* leave body empty */ });
    return () => { cancelled = true; };
  // Re-run when the dialog opens (wsId is the open-flag) — not on
  // body edits, so the user can type freely without re-fetching.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, ws?.id]);

  async function doSubmit() {
    if (!ws || !project) return;
    if (submittingRef.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError("Title is required");
      return;
    }
    if (!base.trim() || !head.trim()) {
      setSubmit({ kind: "err", message: "Base and head branches are required." });
      return;
    }
    submittingRef.current = true;
    setTitleError(null);
    setSubmit({ kind: "loading" });
    try {
      const pr = await githubPrCreate({
        projectId: project.id,
        title: trimmed,
        body,
        base: base.trim(),
        head: head.trim(),
        draft,
      });
      setSubmit({
        kind: "ok",
        htmlUrl: pr.html_url,
        title: pr.title,
        draft: pr.draft,
        number: pr.number,
      });
      // Success toast with an "Open PR" action. Same affordance
      // the rest of the app uses for "I just did X, want to jump
      // to it?" — the toast is the in-app confirmation, the
      // action button is the one-tap jump.
      pushToast(
        draft ? `Draft PR #${pr.number} created` : `PR #${pr.number} created`,
        "success",
        { action: { label: "Open PR", onClick: () => { openPath(pr.html_url).catch(() => {}); } } },
      );
    } catch (e) {
      const msg = String(e);
      setSubmit({ kind: "err", message: msg });
      // Task 18: also surface the failure as a toast. The inline
      // error stays for context (and the GH-specific install/auth
      // hints below it, which the dialog already handles); the
      // toast is the friendly normalized version the helper
      // returns. Matches the IssueImportDialog and Checks-tab
      // patterns.
      const t = ghErrorToToastText(msg);
      pushToast(t.message, t.severity);
    } finally {
      submittingRef.current = false;
    }
  }

  // Pre-flight gating: when `gh` isn't even installed, the IPC
  // would return `gh_unavailable: …` which the dialog can render,
  // but it's a much better UX to disable the Create button
  // outright + show the install hint inline. Mirrors the
  // pattern the Checks tab uses for the same probe.
  const ghUnavailable = githubStatus !== null && !githubStatus.available;
  const ghUnauth = githubStatus !== null && githubStatus.available && !githubStatus.authenticated;
  const canCreate = !!ws && !!project && !ghUnavailable && !ghUnauth;

  const submitting = submit.kind === "loading";
  const isOk = submit.kind === "ok";

  return (
    <AppDialog
      open={!!wsId}
      onOpenChange={(v) => { if (!v && !submitting) close(); }}
      title="Create pull request"
      description={ws && project ? `${project.name} · ${ws.branch}` : undefined}
      className="max-w-xl"
    >
      <form
        onSubmit={(e) => { e.preventDefault(); doSubmit(); }}
        className="flex flex-col gap-4"
      >
        {/* Title — required. Inline error per the QA scenario
            ("Title is required"). The input's `required` HTML
            attr would also fire, but the inline error gives a
            clearer message + persists after the user starts
            editing. */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-[var(--color-fg)]">
            Title <span className="text-[var(--color-err)]">*</span>
          </label>
          <Input
            data-testid="pr-dialog-title"
            value={title}
            onChange={e => { setTitle(e.target.value); if (titleError) setTitleError(null); }}
            placeholder="Fix login redirect loop"
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className={titleError ? "border-[var(--color-err)]" : undefined}
          />
          {titleError && (
            <div
              data-testid="pr-dialog-title-error"
              className="text-[12px] text-[var(--color-err)]"
            >
              {titleError}
            </div>
          )}
        </div>

        {/* Body — auto-prefilled from `workspaceDiff` (capped),
            editable. Empty body is allowed (some PRs ship with no
            description); the backend always sends the field and
            `gh` tolerates an empty body. */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-[var(--color-fg)]">Body</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Describe the change. Leave blank for a description-less PR."
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            // min-w-0 + max-h + overflow-auto per CLAUDE.md grid
            // rules — long monospace diffs would push the dialog
            // past max-w-xl without the min-w-0.
            className={cn(
              "min-w-0 max-h-[220px] resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg-1)] p-2",
              "text-[12.5px] font-mono leading-snug text-[var(--color-fg)]",
              "focus:outline-none focus:border-[var(--color-accent)]",
              "placeholder:text-[var(--color-fg-faint)] placeholder:italic",
            )}
          />
          <div className="text-[11.5px] text-[var(--color-fg-faint)]">
            Auto-prefilled from the workspace diff when available.
          </div>
        </div>

        {/* Base + head branches side by side. Base defaults to
            the project's `base_branch`; head defaults to the
            workspace's branch. Both are editable — the user
            might want to PR from `feature/x` into `release/y`
            instead of `main`. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[var(--color-fg)]">Base branch</label>
            <Input
              value={base}
              onChange={e => setBase(e.target.value)}
              placeholder="main"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[var(--color-fg)]">Head branch</label>
            <Input
              value={head}
              onChange={e => setHead(e.target.value)}
              placeholder="feature/branch"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              className="font-mono"
            />
          </div>
        </div>

        {/* Draft checkbox. Defaults to true (per the plan spec:
            "Auto-draft description from branch diff and issue
            seed when present" — most workspaces shipping a
            brand-new branch want a draft so the user can review
            before exposing the PR). */}
        <label className="flex items-start gap-2 cursor-pointer rounded-md border border-[var(--color-border-soft)] px-2.5 py-2 hover:bg-[var(--color-hover)]">
          <Checkbox
            checked={draft}
            onChange={setDraft}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] text-[var(--color-fg)]">Create as draft</span>
            <span className="text-[11.5px] text-[var(--color-fg-faint)]">
              Drafts are visible on GitHub but can't be merged. Useful when you want review before marking ready.
            </span>
          </div>
        </label>

        {/* Success panel — replaces the form when create returns.
            We keep the dialog open so the user can see the URL
            + draft chip + an explicit "Open PR" button. Auto-
            close-on-success would race the "Open PR" click. */}
        {isOk && (
          <div className="flex flex-col gap-2 rounded-md border border-[var(--color-ok)]/40 bg-[var(--color-ok)]/10 p-3 text-[12.5px]">
            <div className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-ok)]" />
              <div className="min-w-0 flex-1">
                <div className="text-[var(--color-fg)]">
                  {submit.draft ? "Draft PR" : "PR"} #{submit.number} created
                </div>
                <div className="truncate text-[12px] text-[var(--color-fg-dim)]">{submit.title}</div>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { openPath(submit.htmlUrl).catch(() => {}); }}
              className="gap-1.5 self-start"
            >
              <ExternalLink className="h-3 w-3" /> Open PR on GitHub
            </Button>
          </div>
        )}

        {/* Error banner — only the IPC failures surface here.
            Title validation lives next to the input. The prefix-
            matching lets us word the right message ("install gh"
            vs "authenticate"). Matches the IssueImportDialog's
            error UX. */}
        {submit.kind === "err" && (
          <div className="flex items-start gap-2 rounded-md border border-[var(--color-err)]/40 bg-[var(--color-err)]/10 px-3 py-2 text-[12.5px] text-[var(--color-err)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="break-words">{submit.message}</div>
              {ghUnavailable && (
                <div className="mt-1 text-[11.5px] text-[var(--color-fg-faint)]">
                  Install the <code className="font-mono">gh</code> CLI
                  (e.g. <code className="font-mono">brew install gh</code>) and authenticate.
                </div>
              )}
              {ghUnauth && (
                <div className="mt-1 text-[11.5px] text-[var(--color-fg-faint)]">
                  Run <code className="font-mono">gh auth login</code> in a terminal to authenticate.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={close} disabled={submitting}>
            {isOk ? "Close" : "Cancel"}
          </Button>
          {!isOk && (
            <Button
              data-testid="pr-dialog-create"
              variant="primary"
              type="submit"
              disabled={!canCreate || submitting}
            >
              {submitting
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating…</>
                : <><GitPullRequest className="mr-1.5 h-3.5 w-3.5" /> Create PR</>}
            </Button>
          )}
        </div>
      </form>
    </AppDialog>
  );
}
