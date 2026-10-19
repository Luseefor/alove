"use client";

import { useTheme } from "./ThemeProvider";
import type { AppearancePreference } from "@/theme";

const segments: { value: AppearancePreference; label: string; title: string }[] = [
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
  const { appearance, setAppearance } = useTheme();
  const sm = size === "sm";

  return (
    <div
      role="group"
      aria-label="Light or dark appearance"
      className={`inline-flex rounded border border-surface-border p-px bg-surface-base ${sm ? "text-[11px]" : "text-xs"} ${className}`}
    >
      {segments.map(({ value, label, title }) => (
        <button
          key={value}
          type="button"
          title={title}
          onClick={() => setAppearance(value)}
          className={`px-2 font-medium transition-colors rounded-sm ${
            sm ? "py-0.5" : "py-1"
          } ${
            appearance === value
              ? "bg-surface-raised text-text-base shadow-sm"
              : "text-text-muted hover:bg-surface-sunken"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
