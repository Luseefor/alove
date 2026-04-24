"use client";

import { EditorWorkbench } from "@/components/EditorWorkbench";
import { isLocalStandalone } from "@/lib/localStandalone";
import { RedirectToSignIn, useAuth } from "@clerk/nextjs";

function EditorPageCloud() {
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

export default function EditorPage() {
  if (isLocalStandalone()) {
    return <EditorWorkbench />;
  }
  return <EditorPageCloud />;
}
