// Read-only list of the keyboard shortcuts currently wired up. Source of
// truth lives in `src/hooks/useShortcuts.ts` — keep this list in sync when
// you add/remove bindings.

/** A shortcut entry. `keys` is an array of combos (each rendered as a
 *  group); each combo is the raw glyph string like "⇧⌘D" or "⌥⌘↑". We
 *  parse the glyphs into modifier chips + key chips at render time so
 *  the page shows BOTH the macOS symbol AND the key name. */
type Row = { label: string; keys: string[] };

const ROWS: Row[] = [
  { label: "Open settings",                 keys: ["⌘,"] },
  { label: "Jump to workspace 1…9",         keys: ["⌘1 – ⌘9"] },
  { label: "Focus active terminal",         keys: ["⌘L"] },
  { label: "Previous tab",                  keys: ["⇧⌘["] },
  { label: "Next tab",                      keys: ["⇧⌘]"] },
  { label: "Close active tab",              keys: ["⌘W"] },
  { label: "New bottom-split terminal",     keys: ["⇧⌘D"] },
  { label: "Previous workspace",            keys: ["⌘[", "⌥⌘↑"] },
  { label: "Next workspace",                keys: ["⌘]", "⌥⌘↓"] },
];

// Glyph → name mapping for the kbd chip rendering. Modifiers always
// resolve via this table; non-modifier characters (letters, digits,
// brackets, comma, dashes) render as themselves.
const KEY_NAMES: Record<string, string> = {
  "⌘": "Cmd",
  "⇧": "Shift",
  "⌥": "Option",
  "⌃": "Ctrl",
  "↑": "Up",
  "↓": "Down",
  "←": "Left",
  "→": "Right",
  "↩": "Return",
  "␣": "Space",
  ",": "Comma",
};

export function ShortcutsSection() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[20px] font-medium">Shortcuts</h1>
      <div className="rounded-lg border border-[var(--color-border-soft)] overflow-hidden">
        {ROWS.map((r, i) => (
          <div key={r.label}
               className="flex items-center justify-between gap-4 px-4 py-3 text-[13.5px]"
               style={{ borderTop: i === 0 ? undefined : "1px solid var(--color-border-soft)" }}>
            <span>{r.label}</span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {r.keys.map((combo, idx) => (
                <span key={idx} className="flex items-center gap-1">
                  {idx > 0 && <span className="text-[11px] text-[var(--color-fg-faint)]">or</span>}
                  <ComboChip combo={combo} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-[var(--color-fg-faint)]">
        Re-binding shortcuts is not yet supported.
      </p>
    </div>
  );
}

/** Renders a single keybinding as inline kbd chips (symbol + name).
 *  Special-cases the "1 – 9" range form so it reads naturally instead
 *  of becoming nine ⌘N chips. */
function ComboChip({ combo }: { combo: string }) {
  // Range form: "⌘1 – ⌘9" (the only one today). Treat the literal
  // string as one chip group: [Cmd ⌘] [1] – [Cmd ⌘] [9].
  if (combo.includes("–") || combo.includes("-")) {
    const parts = combo.split(/\s*[–-]\s*/);
    return (
      <span className="flex items-center gap-1">
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-[11px] text-[var(--color-fg-faint)]">–</span>}
            <ComboChip combo={p} />
          </span>
        ))}
      </span>
    );
  }
  // Split into modifiers (recognized glyphs) + final key.
  const chars = Array.from(combo);
  return (
    <span className="flex items-center gap-1">
      {chars.map((c, i) => (
        <Key key={i} glyph={c} />
      ))}
    </span>
  );
}

function Key({ glyph }: { glyph: string }) {
  // Always render the human name when we have one (Cmd / Shift /
  // Option / Up / etc.); otherwise the raw glyph (letters, digits,
  // brackets). The mac symbols alone read like hieroglyphs to
  // anyone who hasn't memorized them — names are universal.
  const name = KEY_NAMES[glyph] ?? glyph;
  return (
    <kbd className="inline-flex items-center rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-[1px] font-mono text-[11.5px] leading-none text-[var(--color-fg)]">
      {name}
    </kbd>
  );
}
