// Lazy-loading file tree for the "All files" panel.
// - Initial render fetches the workspace root only.
// - Clicking a dir expands it and fetches its entries on demand (cached by rel-path).
// - Clicking a file opens an edit tab in the workspace.
// - Indentation reflects depth; chevrons rotate to indicate expansion state.

import { useEffect, useState, useCallback } from "react";
import { ChevronRight, File as FileIcon, Folder as FolderIcon, FolderOpen } from "lucide-react";
import type { FileEntry } from "@/lib/types";
import { workspaceDirList } from "@/lib/ipc";
import { useApp } from "@/store/app";
import { cn } from "@/lib/utils";

interface Props { wsId: string; }

export function FileTree({ wsId }: Props) {
  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null);
  // Per-dir cache of children, keyed by rel-path ("" = root).
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  // Expanded set keyed by rel-path.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Tracks in-flight dir loads so we don't double-fetch.
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [err, setErr] = useState<string | null>(null);

  // Load root on mount / wsId change. Reset everything else — different
  // workspace has a different file tree.
  useEffect(() => {
    setRootEntries(null); setChildren({}); setExpanded(new Set()); setErr(null);
    workspaceDirList(wsId, "")
      .then(list => { setRootEntries(list); setChildren({ "": list }); })
      .catch(e => setErr(String(e)));
  }, [wsId]);

  const ensureLoaded = useCallback(async (rel: string) => {
    if (children[rel] || loading.has(rel)) return;
    setLoading(s => { const n = new Set(s); n.add(rel); return n; });
    try {
      const list = await workspaceDirList(wsId, rel);
      setChildren(c => ({ ...c, [rel]: list }));
    } catch (e) { console.error("dir list failed", rel, e); }
    finally { setLoading(s => { const n = new Set(s); n.delete(rel); return n; }); }
  }, [wsId, children, loading]);

  const toggle = useCallback((rel: string) => {
    setExpanded(s => {
      const n = new Set(s);
      if (n.has(rel)) n.delete(rel); else { n.add(rel); ensureLoaded(rel); }
      return n;
    });
  }, [ensureLoaded]);

  if (err) return <div className="px-3 py-2 text-[12.5px] text-[var(--color-err)]">{err}</div>;
  if (!rootEntries) return <div className="px-3 py-2 text-[13.5px] text-[var(--color-fg-faint)]">Loading…</div>;
  if (rootEntries.length === 0) return <div className="px-3 py-2 text-[13.5px] text-[var(--color-fg-faint)]">(empty)</div>;

  return (
    <div className="flex flex-col">
      {rootEntries.map(e => (
        <TreeNode
          key={e.name} wsId={wsId} entry={e} depth={0} rel={e.name}
          expanded={expanded} children_={children} toggle={toggle}
        />
      ))}
    </div>
  );
}

interface NodeProps {
  wsId: string;
  entry: FileEntry;
  depth: number;
  rel: string;
  expanded: Set<string>;
  children_: Record<string, FileEntry[]>;
  toggle: (rel: string) => void;
}

function TreeNode({ wsId, entry, depth, rel, expanded, children_, toggle }: NodeProps) {
  const addTab = useApp(s => s.addTab);
  const isOpen = expanded.has(rel);
  const kids = children_[rel];

  function onClick() {
    if (entry.is_dir) toggle(rel);
    else addTab(wsId, { id: crypto.randomUUID(), type: "edit", path: rel, title: entry.name });
  }

  return (
    <>
      <button
        onClick={onClick}
        title={rel}
        className="flex items-center gap-1.5 px-2 py-1 text-left text-[13px] text-[var(--color-fg-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {entry.is_dir ? (
          <ChevronRight className={cn("h-3 w-3 shrink-0 text-[var(--color-fg-faint)] transition-transform", isOpen && "rotate-90")} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {entry.is_dir
          ? (isOpen
              ? <FolderOpen className="h-4 w-4 shrink-0 text-[var(--color-fg-faint)]" />
              : <FolderIcon className="h-4 w-4 shrink-0 text-[var(--color-fg-faint)]" />)
          : <FileIcon className="h-4 w-4 shrink-0 text-[var(--color-fg-faint)]" />}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.is_dir && isOpen && kids && kids.map(c => (
        <TreeNode
          key={c.name} wsId={wsId} entry={c} depth={depth + 1} rel={`${rel}/${c.name}`}
          expanded={expanded} children_={children_} toggle={toggle}
        />
      ))}
      {entry.is_dir && isOpen && !kids && (
        <div className="px-2 py-1 text-[12px] text-[var(--color-fg-faint)]" style={{ paddingLeft: 8 + (depth + 1) * 14 + 24 }}>
          Loading…
        </div>
      )}
    </>
  );
}
