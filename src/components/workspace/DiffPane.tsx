// Diff viewer with a Side-by-side ⇄ Unified toggle, both backed by
// CodeMirror 6 with full syntax highlighting (langForPath, shared
// with EditorPane). Side-by-side uses MergeView; unified uses
// unifiedMergeView in a single read-only editor.
//
// Adds an inline-comment gutter (Task 11): a custom `gutter()` renders
// a small icon in the line-number column of every line, accent-tinted
// when the line already has a comment. Clicking the marker opens a
// floating DiffCommentPopover anchored to the marker; the popover
// reads / writes comments through the app store. Comments live in
// store state (not the tab), so they survive diff-tab remounts.

import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffTab, Workspace } from "@/lib/types";
import { workspaceFileDiffSides, openPath } from "@/lib/ipc";
import { Button } from "@/components/ui/Button";
import { FolderOpen, Eye, Columns2, AlignJustify } from "lucide-react";
import { useApp, useDiffComments } from "@/store/app";
import { usePrefs } from "@/store/prefs";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { cn } from "@/lib/utils";
import { langForPath } from "./EditorPane";
import { resolveEditorTheme, editorSurfaceTheme } from "@/lib/editorTheme";
import { DiffCommentPopover } from "./DiffCommentPopover";

type Mode = "side" | "unified";
type DiffSide = "left" | "right";
const LS_DIFF_MODE = "diffMode";

function readMode(): Mode {
  try { return (localStorage.getItem(LS_DIFF_MODE) as Mode) === "unified" ? "unified" : "side"; }
  catch { return "side"; }
}
function writeMode(m: Mode) {
  try { localStorage.setItem(LS_DIFF_MODE, m); } catch {}
}

// ── Gutter marker ──────────────────────────────────────────────────────
// A GutterMarker subclass keyed on the line number so the same marker
// instance can be reused across lineMarker re-evaluations (CodeMirror
// compares markers with `eq()`). toDOM returns a span containing an
// inline SVG icon — we hardcode the lucide path data here because
// GutterMarker is imperative DOM (not React) and creating a React root
// per marker would be wasteful.
class CommentGutterMarker extends GutterMarker {
  constructor(readonly line: number, readonly hasComment: boolean) {
    super();
  }
  eq(other: CommentGutterMarker) {
    return other instanceof CommentGutterMarker
      && other.line === this.line
      && other.hasComment === this.hasComment;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-diff-comment-marker"
      + (this.hasComment ? " cm-diff-comment-marker--has" : "");
    // data-testid is stable per-line so QA / E2E can target it.
    span.setAttribute("data-testid", `diff-comment-add-${this.line}`);
    span.setAttribute("data-line", String(this.line));
    span.title = this.hasComment ? "View / edit comment" : "Add comment";
    // Inline SVG. lucide-react MessageSquare / MessageCirclePlus path
    // data (24x24 viewBox, 1.5px stroke equivalent at 14px render).
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    if (this.hasComment) {
      // Filled chat-square (MessageSquare): single path, stroke-only at
      // 14px the interior still reads as "filled" because the stroke
      // thickness closes the bubble.
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");
      svg.appendChild(path);
    } else {
      // Speech-bubble + plus icon (MessageCirclePlus). The "plus"
      // variant hints "add" without text.
      const circle = document.createElementNS(ns, "path");
      circle.setAttribute("d", "M7.9 20A9 9 0 1 0 4 16.1L2 22Z");
      svg.appendChild(circle);
      const h = document.createElementNS(ns, "path");
      h.setAttribute("d", "M8 12h8");
      svg.appendChild(h);
      const v = document.createElementNS(ns, "path");
      v.setAttribute("d", "M12 8v8");
      svg.appendChild(v);
    }
    span.appendChild(svg);
    return span;
  }
}

// ── Component ──────────────────────────────────────────────────────────

// Module-scoped ref for the "left" side's lines-with-comments set, kept
// in sync with `linesWithComments.left`. The gutter closure reads it
// lazily so a comment add / delete doesn't need a Compartment reconfigure.
const leftSetRef: { current: Set<number> } = { current: new Set() };

interface PopoverState {
  line: number;
  side: DiffSide;
  top: number;
  left: number;
}

