"use client";

import { BrandMark } from "@/components/brand/BrandMark";

import Link from "next/link";
import { CloudProjectList } from "@/components/landing/CloudProjectList";
import { LocalProjectList } from "@/components/landing/LocalProjectList";
import { ProjectLauncher } from "@/components/landing/ProjectLauncher";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { isLocalStandalone } from "@/lib/localStandalone";

export default function ProjectsPage() {
  return (
    <main className="min-h-[100dvh] bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="font-bold text-primary">
            <span className="inline-flex items-center gap-2"><BrandMark className="h-6 w-6" />weftly</span>
          </Link>
          <ThemeToggle />
        </header>
        <h1 className="text-2xl font-bold">Projects</h1>
        {isLocalStandalone() ? (
          <>
            <ProjectLauncher />
            <LocalProjectList />
          </>
        ) : (
          <CloudProjectList />
        )}
      </div>
    </main>
  );
}
