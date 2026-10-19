"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function CloudProjectList() {
  const projects = useQuery(api.projects.listMine);
  return (
    <section className="space-y-4">
      <Link
        href="/editor?new=true"
        className="inline-block rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
      >
        New project
      </Link>
      {!projects ? (
        <p role="status">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p>No cloud projects yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {[...projects]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((project) => (
              <li key={project._id} className="py-3">
                <Link
                  href={`/editor?project=${project._id}`}
                  className="text-primary underline"
                >
                  {project.name}
                </Link>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
