// Global confirm modal. Driven by useUI().askConfirm({...}) which
// returns a Promise<boolean>, drop-in replacement for window.confirm()
// with our own chrome + theming + a clear "destructive" red variant.

import { useEffect } from "react";
import { useUI } from "@/store/ui";
import { AppDialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { AlertTriangle } from "lucide-react";

export function ConfirmDialog() {
  const confirm = useUI(s => s.confirm);
  const resolve = useUI(s => s.resolveConfirm);

  // ⏎ confirms, Esc cancels. Esc is already handled by Radix Dialog's
  // onOpenChange (false), but the Enter handler is ours.
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        resolve(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, resolve]);

  if (!confirm) return null;
  const { req } = confirm;
  const destructive = !!req.destructive;

  return (
    <AppDialog
      open
      onOpenChange={(v) => { if (!v) resolve(false); }}
      title={req.title}
      // The dialog this confirm stacks on top of (Sandbox dialog,
      // Archive flow, etc.) already painted the dim backdrop. A
      // second 65% black on top double-dims the screen + the
      // independent fade-in animations compose into visible flicker.
      // Transparent overlay = clean stack.
      overlayClassName="bg-transparent"
    >
      <div className="flex items-start gap-3 pt-1">
        <AlertTriangle
          className={
            "mt-0.5 h-5 w-5 shrink-0 " +
            (destructive ? "text-[var(--color-err)]" : "text-[var(--color-warn)]")
          }
        />
        <p className="text-[14px] text-[var(--color-fg-dim)] leading-relaxed">
          {req.message}
        </p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={() => resolve(false)}>
          {req.cancelLabel ?? "Cancel"}
        </Button>
        <Button
          variant="primary"
          type="button"
          onClick={() => resolve(true)}
          // Override accent → red for destructive actions so the
          // user has a visual "this is irreversible" before they click.
          className={
            destructive
              ? "bg-[var(--color-err)] border-[var(--color-err)] hover:brightness-110"
              : ""
          }
          autoFocus
        >
          {req.confirmLabel ?? "Confirm"}
        </Button>
      </div>
    </AppDialog>
  );
}
