// Per-line diff comment popover. Opens when the user clicks a comment
// marker in the DiffPane gutter. Shows existing comments for the line
// plus a textarea to add or edit one. Anchored to the marker's screen
// rect via `position: fixed`.
//
// Single-level comments only — no threads. Task 14 adds a "Post to
// GitHub" button per unposted comment, which round-trips the local
// comment through `gh api` and stamps the returned id onto
// `comment.remote_id` (so the button is hidden on retry).

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Pencil, MessageSquare, Send, CheckCircle2, Loader2 } from "lucide-react";
import { useApp, useDiffComments, usePrChecks, useWorkspace } from "@/store/app";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/Tooltip";
import { githubPrPostDiffComment } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { ghErrorToToastText } from "@/lib/errors";
import type { DiffInlineComment } from "@/lib/types";

interface PopoverAnchor {
  top: number;
  left: number;
}

interface Props {
  wsId: string;
  path: string;
  side: "left" | "right";
  line: number;
  anchor: PopoverAnchor;
  onClose: () => void;
}

type Mode =
  | { kind: "idle" }
  | { kind: "new" }
  | { kind: "edit"; id: string };

const POPOVER_WIDTH = 320;
const VIEWPORT_GUTTER = 8;

function clampTop(top: number, popoverHeight: number): number {
  const max = window.innerHeight - popoverHeight - VIEWPORT_GUTTER;
  return Math.max(VIEWPORT_GUTTER, Math.min(top, max));
}

function clampLeft(left: number): number {
  const max = window.innerWidth - POPOVER_WIDTH - VIEWPORT_GUTTER;
  return Math.max(VIEWPORT_GUTTER, Math.min(left, max));
}

function useDiffCommentsForLine(
  wsId: string,
  path: string,
  side: "left" | "right",
  line: number,
): DiffInlineComment[] {
  const all = useDiffComments(wsId);
  return useMemo(
    () => all.filter(c => c.path === path && c.side === side && c.line === line),
    [all, path, side, line],
  );
}

