import Link from "next/link";

export const metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6 text-foreground">
      <Link href="/" className="text-primary underline">
        Back to alove
      </Link>
      <h1 className="text-2xl font-bold">Writing with alove</h1>
      <p>
        Create a blank document or choose a template from Projects. Import an
        .alove.json source archive to make a separate project.
      </p>
      <p>
        Use the file browser to create, upload, rename and delete files. The
        file menu sets the main TeX document used by Build.
      </p>
      <p>
        Cite searches your BibTeX entries. Figure, Table and snippets insert at
        the current selection. Find supports Enter for the next match and
        Shift+Enter for the previous match.
      </p>
      <p>
        Equation and alignment examples may require amsmath; theorem
        environments need a matching declaration. Edit figure placeholders to
        refer to an uploaded image. Local projects autosave in this browser.
        Export source regularly for a portable backup. Local saving requires
        browser storage; compiling requires the local server, queue and TeX
        worker.
      </p>
      <p>
        After a successful build and a later failure, Build recovery tests
        whole-file restorations against the last successful source in the same
        compiler environment. Review the diff before applying. Undo restoration
        is available until the source changes.
      </p>
      <p>
        Share downloads source for someone else to import. It does not
        synchronize edits between people.
      </p>
      <Link
        href="/projects"
        className="inline-block rounded bg-primary px-4 py-2 text-primary-foreground"
      >
        Open projects
      </Link>
    </main>
  );
}
