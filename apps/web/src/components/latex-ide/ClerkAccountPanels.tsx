"use client";

import { useClerk } from "@clerk/nextjs";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function ClerkAccountPanels() {
  const { openUserProfile } = useClerk();

  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground">Account</h3>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        Update your name, email, password, and connected accounts in your Clerk profile.
      </p>
      <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => openUserProfile()}>
        Open account settings
        <ExternalLink className="size-3.5 opacity-70" />
      </Button>
    </section>
  );
}
