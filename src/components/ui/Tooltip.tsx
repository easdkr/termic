import * as RT from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left"; delay?: number; }

export function Tip({ content, children, side = "right", delay = 0 }: Props) {
  if (!content) return <>{children}</>;
  return (
    <RT.Provider delayDuration={delay}>
      <RT.Root>
        <RT.Trigger asChild>{children}</RT.Trigger>
        <RT.Portal>
          <RT.Content
            side={side}
            sideOffset={6}
            className={cn(
              // Body-sized 13.5px text (no more squinty tooltips), generous
              // padding so the label isn't crammed against the border.
              "z-[100] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-2)] px-2.5 py-1.5 text-[13.5px] text-[var(--color-fg)] shadow-lg",
              "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0",
            )}
          >
            {content}
            <RT.Arrow className="fill-[var(--color-bg-2)]" />
          </RT.Content>
        </RT.Portal>
      </RT.Root>
    </RT.Provider>
  );
}
