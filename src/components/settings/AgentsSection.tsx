// Settings → Agents. Lets the user edit per-CLI launch commands, default
// args, YOLO flags, and runtime YOLO slash-commands.
//
// Built-in agents (claude/gemini/codex) are editable but not removable —
// removing them would orphan existing workspaces that reference them.
// Saves are debounced (500ms) so typing doesn't hammer the JSON file.

import { useEffect, useRef, useState } from "react";
import { settingsLoad, agentsSave } from "@/lib/ipc";
import type { Agent } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AppDialog } from "@/components/ui/Dialog";
import { Trash2, Plus, Check, AlertTriangle } from "lucide-react";
import { CliIcon, CLI_BRAND_COLOR } from "@/icons/cli";
import { cn } from "@/lib/utils";

export function AgentsSection() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const savedFlashTimer = useRef<number | null>(null);
  // id of an agent that just got created — its card uses this to scroll into
  // view and focus its name input on mount. Cleared after one use.
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);
  // Pending-delete confirmation. null = closed.
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);

  useEffect(() => {
    settingsLoad().then(s => setAgents(s.agents || [])).catch(e => setErr(String(e)));
  }, []);

  function performSave(next: Agent[]) {
    setStatus("saving"); setErr(null);
    agentsSave(next)
      .then(() => {
        setStatus("saved");
        if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
        savedFlashTimer.current = window.setTimeout(() => setStatus("idle"), 1500) as unknown as number;
      })
      .catch(e => { setErr(String(e)); setStatus("error"); });
  }

  function mutate(next: Agent[]) {
    setAgents(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => performSave(next), 500) as unknown as number;
  }

  function patchAgent(id: string, patch: Partial<Agent>) {
    mutate(agents.map(a => a.id === id ? { ...a, ...patch } : a));
  }
  function patchCaps(id: string, patch: Partial<NonNullable<Agent["capabilities"]>>) {
    mutate(agents.map(a => a.id === id
      ? { ...a, capabilities: { ...(a.capabilities || {}), ...patch } }
      : a));
  }
  function requestRemoveAgent(id: string) {
    const a = agents.find(x => x.id === id);
    if (!a || a.builtin) return;
    // Open the in-app confirmation dialog — native confirm() is jarring and
    // doesn't match the rest of the app's chrome.
    setPendingDelete(a);
  }
  function confirmRemoveAgent() {
    if (!pendingDelete) return;
    mutate(agents.filter(x => x.id !== pendingDelete.id));
    setPendingDelete(null);
  }
  function addAgent() {
    // Find a unique id "custom-N".
    let n = 1;
    while (agents.some(a => a.id === `custom-${n}`)) n++;
    const fresh: Agent = {
      id: `custom-${n}`,
      display_name: `New agent ${n}`,
      command: "",
      args: [],
      icon_id: "lucide:terminal",
      color: "#9aa0a6",
      builtin: false,
      capabilities: { yolo_args: [], runtime_yolo_command: "" },
    };
    mutate([...agents, fresh]);
    // Tell that card to scroll-into-view + focus on mount.
    setAutoFocusId(fresh.id);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[20px] font-medium">Agents</h1>
        <div className="flex items-center gap-3">
          <div className="text-[12px] text-[var(--color-fg-faint)] min-h-[1em]">
            {status === "saving" && <span>Saving…</span>}
            {status === "saved"  && <span className="flex items-center gap-1 text-[var(--color-ok)]"><Check className="h-3.5 w-3.5" /> Saved</span>}
            {status === "error"  && <span className="text-[var(--color-err)]">Save failed</span>}
          </div>
          <Button variant="secondary" size="sm" onClick={addAgent}>
            <Plus className="h-3.5 w-3.5" /> Add agent
          </Button>
        </div>
      </div>

      <p className="text-[13px] text-[var(--color-fg-dim)] -mt-2">
        Customize the command and flags used to launch each agent. Useful when the CLI renames a flag
        (e.g., a future <code className="font-mono">--yolo</code> rename) or you want to point at a
        wrapper script. Built-in agents can be edited but not removed.
      </p>

      {err && <div className="text-[13px] text-[var(--color-err)]">{err}</div>}

      <div className="flex flex-col gap-3">
        {agents.map(a => (
          <AgentCard
            key={a.id}
            agent={a}
            onPatch={(p) => patchAgent(a.id, p)}
            onPatchCaps={(p) => patchCaps(a.id, p)}
            onRemove={() => requestRemoveAgent(a.id)}
            autoFocus={autoFocusId === a.id}
            onAutoFocusConsumed={() => setAutoFocusId(null)}
          />
        ))}
      </div>

      {/* Delete confirmation. In-app dialog (not browser confirm) so it
          matches the app chrome and traps focus properly. */}
      <AppDialog
        open={!!pendingDelete}
        onOpenChange={(v) => { if (!v) setPendingDelete(null); }}
      >
        <div className="flex items-start gap-3">
          <span className="shrink-0 rounded-full bg-[var(--color-err)]/15 p-2 text-[var(--color-err)]">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">Remove agent?</div>
            <p className="mt-1 text-[13px] text-[var(--color-fg-dim)]">
              <span className="font-mono text-[var(--color-fg)]">{pendingDelete?.display_name}</span>{" "}
              will be removed. Workspaces that reference it will fall back to spawning the
              literal command <span className="font-mono text-[var(--color-fg)]">{pendingDelete?.command || "(empty)"}</span>.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmRemoveAgent}>
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        </div>
      </AppDialog>
    </div>
  );
}