export function DiffPane({ ws, tab }: { ws: Workspace; tab: DiffTab }) {
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => readMode());
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // Only one of these is mounted at a time depending on `mode`.
  const mergeRef = useRef<MergeView | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  // Holds the current set of lines-with-comments for the active side.
  // Mutated on every comment change so the gutter's `lineMarker` closure
  // reads the latest set without needing a Compartment reconfigure.
  const linesWithCommentsRef = useRef<Set<number>>(new Set());
  // The side the popover is currently anchored to (computed at click time).
  const popoverSideRef = useRef<DiffSide>("right");
  const addTab = useApp(s => s.addTab);
  const diffComments = useDiffComments(ws.id);
  const editorFontSize = usePrefs(s => s.editorFontSize);
  // Same syntax theme as the editor. A change re-renders → the effect
  // below rebuilds the diff view with the new palette.
  const editorThemeId = usePrefs(s => s.editorThemeId);

  // Per-(side) set of line numbers that already have at least one
  // comment. Recomputed whenever the comment list or active path changes.
  // We keep BOTH sides' sets in the ref map so the gutter on editor a
  // reads the "left" set and the gutter on editor b reads the "right" set
  // without a cross-call.
  const linesWithComments = useMemo(() => {
    const left = new Set<number>();
    const right = new Set<number>();
    for (const c of diffComments) {
      if (c.path !== tab.path) continue;
      (c.side === "left" ? left : right).add(c.line);
    }
    return { left, right };
  }, [diffComments, tab.path]);

  // Mirror the memo into the refs the gutter closures read lazily on
  // the next `lineMarker` call — no Compartment reconfigure needed.
  useEffect(() => {
    leftSetRef.current = linesWithComments.left;
    linesWithCommentsRef.current = linesWithComments.right;
  }, [linesWithComments]);

  function setModeAndPersist(m: Mode) {
    writeMode(m);
    setMode(m);
  }

  // Build the comment gutter for ONE editor (a or b, or unified).
  // Side-aware via the view's host class (`cm-merge-a` / `cm-merge-b`);
  // no class is added for the unified editor, which we treat as "right"
  // (its visible line numbers come from the modified doc).
  function buildCommentGutter(side: DiffSide): Extension {
    return gutter({
      class: `cm-diff-comment-gutter cm-diff-comment-gutter--${side}`,
      // RenderEmptyElements=false (default): empty lines don't waste a
      // span. We render a marker on every line that EXISTS, including
      // lines without comments, so the data-testid / click target is
      // always present.
      lineMarker(view, line) {
        const num = view.state.doc.lineAt(line.from).number;
        // The closure reads the latest set from a ref so we don't
        // need to reconfigure the extension on every comment add.
        const set = linesWithCommentsRef.current;
        // For the "a" (left) side, read the left set; everything else
        // reads the right set (covers both the "b" editor in side-by-
        // side and the unified editor — unified shows the modified doc).
        const has = (side === "left" ? leftSetRef.current : set).has(num);
        return new CommentGutterMarker(num, has);
      },
      // No `lineMarkerChange` predicate — the closures read the latest
      // ref value lazily, so a new comment doesn't need a gutter
      // reconfigure; the marker is simply re-requested on the next
      // view update (scroll, doc change, etc.). The `eq()` override
      // keeps the marker identity stable when nothing changed.
      domEventHandlers: {
        click(view, line, event) {
          const target = event.target as HTMLElement | null;
          if (!target?.closest(".cm-diff-comment-marker")) return false;
          const num = view.state.doc.lineAt(line.from).number;
          // Class-based side detection. cm-merge-a / cm-merge-b are
          // added by the @codemirror/merge package on each sub-editor's
          // host element. The unified editor has neither — treat as
          // "right".
          const dom = view.dom;
          const computedSide: DiffSide = dom.classList.contains("cm-merge-a")
            ? "left"
            : "right";
          popoverSideRef.current = computedSide;
          const markerEl = target.closest(".cm-diff-comment-marker") as HTMLElement;
          const rect = markerEl.getBoundingClientRect();
          setPopover({
            line: num,
            side: computedSide,
            top: rect.top,
            left: rect.right + 6,
          });
          event.preventDefault();
          return true;
        },
      },
    });
  }

  useEffect(() => {
    let alive = true;
    setErr(null);
    workspaceFileDiffSides(ws.id, tab.path).then(sides => {
      if (!alive || !hostRef.current) return;
      // Tear any prior view down before mounting the new one.
      mergeRef.current?.destroy();
      mergeRef.current = null;
      editorRef.current?.destroy();
      editorRef.current = null;
      hostRef.current.innerHTML = "";

      const lang = langForPath(tab.path);
      // We need a SEPARATE gutter extension per side (the closure
      // captures the side). Compartment lets us reconfigure later if
      // we ever switch the closure to react to ref changes (today
      // the ref is read lazily, so reconfigure isn't needed).
      const leftGutterComp = new Compartment();
      const rightGutterComp = new Compartment();
      // The base extension set is shared between the a and b editors
      // (and the unified editor) — we add the side-specific comment
      // gutter below per editor.
      const baseExt: Extension[] = [
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        lineNumbers(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        // Same syntax theme as the editor; surfaces pulled from the app
        // CSS vars. dimActiveLine=true — the diff's per-line red/green
        // tints carry the signal, the active-line wash would muddy it.
        resolveEditorTheme(editorThemeId),
        editorSurfaceTheme(editorFontSize, false, true),
        EditorView.theme({
          // @codemirror/merge styles "changed text" as a 2px
          // linear-gradient strip pinned to the bottom of the run —
          // it renders as a ragged green/red underline under every
          // changed word, the eyesore. Replace it with a flat
          // translucent highlight box.
          //
          // !important is REQUIRED: the merge baseTheme's selector
          // (`&dark.cm-merge-b .cm-changedText`, 3 classes) out-
          // specifies a plain `.cm-changedText` rule, so without it
          // our flat background loses and the gradient underline
          // stays. The merge rules aren't !important themselves, so
          // !important wins regardless of specificity.
          ".cm-changedText": {
            background: "rgba(64,160,90,0.26) !important",
            textDecoration: "none",
            borderRadius: "2px",
            boxShadow: "none",
          },
          // Side-by-side: the original ("a") editor's changed runs are
          // removals — tint them red. More specific than the plain
          // `.cm-changedText` above so it wins on that side only.
          "&.cm-merge-a .cm-changedText": {
            background: "rgba(239,83,80,0.24) !important",
          },
          ".cm-changedLine": {
            backgroundColor: "rgba(64,160,90,0.10) !important",
          },
          ".cm-deletedChunk": {
            backgroundColor: "rgba(239,83,80,0.08)",
          },
          ".cm-deletedText": {
            background: "rgba(239,83,80,0.26) !important",
            textDecoration: "none",
          },
          // CodeMirror merge wraps inserted/deleted lines in <ins>/<del>
          // tags — the browser's UA stylesheet underlines <ins> and
          // strikes through <del>, which is what made every changed
          // line look underlined. Drop those.
          "ins.cm-insertedLine, ins.cm-insertedLine *": {
            textDecoration: "none !important",
          },
          "ins.cm-insertedLine .cm-changedText, .cm-insertedLine .cm-changedText, ins.cm-insertedLine .cm-insertedText, .cm-insertedLine .cm-insertedText, ins.cm-insertedLine .cm-inserted, .cm-insertedLine .cm-inserted": {
            background: "transparent !important",
          },
          "del.cm-deletedLine, del.cm-deletedLine *": {
            textDecoration: "none !important",
          },
          "del.cm-deletedLine .cm-deletedText, .cm-deletedLine .cm-deletedText, del.cm-deletedLine .cm-deleted, .cm-deletedLine .cm-deleted": {
            background: "transparent !important",
          },
          // Diff comment gutter — small per-line icon. The marker is
          // 16x16 in the gutter column; on lines without comments it
          // fades to dim+40% opacity so it doesn't visually compete
          // with the diff tints, on lines WITH a comment the icon
          // fills with the accent color and the cell tints. Tinted
          // background on the cell, not the marker, so the marker's
          // hit target stays clean.
          ".cm-diff-comment-gutter": {
            width: "20px",
            backgroundColor: "transparent !important",
          },
          ".cm-diff-comment-gutter .cm-gutterElement": {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          },
          ".cm-diff-comment-marker": {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "16px",
            height: "16px",
            borderRadius: "3px",
            color: "var(--color-fg-dim)",
            opacity: "0.45",
            transition: "opacity 80ms, color 80ms, background-color 80ms",
            userSelect: "none",
          },
          ".cm-diff-comment-marker:hover": {
            opacity: "1",
            color: "var(--color-fg)",
            backgroundColor: "var(--color-hover)",
          },
          ".cm-diff-comment-marker--has": {
            color: "var(--color-accent)",
            opacity: "1",
          },
          ".cm-diff-comment-marker--has:hover": {
            backgroundColor:
              "color-mix(in srgb, var(--color-accent) 24%, transparent)",
          },
        }),
      ];
      if (lang) baseExt.push(lang as Extension);

      if (mode === "side") {
        mergeRef.current = new MergeView({
          parent: hostRef.current,
          a: { doc: sides.original, extensions: [...baseExt, leftGutterComp.of(buildCommentGutter("left"))] },
          b: { doc: sides.modified, extensions: [...baseExt, rightGutterComp.of(buildCommentGutter("right"))] },
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 6 },
        });
      } else {
        // Unified shows the modified doc's line numbers → "right" side.
        editorRef.current = new EditorView({
          parent: hostRef.current,
          doc: sides.modified,
          extensions: [
            ...baseExt,
            rightGutterComp.of(buildCommentGutter("right")),
            unifiedMergeView({
              original: sides.original,
              highlightChanges: true,
              gutter: true,
              syntaxHighlightDeletions: true,
              mergeControls: false,
              collapseUnchanged: { margin: 3, minSize: 6 },
            }),
          ],
        });
      }
    }).catch(e => alive && setErr(String(e)));
    return () => {
      alive = false;
      mergeRef.current?.destroy(); mergeRef.current = null;
      editorRef.current?.destroy(); editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id, tab.path, editorFontSize, mode, editorThemeId]);

  // When the user closes the popover (Esc, click outside, etc.) the
  // current state simply goes to null. We don't need any teardown of
  // the popover itself.
  function closePopover() {
    setPopover(null);
  }

  return (
    // bg MUST be opaque: tab swap keeps the codex/claude terminal
    // mounted under us via visibility-toggle, and xterm's WebGL canvas
    // bleeds through any transparent ancestor.
    <div className="flex h-full flex-col bg-[var(--color-bg)]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-border-soft)] bg-[var(--color-bg-1)] px-3">
        <span className="font-mono text-[12.5px] text-[var(--color-fg-dim)] truncate">{tab.path}</span>
        <div className="flex items-center gap-1">
          {/* Side-by-side ⇄ Unified toggle. Persisted in localStorage
              so the user's preference sticks across launches. */}
          <div className="mr-1 inline-flex items-stretch rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-[2px]">
            <button
              type="button"
              title="Unified (inline)"
              onClick={() => setModeAndPersist("unified")}
              className={cn(
                "h-6 rounded-[5px] px-1.5 text-[11.5px] transition-colors",
                mode === "unified"
                  ? "bg-[var(--color-bg-3)] text-[var(--color-fg)]"
                  : "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]",
              )}
            ><AlignJustify className="h-3.5 w-3.5" /></button>
            <button
              type="button"
              title="Side by side"
              onClick={() => setModeAndPersist("side")}
              className={cn(
                "h-6 rounded-[5px] px-1.5 text-[11.5px] transition-colors",
                mode === "side"
                  ? "bg-[var(--color-bg-3)] text-[var(--color-fg)]"
                  : "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]",
              )}
            ><Columns2 className="h-3.5 w-3.5" /></button>
          </div>
          <Button size="sm" variant="ghost" onClick={() =>
            addTab(ws.id, { id: crypto.randomUUID(), type: "edit", path: tab.path, title: tab.path.split("/").pop() || tab.path })
          }><Eye className="h-4 w-4" /> View</Button>
          <Button size="sm" variant="ghost" onClick={() => openPath(`${ws.path}/${tab.path}`).catch(() => {})}>
            <FolderOpen className="h-4 w-4" /> Open
          </Button>
        </div>
      </div>
      {err && <div className="p-4 font-mono text-[12.5px] text-[var(--color-err)]">Error: {err}</div>}
      {!err && (
        <div
          ref={hostRef}
          data-selectable
          className="min-h-0 flex-1 overflow-auto"
        />
      )}
      {popover && (
        <DiffCommentPopover
          wsId={ws.id}
          path={tab.path}
          side={popover.side}
          line={popover.line}
          anchor={{ top: popover.top, left: popover.left }}
          onClose={closePopover}
        />
      )}
    </div>
  );
}
