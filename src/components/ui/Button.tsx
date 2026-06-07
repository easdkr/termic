import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md whitespace-nowrap font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-gradient-to-b from-[var(--color-accent)] to-[var(--color-accent-deep)] text-white hover:brightness-110 border border-[var(--color-accent)]/50",
        secondary: "bg-[var(--color-bg-2)] text-[var(--color-fg)] hover:bg-[var(--color-bg-3)] border border-[var(--color-border)]",
        ghost: "text-[var(--color-fg-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]",
        icon: "text-[var(--color-fg-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] rounded-md",
        danger: "bg-[var(--color-err)]/15 text-[var(--color-err)] border border-[var(--color-err)]/30 hover:bg-[var(--color-err)]/25",
      },
      size: {
        sm: "h-7 px-2.5 text-[13.5px]",
        md: "h-8 px-3 text-[14px]",
        lg: "h-9 px-4 text-[13px]",
        icon: "h-7 w-7 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(
  ({ className, variant, size, type = "button", ...rest }, ref) =>
    <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...rest} />,
);
Button.displayName = "Button";
