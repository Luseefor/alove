import Link from "next/link";
export const metadata = { title: "Data and privacy" };

export default function PrivacyPage() {
  return <main className="mx-auto max-w-2xl space-y-5 p-6 text-foreground">
    <Link href="/" className="text-primary underline">Back to Weftly</Link>
    <h1 className="text-2xl font-bold">Your projects and data</h1>
    <p>Local mode stores projects, build history and settings in this browser. Other people using the same browser profile can access browser storage. Export source to keep an independent backup; browser storage can be cleared or evicted.</p>
    <p>In cloud mode, Clerk handles your account and sessions. Convex stores projects and files under your account. Signing out does not delete cloud projects. When the deployment has its signed Clerk webhook configured, deleting your Clerk account schedules deletion of its cloud projects and files. Use Delete in Projects to remove a project and its files from the application database.</p>
    <p>Unsaved cloud edits can have a recovery copy in this browser. The editor offers that copy when the same account reopens the same project in that tab. Signing out hides your workspace but does not erase browser recovery data. Clear site data when using a shared computer after exporting anything you need.</p>
    <p>Building sends the current source and assets to the compile service. The worker removes its temporary workspace after execution. The queue can retain source, logs and the PDF for operational recovery. Completed job retention is bounded by count and age, and failed jobs have a separate retention window. Deletion runs when the worker is available; outages can delay cleanup.</p>
    <p>Build recovery keeps source snapshots and diagnostic evidence in this browser. Source archives and debugging exports include your document text. Review them before sharing. This release has no advertising analytics or document-source telemetry integration.</p>
    <p>This page describes the application data flow. Hosting providers may keep operational backups and logs according to their configured policies. Deployment operators should publish their contact information and retention settings before inviting users.</p>
    <div className="flex flex-wrap gap-4"><Link href="/help" className="text-primary underline">Help</Link><Link href="/status" className="text-primary underline">Service status</Link><a href="https://github.com/Luseefor/alove/issues" className="text-primary underline">Report a problem</a></div>
  </main>;
}
