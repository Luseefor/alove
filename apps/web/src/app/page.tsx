import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { LandingShell } from "@/components/LandingShell";
import { Button } from "@/components/ui/primitives";
import { isLocalStandalone } from "@/lib/localStandalone";

export default async function Home() {
  if (isLocalStandalone()) {
    return (
      <LandingShell>
        <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col justify-center gap-10 px-6 pb-16 pt-20">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-alove-fg-muted dark:text-alove-fg-muted">
              LaTeX workspace
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              alove
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-zinc-600 dark:text-zinc-300">
              Running in local mode: full editor and PDF builds on this machine.
              Convex sync and Clerk sign-in are off.
            </p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
            <Button variant="primary" size="md" href="/editor">
              Open editor
            </Button>
          </div>
        </main>
      </LandingShell>
    );
  }

  return (
    <LandingShell>
      <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col justify-center gap-10 px-6 pb-16 pt-20">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-alove-fg-muted dark:text-alove-fg-muted">
            LaTeX workspace
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            alove
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-600 dark:text-zinc-300">
            A focused editor with live Convex sync, Clerk sign-in, and fast PDF
            builds — tuned for clarity and everyday writing flow.
          </p>
        </div>
        <Show
          when="signed-out"
          fallback={
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
              <Button variant="primary" size="md" href="/editor">
                Open editor
              </Button>
              <UserButton />
            </div>
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <SignInButton mode="modal">
              <Button variant="primary" size="md" type="button">
                Sign in
              </Button>
            </SignInButton>
            <Button variant="outline" size="md" href="/sign-up">
              Create account
            </Button>
          </div>
        </Show>
      </main>
    </LandingShell>
  );
}
