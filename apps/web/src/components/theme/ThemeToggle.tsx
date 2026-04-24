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
      className={`inline-flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80 ${sm ? "text-[11px]" : "text-xs"} ${className}`}
    >
      {segments.map(({ value, label, title }) => (
        <button
          key={value}
          type="button"
          title={title}
          onClick={() => setPreference(value)}
          className={`rounded-md px-2 font-medium transition-colors ${
            sm ? "py-0.5" : "py-1"
          } ${
            preference === value
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
