import type { ReactNode } from "react";
import Link from "next/link";

export type SiteFailureAction = {
  href: string;
  label: string;
  primary?: boolean;
};

type SiteFailureProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions: SiteFailureAction[];
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
};

function actionClassName(primary?: boolean) {
  if (primary) {
    return "inline-flex items-center justify-center rounded-2xl bg-primary px-6 py-3 text-[13px] font-bold uppercase tracking-widest text-primary-foreground transition-all hover:opacity-90 active:scale-95";
  }
  return "inline-flex items-center justify-center rounded-2xl border border-border bg-card-bg px-6 py-3 text-[13px] font-bold uppercase tracking-widest text-foreground transition-all hover:bg-muted active:scale-95";
}

export function SiteFailure({
  eyebrow,
  title,
  description,
  actions,
  onRetry,
  retryLabel = "Try again",
  children,
}: SiteFailureProps) {
  return (
    <main className="mx-auto flex min-h-[60dvh] w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-overline text-muted-foreground">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {children}
      <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
        {onRetry ? (
          <button type="button" onClick={onRetry} className={actionClassName(true)}>
            {retryLabel}
          </button>
        ) : null}
        {actions.map((action) => (
          <Link
            key={action.href + action.label}
            href={action.href}
            className={actionClassName(action.primary)}
          >
            {action.label}
          </Link>
        ))}
      </div>
    </main>
  );
}
