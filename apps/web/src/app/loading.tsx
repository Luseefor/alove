export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="mx-auto flex min-h-[60dvh] w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center"
    >
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary"
      />
      <p className="mt-4 text-sm font-medium text-muted-foreground">Loading</p>
    </div>
  );
}
