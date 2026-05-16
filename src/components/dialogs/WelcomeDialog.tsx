// First-launch welcome: pick repos_dir (with live discovery preview) +
// see which CLIs are installed.

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useUI } from "@/store/ui";
import { AppDialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { discoverRepos, detectClis, settingsSave } from "@/lib/ipc";
import type { CliInfo } from "@/lib/types";
import { CliIcon, CLI_BRAND_COLOR } from "@/icons/cli";
import { TermicMark } from "@/icons/TermicLogo";
import { cn } from "@/lib/utils";

export function WelcomeDialog() {
  const open = useUI(s => s.welcomeOpen);
  const close = useUI(s => s.closeWelcome);
  const [dir, setDir] = useState("");
  const [summary, setSummary] = useState("");
  const [clis, setClis] = useState<CliInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClis([]); setSummary(""); setDir("");
    detectClis().then(setClis).catch(() => setClis([]));
  }, [open]);

  // Debounced live preview.
  useEffect(() => {
    if (!open || !dir) { setSummary(""); return; }
    const t = window.setTimeout(async () => {
      try {
        const repos = await discoverRepos(dir);
        const unadded = repos.filter(r => !r.already_added).length;
        setSummary(repos.length === 0
          ? `No git repos found in ${dir}.`
          : `Found ${repos.length} repo${repos.length === 1 ? "" : "s"} (${unadded} not yet added).`);
      } catch { setSummary("Couldn't read that path."); }
    }, 200);
    return () => window.clearTimeout(t);
  }, [dir, open]);

  async function browse() {
    const sel = await openDialog({ directory: true, multiple: false });
    if (typeof sel === "string") setDir(sel);
  }

  async function submit(skip: boolean) {
    setBusy(true);
    try {
      // Load + merge so the agents list (and any future field) survives the
      // save — settings_save replaces the whole file.
      const { settingsLoad } = await import("@/lib/ipc");
      const cur = await settingsLoad();
      await settingsSave({ ...cur, repos_dir: skip ? "" : dir.trim(), welcomed: true });
      close();
    } finally { setBusy(false); }
  }

  return (
    <AppDialog open={open} onOpenChange={() => {}}
      hideClose className="max-w-[520px]"
    >
      <div className="mb-4 flex items-center gap-3 -mt-1">
        <TermicMark size={40} />
        <div>
          <div className="text-[18px] font-semibold leading-tight">Welcome to Termic</div>
          <div className="text-[12.5px] text-[var(--color-fg-dim)]">One quick thing and you're in.</div>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="flex flex-col gap-3">
        <label className="block text-[13.5px]">
          Where do you keep your repos? <span className="text-[var(--color-fg-faint)] font-normal">(we'll suggest unadded ones)</span>
          <div className="mt-1.5 flex gap-2">
            <Input value={dir} onChange={e => setDir(e.target.value)} placeholder="~/Projects" />
            <Button variant="secondary" type="button" onClick={browse}>Browse…</Button>
          </div>
          <div className="mt-1 text-[12px] text-[var(--color-fg-faint)]">{summary}</div>
        </label>

        <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg)] p-3">
          <div className="mb-2 text-[11.5px] uppercase tracking-wider text-[var(--color-fg-dim)]">
            Agent CLIs on your PATH
          </div>
          {clis.length === 0 && <div className="text-[13.5px] text-[var(--color-fg-faint)]">Checking…</div>}
          {clis.map(c => (
            <div key={c.name} className={cn("flex items-center gap-2 py-0.5 text-[13.5px]", !c.found && "opacity-60")}>
              <span className={c.found ? CLI_BRAND_COLOR[c.name] : "text-[var(--color-fg-faint)]"}>
                <CliIcon cli={c.name} className="h-4 w-4" />
              </span>
              <span className="min-w-[60px]">{c.name}</span>
              <span className="truncate font-mono text-[12px] text-[var(--color-fg-dim)]">
                {c.found ? (c.version || c.path) : <span className="text-[var(--color-err)]">not installed</span>}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={() => submit(true)} disabled={busy}>Skip for now</Button>
          <Button variant="primary" type="submit" disabled={busy}>Get started</Button>
        </div>
      </form>
    </AppDialog>
  );
}
