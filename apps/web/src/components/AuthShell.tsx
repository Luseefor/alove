"use client";

import type { ReactNode } from "react";
import { PaletteSwitcher } from "@/components/theme/PaletteSwitcher";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

type AuthShellProps = {
  children: ReactNode;
};

/**
 * Clerk sign-in/up pages: same appearance + accent controls as the landing shell.
 */
export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="relative min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end p-4">
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <PaletteSwitcher size="md" />
          <ThemeToggle />
        </div>
      </div>
      <main className="flex min-h-[100dvh] flex-col items-center justify-center px-4 pb-12 pt-20">
        <div className="w-full max-w-md [&_.cl-card]:shadow-xl [&_.cl-card]:ring-1 [&_.cl-card]:ring-zinc-200/80 dark:[&_.cl-card]:ring-zinc-700/80">
          {children}
        </div>
      </main>
    </div>
  );
}
