// Per-(workspace, kind) lifecycle state for streaming Setup/Run scripts.
// Lives outside the app store because it churns line-by-line during a run
// (would re-render unrelated app store subscribers otherwise) and resets
// fully on next invocation — no persistence.

import { create } from "zustand";

export type RunStatus = "idle" | "running" | "done" | "error";

interface RunState {
  status: RunStatus;
  /** Tail of captured stdout+stderr — capped to MAX_LINES so a long-running
   *  dev server doesn't grow this unboundedly. */
  lines: string[];
  /** Exit code if status is "done" or "error". */
  exitCode: number | null;
  /** Wall-clock ms when the run started — used for "Running for 12s" labels. */
  startedAt: number | null;
}

type Key = string; // `${wsId}:${kind}`
const key = (wsId: string, kind: string) => `${wsId}:${kind}`;
const MAX_LINES = 2000;
const EMPTY: RunState = Object.freeze({ status: "idle", lines: [], exitCode: null, startedAt: null }) as RunState;

interface Store {
  runs: Record<Key, RunState>;
  start: (wsId: string, kind: string) => void;
  appendLine: (wsId: string, kind: string, line: string) => void;
  finish: (wsId: string, kind: string, exitCode: number | null, success: boolean) => void;
  reset:  (wsId: string, kind: string) => void;
}

export const useScriptRuns = create<Store>(set => ({
  runs: {},
  start: (wsId, kind) => set(s => ({
    runs: { ...s.runs, [key(wsId, kind)]: { status: "running", lines: [], exitCode: null, startedAt: Date.now() } },
  })),
  appendLine: (wsId, kind, line) => set(s => {
    const k = key(wsId, kind);
    const cur = s.runs[k] ?? EMPTY;
    const next = cur.lines.length >= MAX_LINES
      ? [...cur.lines.slice(-MAX_LINES + 1), line]
      : [...cur.lines, line];
    return { runs: { ...s.runs, [k]: { ...cur, lines: next } } };
  }),
  finish: (wsId, kind, exitCode, success) => set(s => {
    const k = key(wsId, kind);
    const cur = s.runs[k] ?? EMPTY;
    return { runs: { ...s.runs, [k]: { ...cur, status: success ? "done" : "error", exitCode } } };
  }),
  reset: (wsId, kind) => set(s => {
    const k = key(wsId, kind);
    if (!s.runs[k]) return s;
    const { [k]: _, ...rest } = s.runs;
    return { runs: rest };
  }),
}));

/** Tight selector — returns the run state for a specific (ws, kind), or the
 *  shared frozen EMPTY object when nothing has run yet. Stable identity for
 *  the empty case keeps React from re-rendering on unrelated key changes. */
export const useRunState = (wsId: string | undefined, kind: string) =>
  useScriptRuns(s => (wsId ? s.runs[key(wsId, kind)] : undefined) ?? EMPTY);
