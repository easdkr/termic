import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className={cn(
        "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[13px] text-[var(--color-fg)]",
        "outline-none transition-colors focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent-soft)]",
        className,
      )}
      {...rest}
    />
  ),
);
Input.displayName = "Input";
