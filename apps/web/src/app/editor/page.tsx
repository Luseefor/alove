"use client";

import { EditorWorkbench } from "@/components/EditorWorkbench";
import { RedirectToSignIn, useAuth } from "@clerk/nextjs";

export default function EditorPage() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (!isSignedIn) {
    return <RedirectToSignIn />;
  }

  return <EditorWorkbench />;
}