export function DiffCommentPopover({ wsId, path, side, line, anchor, onClose }: Props) {
  const lineComments = useDiffCommentsForLine(wsId, path, side, line);
  const addComment = useApp(s => s.addDiffComment);
  const updateComment = useApp(s => s.updateDiffComment);
  const deleteComment = useApp(s => s.deleteDiffComment);
  const markPosted = useApp(s => s.markDiffCommentPosted);
  const pushToast = useUI(s => s.pushToast);
  const askConfirm = useUI(s => s.askConfirm);
  // PR snapshot for this workspace (Task 8's `usePrChecks`). `pr` is
  // null when the branch has no associated PR — that gates the "Post
  // to GitHub" button off entirely (we can't post a review comment
  // to a PR that doesn't exist).
  const prSnapshot = usePrChecks(wsId);
  // Need `project_id` for the IPC payload; look it up via the new
  // `useWorkspace` selector (Task 14). Falls back to null when the
  // workspace isn't in the store (e.g. just-archived race).
  const ws = useWorkspace(wsId);

  const [mode, setMode] = useState<Mode>(() => ({ kind: "new" }));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Per-comment in-flight flag for the "Post to GitHub" button. Keyed
  // by comment id so multiple unposted comments on the same line
  // each get their own spinner.
  const [posting, setPosting] = useState<Record<string, boolean>>({});
  const [pos, setPos] = useState({ top: anchor.top, left: anchor.left });
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Entering edit/new mode focuses the textarea. First mount starts in
  // "new" mode so the textarea gets focus immediately for fast typing.
  useEffect(() => {
    if (mode.kind === "new" || mode.kind === "edit") {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [mode.kind]);

  // Re-clamp on resize. The popover is `position: fixed` so a viewport
  // resize (or moving the window to a different monitor) can leave it
  // dangling off-screen.
  useEffect(() => {
    function reposition() {
      const el = popoverRef.current;
      const h = el?.offsetHeight ?? 200;
      setPos({
        top: clampTop(anchor.top, h),
        left: clampLeft(anchor.left),
      });
    }
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [anchor.top, anchor.left]);

  function enterEdit(c: DiffInlineComment) {
    setMode({ kind: "edit", id: c.id });
    setDraft(c.body);
    setError(null);
  }

  function enterNew() {
    setMode({ kind: "new" });
    setDraft("");
    setError(null);
  }

  function cancel() {
    if (lineComments.length > 0) {
      setMode({ kind: "idle" });
    } else {
      onClose();
    }
    setError(null);
  }

  function save() {
    if (mode.kind === "new") {
      const id = addComment(wsId, path, side, line, draft);
      if (!id) { setError("Comment cannot be empty"); return; }
      pushToast("Comment added", "success");
      setMode({ kind: "idle" });
      setDraft("");
      setError(null);
    } else if (mode.kind === "edit") {
      const ok = updateComment(mode.id, draft);
      if (!ok) { setError("Comment cannot be empty"); return; }
      pushToast("Comment updated", "success");
      setMode({ kind: "idle" });
      setError(null);
    }
  }

  function remove(id: string) {
    deleteComment(id);
    pushToast("Comment deleted", "success");
    if (mode.kind === "edit" && mode.id === id) {
      setMode({ kind: "new" });
      setDraft("");
    }
  }

  // Post one local comment to GitHub. The render layer keeps the
  // button hidden / disabled when guards fail, so by the time we
  // get here all the inputs the IPC needs should be present.
  async function postToGitHub(c: DiffInlineComment) {
    if (c.remote_id) return;
    const pr = prSnapshot.pr;
    const headSha = pr?.head_sha;
    if (!pr || !headSha) return;
    const projectId = ws?.project_id;
    if (!projectId) {
      pushToast("Workspace not found", "error");
      return;
    }
    const ok = await askConfirm({
      title: `Post comment to PR #${pr.number}?`,
      message: `Posts this comment to ${path} line ${line} on PR #${pr.number}. The local copy stays; the GitHub id is stamped on it.`,
      confirmLabel: "Post to GitHub",
    });
    if (!ok) return;
    setPosting(prev => ({ ...prev, [c.id]: true }));
    try {
      const remoteId = await githubPrPostDiffComment({
        projectId,
        prNumber: pr.number,
        commitId: headSha,
        path,
        line,
        side,
        body: c.body,
      });
      markPosted(wsId, c.id, remoteId, new Date().toISOString());
      pushToast(`Comment posted to PR #${pr.number}`, "success");
    } catch (e) {
      // Task 18: route the gh error through the helper so the
      // "post to GitHub" toast uses the same friendly text as
      // the merge / fetch / create paths. `gh_error:` falls
      // through to the raw stderr text per the helper's spec.
      const t = ghErrorToToastText(String(e));
      pushToast(t.message, t.severity);
    } finally {
      setPosting(prev => {
        const { [c.id]: _drop, ...rest } = prev;
        return rest;
      });
    }
  }

  // Esc closes the popover; ⌘Enter / Ctrl+Enter saves the draft.
  // The effect re-binds on every mode/draft/error change so the listener
  // always sees the current `save` closure.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && (mode.kind === "new" || mode.kind === "edit")) {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, draft, error]);

  const editing = mode.kind === "edit" ? lineComments.find(c => c.id === mode.id) ?? null : null;
  const editorBody = mode.kind === "edit" || mode.kind === "new" ? draft : "";

  return (
    <>
      {/* Transparent full-screen overlay that captures clicks outside
          the popover. No dim — the diff underneath should stay visible
          so the user keeps their place. */}
      <div
        data-testid="diff-comment-overlay"
        className="fixed inset-0 z-30"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      />
      <div
        ref={popoverRef}
        role="dialog"
        aria-label="Diff comment"
        // No transform / translate-1/2: those land at sub-pixel offsets
        // in WKWebView when the viewport width is odd and blur every
        // glyph (see CLAUDE.md). top/left only.
        style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
        className={cn(
          "fixed z-40 flex flex-col gap-2 rounded-lg border p-3 shadow-2xl",
          "border-[var(--color-border)] bg-[var(--color-bg-2)] text-[var(--color-fg)]",
        )}
      >
        <div className="flex items-center justify-between text-[12px] text-[var(--color-fg-dim)]">
          <span className="font-mono">
            Line {line} · {side}
          </span>
          <span className="tabular-nums">
            {lineComments.length} comment{lineComments.length === 1 ? "" : "s"}
          </span>
        </div>

        {lineComments.length > 0 && (
          <ul className="flex max-h-40 flex-col gap-1.5 overflow-auto rounded border border-[var(--color-border-soft)] bg-[var(--color-bg)] p-1.5">
            {lineComments.map(c => {
              const isEditing = mode.kind === "edit" && mode.id === c.id;
              const isPosting = !!posting[c.id];
              const pr = prSnapshot.pr;
              const canPost = !c.remote_id && !!pr && !!pr.head_sha;
              return (
                <li
                  key={c.id}
                  data-testid={`diff-comment-item-${c.id}`}
                  className={cn(
                    "rounded px-2 py-1.5 text-[12.5px]",
                    isEditing
                      ? "bg-[var(--color-bg-2)] ring-1 ring-[var(--color-accent-soft)]"
                      : "hover:bg-[var(--color-hover)]",
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{c.body}</div>
                  {mode.kind !== "edit" && (
                    <div className="mt-1 flex items-center justify-between gap-1">
                      {c.remote_id ? (
                        <Tip
                          content={pr ? `Open the posted comment on PR #${pr.number}` : `Posted to GitHub as #${c.remote_id}`}
                        >
                          <a
                            href={pr ? `${pr.html_url}#discussion_r${c.remote_id}` : undefined}
                            target="_blank"
                            rel="noreferrer"
                            data-testid={`diff-comment-posted-${c.id}`}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-ok)] hover:bg-[var(--color-ok)]/10"
                            onClick={e => { if (!pr) e.preventDefault(); }}
                          >
                            <CheckCircle2 className="h-3 w-3" /> Posted
                          </a>
                        </Tip>
                      ) : <span />}
                      <div className="flex items-center gap-1">
                        {canPost && (
                          <Tip content={`Post this comment to PR #${pr!.number}`}>
                            <button
                              type="button"
                              onClick={() => postToGitHub(c)}
                              disabled={isPosting}
                              data-testid={`diff-comment-post-${c.id}`}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-hover)] disabled:opacity-50"
                            >
                              {isPosting
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Send className="h-3 w-3" />}
                              Post to GitHub
                            </button>
                          </Tip>
                        )}
                        <button
                          type="button"
                          onClick={() => enterEdit(c)}
                          data-testid={`diff-comment-edit-${c.id}`}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-fg-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(c.id)}
                          data-testid={`diff-comment-delete-${c.id}`}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-err)] hover:bg-[var(--color-err)]/10"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Hint when the workspace has comments but no usable PR data.
            Don't show if every comment is already posted (nothing the
            user can do anyway) or if the pr snapshot is still loading. */}
        {lineComments.length > 0
          && lineComments.some(c => !c.remote_id)
          && prSnapshot.fetchedAt !== null
          && (prSnapshot.pr === null || !prSnapshot.pr.head_sha) && (
          <div
            data-testid="diff-comment-no-pr-hint"
            className="rounded border border-dashed border-[var(--color-border-soft)] px-2 py-1.5 text-[11px] text-[var(--color-fg-dim)]"
          >
            {prSnapshot.pr === null
              ? "No PR for this branch. Create one to post comments to GitHub."
              : "PR data is missing the head commit SHA. Refresh the Checks tab to fetch it."}
          </div>
        )}

        {lineComments.length === 0 && mode.kind === "idle" && (
          <div className="flex items-center gap-2 rounded border border-dashed border-[var(--color-border-soft)] px-2 py-3 text-[12px] text-[var(--color-fg-dim)]">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>No comments on this line.</span>
          </div>
        )}

        {(mode.kind === "new" || mode.kind === "edit") ? (
          <div className="flex flex-col gap-1.5">
            <div className="text-[11.5px] font-medium text-[var(--color-fg-dim)]">
              {editing ? "Edit comment" : "Add a comment"}
            </div>
            <textarea
              ref={textareaRef}
              data-testid="diff-comment-textarea"
              value={editorBody}
              onChange={e => { setDraft(e.target.value); if (error) setError(null); }}
              onKeyDown={e => {
                if (e.key === "Escape") { e.stopPropagation(); cancel(); }
              }}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              placeholder="Type a comment…"
              rows={3}
              className={cn(
                "min-h-[68px] w-full resize-y rounded border bg-[var(--color-bg)] px-2 py-1.5 text-[12.5px] text-[var(--color-fg)]",
                "outline-none transition-colors",
                error
                  ? "border-[var(--color-err)] focus:ring-[var(--color-err)]/30"
                  : "border-[var(--color-border)] focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent-soft)]",
              )}
            />
            {error && (
              <div
                role="alert"
                data-testid="diff-comment-error"
                className="text-[11.5px] text-[var(--color-err)]"
              >
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={cancel} data-testid="diff-comment-cancel">
                Cancel
              </Button>
              {mode.kind === "edit" && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => remove(mode.id)}
                  data-testid="diff-comment-popover-delete"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={save} data-testid="diff-comment-save">
                {mode.kind === "edit" ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              variant="primary"
              onClick={enterNew}
              data-testid="diff-comment-new"
            >
              + Add comment
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
