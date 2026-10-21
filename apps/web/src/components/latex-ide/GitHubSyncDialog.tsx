"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GitHubSync } from "./GitHubSync";
export function GitHubSyncDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded border border-border px-2 py-1.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          GitHub
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>GitHub repository sync</DialogTitle>
          <DialogDescription>
            Connect a repository and branch. Preview pulls before importing
            source, and push saved changes when the remote branch matches your
            last sync.
          </DialogDescription>
        </DialogHeader>
        <GitHubSync />
      </DialogContent>
    </Dialog>
  );
}
