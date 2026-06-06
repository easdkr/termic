// Per-line diff comment popover. Opens when the user clicks a comment
// marker in the DiffPane gutter. Shows existing comments for the line
// plus a textarea to add or edit one. Anchored to the marker's screen
// rect via `position: fixed`.
//
// Single-level comments only — no threads. Task 14 will round-trip the
// post-able ones through `gh api`.

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Pencil, MessageSquare } from "lucide-react";
import { useApp, useDiffComments } from "@/store/app";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
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
  const pushToast = useUI(s => s.pushToast);

  const [mode, setMode] = useState<Mode>(() => ({ kind: "new" }));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
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
                    <div className="mt-1 flex items-center justify-end gap-1">
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
                  )}
                </li>
              );
            })}
          </ul>
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
