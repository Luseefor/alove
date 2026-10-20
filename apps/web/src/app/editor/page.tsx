"use client";

import { Suspense } from "react";
import { EditorWorkbench } from "@/components/EditorWorkbench";
import { isLocalStandalone } from "@/lib/localStandalone";
import { RedirectToSignIn, useAuth } from "@clerk/nextjs";

function EditorPageCloud() {
  const { isLoaded, isSignedIn, userId } = useAuth();

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

  return <EditorWorkbench key={userId} />;
}

export default function EditorPage() {
  return (
    <Suspense fallback={<div role="status">Opening workspace…</div>}>
      {isLocalStandalone() ? <EditorWorkbench /> : <EditorPageCloud />}
    </Suspense>
  );
}
