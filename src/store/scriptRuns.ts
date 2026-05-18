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

type Key = string; // `${wsId}:${member}:${kind}` — member="" for host
const key = (wsId: string, kind: string, member: string = "") =>
  `${wsId}:${member}:${kind}`;
const MAX_LINES = 2000;
const EMPTY: RunState = Object.freeze({ status: "idle", lines: [], exitCode: null, startedAt: null }) as RunState;

interface Store {
  runs: Record<Key, RunState>;
  start: (wsId: string, kind: string, member?: string) => void;
  appendLine: (wsId: string, kind: string, line: string, member?: string) => void;
  finish: (wsId: string, kind: string, exitCode: number | null, success: boolean, member?: string) => void;
  reset:  (wsId: string, kind: string, member?: string) => void;
}

export const useScriptRuns = create<Store>(set => ({
  runs: {},
  start: (wsId, kind, member = "") => set(s => ({
    runs: { ...s.runs, [key(wsId, kind, member)]: { status: "running", lines: [], exitCode: null, startedAt: Date.now() } },
  })),
  appendLine: (wsId, kind, line, member = "") => set(s => {
    const k = key(wsId, kind, member);
    const cur = s.runs[k] ?? EMPTY;
    const next = cur.lines.length >= MAX_LINES
      ? [...cur.lines.slice(-MAX_LINES + 1), line]
      : [...cur.lines, line];
    return { runs: { ...s.runs, [k]: { ...cur, lines: next } } };
  }),
  finish: (wsId, kind, exitCode, success, member = "") => set(s => {
    const k = key(wsId, kind, member);
    const cur = s.runs[k] ?? EMPTY;
    return { runs: { ...s.runs, [k]: { ...cur, status: success ? "done" : "error", exitCode } } };
  }),
  reset: (wsId, kind, member = "") => set(s => {
    const k = key(wsId, kind, member);
    if (!s.runs[k]) return s;
    const { [k]: _, ...rest } = s.runs;
    return { runs: rest };
  }),
}));

/** Tight selector — returns the run state for a specific (ws, member, kind),
 *  or the shared frozen EMPTY object when nothing has run yet. Stable
 *  identity for the empty case keeps React from re-rendering on unrelated
 *  key changes. `member` defaults to "" (host). */
export const useRunState = (wsId: string | undefined, kind: string, member: string = "") =>
  useScriptRuns(s => (wsId ? s.runs[key(wsId, kind, member)] : undefined) ?? EMPTY);
