// Fires a macOS notification when a tab earns the unread state, but only for
// tabs that aren't currently active (don't ping the screen the user is on).

import { useEffect, useRef } from "react";
import { useApp } from "@/store/app";
import { usePrefs } from "@/store/prefs";
import { notify } from "@/lib/ipc";

const DEBOUNCE_MS = 8000;

export function useAttentionNotifier() {
  const lastFiredRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const unsub = useApp.subscribe((state, prev) => {
      // Gate every notification on the user's pref. We still update unread
      // dots in the sidebar — only the OS notification is opt-in.
      if (!usePrefs.getState().desktopNotifications) return;
      const wsIds = Object.keys(state.tabs);
      for (const wsId of wsIds) {
        const tabs = state.tabs[wsId] || [];
        const prevTabs = prev.tabs[wsId] || [];
        for (const t of tabs) {
          if (!t.unread) continue;
          const wasUnread = prevTabs.find(p => p.id === t.id)?.unread;
          if (wasUnread) continue;
          // Suppress notifications for ANY tab in the focused workspace —
          // even hidden tabs within it. The user explicitly asked for "never
          // watch and notify for work done" while focused on a workspace.
          if (state.activeWorkspaceId === wsId) continue;
          const key = `${wsId}:${t.id}`;
          const now = Date.now();
          if ((lastFiredRef.current[key] || 0) + DEBOUNCE_MS > now) continue;
          lastFiredRef.current[key] = now;
          const w = state.workspaces.find(w => w.id === wsId);
          const reason = t.unread.reason === "bell" ? "wants input" : t.unread.reason === "exit" ? "exited" : "is idle";
          notify(`${w?.name || "workspace"} · ${t.type === "terminal" ? t.cli : t.type}`, `agent ${reason}`).catch(() => {});
        }
      }
    });
    return unsub;
  }, []);
}
