import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "link";
type ButtonSize = "sm" | "md" | "lg" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When set, renders a Next.js `Link` with the same visual styles as a button. */
  href?: string;
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  href,
  children,
  ...props
}: ButtonProps) {
  const base = "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
  
  const variants = {
    primary: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
    danger: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
    link: "text-primary underline-offset-4 hover:underline",
  };

  const sizes = {
    sm: "h-8 rounded-md px-3 text-xs",
    md: "h-9 px-4 py-2",
    lg: "h-10 rounded-md px-8",
    icon: "h-9 w-9",
  };

  const cls = cn(base, variants[variant], sizes[size], className);

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
    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
      {children}
    </kbd>
  );
}

export function Badge({ children, variant = "default", className }: { children: ReactNode, variant?: "default" | "secondary" | "outline" | "destructive", className?: string }) {
  const variants = {
    default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
    secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
    outline: "text-foreground",
    destructive: "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
  };
  return (
    <div className={cn("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", variants[variant], className)}>
      {children}
    </div>
  );
}

export function Separator({ orientation = "horizontal", className }: { orientation?: "horizontal" | "vertical", className?: string }) {
  return (
    <div 
      className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]", className)}
    />
  );
}

export function RailSectionTitle({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <div className={cn("px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider", className)}>
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
  className?: string;
};

export function ToggleChip({
  checked,
  onChange,
  children,
  disabled,
  title,
  className,
}: ToggleChipProps) {
  return (
    <label
      title={title}
      className={cn(
        "inline-flex cursor-pointer select-none items-center gap-1.5 border-b-2 px-1.5 py-0.5 text-xs font-medium transition-colors",
        checked
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
        disabled && "pointer-events-none opacity-45",
        className
      )}
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
