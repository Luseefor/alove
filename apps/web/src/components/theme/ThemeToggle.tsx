"use client";

import { useTheme, type ThemePreference } from "./ThemeProvider";

const segments: { value: ThemePreference; label: string; title: string }[] = [
  { value: "light", label: "Light", title: "Light theme" },
  { value: "system", label: "Auto", title: "Match system" },
  { value: "dark", label: "Dark", title: "Dark theme" },
];

type ThemeToggleProps = {
  /** Compact pill for toolbars; roomy for landing. */
  size?: "sm" | "md";
  className?: string;
};

export function ThemeToggle({ size = "md", className = "" }: ThemeToggleProps) {
  const { preference, setPreference } = useTheme();
  const sm = size === "sm";

  return (
    <div
      role="group"
      aria-label="Light or dark appearance"
      className={`inline-flex rounded border border-zinc-300 p-px dark:border-zinc-600 ${sm ? "text-[11px]" : "text-xs"} ${className}`}
    >
      {segments.map(({ value, label, title }) => (
        <button
          key={value}
          type="button"
          title={title}
          onClick={() => setPreference(value)}
          className={`px-2 font-medium transition-colors ${
            sm ? "py-0.5" : "py-1"
          } ${
            preference === value
              ? "bg-zinc-200 text-zinc-950 dark:bg-zinc-700 dark:text-zinc-50"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/80"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
