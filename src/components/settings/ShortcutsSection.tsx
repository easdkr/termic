// Read-only list of the keyboard shortcuts currently wired up. Source of
// truth lives in `src/hooks/useShortcuts.ts` — keep this list in sync when
// you add/remove bindings.

const ROWS: { label: string; keys: string }[] = [
  { label: "Open settings",                 keys: "⌘," },
  { label: "Jump to workspace 1…9",         keys: "⌘1 – ⌘9" },
  { label: "Focus active terminal",         keys: "⌘L" },
  { label: "Previous tab",                  keys: "⌘[" },
  { label: "Next tab",                      keys: "⌘]" },
  { label: "Close active tab",              keys: "⌘W" },
  { label: "New bottom-split terminal",     keys: "⌘T" },
  { label: "Previous workspace",            keys: "⇧⌘[" },
  { label: "Next workspace",                keys: "⇧⌘]" },
];

export function ShortcutsSection() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-medium">Shortcuts</h1>
      <div className="rounded-lg border border-[var(--color-border-soft)] overflow-hidden">
        {ROWS.map((r, i) => (
          <div key={r.keys}
               className="flex items-center justify-between px-4 py-3 text-[13.5px]"
               style={{ borderTop: i === 0 ? undefined : "1px solid var(--color-border-soft)" }}>
            <span>{r.label}</span>
            <kbd className="font-mono text-[12.5px] text-[var(--color-fg-dim)]">{r.keys}</kbd>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-[var(--color-fg-faint)]">
        Re-binding shortcuts is not yet supported.
      </p>
    </div>
  );
}
