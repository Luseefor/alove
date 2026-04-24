"use client";

import type { ReactNode } from "react";
import { PaletteSwitcher } from "@/components/theme/PaletteSwitcher";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export function LandingShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[100dvh]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end p-4">
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <PaletteSwitcher size="md" />
          <ThemeToggle />
        </div>
      </div>
      {children}
    </div>
  );
}
