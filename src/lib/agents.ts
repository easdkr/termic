// Per-agent CLI knowledge: launch args + runtime mode switching.
// Centralizes the "what flag does CLI X take for YOLO mode" question so
// TerminalPane, ReviewDialog, and future spawn sites all agree.

import { ptyWrite } from "@/lib/ipc";

/** Args appended to the spawn command when YOLO mode is on. */
export function yoloArgsForCli(cli: string): string[] {
  switch (cli) {
    case "claude": return ["--dangerously-skip-permissions"];
    case "gemini": return ["--yolo"];
    case "codex":  return ["--dangerously-bypass-approvals-and-sandbox"];
    default:       return [];
  }
}

/** Compose the full args list for a spawn given the agent and current prefs. */
export function spawnArgsForCli(cli: string, yolo: boolean): string[] {
  return yolo ? yoloArgsForCli(cli) : [];
}

/**
 * Attempt to toggle YOLO on a live PTY without respawning. Currently only
 * Gemini supports this — it has `/approval-mode <mode>` as a slash command.
 * Claude has no runtime toggle (would require respawn with the flag); same
 * for codex. Returns true if we sent something to the PTY.
 */
export async function tryToggleYoloLive(cli: string, ptyId: string, yolo: boolean): Promise<boolean> {
  if (cli !== "gemini") return false;
  // gemini's runtime command: `/approval-mode yolo` or `/approval-mode default`.
  const cmd = yolo ? "/approval-mode yolo" : "/approval-mode default";
  const bytes = new TextEncoder().encode(cmd + "\r");
  try { await ptyWrite(ptyId, Array.from(bytes)); return true; } catch { return false; }
}
