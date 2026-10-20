"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useServiceReadiness } from "@/hooks/useServiceReadiness";

const ROWS = [
  {
    key: "configuration" as const,
    label: "Configuration",
    detail: "Server settings needed to accept compile jobs.",
  },
  {
    key: "redis" as const,
    label: "Compile queue",
    detail: "Queue connection used to hand jobs to the worker.",
  },
  {
    key: "worker" as const,
    label: "Compile worker",
    detail: "Recent worker heartbeat for TeX builds.",
  },
] as const;

function badgeClass(state: "Ready" | "Unavailable" | "Checking"): string {
  if (state === "Ready") {
    return "bg-success-bg text-success border-success-border";
  }
  if (state === "Checking") {
    return "bg-muted text-muted-foreground border-border";
  }
  return "bg-error-bg text-error border-error-border";
}

export default function StatusPage() {
  const { status, checks, offline, loading, retry } = useServiceReadiness();
  const overall = status === "ready" ? "Ready" : status === "checking" ? "Checking" : "Unavailable";

  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <Link href="/" className="text-primary underline">
        Back to alove
      </Link>
      <div className="space-y-2">
        <p className="text-overline text-muted-foreground">Service status</p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Compile backend readiness
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This page reports the compile backend only. It does not check cloud
          sign-in or document sync.
        </p>
      </div>

      <div
        role={overall === "Unavailable" ? "alert" : "status"}
        aria-live="polite"
        className="rounded-shell border border-border bg-card-bg p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[14px] font-black text-foreground">
            Overall
          </span>
          <span
            className={cn(
              "text-[10px] font-black uppercase tracking-[0.15em] px-2.5 py-1 rounded-full border shadow-sm",
              badgeClass(overall),
            )}
          >
            {loading && status === "checking" ? "Checking" : overall}
          </span>
        </div>
        {offline ? (
          <p className="mt-3 text-[12px] font-bold text-muted-foreground">
            You are offline. Showing unavailable until the connection returns.
          </p>
        ) : null}
        {overall === "Unavailable" ? (
          <p className="mt-3 text-[12px] font-bold text-muted-foreground">
            The compile backend is unavailable. Retry or check the help page.
          </p>
        ) : null}
      </div>

      <ul className="space-y-3">
        {ROWS.map((row) => {
          const value = checks?.[row.key];
          const state =
            status === "checking" || loading && checks === null
              ? "Checking"
              : value
                ? "Ready"
                : "Unavailable";
          return (
            <li
              key={row.key}
              className="flex items-start justify-between gap-4 rounded-3xl border border-border bg-card-bg p-5"
            >
              <div className="space-y-1">
                <p className="text-[14px] font-black text-foreground">
                  {row.label}
                </p>
                <p className="text-[12px] font-bold leading-tight text-muted-foreground opacity-70">
                  {row.detail}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 text-[10px] font-black uppercase tracking-[0.15em] px-2.5 py-1 rounded-full border shadow-sm",
                  badgeClass(state),
                )}
              >
                {state}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center justify-center rounded-2xl bg-primary px-6 py-3 text-[13px] font-bold uppercase tracking-widest text-primary-foreground transition-all hover:opacity-90 active:scale-95"
        >
          Retry
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-2xl bg-primary px-6 py-3 text-[13px] font-bold uppercase tracking-widest text-primary-foreground transition-all hover:opacity-90"
        >
          Go home
        </Link>
        <Link
          href="/help"
          className="inline-flex items-center justify-center rounded-2xl border border-border bg-card-bg px-6 py-3 text-[13px] font-bold uppercase tracking-widest text-foreground transition-all hover:bg-muted"
        >
          Get help
        </Link>
      </div>
    </main>
  );
}