function AgentCard({ agent, onPatch, onPatchCaps, onRemove, autoFocus, onAutoFocusConsumed }: {
  agent: Agent;
  onPatch: (p: Partial<Agent>) => void;
  onPatchCaps: (p: Partial<NonNullable<Agent["capabilities"]>>) => void;
  onRemove: () => void;
  /** True for a freshly-created card — scrolls into view + focuses the name
   *  input on mount. */
  autoFocus?: boolean;
  onAutoFocusConsumed?: () => void;
}) {
  // The args + yolo_args fields are arrays — edited as space-separated text
  // for ergonomics. We split on whitespace and drop empties on commit.
  const argsText      = (agent.args || []).join(" ");
  const yoloArgsText  = (agent.capabilities?.yolo_args || []).join(" ");
  const cardRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    // Two RAFs so layout settles before scrolling — otherwise the card might
    // not have its final position yet and the scroll target is stale.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameRef.current?.focus();
      nameRef.current?.select();
      onAutoFocusConsumed?.();
    }));
  }, [autoFocus, onAutoFocusConsumed]);

  return (
    <div ref={cardRef} className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-1)] p-4">
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn(CLI_BRAND_COLOR[agent.icon_id] || "text-[var(--color-fg-dim)]")}>
            <CliIcon cli={agent.icon_id} className="h-4 w-4" />
          </span>
          <input
            ref={nameRef}
            value={agent.display_name}
            onChange={(e) => onPatch({ display_name: e.target.value })}
            className="bg-transparent text-[14px] font-semibold outline-none border-b border-transparent focus:border-[var(--color-accent)]"
          />
          <span className="rounded bg-[var(--color-bg-3)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg-dim)] font-mono">{agent.id}</span>
          {agent.builtin && (
            <span className="rounded bg-[var(--color-bg-3)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg-faint)] uppercase tracking-wider">built-in</span>
          )}
        </div>
        {!agent.builtin && (
          <button
            onClick={onRemove}
            className="rounded p-1.5 text-[var(--color-fg-faint)] hover:bg-[var(--color-bg-3)] hover:text-[var(--color-err)]"
            title="Remove agent"
          ><Trash2 className="h-4 w-4" /></button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3">
        <Field label="Command" hint="Binary or shell command to spawn. e.g. claude, /usr/local/bin/claude, sh -lc 'claude'">
          <Input value={agent.command} onChange={e => onPatch({ command: e.target.value })} className="font-mono" placeholder="claude" />
        </Field>
        <Field label="Default args" hint="Always passed. Space-separated.">
          <Input value={argsText}
            onChange={e => onPatch({ args: e.target.value.split(/\s+/).filter(Boolean) })}
            className="font-mono" placeholder="--no-update"
          />
        </Field>
        <Field label="YOLO args" hint="Appended when YOLO mode (⚡) is on. Empty = no flag added.">
          <Input value={yoloArgsText}
            onChange={e => onPatchCaps({ yolo_args: e.target.value.split(/\s+/).filter(Boolean) })}
            className="font-mono" placeholder="--dangerously-skip-permissions"
          />
        </Field>
        <Field label="Runtime YOLO command" hint='Slash-command sent to live PTY when YOLO is toggled. Use {mode} for "yolo" or "default". Empty = no runtime toggle.'>
          <Input value={agent.capabilities?.runtime_yolo_command || ""}
            onChange={e => onPatchCaps({ runtime_yolo_command: e.target.value })}
            className="font-mono" placeholder="/approval-mode {mode}"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[13px] font-medium">{label}</div>
      {hint && <div className="mt-0.5 mb-1.5 text-[12px] text-[var(--color-fg-dim)]">{hint}</div>}
      {children}
    </label>
  );
}
