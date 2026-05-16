// Minimal shadcn-style Dialog over Radix. Sized for our dark theme.

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  description?: string;
  className?: string;
  hideClose?: boolean;
  children: ReactNode;
}

export function AppDialog({ open, onOpenChange, title, description, className, hideClose, children }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* No `backdrop-blur` — the 2px blur made the underlying logo +
            text behind the dialog look fuzzy/out of focus, which read as
            an anti-aliasing bug. Plain dim is cleaner and matches Conductor's
            backdrop style. */}
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/65 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        {/* Centering via flexbox on a full-viewport wrapper — NO transforms
            on the Content itself. The previous `left-1/2 -translate-x-1/2`
            scheme positions the dialog at sub-pixel offsets when the viewport
            or dialog width is odd, which makes every glyph inside render
            blurry. flex centering keeps everything on integer pixels. */}
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <Dialog.Content
            className={cn(
              "relative grid w-full max-w-md gap-2 pointer-events-auto",
              "rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-1)] p-5 shadow-2xl",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0",
              className,
            )}
          >
            {title && <Dialog.Title className="text-base font-medium">{title}</Dialog.Title>}
            {description && <Dialog.Description className="text-xs text-[var(--color-fg-dim)] -mt-1">{description}</Dialog.Description>}
            {children}
            {!hideClose && (
              <Dialog.Close className="absolute right-3 top-3 rounded-md p-1 text-[var(--color-fg-faint)] hover:bg-[var(--color-hover)]">
                <X className="h-4 w-4" />
              </Dialog.Close>
            )}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
