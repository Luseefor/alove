import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When set, renders a Next.js `Link` with the same visual styles as a button. */
  href?: string;
};

const btnBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-alove-focus-ring/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-alove-accent text-alove-on-accent shadow-sm hover:bg-alove-accent-hover active:bg-alove-accent-active",
  secondary:
    "bg-zinc-200/90 text-zinc-900 hover:bg-zinc-300/90 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700",
  ghost:
    "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/80",
  outline:
    "border border-zinc-300 bg-transparent text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900",
  danger:
    "bg-red-600 text-white hover:bg-red-500 active:bg-red-700",
};

function buttonClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  className: string,
) {
  const sizes = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return `${btnBase} ${sizes} ${variantClasses[variant]} ${className}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  href,
  children,
  ...props
}: ButtonProps) {
  const cls = buttonClassName(variant, size, className);
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={cls} {...props}>
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-600 tabular-nums shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </kbd>
  );
}

export function RailSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-zinc-200 px-3 py-1.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
      {children}
    </div>
  );
}

type ToggleChipProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
};

export function ToggleChip({
  checked,
  onChange,
  children,
  disabled,
  title,
}: ToggleChipProps) {
  return (
    <label
      title={title}
      className={`inline-flex cursor-pointer select-none items-center gap-1.5 border-b-2 px-1.5 py-0.5 text-xs font-medium transition-colors ${
        checked
          ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      } ${disabled ? "pointer-events-none opacity-45" : ""}`}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}
